import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { withRoomDataLock } from './roomHome.js';
import { createSanitizedChildEnvironment } from './providers/childEnvironment.js';
import {
  resolveSourceStatePath,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from './workspace.js';
import { createExecutionProvenance } from './discussion/types.js';
import {
  createScanGenerationId,
  measureScanReplacementCredit,
  pruneScanGenerations,
  publishScanGeneration
} from './scanSnapshot.js';
import { withRoomStorageTransaction } from './roomFile.js';

export { resolveCurrentScanSnapshot } from './scanSnapshot.js';

export interface ScanResult {
  projectName: string;
  technologies: {
    frontend: string[];
    backend: string[];
    database: string[];
    tools: string[];
    languages: string[];
  };
  fileCount: number;
  structure: Record<string, string[]>;
  truncated?: boolean;
}

export interface SourceRootIdentity {
  device: string;
  inode: string;
  birthtimeNs: string;
}

function pinnedScanWorkerMain(): void {
  const fsSync = require('fs') as typeof import('fs');
  const pathSync = require('path') as typeof import('path');
  const request = JSON.parse(process.argv[process.argv.length - 1]) as {
    expectedDevice: string;
    expectedInode: string;
    expectedBirthtimeNs: string;
    projectName: string;
  };
  const root = fsSync.statSync('.', { bigint: true });
  if (
    !root.isDirectory()
    || root.dev.toString() !== request.expectedDevice
    || root.ino.toString() !== request.expectedInode
    || root.birthtimeNs.toString() !== request.expectedBirthtimeNs
  ) {
    throw new Error('The attached Source root changed after authorization.');
  }
  const ignored = new Set([
    'node_modules', '.git', 'dist', 'dist-packaged', 'build', '.next', '.room',
    'out', '.gemini', 'coverage', 'release', 'releases', '.gradle', 'target', '.cache'
  ]);
  const result: ScanResult = {
    projectName: request.projectName,
    technologies: { frontend: [], backend: [], database: [], tools: [], languages: [] },
    fileCount: 0,
    structure: {}
  };
  const maxInspectedEntries = 100_000;
  const maxDirectoryEntries = 4096;
  const maxSerializedBytes = 6 * 1024 * 1024;
  const deadline = Date.now() + 45_000;
  let inspectedEntries = 0;
  let serializedBytes = 256;
  const languages = new Set<string>();
  const languageByExtension = new Map([
    ['.ts', 'TypeScript'], ['.tsx', 'TypeScript'], ['.js', 'JavaScript'],
    ['.jsx', 'JavaScript'], ['.py', 'Python'], ['.go', 'Go'], ['.rs', 'Rust'],
    ['.java', 'Java'], ['.rb', 'Ruby'], ['.php', 'PHP'], ['.cs', 'C#']
  ]);

  function isSkippableFilesystemError(error: unknown): boolean {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
    return ['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR'].includes(code);
  }

  function readDirectoryBatch(): import('fs').Dirent[] {
    const entries: import('fs').Dirent[] = [];
    const directory = fsSync.opendirSync('.');
    try {
      while (
        entries.length < maxDirectoryEntries
        && inspectedEntries < maxInspectedEntries
        && Date.now() < deadline
      ) {
        const entry = directory.readSync();
        if (!entry) return entries;
        inspectedEntries += 1;
        entries.push(entry);
      }
      result.truncated = true;
      return entries;
    } finally {
      directory.closeSync();
    }
  }

  function readRegularFile(filename: string, maxBytes: number): string | null {
    const noFollow = typeof fsSync.constants.O_NOFOLLOW === 'number' ? fsSync.constants.O_NOFOLLOW : 0;
    let descriptor: number;
    try {
      descriptor = fsSync.openSync(filename, fsSync.constants.O_RDONLY | noFollow);
    } catch {
      return null;
    }
    try {
      const stat = fsSync.fstatSync(descriptor, { bigint: true });
      if (!stat.isFile() || stat.size > BigInt(maxBytes)) return null;
      const buffer = Buffer.alloc(maxBytes + 1);
      let total = 0;
      while (total <= maxBytes) {
        const bytesRead = fsSync.readSync(
          descriptor,
          buffer,
          total,
          Math.min(64 * 1024, maxBytes + 1 - total),
          total
        );
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      return total > maxBytes ? null : buffer.subarray(0, total).toString('utf-8');
    } finally {
      fsSync.closeSync(descriptor);
    }
  }

  function walk(
    relativeDirectory: string,
    expectedParent: import('fs').BigIntStats,
    depth = 0
  ): void {
    if (
      depth > 5
      || inspectedEntries >= maxInspectedEntries
      || Date.now() >= deadline
    ) {
      result.truncated = true;
      return;
    }
    const current = fsSync.statSync('.', { bigint: true });
    if (current.dev !== expectedParent.dev || current.ino !== expectedParent.ino) {
      throw new Error('Source directory changed during pinned scan.');
    }
    let entries: import('fs').Dirent[];
    try {
      entries = readDirectoryBatch();
    } catch (error: unknown) {
      if (depth > 0 && isSkippableFilesystemError(error)) return;
      throw error;
    }
    const filesInDirectory: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue;
      let stat: import('fs').BigIntStats;
      try {
        stat = fsSync.lstatSync(entry.name, { bigint: true });
      } catch (error: unknown) {
        if (isSkippableFilesystemError(error)) continue;
        throw error;
      }
      if (stat.isSymbolicLink()) continue;
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (stat.isDirectory()) {
        let enteredDirectory = false;
        try {
          process.chdir(entry.name);
          enteredDirectory = true;
          const entered = fsSync.statSync('.', { bigint: true });
          if (entered.dev !== stat.dev || entered.ino !== stat.ino) {
            throw new Error('Source directory changed during pinned scan.');
          }
          walk(relativePath, entered, depth + 1);
        } catch (error: unknown) {
          if (!isSkippableFilesystemError(error)) throw error;
        } finally {
          if (enteredDirectory) {
            process.chdir('..');
            const returned = fsSync.statSync('.', { bigint: true });
            if (returned.dev !== expectedParent.dev || returned.ino !== expectedParent.ino) {
              throw new Error('Source parent changed during pinned scan.');
            }
          }
        }
        continue;
      }
      if (!stat.isFile()) continue;
      result.fileCount += 1;
      if (filesInDirectory.length < 10) filesInDirectory.push(entry.name);
      const extension = pathSync.extname(entry.name).toLowerCase();
      const language = languageByExtension.get(extension);
      if (language) languages.add(language);
      if (entry.name === 'package.json') {
        const content = readRegularFile(entry.name, 512 * 1024);
        if (!content) continue;
        try {
          const pkg = JSON.parse(content) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.react) result.technologies.frontend.push('React');
          if (deps.vue) result.technologies.frontend.push('Vue');
          if (deps.svelte) result.technologies.frontend.push('Svelte');
          if (deps.next) result.technologies.frontend.push('Next.js');
          if (deps.nuxt) result.technologies.frontend.push('Nuxt.js');
          if (deps.hono) result.technologies.backend.push('Hono');
          if (deps.express) result.technologies.backend.push('Express');
          if (deps.nest) result.technologies.backend.push('NestJS');
          if (deps.fastify) result.technologies.backend.push('Fastify');
          if (deps.prisma) result.technologies.database.push('Prisma ORM');
          if (deps.mongoose || deps.mongodb) result.technologies.database.push('MongoDB');
          if (deps.pg || deps.postgres) result.technologies.database.push('PostgreSQL');
          if (deps.sequelize) result.technologies.database.push('Sequelize');
          if (deps.tailwindcss) result.technologies.tools.push('TailwindCSS');
          if (deps.electron) result.technologies.tools.push('Electron');
          if (deps.vite) result.technologies.tools.push('Vite');
          if (deps.webpack) result.technologies.tools.push('Webpack');
        } catch {}
      }
      if (entry.name === 'requirements.txt') result.technologies.backend.push('Python');
      if (entry.name === 'go.mod') result.technologies.backend.push('Go Modules');
      if (entry.name === 'Cargo.toml') result.technologies.tools.push('Cargo');
    }
    if (relativeDirectory && filesInDirectory.length > 0) {
      const entryBytes = Buffer.byteLength(
        JSON.stringify([relativeDirectory, filesInDirectory]),
        'utf-8'
      ) + 1;
      if (serializedBytes + entryBytes > maxSerializedBytes) {
        result.truncated = true;
      } else {
        serializedBytes += entryBytes;
        result.structure[relativeDirectory] = filesInDirectory;
      }
    }
  }

  walk('', root);
  result.technologies.languages = [...languages];
  for (const key of ['frontend', 'backend', 'database', 'tools'] as const) {
    result.technologies[key] = [...new Set(result.technologies[key])];
  }
  process.stdout.write(JSON.stringify(result));
}

