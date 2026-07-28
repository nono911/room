import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { parseSkillFrontmatter } from './parser.js';
import { listDirectoryNamesBounded } from '../boundedFs.js';
import {
  buildMachineSkillSourceLabel,
  buildSkillIdentity,
  isWithinMachineSkillRoot,
  truncateUtf8
} from './machineCatalogIdentity.js';
import { readMachineSkillFile } from './machineSkillFile.js';

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

export interface ApprovedMachineSkillSnapshot {
  memberId: string;
  provider: string;
  reference: string;
  contentDigest: string;
  content: string;
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
const MAX_CATALOG_FILES = 1000;
const MAX_SCAN_DEPTH = 12;
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const MAX_INSPECTED_ENTRIES = 20_000;
const MAX_INSPECTED_DIRECTORIES = 2_000;
const MAX_AGGREGATE_SKILL_BYTES = 16 * 1024 * 1024;
const MAX_CATALOG_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_SCAN_MS = 4_000;
const CACHE_TTL_MS = 15_000;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build']);

interface CatalogLoadResult {
  records: MachineSkillRecord[];
  truncated: boolean;
}

let defaultCatalogCache: { expiresAt: number; result: CatalogLoadResult } | null = null;
let defaultCatalogLoad: Promise<CatalogLoadResult> | null = null;

interface CatalogScanBudget {
  deadline: number;
  inspectedEntries: number;
  inspectedDirectories: number;
  skillFiles: number;
  contentBytes: number;
  metadataBytes: number;
  truncated: boolean;
}

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

export function machineSkillContentDigest(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function approvedMachineSkillContent(
  snapshots: readonly ApprovedMachineSkillSnapshot[],
  agent: { id?: string; provider: string } | undefined,
  reference: string
): string | undefined {
  if (!agent?.id) return undefined;
  return snapshots.find(snapshot => (
    snapshot.memberId === agent.id
    && snapshot.provider === agent.provider
    && snapshot.reference === reference
    && snapshot.contentDigest === machineSkillContentDigest(snapshot.content)
  ))?.content;
}

export async function discoverMachineSkills(
  options?: MachineSkillCatalogOptions
): Promise<MachineSkillSummary[]> {
  const { records } = await loadCatalog(options);
  return records.map(({ filePath: _filePath, rootPath: _rootPath, ...summary }) => summary);
}

export async function discoverMachineSkillsWithDiagnostics(
  options?: MachineSkillCatalogOptions
): Promise<{ skills: MachineSkillSummary[]; truncated: boolean }> {
  const { records, truncated } = await loadCatalog(options);
  return {
    skills: records.map(({ filePath: _filePath, rootPath: _rootPath, ...summary }) => summary),
    truncated
  };
}

export async function readMachineSkill(
  reference: string,
  options?: MachineSkillCatalogOptions
): Promise<{ skill: MachineSkillSummary; content: string; filePath: string }> {
  const normalizedReference = normalizeMachineSkillReference(reference);
  if (!normalizedReference) {
    throw new Error(`Invalid machine skill reference: ${reference}`);
  }

  const resolved = await resolveExactMachineSkill(normalizedReference, options);
  if (!resolved) {
    throw new Error(`Machine skill is unavailable: ${reference}`);
  }

  const [canonicalFile, canonicalRoot] = await Promise.all([
    fs.realpath(resolved.record.filePath),
    fs.realpath(resolved.record.rootPath)
  ]);
  if (!isWithinMachineSkillRoot(canonicalRoot, canonicalFile)) {
    throw new Error(`Machine skill escaped its registered source: ${reference}`);
  }

  const { filePath: _filePath, rootPath: _rootPath, ...skill } = resolved.record;
  return { skill, content: resolved.content, filePath: canonicalFile };
}

async function resolveExactMachineSkill(
  reference: string,
  options?: MachineSkillCatalogOptions
): Promise<{ record: MachineSkillRecord; content: string } | null> {
  const match = reference.match(/^machine:\/\/(codex|agents|plugin)\/([^/?#]+)$/);
  if (!match) return null;
  const source = match[1] as MachineSkillSource;
  const identity = decodeURIComponent(match[2]);
  const root = getCatalogRoots(options).find(item => item.source === source);
  if (!root) return null;
  const canonicalRoot = await fs.realpath(root.rootPath).catch(() => null);
  if (!canonicalRoot) return null;
  const parts = identity.split('/');
  const candidates = [path.join(canonicalRoot, ...parts, 'SKILL.md')];
  if (source === 'plugin' && parts.length >= 3) {
    const pluginRoot = path.join(canonicalRoot, parts[0], parts[1]);
    const versions = await listDirectoryNamesBounded(pluginRoot, 256).catch(() => null);
    if (versions?.truncated) {
      throw new Error(`Machine skill version directory exceeds its limit: ${reference}`);
    }
    for (const version of versions?.names || []) {
      candidates.push(path.join(
        pluginRoot,
        version,
        'skills',
        ...parts.slice(2),
        'SKILL.md'
      ));
    }
  }
  const matchingFiles: Array<{
    canonicalFile: string;
    modifiedAt: string;
    relativeDirectory: string;
  }> = [];
  for (const candidate of candidates) {
    try {
      const [canonicalFile, stat] = await Promise.all([
        fs.realpath(candidate),
        fs.lstat(candidate)
      ]);
      if (
        stat.isSymbolicLink()
        || !stat.isFile()
        || !isWithinMachineSkillRoot(canonicalRoot, canonicalFile)
      ) continue;
      const relativeDirectory = path.relative(
        canonicalRoot,
        path.dirname(canonicalFile)
      ).split(path.sep).join('/');
      if (buildSkillIdentity(source, relativeDirectory) !== identity) continue;
      matchingFiles.push({
        canonicalFile,
        modifiedAt: stat.mtime.toISOString(),
        relativeDirectory
      });
    } catch {}
  }
  const selected = matchingFiles.sort(
    (left, right) => right.modifiedAt.localeCompare(left.modifiedAt)
  )[0];
  if (!selected) return null;
  const content = await readMachineSkillFile(selected.canonicalFile, reference);
  const { metadata } = parseSkillFrontmatter(content);
  return {
    content,
    record: {
      reference,
      name: truncateUtf8(
        metadata.name?.trim() || path.basename(path.dirname(selected.canonicalFile)),
        256
      ),
      description: metadata.description
        ? truncateUtf8(metadata.description.trim(), 2_048)
        : undefined,
      source,
      sourceLabel: truncateUtf8(
        buildMachineSkillSourceLabel(source, root.sourceLabel, selected.relativeDirectory),
        512
      ),
      relativePath: truncateUtf8(
        selected.relativeDirectory
          ? `${selected.relativeDirectory}/SKILL.md`
          : 'SKILL.md',
        1_024
      ),
      modifiedAt: selected.modifiedAt,
      filePath: selected.canonicalFile,
      rootPath: canonicalRoot
    }
  };
}

async function loadCatalog(options?: MachineSkillCatalogOptions): Promise<CatalogLoadResult> {
  const useCache = usesDefaultRoots(options);
  const cachedCatalog = defaultCatalogCache;
  if (useCache && !options?.forceRefresh && cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.result;
  }
  if (useCache && defaultCatalogLoad) return defaultCatalogLoad;

  const load = async (): Promise<CatalogLoadResult> => {
    const budget: CatalogScanBudget = {
      deadline: Date.now() + MAX_CATALOG_SCAN_MS,
      inspectedEntries: 0,
      inspectedDirectories: 0,
      skillFiles: 0,
      contentBytes: 0,
      metadataBytes: 0,
      truncated: false
    };
    const discovered: MachineSkillRecord[] = [];
    for (const root of getCatalogRoots(options)) {
      discovered.push(...await scanCatalogRoot(root, budget));
    }
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
      defaultCatalogCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        result: { records, truncated: budget.truncated }
      };
    }
    return { records, truncated: budget.truncated };
  };
  if (!useCache) return load();
  defaultCatalogLoad = load();
  try {
    return await defaultCatalogLoad;
  } finally {
    defaultCatalogLoad = null;
  }
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

async function scanCatalogRoot(
  root: CatalogRoot,
  budget: CatalogScanBudget
): Promise<MachineSkillRecord[]> {
  const canonicalRoot = await fs.realpath(root.rootPath).catch(() => null);
  if (!canonicalRoot) return [];

  const records: MachineSkillRecord[] = [];

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (
      depth > MAX_SCAN_DEPTH
      || budget.skillFiles >= MAX_CATALOG_FILES
      || budget.inspectedEntries >= MAX_INSPECTED_ENTRIES
      || budget.inspectedDirectories >= MAX_INSPECTED_DIRECTORIES
      || Date.now() > budget.deadline
    ) {
      budget.truncated = true;
      return;
    }
    let entries: Awaited<ReturnType<typeof fs.opendir>>;
    try {
      entries = await fs.opendir(directory);
    } catch {
      return;
    }
    budget.inspectedDirectories += 1;
    try {
      for await (const entry of entries) {
      budget.inspectedEntries += 1;
      if (
        budget.skillFiles >= MAX_CATALOG_FILES
        || budget.inspectedEntries > MAX_INSPECTED_ENTRIES
        || Date.now() > budget.deadline
      ) {
        budget.truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await walk(entryPath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile() || entry.name !== 'SKILL.md') continue;
      budget.skillFiles += 1;
      const record = await readCatalogEntry(root, canonicalRoot, entryPath, budget);
      if (record) records.push(record);
      }
    } finally {
      await entries.close().catch(() => undefined);
    }
  };

  await walk(canonicalRoot, 0);
  return records;
}

async function readCatalogEntry(
  root: CatalogRoot,
  canonicalRoot: string,
  filePath: string,
  budget: CatalogScanBudget
): Promise<MachineSkillRecord | null> {
  try {
    const [canonicalFile, stat] = await Promise.all([fs.realpath(filePath), fs.lstat(filePath)]);
    if (
      !stat.isFile()
      || stat.isSymbolicLink()
      || stat.size > MAX_SKILL_FILE_BYTES
      || !isWithinMachineSkillRoot(canonicalRoot, canonicalFile)
    ) {
      return null;
    }
    if (budget.contentBytes + stat.size > MAX_AGGREGATE_SKILL_BYTES) {
      budget.truncated = true;
      return null;
    }

    budget.contentBytes += stat.size;
    const content = await readMachineSkillFile(canonicalFile, canonicalFile);
    const { metadata } = parseSkillFrontmatter(content);
    const skillDirectory = path.dirname(canonicalFile);
    const relativeDirectory = path.relative(canonicalRoot, skillDirectory).split(path.sep).join('/');
    const identity = buildSkillIdentity(root.source, relativeDirectory, metadata.name);
    if (!identity) return null;
    const reference = normalizeMachineSkillReference(
      `${MACHINE_SKILL_PREFIX}${root.source}/${encodeURIComponent(identity)}`
    );
    if (!reference) return null;

    const record: MachineSkillRecord = {
      reference,
      name: truncateUtf8(metadata.name?.trim() || path.basename(skillDirectory), 256),
      description: metadata.description
        ? truncateUtf8(metadata.description.trim(), 2_048)
        : undefined,
      source: root.source,
      sourceLabel: truncateUtf8(
        buildMachineSkillSourceLabel(root.source, root.sourceLabel, relativeDirectory),
        512
      ),
      relativePath: truncateUtf8(
        relativeDirectory ? `${relativeDirectory}/SKILL.md` : 'SKILL.md',
        1_024
      ),
      modifiedAt: stat.mtime.toISOString(),
      filePath: canonicalFile,
      rootPath: canonicalRoot
    };
    const metadataBytes = Buffer.byteLength(JSON.stringify({
      reference: record.reference,
      name: record.name,
      description: record.description,
      source: record.source,
      sourceLabel: record.sourceLabel,
      relativePath: record.relativePath,
      modifiedAt: record.modifiedAt
    }), 'utf-8');
    if (budget.metadataBytes + metadataBytes > MAX_CATALOG_METADATA_BYTES) {
      budget.truncated = true;
      return null;
    }
    budget.metadataBytes += metadataBytes;
    return record;
  } catch {
    return null;
  }
}
