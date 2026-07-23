import * as fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

export interface DetectedAgent {
  id: string;
  name: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

const AGENT_DEFS = [
  { id: 'claude', name: 'Claude Code', bin: 'claude', versionArgs: ['--version'] },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', versionArgs: ['--version'] },
  { id: 'codex', name: 'Codex CLI', bin: 'codex', versionArgs: ['--version'] },
  { id: 'copilot', name: 'GitHub Copilot CLI', bin: 'copilot', versionArgs: ['--version'] },
  { id: 'codewhale', name: 'CodeWhale', bin: 'codewhale', versionArgs: ['--version'] },
  { id: 'agy', name: 'Antigravity CLI', bin: 'agy', versionArgs: ['--version'] },
  { id: 'kiro', name: 'Kiro CLI', bin: 'kiro-cli', versionArgs: ['--version'] }
];

export function wellKnownUserToolchainBins(): string[] {
  const home = os.homedir();
  const dirs: string[] = [];
  const env = process.env;

  // npm config prefix
  const npmPrefixRaw = env.NPM_CONFIG_PREFIX ?? env.npm_config_prefix;
  if (typeof npmPrefixRaw === 'string') {
    const npmPrefix = npmPrefixRaw.trim();
    if (npmPrefix.length > 0) {
      dirs.push(path.join(npmPrefix, 'bin'));
    }
  }

  // Common user-level binary folders
  dirs.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, 'Library', 'pnpm'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.npm-packages', 'bin')
  );

  // MacOS / Linux system-wide paths commonly missing from GUI environment
  if (process.platform !== 'win32') {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  }

  // NVM, FNM, Mise version managers
  const versionManagers = [
    path.join(home, '.nvm', 'versions', 'node'),
    path.join(home, '.local', 'share', 'fnm', 'node-versions'),
    path.join(home, '.local', 'share', 'mise', 'installs', 'node')
  ];

  for (const root of versionManagers) {
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // nvm/mise structure
          const candidateBin = path.join(root, entry.name, 'bin');
          if (existsSync(candidateBin)) {
            dirs.push(candidateBin);
          }
          // fnm structure
          const fnmCandidateBin = path.join(root, entry.name, 'installation', 'bin');
          if (existsSync(fnmCandidateBin)) {
            dirs.push(fnmCandidateBin);
          }
        }
      }
    } catch {}
  }

  return dirs;
}

export function resolvePathDirs(): string[] {
  const seen = new Set<string>();
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter),
    ...wellKnownUserToolchainBins()
  ];

  return dirs.filter((dir) => {
    if (!dir || seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

export function resolveOnPath(bin: string): string | null {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];

  const dirs = resolvePathDirs();
  for (const dir of dirs) {
    for (const ext of exts) {
      const fullPath = path.join(dir, bin + ext);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

async function probeVersion(executablePath: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileP(executablePath, args, {
      env: {
        ...process.env,
        PATH: resolvePathDirs().join(path.delimiter)
      },
      timeout: 2000,
      maxBuffer: 1024 * 1024
    });
    const firstLine = stdout.trim().split('\n')[0];
    return firstLine ? firstLine.trim() : null;
  } catch {
    return null;
  }
}

export async function detectLocalAgents(): Promise<DetectedAgent[]> {
  const results: DetectedAgent[] = [];

  for (const def of AGENT_DEFS) {
    const resolvedPath = resolveOnPath(def.bin);
    if (!resolvedPath) {
      results.push({
        id: def.id,
        name: def.name,
        available: false,
        path: null,
        version: null
      });
      continue;
    }

    const version = await probeVersion(resolvedPath, def.versionArgs);
    results.push({
      id: def.id,
      name: def.name,
      available: true,
      path: resolvedPath,
      version: version
    });
  }

  return results;
}
