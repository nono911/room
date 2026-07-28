import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import {
  createRoomSkillReference,
  parseRoomSkillReference,
  parseTaskCanonical,
  readRoomTextFile,
  renderCodingTaskMarkdown,
  renderDiscussionMarkdown,
  withRoomStorageReconciliation
} from '@room/engine';
import {
  ALLOWED_ROOM_FILE_SECTIONS,
  requireBoundRoom, requireBoundRoomWorkspace, resolveWithinProject, resolveWithinRoomData,
  sanitizeFileName, isAllowed, isPlainObject
} from './shared.js';
import type { ContextSet, RoomArtifactSection } from '../../shared/types/domain.js';
import { writeRoomDataFileAtomically } from './room-file-write.js';
import {
  toRendererDiscussionLog,
  toRendererTaskResult
} from './renderer-safe.js';
import { assertUtf8Bytes, IPC_LIMITS } from './ipc-limits.js';
import { toPublicError } from './public-error.js';
import { listRoomArtifactPage } from './room-artifact-pages.js';
import { listRoomTaskRunPage } from './task-run-pages.js';

const ROOM_FILE_PREVIEW_BYTES = 4 * 1024 * 1024;

function assertVisibleRoomFilename(filename: string): void {
  if (filename.startsWith('.')) {
    throw new Error('ROOM filenames cannot be hidden.');
  }
}

function validateContextSets(value: unknown): ContextSet[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error('Invalid context sets.');
  }
  return value.map((item) => {
    if (!isPlainObject(item)) throw new Error('Invalid context set.');
    const { id, name, refs, createdAt, updatedAt } = item;
    if (
      typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
      typeof name !== 'string' || !name.trim() || name.length > 80 ||
      !Array.isArray(refs) || refs.length > 200 ||
      !refs.every(ref => typeof ref === 'string' && ref.length > 0 && ref.length <= 500) ||
      typeof createdAt !== 'string' || typeof updatedAt !== 'string'
    ) {
      throw new Error('Invalid context set.');
    }
    return {
      id,
      name: name.trim(),
      refs: Array.from(new Set(refs)),
      createdAt,
      updatedAt
    };
  });
}

async function removeSupersededDiscussionSummaries(
  roomId: string,
  documentsDir: string,
  keepFilename: string
): Promise<void> {
  const match = keepFilename.match(/-discussion-[A-Za-z0-9_-]+-summary\.md$/);
  if (!match) return;

  const suffix = match[0];
  try {
    const { safeReadDir } = await import('./shared.js');
    const files = await safeReadDir(documentsDir);
    await withRoomStorageReconciliation(
      requireBoundRoomWorkspace(roomId),
      () => Promise.all(files
        .filter(file => file.endsWith(suffix) && file !== keepFilename)
        .map(file => fs.rm(resolveWithinProject(documentsDir, file), { force: true })))
    );
  } catch {
    // Best-effort cleanup; saving the requested file should still proceed.
  }
}

