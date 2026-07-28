import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { promisify } from 'util';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withAiRunAdmission } from './aiRunAdmission.js';
import { analyzeFeatureImpact } from './impact/analyzer.js';
import { GeminiProvider } from './providers/gemini.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function roomFixture(roomId: string, home?: string) {
  const root = home || await fs.mkdtemp(path.join(os.tmpdir(), 'room-ai-admission-'));
  if (!home) roots.push(root);
  const roomRoot = path.join(root, 'rooms', roomId);
  await fs.mkdir(roomRoot, { recursive: true });
  return { roomRoot, roomId };
}

async function waitForLeaseCount(root: string, expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  const systemRoot = path.join(root, 'system');
  while (Date.now() < deadline) {
    const entries = await fs.readdir(systemRoot).catch(() => []);
    if (entries.filter(entry => /^\.ai-run-.*\.lease$/.test(entry)).length >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} AI run leases.`);
}

describe('cross-process AI run admission', () => {
  it('does not expose provider faults in impact fallback output', async () => {
    const location = await roomFixture('room_impact_redaction');
    const sentinel = 'provider-private-impact-sentinel';
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    const execute = vi.spyOn(GeminiProvider.prototype, 'execute')
      .mockRejectedValue(new Error(sentinel));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const report = await analyzeFeatureImpact(location, 'Change Source attachment behavior');
      expect(report.reasoning).toContain('AI impact analysis failed.');
      expect(report.reasoning).not.toContain(sentinel);
      expect(warning).not.toHaveBeenCalledWith(expect.stringContaining(sentinel));
    } finally {
      execute.mockRestore();
      warning.mockRestore();
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    }
  });

  it('records the source-less heuristic actor when no AI provider is configured', async () => {
    const location = await roomFixture('room_impact_heuristic');
    const previousKeys = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      gemini: process.env.GEMINI_API_KEY
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      await analyzeFeatureImpact(location, 'Inspect Room-only behavior');
      const [runFile] = await fs.readdir(path.join(location.roomRoot, 'runs'));
      const record = JSON.parse(await fs.readFile(
        path.join(location.roomRoot, 'runs', runFile),
        'utf-8'
      ));
      expect(record).toMatchObject({
        kind: 'impact',
        status: 'completed',
        participants: [{
          roomId: location.roomId,
          referenceKind: 'runtime',
          id: 'runtime_impact_heuristic',
          provider: 'Local heuristic',
          modelName: 'keyword-ranking-v1'
        }]
      });
    } finally {
      restoreEnvironment('ANTHROPIC_API_KEY', previousKeys.anthropic);
      restoreEnvironment('OPENAI_API_KEY', previousKeys.openai);
      restoreEnvironment('GEMINI_API_KEY', previousKeys.gemini);
    }
  });

  it('enforces per-Room and global limits and releases leases', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-ai-admission-shared-'));
    roots.push(root);
    const first = await roomFixture('room_first', root);
    const second = await roomFixture('room_second', root);
    let releaseFirst = (): void => {};
    let releaseSecond = (): void => {};
    const firstRun = withAiRunAdmission(first, 'discussion:first', () =>
      new Promise<void>(resolve => { releaseFirst = resolve; })
    );
    const secondRun = withAiRunAdmission(first, 'discussion:second', () =>
      new Promise<void>(resolve => { releaseSecond = resolve; })
    );
    await waitForLeaseCount(root, 2);
    try {
      await expect(withAiRunAdmission(first, 'discussion:third', async () => undefined))
        .rejects.toThrow('active AI run limit');
      const previousKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'test-key';
      const execute = vi.spyOn(GeminiProvider.prototype, 'execute');
      try {
        await expect(analyzeFeatureImpact(first, 'Add a bounded Room-first action'))
          .rejects.toThrow('active AI run limit');
        expect(execute).not.toHaveBeenCalled();
      } finally {
        execute.mockRestore();
        if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousKey;
      }
      await expect(withAiRunAdmission(second, 'discussion:third', async () => undefined))
        .resolves.toBeUndefined();
    } finally {
      releaseFirst();
      releaseSecond();
      await Promise.all([firstRun, secondRun]);
    }
    await expect(withAiRunAdmission(first, 'discussion:third', async () => undefined))
      .resolves.toBeUndefined();
  });

  it('counts leases held by independent processes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-ai-admission-processes-'));
    roots.push(root);
    const first = await roomFixture('room_first', root);
    const second = await roomFixture('room_second', root);
    const viteNode = path.resolve(process.cwd(), '..', '..', 'node_modules', '.bin', 'vite-node');
    const fixturePath = path.resolve(process.cwd(), 'src', 'aiRunAdmission.multiprocess.fixture.ts');
    const children: ChildProcessWithoutNullStreams[] = [];
    const start = async (roomRoot: string, roomId: string, operationId: string) => {
      const child = spawn(viteNode, [fixturePath, roomRoot, roomId, operationId, '10000']);
      children.push(child);
      await new Promise<void>((resolve, reject) => {
        child.stdout.once('data', chunk => {
          if (String(chunk).includes('ACQUIRED')) resolve();
          else reject(new Error(`Unexpected child output: ${chunk}`));
        });
        child.once('error', reject);
        child.once('exit', code => {
          if (code !== null && code !== 0) reject(new Error(`Admission child exited ${code}.`));
        });
      });
    };
    try {
      await start(first.roomRoot, first.roomId, 'discussion:first-a');
      await start(first.roomRoot, first.roomId, 'discussion:first-b');
      await start(second.roomRoot, second.roomId, 'discussion:second-a');
      await start(second.roomRoot, second.roomId, 'discussion:second-b');
      const run = promisify(execFile);
      await expect(run(viteNode, [
        fixturePath,
        path.join(root, 'rooms', 'room_third'),
        'room_third',
        'discussion:third',
        '10'
      ])).rejects.toThrow('active AI run limit');
    } finally {
      for (const child of children) child.kill();
    }
  }, 15_000);

  it('expires an abandoned lease whose PID was reused', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-ai-admission-reused-pid-'));
    roots.push(root);
    const room = await roomFixture('room_reused', root);
    const systemRoot = path.join(root, 'system');
    const leasePath = path.join(
      systemRoot,
      '.ai-run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.lease'
    );
    const ownerPath = path.join(leasePath, 'owner.json');
    await fs.mkdir(leasePath, { recursive: true });
    await fs.writeFile(ownerPath, JSON.stringify({
      token: 'a'.repeat(32),
      pid: process.pid,
      processIdentity: 'different-process-incarnation',
      roomId: room.roomId,
      operationId: 'discussion:abandoned'
    }));
    const stale = new Date(Date.now() - 60_000);
    await fs.utimes(ownerPath, stale, stale);

    await expect(withAiRunAdmission(
      room,
      'discussion:replacement',
      async () => undefined
    )).resolves.toBeUndefined();
    await expect(fs.access(leasePath)).rejects.toThrow();
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
