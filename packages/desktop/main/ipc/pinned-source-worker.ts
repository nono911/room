interface WorkerEntry {
  name: string;
  path?: string;
  kind: 'file' | 'directory';
  size: number;
  modifiedAt: string;
  childCount?: number;
  childCountTruncated?: boolean;
  previewBase64?: string;
}

interface WorkerWalkResult {
  entries: WorkerEntry[];
  truncated: boolean;
}

interface WorkerReadResult {
  data: string;
  size: number;
  modifiedAt: string;
}

interface WorkerGitStatus {
  repository: boolean;
  branch?: string;
  commit?: string;
  unsupportedReason?: string;
}

function sourceWorkerMain(): void {
  const fs = require('fs') as typeof import('fs');
  const pathModule = require('path') as typeof import('path');
  const request = JSON.parse(process.argv[process.argv.length - 1]) as {
    operation: 'walk' | 'read' | 'git';
    relativePath?: string;
    expectedDevice: string;
    expectedInode: string;
    expectedBirthtimeNs: string;
    maxBytes?: number;
    maxEntries?: number;
    maxDepth?: number;
    maxInspectedEntries?: number;
    maxDirectoryEntries?: number;
    maxDurationMs?: number;
    includeChildCount?: boolean;
    includePreviews?: boolean;
    previewBytes?: number;
    previewBudgetBytes?: number;
    maxSerializedBytes?: number;
    maxPreviewFileBytes?: number;
    ignoredDirectories?: string[];
  };
  const maxInspected = Math.max(1, Math.min(10_000, request.maxInspectedEntries ?? 10_000));
  const maxDirectoryEntries = Math.max(1, Math.min(
    4096,
    request.maxDirectoryEntries ?? 4096
  ));
  const deadline = Date.now() + Math.max(100, Math.min(15_000, request.maxDurationMs ?? 15_000));
  let inspectedEntries = 0;

  function fail(message: string): never {
    throw new Error(message);
  }

  function isSkippableFilesystemError(error: unknown): boolean {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
    return ['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR'].includes(code);
  }

  function validateRoot(): void {
    const stat = fs.statSync('.', { bigint: true });
    if (
      !stat.isDirectory()
      || stat.dev.toString() !== request.expectedDevice
      || stat.ino.toString() !== request.expectedInode
      || stat.birthtimeNs.toString() !== request.expectedBirthtimeNs
    ) {
      fail('The attached Source root changed after authorization.');
    }
  }

  function splitRelative(raw = ''): string[] {
    if (typeof raw !== 'string' || raw.includes('\0') || pathModule.isAbsolute(raw)) {
      fail('Invalid Source-relative path.');
    }
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized) return [];
    const segments = normalized.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
      fail('Invalid Source-relative path.');
    }
    return segments;
  }

  function enterDirectory(segments: string[]): void {
    for (const segment of segments) {
      const before = fs.lstatSync(segment, { bigint: true });
      if (before.isSymbolicLink() || !before.isDirectory()) {
        fail('Source paths cannot contain symbolic links.');
      }
      process.chdir(segment);
      const after = fs.statSync('.', { bigint: true });
      if (after.dev !== before.dev || after.ino !== before.ino) {
        fail('Source directory changed during secure traversal.');
      }
    }
  }

  function readDirectoryBatch(limit: number): {
    entries: import('fs').Dirent[];
    truncated: boolean;
  } {
    const entries: import('fs').Dirent[] = [];
    const directory = fs.opendirSync('.');
    try {
      while (inspectedEntries < maxInspected && Date.now() < deadline) {
        const entry = directory.readSync();
        if (!entry) return { entries, truncated: false };
        // A directory with exactly `limit` entries must not be reported as
        // truncated: only stop once a *next* entry proves more remain, so
        // this read (past what we keep) is the one that decides it, not the
        // count reaching `limit`.
        if (entries.length >= limit) return { entries, truncated: true };
        inspectedEntries += 1;
        entries.push(entry);
      }
      return { entries, truncated: true };
    } finally {
      directory.closeSync();
    }
  }

  function walkDirectory(): WorkerWalkResult {
    const startSegments = splitRelative(request.relativePath);
    enterDirectory(startSegments);
    const start = fs.statSync('.', { bigint: true });
    const basePath = startSegments.join('/');
    const outputLimit = Math.max(1, Math.min(2500, request.maxEntries ?? 500));
    const maxDepth = Math.max(0, Math.min(32, request.maxDepth ?? 32));
    const ignored = new Set(request.ignoredDirectories || []);
    const entries: WorkerEntry[] = [];
    let truncated = false;
    const maxSerializedBytes = Math.max(1024, Math.min(
      6 * 1024 * 1024,
      request.maxSerializedBytes ?? 6 * 1024 * 1024
    ));
    let serializedBytes = 64;
    let previewBudget = Math.max(0, Math.min(
      4 * 1024 * 1024,
      request.previewBudgetBytes ?? 0
    ));

    function visibleChildren(): { count: number; truncated: boolean } {
      const batch = readDirectoryBatch(33);
      let count = 0;
      for (const entry of batch.entries) {
        if (entry.name.startsWith('.')) continue;
        try {
          const stat = fs.lstatSync(entry.name, { bigint: true });
          if (!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory())) count += 1;
        } catch (error: unknown) {
          if (!isSkippableFilesystemError(error)) throw error;
        }
      }
      return { count, truncated: batch.truncated };
    }

    function addPreview(item: WorkerEntry, stat: import('fs').BigIntStats): void {
      if (
        !request.includePreviews
        || previewBudget <= 0
        || stat.size > BigInt(request.maxPreviewFileBytes ?? 1024 * 1024)
      ) return;
      const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
      let descriptor: number | undefined;
      try {
        descriptor = fs.openSync(item.name, fs.constants.O_RDONLY | noFollow);
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) return;
        const length = Math.min(
          Number(opened.size),
          request.previewBytes ?? 48 * 1024,
          previewBudget
        );
        const buffer = Buffer.alloc(length);
        const bytesRead = fs.readSync(descriptor, buffer, 0, length, 0);
        item.previewBase64 = buffer.subarray(0, bytesRead).toString('base64');
        previewBudget -= bytesRead;
      } catch (error: unknown) {
        if (!isSkippableFilesystemError(error)) throw error;
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
      }
    }

    function collect(
      relativeDirectory: string,
      expectedParent: import('fs').BigIntStats,
      depth: number
    ): void {
      const current = fs.statSync('.', { bigint: true });
      if (current.dev !== expectedParent.dev || current.ino !== expectedParent.ino) {
        fail('Source directory changed during secure traversal.');
      }
      let batch: { entries: import('fs').Dirent[]; truncated: boolean };
      try {
        batch = readDirectoryBatch(maxDirectoryEntries);
      } catch (error: unknown) {
        if (depth > 0 && isSkippableFilesystemError(error)) return;
        throw error;
      }
      if (batch.truncated) truncated = true;
      batch.entries.sort((first, second) => (
        first.isDirectory() === second.isDirectory()
          ? first.name.localeCompare(second.name)
          : first.isDirectory() ? -1 : 1
      ));
      for (const entry of batch.entries) {
        if (entry.name.startsWith('.') || (
          entry.isDirectory() && ignored.has(entry.name)
        )) continue;
        let stat: import('fs').BigIntStats;
        try {
          stat = fs.lstatSync(entry.name, { bigint: true });
        } catch (error: unknown) {
          if (isSkippableFilesystemError(error)) continue;
          throw error;
        }
        if (stat.isSymbolicLink()) continue;
        const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : null;
        if (!kind) continue;
        if (entries.length >= outputLimit) {
          truncated = true;
          return;
        }
        const relativePath = relativeDirectory
          ? `${relativeDirectory}/${entry.name}`
          : entry.name;
        const item: WorkerEntry = {
          path: relativePath,
          name: entry.name,
          kind,
          size: kind === 'file' ? Number(stat.size) : 0,
          modifiedAt: new Date(Number(stat.mtimeMs)).toISOString()
        };
        if (kind === 'file') addPreview(item, stat);
        const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf-8') + 1;
        if (serializedBytes + itemBytes > maxSerializedBytes) {
          truncated = true;
          return;
        }
        serializedBytes += itemBytes;
        entries.push(item);
        if (kind !== 'directory') continue;
        let enteredDirectory = false;
        try {
          process.chdir(entry.name);
          enteredDirectory = true;
          const entered = fs.statSync('.', { bigint: true });
          if (entered.dev !== stat.dev || entered.ino !== stat.ino) {
            fail('Source directory changed during secure traversal.');
          }
          if (request.includeChildCount) {
            const children = visibleChildren();
            item.childCount = children.count;
            item.childCountTruncated = children.truncated;
          }
          if (depth < maxDepth && inspectedEntries < maxInspected && Date.now() < deadline) {
            collect(relativePath, entered, depth + 1);
          } else if (depth < maxDepth) {
            truncated = true;
          }
        } catch (error: unknown) {
          if (!isSkippableFilesystemError(error)) throw error;
        } finally {
          if (enteredDirectory) {
            process.chdir('..');
            const returned = fs.statSync('.', { bigint: true });
            if (returned.dev !== expectedParent.dev || returned.ino !== expectedParent.ino) {
              fail('Source parent changed during secure traversal.');
            }
          }
        }
        if (entries.length >= outputLimit || inspectedEntries >= maxInspected || Date.now() >= deadline) {
          truncated = true;
          return;
        }
      }
    }

    collect(basePath, start, 0);
    return { entries, truncated };
  }

  function readFile(): WorkerReadResult {
    const segments = splitRelative(request.relativePath);
    const filename = segments.pop();
    if (!filename) fail('A Source file path is required.');
    enterDirectory(segments);
    const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | noFollow);
    try {
      const [opened, current] = [
        fs.fstatSync(descriptor, { bigint: true }),
        fs.lstatSync(filename, { bigint: true })
      ];
      if (
        current.isSymbolicLink()
        || !opened.isFile()
        || opened.dev !== current.dev
        || opened.ino !== current.ino
      ) {
        fail('Source file changed during secure open.');
      }
      const maxBytes = request.maxBytes ?? 1024 * 1024;
      if (opened.size > BigInt(maxBytes)) {
        return {
          data: '',
          size: Number(opened.size),
          modifiedAt: new Date(Number(opened.mtimeMs)).toISOString()
        };
      }
      return {
        data: fs.readFileSync(descriptor).toString('base64'),
        size: Number(opened.size),
        modifiedAt: new Date(Number(opened.mtimeMs)).toISOString()
      };
    } finally {
      fs.closeSync(descriptor);
    }
  }

  function runGit(): WorkerGitStatus {
    let dotGit: import('fs').BigIntStats;
    try {
      dotGit = fs.lstatSync('.git', { bigint: true });
    } catch {
      return { repository: false };
    }
    if (dotGit.isSymbolicLink()) return { repository: false };
    if (dotGit.isFile()) {
      return {
        repository: false,
        unsupportedReason: 'Linked Git worktree metadata is outside the attached Source boundary.'
      };
    }
    if (!dotGit.isDirectory()) return { repository: false };
    enterDirectory(['.git']);

    function readCurrentFile(filename: string, maxBytes = 1024 * 1024): string | null {
      let descriptor: number;
      try {
        const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
        descriptor = fs.openSync(filename, fs.constants.O_RDONLY | noFollow);
      } catch {
        return null;
      }
      try {
        const stat = fs.fstatSync(descriptor, { bigint: true });
        if (!stat.isFile() || stat.size > BigInt(maxBytes)) return null;
        return fs.readFileSync(descriptor, 'utf-8');
      } finally {
        fs.closeSync(descriptor);
      }
    }

    const head = readCurrentFile('HEAD', 4096)?.trim();
    if (!head) return { repository: true };
    if (/^[a-f0-9]{40,64}$/i.test(head)) {
      return { repository: true, commit: head.slice(0, 12) };
    }
    if (!head.startsWith('ref: refs/heads/')) return { repository: true };
    const ref = head.slice('ref: '.length);
    const branch = ref.slice('refs/heads/'.length);
    const packedRefs = readCurrentFile('packed-refs') || '';
    const packed = packedRefs.split('\n').find(line => (
      !line.startsWith('#') && !line.startsWith('^') && line.endsWith(` ${ref}`)
    ));
    const packedCommit = packed?.split(' ')[0];
    let commit = packedCommit && /^[a-f0-9]{40,64}$/i.test(packedCommit)
      ? packedCommit.slice(0, 12)
      : undefined;
    const refSegments = splitRelative(ref);
    const refFilename = refSegments.pop();
    if (refFilename) {
      try {
        enterDirectory(refSegments);
        const looseRef = readCurrentFile(refFilename, 4096)?.trim();
        if (looseRef && /^[a-f0-9]{40,64}$/i.test(looseRef)) commit = looseRef.slice(0, 12);
      } catch {
        // A packed ref legitimately has no loose-ref directory.
      }
    }
    return { repository: true, branch, commit };
  }

  validateRoot();
  const result = request.operation === 'walk'
    ? walkDirectory()
    : request.operation === 'read'
      ? readFile()
      : runGit();
  process.stdout.write(JSON.stringify(result));
}

export const SOURCE_WORKER_SCRIPT = `(${sourceWorkerMain.toString()})();`;