export function registerFilesIpc(): void {
  ipcMain.handle('list-room-artifacts', async (
    _event,
    {
      roomId,
      section,
      cursor
    }: { roomId: string; section: string; cursor?: string }
  ) => {
    try {
      requireBoundRoom(roomId);
      if (!isAllowed(section, ['documents', 'reviews', 'discussions', 'tasks', 'decisions'] as const)) {
        throw new Error('Invalid ROOM artifact section.');
      }
      assertUtf8Bytes(cursor || '', 'Artifact cursor', 512);
      return {
        success: true,
        ...await listRoomArtifactPage(
          roomId,
          section as RoomArtifactSection,
          cursor || undefined
        )
      };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('list-room-task-runs', async (
    _event,
    { roomId, cursor }: { roomId: string; cursor?: string }
  ) => {
    try {
      requireBoundRoom(roomId);
      assertUtf8Bytes(cursor || '', 'Task run cursor', 512);
      return {
        success: true,
        ...await listRoomTaskRunPage(roomId, cursor || undefined)
      };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('load-context-sets', async (_event, { roomId }: { roomId: string }) => {
    try {
      requireBoundRoom(roomId);
      try {
        const content = await readRoomTextFile(
          requireBoundRoomWorkspace(roomId),
          ['context', 'sets.json'],
          256 * 1024
        );
        return { success: true, contextSets: validateContextSets(JSON.parse(content)) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { success: true, contextSets: [] };
        }
        throw error;
      }
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('save-context-sets', async (
    _event,
    { roomId, contextSets }: { roomId: string; contextSets: unknown }
  ) => {
    try {
      requireBoundRoom(roomId);
      const validated = validateContextSets(contextSets);
      const contextDir = resolveWithinRoomData(roomId, 'context');
      await fs.mkdir(contextDir, { recursive: true });
      await writeRoomDataFileAtomically(
        roomId,
        ['context', 'sets.json'],
        JSON.stringify(validated, null, 2)
      );
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('read-room-file', async (_event, { roomId, section, filename }: { roomId: string; section: string; filename: string }) => {
    try {
      assertUtf8Bytes(section, 'ROOM file section', 64);
      assertUtf8Bytes(filename, 'Filename', 255);
      if (!isAllowed(section, ALLOWED_ROOM_FILE_SECTIONS)) {
        return { success: false, error: 'Invalid ROOM file section.' };
      }

      requireBoundRoom(roomId);
      const roomSkill = section === 'skills'
        ? parseRoomSkillReference(filename)
        : null;
      if (section === 'skills' && !roomSkill) {
        throw new Error('A qualified Room skill reference is required.');
      }
      const safeFilename = roomSkill?.filename || sanitizeFileName(filename);
      const workspace = requireBoundRoomWorkspace(roomId);
      if (section === 'tasks' && /^task-[\w-]+\.md$/i.test(safeFilename)) {
        const canonical = await readRoomTextFile(
          workspace,
          ['tasks', safeFilename.replace(/\.md$/i, '.json')],
          8 * 1024 * 1024
        );
        return {
          success: true,
          content: renderCodingTaskMarkdown(parseTaskCanonical(canonical)),
          sourceSection: 'tasks'
        };
      }
      if (section === 'discussions' && /^discussion-[\w-]+\.md$/i.test(safeFilename)) {
        const canonical = JSON.parse(await readRoomTextFile(
          workspace,
          ['discussions', safeFilename.replace(/\.md$/i, '.json')],
          8 * 1024 * 1024
        ));
        return {
          success: true,
          content: renderDiscussionMarkdown(canonical),
          sourceSection: 'discussions'
        };
      }
      const sectionsToTry = roomSkill
        ? [roomSkill.source]
        : section === 'documents'
        ? ['documents', 'reviews', 'decisions']
        : section === 'skills'
          ? ['skills', 'roles']
          : [section];

      let filePath = '';
      let sourceSection = '';
      for (const sectionToTry of sectionsToTry) {
        const candidate = resolveWithinRoomData(roomId, sectionToTry, safeFilename);
        try {
          const stat = await fs.stat(candidate);
          if (stat.isFile()) {
            filePath = candidate;
            sourceSection = sectionToTry;
            break;
          }
        } catch {}
      }

      if (!filePath) {
        return { success: false, error: 'Selected item is not a file.' };
      }

      const content = await readRoomTextFile(
        workspace,
        [sourceSection, safeFilename],
        ROOM_FILE_PREVIEW_BYTES
      );
      if (
        (sourceSection === 'tasks' || sourceSection === 'discussions')
        && safeFilename.endsWith('.json')
      ) {
        return {
          success: true,
          content: JSON.stringify(
            sourceSection === 'tasks'
              ? toRendererTaskResult(parseTaskCanonical(content))
              : toRendererDiscussionLog(JSON.parse(content)),
            null,
            2
          ),
          sourceSection
        };
      }
      return { success: true, content, sourceSection };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('delete-discussion', async (
    _event,
    { roomId, filename }: { roomId: string; filename: string }
  ) => {
    try {
      requireBoundRoom(roomId);
      assertUtf8Bytes(filename || '', 'Discussion filename', 255);
      const safeFilename = sanitizeFileName(filename || '');
      if (
        filename !== safeFilename
        || !/^discussion-[A-Za-z0-9_-]+\.(?:md|json)$/i.test(safeFilename)
      ) {
        throw new Error('Invalid discussion filename.');
      }
      const baseName = safeFilename.replace(/\.(?:md|json)$/i, '');
      await withRoomStorageReconciliation(
        requireBoundRoomWorkspace(roomId),
        () => Promise.all([
          fs.rm(resolveWithinRoomData(roomId, 'discussions', `${baseName}.json`), { force: true }),
          fs.rm(resolveWithinRoomData(roomId, 'discussions', `${baseName}.md`), { force: true })
        ])
      );
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('save-room-file', async (_event, { roomId, section, filename, content }: { roomId: string; section: string; filename: string; content: string }) => {
    try {
      if (!isAllowed(section, ['documents', 'tasks'] as const)) {
        return { success: false, error: 'Invalid ROOM file section.' };
      }
      assertUtf8Bytes(content, 'File content', IPC_LIMITS.roomFileBytes);
      assertUtf8Bytes(filename || '', 'Filename', 255);

      requireBoundRoom(roomId);
      const safeFilename = sanitizeFileName(filename || 'untitled', 'untitled');
      assertVisibleRoomFilename(safeFilename);
      const fileNameWithExt = safeFilename.endsWith('.md') ? safeFilename : `${safeFilename}.md`;
      const sectionDir = resolveWithinRoomData(roomId, section);
      await fs.mkdir(sectionDir, { recursive: true });
      if (section === 'documents') {
        await removeSupersededDiscussionSummaries(roomId, sectionDir, fileNameWithExt);
      }
      await writeRoomDataFileAtomically(roomId, [section, fileNameWithExt], content);
      return { success: true, filename: fileNameWithExt };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('save-context-file', async (_event, { roomId, filename, content }: { roomId: string; filename: string; content: string }) => {
    try {
      if (filename !== 'overview.md' && filename !== 'structure.md') {
        return { success: false, error: 'Invalid context file.' };
      }
      assertUtf8Bytes(content, 'Context content', IPC_LIMITS.contextFileBytes);

      requireBoundRoom(roomId);
      const contextDir = resolveWithinRoomData(roomId, 'context');
      await fs.mkdir(contextDir, { recursive: true });
      await writeRoomDataFileAtomically(roomId, ['context', filename], content);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('save-skill', async (_event, { roomId, name, content, source }: { roomId: string; name: string; content: string; source?: 'skills' | 'roles' }) => {
    try {
      assertUtf8Bytes(content, 'Skill content', IPC_LIMITS.skillFileBytes);
      assertUtf8Bytes(name || '', 'Skill name', 255);
      requireBoundRoom(roomId);
      const subfolder = source === 'roles' ? 'roles' : 'skills';
      const skillsDir = resolveWithinRoomData(roomId, subfolder);
      await fs.mkdir(skillsDir, { recursive: true });
      const filename = sanitizeFileName(name || 'untitled', 'untitled');
      assertVisibleRoomFilename(filename);
      const fileNameWithExt = filename.endsWith('.md') ? filename : `${filename}.md`;
      await writeRoomDataFileAtomically(roomId, [subfolder, fileNameWithExt], content);
      return {
        success: true,
        reference: createRoomSkillReference(subfolder, fileNameWithExt)
      };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

}
