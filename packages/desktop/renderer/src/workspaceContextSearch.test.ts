// @vitest-environment node

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  serializeTaskCanonical,
  type CodingTaskResult,
  type RoomRecord
} from '@room/engine';
import { bindCurrentRoom } from '../../main/ipc/shared.js';
import { searchContextItems } from '../../main/ipc/workspace-context.js';

const roots: string[] = [];

async function fixture(): Promise<{ record: RoomRecord; source: RoomRecord['manifest']['sources'][number] }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-context-search-'));
  roots.push(root);
  const roomRoot = path.join(root, 'home', 'rooms', 'room_personal');
  const sourceRoot = path.join(root, 'source');
  await Promise.all([
    fs.mkdir(path.join(roomRoot, 'documents'), { recursive: true }),
    fs.mkdir(sourceRoot)
  ]);
  await fs.writeFile(
    path.join(roomRoot, 'documents', 'unrelated-name.md'),
    '# Room note\nThe needlesymbol appears only in this content.\n'
  );
  await fs.writeFile(
    path.join(sourceRoot, 'unrelated-source.md'),
    '# Source note\nThe needlesymbol also appears only inside this file.\n'
  );
  const canonicalPath = await fs.realpath(sourceRoot);
  const stat = await fs.lstat(canonicalPath, { bigint: true });
  const source = {
    id: 'source_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    type: 'directory' as const,
    name: 'Source',
    path: sourceRoot,
    canonicalPath,
    rootDevice: stat.dev.toString(),
    rootInode: stat.ino.toString(),
    rootBirthtimeNs: stat.birthtimeNs.toString(),
    attachedAt: new Date().toISOString()
  };
  const manifest = {
    schemaVersion: 1 as const,
    id: 'room_personal',
    name: 'Personal Room',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    activeSourceId: source.id,
    sources: [source]
  };
  const record: RoomRecord = { roomRoot, manifest };
  await fs.writeFile(path.join(roomRoot, 'room.json'), JSON.stringify(manifest));
  bindCurrentRoom(record);
  return { record, source };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('context search', () => {
  it('finds Room and Source files when terms occur only in bounded previews', async () => {
    const { record, source } = await fixture();
    const results = await searchContextItems(record.manifest.id, source, 'needlesymbol');

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '.room/documents/unrelated-name.md' }),
      expect.objectContaining({ path: 'unrelated-source.md' })
    ]));
  });

  it('bounds results and Room-file inspection for a large long-lived Room', async () => {
    const { record } = await fixture();
    const documents = path.join(record.roomRoot, 'documents');
    await Promise.all(Array.from({ length: 2600 }, (_, index) => (
      fs.writeFile(path.join(documents, `bounded-${index}.md`), '# Bounded\n')
    )));

    const results = await searchContextItems(record.manifest.id, undefined, 'bounded');
    expect(results).toHaveLength(80);
    expect(results.every(result => result.path?.startsWith('.room/documents/bounded-')))
      .toBe(true);
  }, 10_000);

  it('indexes canonical task and discussion records through virtual markdown refs', async () => {
    const { record } = await fixture();
    await Promise.all([
      fs.mkdir(path.join(record.roomRoot, 'tasks'), { recursive: true }),
      fs.mkdir(path.join(record.roomRoot, 'discussions'), { recursive: true })
    ]);
    const task: CodingTaskResult = {
      id: 'task-canonical-search',
      title: 'Canonical release task',
      task: 'Find taskneedle in this task.',
      status: 'approved',
      cycles: 1,
      messages: [],
      participants: [],
      markdownFilename: 'task-canonical-search.md',
      jsonFilename: 'task-canonical-search.json',
      sourceProvenance: {
        mode: 'room-only',
        roomId: record.manifest.id,
        startedAt: '2026-07-27T00:00:00.000Z'
      }
    };
    await fs.writeFile(
      path.join(record.roomRoot, 'tasks', 'task-canonical-search.json'),
      serializeTaskCanonical(task)
    );
    await fs.writeFile(
      path.join(record.roomRoot, 'discussions', 'discussion-canonical-search.json'),
      JSON.stringify({
        id: 'discussion-canonical-search',
        title: 'Canonical discussion',
        topic: 'Find discussionneedle in this chat.',
        status: 'completed',
        messages: [],
        sourceProvenance: task.sourceProvenance
      })
    );

    await expect(searchContextItems(record.manifest.id, undefined, 'taskneedle'))
      .resolves.toContainEqual(expect.objectContaining({
        ref: 'task:task-canonical-search.md',
        path: '.room/tasks/task-canonical-search.md'
      }));
    await expect(searchContextItems(record.manifest.id, undefined, 'discussionneedle'))
      .resolves.toContainEqual(expect.objectContaining({
        ref: 'discussion:discussion-canonical-search.md',
        path: '.room/discussions/discussion-canonical-search.md'
      }));
  });
});
