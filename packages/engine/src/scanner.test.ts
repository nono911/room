import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveCurrentScanSnapshot,
  scanDirectory,
  writeScanData,
  type ScanResult
} from './scanner.js';
import {
  SCAN_ORPHAN_GRACE_MS,
  withCurrentScanSnapshot
} from './scanSnapshot.js';
import type { WorkspaceLocation } from './workspace.js';
import { roomPathUsageBytes } from './roomFile.js';
import { loadRunContextFiles } from './discussion/runContext.js';

const roots: string[] = [];

function scan(projectName: string): ScanResult {
  return {
    projectName,
    technologies: { frontend: [], backend: [], database: [], tools: [], languages: [] },
    fileCount: 1,
    structure: { src: ['index.ts'] }
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('Source scan storage', () => {
  it('rejects the exact serialized scan payload before publishing above quota', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-quota-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    const workspace: WorkspaceLocation = {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_00000000000000000000000000000001',
      sourceName: 'Quota',
      sourceRoot: path.join(root, 'source')
    };
    const previousQuota = process.env.ROOM_TEST_STORAGE_QUOTA_BYTES;
    process.env.ROOM_TEST_STORAGE_QUOTA_BYTES = '512';
    try {
      await expect(writeScanData(workspace, scan('Quota Project')))
        .rejects.toThrow('storage quota exceeded');
      await expect(resolveCurrentScanSnapshot(workspace)).resolves.toBeUndefined();
    } finally {
      if (previousQuota === undefined) delete process.env.ROOM_TEST_STORAGE_QUOTA_BYTES;
      else process.env.ROOM_TEST_STORAGE_QUOTA_BYTES = previousQuota;
    }
  });

  it('admits a same-size scan rollover at quota after exact pruning credit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-rollover-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    const workspace: WorkspaceLocation = {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_99999999999999999999999999999999',
      sourceName: 'Rollover',
      sourceRoot: path.join(root, 'source')
    };
    const fixedScan = scan('Same-size generation');
    for (let index = 0; index < 5; index += 1) {
      await writeScanData(workspace, fixedScan, { overview: 'x'.repeat(8 * 1024) });
    }
    const usageAtRetention = await roomPathUsageBytes(roomRoot);
    const ledgerAtRetention = JSON.parse(await fs.readFile(
      path.join(roomRoot, '.room-usage.json'),
      'utf-8'
    ));
    expect(ledgerAtRetention.entries).toBeGreaterThan(0);
    const previousQuota = process.env.ROOM_TEST_STORAGE_QUOTA_BYTES;
    process.env.ROOM_TEST_STORAGE_QUOTA_BYTES = String(usageAtRetention);
    try {
      await expect(writeScanData(
        workspace,
        fixedScan,
        { overview: 'x'.repeat(8 * 1024) }
      )).resolves.toBeUndefined();
      expect(await roomPathUsageBytes(roomRoot)).toBe(usageAtRetention);
      expect(JSON.parse(await fs.readFile(
        path.join(roomRoot, '.room-usage.json'),
        'utf-8'
      )).entries).toBe(ledgerAtRetention.entries);
    } finally {
      if (previousQuota === undefined) delete process.env.ROOM_TEST_STORAGE_QUOTA_BYTES;
      else process.env.ROOM_TEST_STORAGE_QUOTA_BYTES = previousQuota;
    }
  });

  it('does not stage a credited rollover when pre-pruning fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-prune-failure-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    const workspace: WorkspaceLocation = {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_88888888888888888888888888888888',
      sourceName: 'Prune failure',
      sourceRoot: path.join(root, 'source')
    };
    for (let index = 0; index < 5; index += 1) {
      await writeScanData(workspace, scan(`Generation ${index}`));
    }
    const currentBefore = await resolveCurrentScanSnapshot(workspace);
    const usageBefore = await roomPathUsageBytes(roomRoot);
    const generationsRoot = path.join(
      roomRoot,
      'sources',
      workspace.sourceId!,
      'scan',
      'generations'
    );
    await fs.chmod(generationsRoot, 0o500);
    try {
      await expect(writeScanData(workspace, scan('Rejected generation')))
        .rejects.toThrow();
    } finally {
      await fs.chmod(generationsRoot, 0o700);
    }

    expect(await resolveCurrentScanSnapshot(workspace)).toBe(currentBefore);
    expect(await roomPathUsageBytes(roomRoot)).toBe(usageBefore);
  });

  it('keeps scans isolated by Source and preserves Room overview memory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(path.join(roomRoot, 'context'), { recursive: true });
    await fs.writeFile(path.join(roomRoot, 'context', 'overview.md'), 'Room memory sentinel', 'utf-8');
    const base: Omit<WorkspaceLocation, 'sourceId' | 'sourceRoot' | 'sourceName'> = {
      roomId: 'room_test',
      roomRoot
    };
    const first = {
      ...base,
      sourceId: 'source_11111111111111111111111111111111',
      sourceName: 'First',
      sourceRoot: path.join(root, 'first')
    };
    const second = {
      ...base,
      sourceId: 'source_22222222222222222222222222222222',
      sourceName: 'Second',
      sourceRoot: path.join(root, 'second')
    };

    await writeScanData(first, scan('First Project'));
    await writeScanData(second, scan('Second Project'));
    const firstSnapshot = await resolveCurrentScanSnapshot(first);
    const secondSnapshot = await resolveCurrentScanSnapshot(second);

    expect(await fs.readFile(path.join(roomRoot, 'context', 'overview.md'), 'utf-8'))
      .toBe('Room memory sentinel');
    expect(await fs.readFile(path.join(firstSnapshot!, 'overview.md'), 'utf-8'))
      .toContain('First Project');
    expect(await fs.readFile(path.join(secondSnapshot!, 'overview.md'), 'utf-8'))
      .toContain('Second Project');
  });

  it('rejects a symlink planted in Source-derived Room storage', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-symlink-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    const outside = path.join(root, 'outside');
    const sourceId = 'source_33333333333333333333333333333333';
    await fs.mkdir(path.join(roomRoot, 'sources', sourceId), { recursive: true });
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(roomRoot, 'sources', sourceId, 'scan'), 'dir');

    await expect(writeScanData({
      roomId: 'room_test',
      roomRoot,
      sourceId,
      sourceName: 'Unsafe',
      sourceRoot: path.join(root, 'source')
    }, scan('Unsafe Project'))).rejects.toThrow('symbolic link');
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('publishes concurrent scan files as one consistent snapshot', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-atomic-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    const sourceId = 'source_44444444444444444444444444444444';
    const workspace: WorkspaceLocation = {
      roomId: 'room_test',
      roomRoot,
      sourceId,
      sourceName: 'Atomic',
      sourceRoot: path.join(root, 'source')
    };

    await Promise.all([
      writeScanData(workspace, scan('First Snapshot')),
      writeScanData(workspace, scan('Second Snapshot'))
    ]);

    const scanRoot = await resolveCurrentScanSnapshot(workspace);
    expect(scanRoot).toBeDefined();
    const overview = await fs.readFile(path.join(scanRoot, 'overview.md'), 'utf-8');
    const structure = await fs.readFile(path.join(scanRoot, 'structure.md'), 'utf-8');
    const map = JSON.parse(await fs.readFile(path.join(scanRoot, 'project-map.json'), 'utf-8'));
    expect(overview).toContain(map.projectName);
    expect(structure).toContain(map.projectName);
    expect(JSON.parse(await fs.readFile(path.join(scanRoot, 'provenance.json'), 'utf-8')))
      .toMatchObject({ roomId: 'room_test', sourceId });
  });

  it('keeps a captured generation readable after a newer generation is published', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-generation-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    const workspace: WorkspaceLocation = {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_55555555555555555555555555555555',
      sourceName: 'Generation',
      sourceRoot: path.join(root, 'source')
    };
    await writeScanData(workspace, scan('First Generation'));
    const captured = await resolveCurrentScanSnapshot(workspace);
    await writeScanData(workspace, scan('Second Generation'));
    const current = await resolveCurrentScanSnapshot(workspace);

    expect(captured).toBeDefined();
    expect(current).toBeDefined();
    expect(current).not.toBe(captured);
    expect(await fs.readFile(path.join(captured!, 'overview.md'), 'utf-8'))
      .toContain('First Generation');
    expect(await fs.readFile(path.join(current!, 'overview.md'), 'utf-8'))
      .toContain('Second Generation');
  });

  it('bounds retained scan generations while preserving the current overlap window', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-retention-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    const workspace: WorkspaceLocation = {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_66666666666666666666666666666666',
      sourceName: 'Retention',
      sourceRoot: path.join(root, 'source')
    };

    for (let index = 0; index < 8; index += 1) {
      await writeScanData(workspace, scan(`Generation ${index}`));
    }

    const current = await resolveCurrentScanSnapshot(workspace);
    const generationsRoot = path.join(
      roomRoot,
      'sources',
      workspace.sourceId!,
      'scan',
      'generations'
    );
    const retained = await fs.readdir(generationsRoot);
    expect(retained).toHaveLength(5);
    expect(retained).toContain(path.basename(current!));
    expect(await fs.readFile(path.join(current!, 'overview.md'), 'utf-8'))
      .toContain('Generation 7');
  });

  it('holds a reader lease while later scans publish and prune generations', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-lease-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    const workspace: WorkspaceLocation = {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_77777777777777777777777777777777',
      sourceName: 'Lease',
      sourceRoot: path.join(root, 'source')
    };
    await writeScanData(workspace, scan('Leased Generation'));
    let releaseReader = (): void => {};
    const readerGate = new Promise<void>(resolve => {
      releaseReader = resolve;
    });
    let readerEntered = (): void => {};
    const entered = new Promise<void>(resolve => {
      readerEntered = resolve;
    });
    const reader = withCurrentScanSnapshot(workspace, async snapshotRoot => {
      readerEntered();
      await readerGate;
      return fs.readFile(path.join(snapshotRoot, 'overview.md'), 'utf-8');
    });
    await entered;
    let publishersFinished = false;
    const publishers = Promise.all(Array.from({ length: 6 }, (_, index) => (
      writeScanData(workspace, scan(`Later ${index}`))
    ))).then(() => {
      publishersFinished = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(publishersFinished).toBe(false);
    releaseReader();
    await expect(reader).resolves.toContain('Leased Generation');
    await publishers;
  });

  it('reclaims stale unpublished generations left by interrupted scans', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-orphan-'));
    roots.push(root);
    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    const workspace: WorkspaceLocation = {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_88888888888888888888888888888888',
      sourceName: 'Orphan',
      sourceRoot: path.join(root, 'source')
    };
    const orphan = path.join(
      roomRoot,
      'sources',
      workspace.sourceId!,
      'scan',
      'generations',
      `generation-${'a'.repeat(32)}`
    );
    await fs.mkdir(orphan, { recursive: true });
    await fs.writeFile(path.join(orphan, 'partial'), 'partial');
    const stale = new Date(Date.now() - SCAN_ORPHAN_GRACE_MS - 1000);
    await fs.utimes(orphan, stale, stale);

    await writeScanData(workspace, scan('Recovery'));
    await expect(fs.access(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('skips file and directory symlinks instead of reading outside the Source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-source-symlink-'));
    roots.push(root);
    const sourceRoot = path.join(root, 'source');
    const outsideRoot = path.join(root, 'outside');
    await Promise.all([fs.mkdir(sourceRoot), fs.mkdir(outsideRoot)]);
    await fs.writeFile(path.join(outsideRoot, 'package.json'), JSON.stringify({
      dependencies: { react: 'latest' }
    }));
    await fs.symlink(path.join(outsideRoot, 'package.json'), path.join(sourceRoot, 'package.json'));
    await fs.symlink(outsideRoot, path.join(sourceRoot, 'outside-dir'), 'dir');
    await fs.writeFile(path.join(sourceRoot, 'index.ts'), 'export {};');

    const result = await scanDirectory(sourceRoot);
    expect(result.fileCount).toBe(1);
    expect(result.technologies.frontend).toEqual([]);
    expect(result.structure).not.toHaveProperty('outside-dir');
  });

  it('rejects a Source root whose persisted filesystem identity no longer matches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-source-identity-'));
    roots.push(root);
    const sourceRoot = path.join(root, 'source');
    await fs.mkdir(sourceRoot);
    const stat = await fs.lstat(sourceRoot, { bigint: true });

    await expect(scanDirectory(sourceRoot, {
      device: stat.dev.toString(),
      inode: (stat.ino + 1n).toString(),
      birthtimeNs: stat.birthtimeNs.toString()
    })).rejects.toThrow('root changed after authorization');
  });

  it('preserves visible technology detection while excluding hidden Source paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-parity-'));
    roots.push(root);
    const sourceRoot = path.join(root, 'source');
    const appRoot = path.join(sourceRoot, 'app');
    const hiddenRoot = path.join(sourceRoot, '.github');
    await Promise.all([
      fs.mkdir(appRoot, { recursive: true }),
      fs.mkdir(hiddenRoot, { recursive: true })
    ]);
    await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({
      dependencies: {
        nuxt: 'latest',
        nest: 'latest',
        fastify: 'latest',
        mongodb: 'latest',
        sequelize: 'latest',
        tailwindcss: 'latest',
        webpack: 'latest'
      }
    }));
    await Promise.all([
      fs.writeFile(path.join(appRoot, 'requirements.txt'), ''),
      fs.writeFile(path.join(appRoot, 'go.mod'), ''),
      fs.writeFile(path.join(appRoot, 'Cargo.toml'), ''),
      fs.writeFile(path.join(appRoot, 'index.ts'), 'export {};\n'),
      fs.writeFile(path.join(hiddenRoot, 'workflow.ts'), 'export {};\n')
    ]);

    const result = await scanDirectory(sourceRoot);
    expect(result.technologies).toMatchObject({
      frontend: ['Nuxt.js'],
      backend: expect.arrayContaining(['NestJS', 'Fastify', 'Python', 'Go Modules']),
      database: expect.arrayContaining(['MongoDB', 'Sequelize']),
      tools: expect.arrayContaining(['TailwindCSS', 'Webpack', 'Cargo']),
      languages: ['TypeScript']
    });
    expect(result.structure).not.toHaveProperty('.github');
    expect(JSON.stringify(result)).not.toContain('workflow.ts');

    const roomRoot = path.join(root, 'room');
    await fs.mkdir(roomRoot);
    const workspace: WorkspaceLocation = {
      roomId: 'room_test',
      roomRoot,
      sourceId: 'source_77777777777777777777777777777777',
      sourceName: 'Visible Source',
      sourceRoot
    };
    await writeScanData(workspace, result);
    const snapshot = await resolveCurrentScanSnapshot(workspace);
    const persisted = await fs.readFile(path.join(snapshot!, 'project-map.json'), 'utf-8');
    const runContext = await loadRunContextFiles(workspace);
    expect(persisted).not.toContain('workflow.ts');
    expect(JSON.stringify(runContext)).not.toContain('.github');
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'skips an unreadable nested directory and scans accessible siblings',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-unreadable-'));
      roots.push(root);
      const sourceRoot = path.join(root, 'source');
      const blocked = path.join(sourceRoot, 'blocked');
      const accessible = path.join(sourceRoot, 'accessible');
      await Promise.all([
        fs.mkdir(blocked, { recursive: true }),
        fs.mkdir(accessible, { recursive: true })
      ]);
      await fs.writeFile(path.join(blocked, 'secret.ts'), 'export {};\n');
      await fs.writeFile(path.join(accessible, 'visible.ts'), 'export {};\n');
      await fs.chmod(blocked, 0o000);
      try {
        const result = await scanDirectory(sourceRoot);
        expect(result.technologies.languages).toContain('TypeScript');
        expect(result.structure.accessible).toContain('visible.ts');
        expect(result.structure).not.toHaveProperty('blocked');
      } finally {
        await fs.chmod(blocked, 0o700);
      }
    }
  );

  it('marks a scan truncated at the per-directory inspection budget', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-budget-'));
    roots.push(root);
    const sourceRoot = path.join(root, 'source');
    await fs.mkdir(sourceRoot);
    await Promise.all(Array.from({ length: 4100 }, (_, index) => (
      fs.writeFile(path.join(sourceRoot, `entry-${index}.ts`), '')
    )));

    const result = await scanDirectory(sourceRoot);
    expect(result.truncated).toBe(true);
    expect(result.fileCount).toBeLessThanOrEqual(4096);
  });

  it('keeps the authorized Source inode pinned when its pathname is replaced mid-scan', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-scan-source-swap-'));
    roots.push(root);
    const sourceRoot = path.join(root, 'source');
    const movedRoot = path.join(root, 'source-moved');
    await fs.mkdir(sourceRoot);
    await Promise.all(Array.from({ length: 100 }, (_, index) => (
      fs.writeFile(path.join(sourceRoot, `original-${index}.ts`), 'export {};\n', 'utf-8')
    )));
    const stat = await fs.lstat(sourceRoot, { bigint: true });
    const scan = scanDirectory(sourceRoot, {
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
      birthtimeNs: stat.birthtimeNs.toString()
    });

    await fs.rename(sourceRoot, movedRoot);
    await fs.mkdir(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, 'package.json'), JSON.stringify({
      dependencies: { react: 'latest' }
    }));

    const result = await scan;
    expect(result.fileCount).toBe(100);
    expect(result.technologies.frontend).not.toContain('React');
  });
});
