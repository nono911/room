import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseSkillFrontmatter } from './parser.js';

export type MachineSkillSource = 'codex' | 'agents' | 'plugin';

export interface MachineSkillSummary {
  reference: string;
  name: string;
  description?: string;
  source: MachineSkillSource;
  sourceLabel: string;
  relativePath: string;
  modifiedAt: string;
}

export interface MachineSkillCatalogOptions {
  codexSkillsRoot?: string | null;
  agentsSkillsRoot?: string | null;
  pluginCacheRoot?: string | null;
  forceRefresh?: boolean;
}

interface MachineSkillRecord extends MachineSkillSummary {
  filePath: string;
  rootPath: string;
}

interface CatalogRoot {
  source: MachineSkillSource;
  sourceLabel: string;
  rootPath: string;
}

const MACHINE_SKILL_PREFIX = 'machine://';
const MAX_CATALOG_FILES = 2000;
const MAX_SCAN_DEPTH = 12;
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const CACHE_TTL_MS = 15_000;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build']);

let defaultCatalogCache: { expiresAt: number; records: MachineSkillRecord[] } | null = null;

export function isMachineSkillReference(value: string): boolean {
  return normalizeMachineSkillReference(value) !== null;
}

export function normalizeMachineSkillReference(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^machine:\/\/(codex|agents|plugin)\/([^/?#]+)$/);
  if (!match) return null;

  let identity: string;
  try {
    identity = decodeURIComponent(match[2]);
  } catch {
    return null;
  }

  const normalizedIdentity = identity.replace(/\\/g, '/');
  const parts = normalizedIdentity.split('/');
  if (
    normalizedIdentity.length === 0
    || normalizedIdentity.length > 500
    || path.posix.isAbsolute(normalizedIdentity)
    || parts.some(part => !part || part === '.' || part === '..' || part.includes('\0'))
  ) {
    return null;
  }

  return `${MACHINE_SKILL_PREFIX}${match[1]}/${encodeURIComponent(normalizedIdentity)}`;
}

export async function discoverMachineSkills(
  options?: MachineSkillCatalogOptions
): Promise<MachineSkillSummary[]> {
  const records = await loadCatalog(options);
  return records.map(({ filePath: _filePath, rootPath: _rootPath, ...summary }) => summary);
}

export async function readMachineSkill(
  reference: string,
  options?: MachineSkillCatalogOptions
): Promise<{ skill: MachineSkillSummary; content: string; filePath: string }> {
  const normalizedReference = normalizeMachineSkillReference(reference);
  if (!normalizedReference) {
    throw new Error(`Invalid machine skill reference: ${reference}`);
  }

  let records = await loadCatalog(options);
  let record = records.find(item => item.reference === normalizedReference);
  if (!record && usesDefaultRoots(options)) {
    records = await loadCatalog({ ...options, forceRefresh: true });
    record = records.find(item => item.reference === normalizedReference);
  }
  if (!record) {
    throw new Error(`Machine skill is unavailable: ${reference}`);
  }

  const fileStat = await fs.lstat(record.filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_SKILL_FILE_BYTES) {
    throw new Error(`Machine skill cannot be read safely: ${reference}`);
  }
  const [canonicalFile, canonicalRoot] = await Promise.all([
    fs.realpath(record.filePath),
    fs.realpath(record.rootPath)
  ]);
  if (!isWithinRoot(canonicalRoot, canonicalFile)) {
    throw new Error(`Machine skill escaped its registered source: ${reference}`);
  }

  const content = await fs.readFile(canonicalFile, 'utf-8');
  const { filePath: _filePath, rootPath: _rootPath, ...skill } = record;
  return { skill, content, filePath: canonicalFile };
}

async function loadCatalog(options?: MachineSkillCatalogOptions): Promise<MachineSkillRecord[]> {
  const useCache = usesDefaultRoots(options);
  const cachedCatalog = defaultCatalogCache;
  if (useCache && !options?.forceRefresh && cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.records;
  }

  const roots = getCatalogRoots(options);
  const discovered = (await Promise.all(roots.map(root => scanCatalogRoot(root)))).flat();
  const deduped = new Map<string, MachineSkillRecord>();
  for (const record of discovered) {
    const current = deduped.get(record.reference);
    if (!current || record.modifiedAt > current.modifiedAt) {
      deduped.set(record.reference, record);
    }
  }
  const records = [...deduped.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
    || left.source.localeCompare(right.source)
    || left.reference.localeCompare(right.reference)
  );

  if (useCache) {
    defaultCatalogCache = { expiresAt: Date.now() + CACHE_TTL_MS, records };
  }
  return records;
}

function usesDefaultRoots(options?: MachineSkillCatalogOptions): boolean {
  return options?.codexSkillsRoot === undefined
    && options?.agentsSkillsRoot === undefined
    && options?.pluginCacheRoot === undefined;
}

function getCatalogRoots(options?: MachineSkillCatalogOptions): CatalogRoot[] {
  const codexHome = path.resolve(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'));
  const configured = [
    {
      source: 'codex' as const,
      sourceLabel: 'Codex',
      rootPath: options?.codexSkillsRoot === undefined
        ? path.join(codexHome, 'skills')
        : options.codexSkillsRoot
    },
    {
      source: 'agents' as const,
      sourceLabel: 'Agents',
      rootPath: options?.agentsSkillsRoot === undefined
        ? path.join(os.homedir(), '.agents', 'skills')
        : options.agentsSkillsRoot
    },
    {
      source: 'plugin' as const,
      sourceLabel: 'Codex Plugin',
      rootPath: options?.pluginCacheRoot === undefined
        ? path.join(codexHome, 'plugins', 'cache')
        : options.pluginCacheRoot
    }
  ];

  return configured
    .filter((root): root is CatalogRoot => typeof root.rootPath === 'string' && root.rootPath.trim().length > 0)
    .map(root => ({ ...root, rootPath: path.resolve(root.rootPath) }));
}

async function scanCatalogRoot(root: CatalogRoot): Promise<MachineSkillRecord[]> {
  const canonicalRoot = await fs.realpath(root.rootPath).catch(() => null);
  if (!canonicalRoot) return [];

  const records: MachineSkillRecord[] = [];
  let visitedFiles = 0;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH || visitedFiles >= MAX_CATALOG_FILES) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (visitedFiles >= MAX_CATALOG_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await walk(entryPath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile() || entry.name !== 'SKILL.md') continue;
      visitedFiles += 1;
      const record = await readCatalogEntry(root, canonicalRoot, entryPath);
      if (record) records.push(record);
    }
  };

  await walk(canonicalRoot, 0);
  return records;
}

async function readCatalogEntry(
  root: CatalogRoot,
  canonicalRoot: string,
  filePath: string
): Promise<MachineSkillRecord | null> {
  try {
    const [canonicalFile, stat] = await Promise.all([fs.realpath(filePath), fs.lstat(filePath)]);
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || stat.size > MAX_SKILL_FILE_BYTES
      || !isWithinRoot(canonicalRoot, canonicalFile)
    ) {
      return null;
    }

    const content = await fs.readFile(canonicalFile, 'utf-8');
    const { metadata } = parseSkillFrontmatter(content);
    const skillDirectory = path.dirname(canonicalFile);
    const relativeDirectory = path.relative(canonicalRoot, skillDirectory).split(path.sep).join('/');
    const identity = buildSkillIdentity(root.source, relativeDirectory, metadata.name);
    if (!identity) return null;
    const reference = normalizeMachineSkillReference(
      `${MACHINE_SKILL_PREFIX}${root.source}/${encodeURIComponent(identity)}`
    );
    if (!reference) return null;

    return {
      reference,
      name: metadata.name?.trim() || path.basename(skillDirectory),
      description: metadata.description?.trim() || undefined,
      source: root.source,
      sourceLabel: buildSourceLabel(root, relativeDirectory),
      relativePath: relativeDirectory ? `${relativeDirectory}/SKILL.md` : 'SKILL.md',
      modifiedAt: stat.mtime.toISOString(),
      filePath: canonicalFile,
      rootPath: canonicalRoot
    };
  } catch {
    return null;
  }
}

function buildSkillIdentity(
  source: MachineSkillSource,
  relativeDirectory: string,
  metadataName?: string
): string | null {
  if (source !== 'plugin') {
    return relativeDirectory || metadataName?.trim() || null;
  }

  const parts = relativeDirectory.split('/').filter(Boolean);
  const skillsIndex = parts.lastIndexOf('skills');
  if (skillsIndex >= 3 && parts.length > skillsIndex + 1) {
    return [parts[0], parts[1], ...parts.slice(skillsIndex + 1)].join('/');
  }
  return relativeDirectory || metadataName?.trim() || null;
}

function buildSourceLabel(root: CatalogRoot, relativeDirectory: string): string {
  if (root.source !== 'plugin') return root.sourceLabel;
  const parts = relativeDirectory.split('/').filter(Boolean);
  return parts[1] ? `${root.sourceLabel} · ${parts[1]}` : root.sourceLabel;
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