const PINNED_SCAN_WORKER_SCRIPT = `(${pinnedScanWorkerMain.toString()})();`;
const execFileAsync = promisify(execFile);

async function scanPinnedDirectory(
  dirPath: string,
  expectedRootIdentity: SourceRootIdentity
): Promise<ScanResult> {
  const payload = JSON.stringify({
    expectedDevice: expectedRootIdentity.device,
    expectedInode: expectedRootIdentity.inode,
    expectedBirthtimeNs: expectedRootIdentity.birthtimeNs,
    projectName: path.basename(path.resolve(dirPath))
  });
  const { stdout } = await execFileAsync(
    process.execPath,
    ['-e', PINNED_SCAN_WORKER_SCRIPT, '--', payload],
    {
      cwd: path.resolve(dirPath),
      env: {
        ...createSanitizedChildEnvironment(),
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {})
      },
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    }
  );
  return JSON.parse(stdout) as ScanResult;
}

export async function scanDirectory(
  dirPath: string,
  expectedRootIdentity?: SourceRootIdentity
): Promise<ScanResult> {
  if (expectedRootIdentity) {
    return scanPinnedDirectory(path.resolve(dirPath), expectedRootIdentity);
  }
  const resolvedPath = path.resolve(dirPath);
  const sourceRootStat = await fs.lstat(resolvedPath, { bigint: true });
  if (sourceRootStat.isSymbolicLink() || !sourceRootStat.isDirectory()) {
    throw new Error('Source root must be a real directory.');
  }
  const identity = expectedRootIdentity || {
    device: sourceRootStat.dev.toString(),
    inode: sourceRootStat.ino.toString(),
    birthtimeNs: sourceRootStat.birthtimeNs.toString()
  };
  return scanPinnedDirectory(await fs.realpath(resolvedPath), identity);
}

export async function writeScanData(
  workspace: WorkspaceInput,
  scan: ScanResult,
  options: { overview?: string } = {}
) {
  const resolvedWorkspace = resolveWorkspaceLocation(workspace);
  const generation = createScanGenerationId();
  const defaultOverview = `# Project: ${scan.projectName}

## Overview
Automated codebase analysis generated by ROOM.

## Core Technologies
- **Languages**: ${scan.technologies.languages.join(', ') || 'Unknown'}
- **Frontend**: ${scan.technologies.frontend.join(', ') || 'None detected'}
- **Backend**: ${scan.technologies.backend.join(', ') || 'None detected'}
- **Database**: ${scan.technologies.database.join(', ') || 'None detected'}
- **Tools**: ${scan.technologies.tools.join(', ') || 'None detected'}

## Repository Details
- Total files: ${scan.fileCount}
`;
  const structure = `# Architecture Map: ${scan.projectName}

## Tech Stack Summary
- **Frontend Framework**: ${scan.technologies.frontend[0] || 'Unknown'}
- **Backend Runtime**: ${scan.technologies.backend[0] || 'Unknown'}
- **Database Layer**: ${scan.technologies.database[0] || 'Unknown'}

## Monitored Directories
${Object.keys(scan.structure).length === 0 ? '- None' : Object.keys(scan.structure).map(folder => `- \`${folder}/\``).join('\n')}
`;
  const artifacts = {
    overview: options.overview?.trim() || defaultOverview,
    structure,
    projectMap: JSON.stringify(scan, null, 2),
    provenance: JSON.stringify(createExecutionProvenance(resolvedWorkspace), null, 2)
  };
  const projectedBytes = Object.values(artifacts).reduce(
    (total, content) => total + Buffer.byteLength(content, 'utf-8'),
    Buffer.byteLength(`${JSON.stringify({ generation })}\n`, 'utf-8')
  );
  return withRoomStorageTransaction(
    workspace,
    async () => ({
      bytes: projectedBytes - await measureScanReplacementCredit(workspace, generation),
      entries: null
    }),
    () => writeScanDataWithinQuota(workspace, generation, artifacts)
  );
}

async function writeScanDataWithinQuota(
  workspace: WorkspaceInput,
  generation: string,
  artifacts: {
    overview: string;
    structure: string;
    projectMap: string;
    provenance: string;
  }
) {
  const resolvedWorkspace = resolveWorkspaceLocation(workspace);
  const scanRoot = resolveSourceStatePath(workspace, 'scan');
  const generationsRoot = resolveSourceStatePath(workspace, 'scan', 'generations');
  const stageDir = path.join(generationsRoot, generation);
  let published = false;
  await withRoomDataLock(
    resolvedWorkspace.roomRoot,
    `scan-${resolvedWorkspace.sourceId}`,
    async () => {
      await fs.mkdir(generationsRoot, { recursive: true, mode: 0o700 });
      await pruneScanGenerations(workspace, generation);
      await fs.mkdir(stageDir, { mode: 0o700 });
      try {
        await fs.writeFile(path.join(stageDir, 'overview.md'), artifacts.overview, {
          encoding: 'utf-8',
          mode: 0o600
        });
        await fs.writeFile(path.join(stageDir, 'structure.md'), artifacts.structure, {
          encoding: 'utf-8',
          mode: 0o600
        });
        await fs.writeFile(path.join(stageDir, 'project-map.json'), artifacts.projectMap, {
          encoding: 'utf-8',
          mode: 0o600
        });
        await fs.writeFile(
          path.join(stageDir, 'provenance.json'),
          artifacts.provenance,
          { encoding: 'utf-8', mode: 0o600 }
        );
        await fs.lstat(scanRoot);
        await publishScanGeneration(workspace, generation);
        published = true;
        await pruneScanGenerations(workspace, generation);
      } finally {
        if (!published) {
          await fs.rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
  );
}
