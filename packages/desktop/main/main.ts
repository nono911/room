import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { scanDirectory, writeScanData, loadAgents, DiscussionEngine, detectLocalAgents, resolveOnPath, LocalCliProvider, getFallbackModels, isOpenAiModelAllowed, validateAgentConfig as validateEngineAgentConfig, normalizeLocalCliModelName, assertLocalCliExecutionAllowed, AGY_FALLBACK_MODELS, type AgentConfig, loadTaskBoard } from '@room/engine';

const execFileP = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rendererRoot = path.resolve(__dirname, '../renderer');

// Register app:// scheme as standard and secure to support ES Modules
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    net.fetch('http://localhost:5173')
      .then(() => {
        mainWindow?.loadURL('http://localhost:5173');
      })
      .catch(() => {
        console.log('[Electron] Dev server not running on port 5173. Falling back to built renderer files.');
        mainWindow?.loadURL('app://localhost/index.html');
      });
  } else {
    mainWindow.loadURL('app://localhost/index.html'); // Load using custom protocol
  }
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await applyApiKeysToEnvironment();

  // Register custom protocol handler to resolve files from renderer output
  protocol.handle('app', (request) => {
    try {
      const parsedUrl = new URL(request.url);
      const requestPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
      const safePath = resolveRendererAssetPath(requestPath);
      return net.fetch(`file://${safePath}`);
    } catch (error) {
      console.warn('[Electron] Rejected app:// path request:', error);
      return new Response('Forbidden', { status: 403 });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const ROOM_DIR = '.room';
const SUPPORTED_LOCAL_CLI_PRESETS = ['claude', 'gemini', 'codex', 'copilot', 'codewhale', 'agy'] as const;
const ALLOWED_PROJECT_MAIN_AGENTS = ['none', ...SUPPORTED_LOCAL_CLI_PRESETS] as const;
const SUPPORTED_LOCAL_CLI_PRESETS_SET = new Set<string>(SUPPORTED_LOCAL_CLI_PRESETS);
const ALLOWED_PROJECT_MAIN_AGENT_SET = new Set<string>(ALLOWED_PROJECT_MAIN_AGENTS);
const ALLOWED_PROJECT_CONFIG_KEYS = ['mainAgent', 'modelName', 'allowDangerousCli'] as const;
const ALLOWED_MCP_CONFIG_KEYS = ['mcpServers'] as const;
const ALLOWED_ROOM_FILE_SECTIONS = ['documents', 'tasks', 'discussions', 'decisions', 'reviews', 'skills'] as const;
const WORKSPACE_FILE_LIMIT = 500;
const WORKSPACE_FILE_READ_LIMIT_BYTES = 1024 * 1024;
const CONTEXT_SEARCH_SCAN_LIMIT = 2500;
const CONTEXT_SEARCH_RESULT_LIMIT = 80;
const CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES = 48 * 1024;
const DISCUSSION_CONTEXT_FILE_LIMIT_BYTES = 200 * 1024;
const DISCUSSION_CONTEXT_TOTAL_LIMIT = 700 * 1024;
const IGNORED_WORKSPACE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-packaged',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache'
]);

interface ApiKeyConfig {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

const ORIGINAL_API_ENV: ApiKeyConfig = {
  geminiApiKey: process.env.GEMINI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY
};

type ProjectMainAgent = typeof ALLOWED_PROJECT_MAIN_AGENTS[number];

interface ProjectConfig {
  mainAgent: ProjectMainAgent;
  modelName?: string;
  allowDangerousCli: boolean;
}

interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

interface ContextSearchResult {
  ref: string;
  label: string;
  type: 'workspace' | 'task' | 'doc' | 'discussion' | 'file';
  path?: string;
  detail: string;
  modifiedAt?: string;
  size?: number;
}

interface SkillPreviewItem {
  filename: string;
  readable: boolean;
  source?: 'skills' | 'roles';
  bytes?: number;
  heading?: string;
  error?: string;
}

function resolveProjectPath(dirPath: string): string {
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    throw new Error('Invalid project path.');
  }
  return path.resolve(dirPath);
}

let currentProjectRoot: string | null = null;

function bindCurrentProjectRoot(dirPath: string): string {
  const projectRoot = resolveProjectPath(dirPath);
  currentProjectRoot = projectRoot;
  return projectRoot;
}

function requireBoundProjectRoot(dirPath: string): string {
  const projectRoot = resolveProjectPath(dirPath);
  if (!currentProjectRoot || projectRoot !== currentProjectRoot) {
    throw new Error('Project path is not the active workspace.');
  }
  return projectRoot;
}

function resolveWithinProject(projectRoot: string, ...parts: string[]): string {
  const root = resolveProjectPath(projectRoot);
  const resolved = path.resolve(root, ...parts);
  const safeRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(safeRoot)) {
    throw new Error('Invalid project path.');
  }
  return resolved;
}

function sanitizeFileName(input: string, fallback = 'untitled'): string {
  const name = path.basename(input || '').trim();
  if (!name) return fallback;
  return name;
}

function sanitizeWorkspaceRelativePath(input: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('Invalid workspace file path.');
  }

  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid workspace file path.');
  }

  return normalized;
}

function isRoomManagedWorkspaceFile(relPath: string): boolean {
  return relPath.toLowerCase().startsWith(`${ROOM_DIR}/`);
}

function isSearchableRoomContextFile(relPath: string): boolean {
  const normalized = relPath.toLowerCase();
  if (!normalized.startsWith(`${ROOM_DIR}/`)) return true;
  if (normalized.startsWith(`${ROOM_DIR}/tasks/`)) return normalized.endsWith('.md');
  if (normalized.startsWith(`${ROOM_DIR}/documents/`)) return normalized.endsWith('.md');
  if (normalized.startsWith(`${ROOM_DIR}/reviews/`)) return normalized.endsWith('.md');
  if (normalized.startsWith(`${ROOM_DIR}/decisions/`)) return normalized.endsWith('.md');
  if (normalized.startsWith(`${ROOM_DIR}/discussions/`)) return normalized.endsWith('.md');
  return false;
}

async function listWorkspaceFiles(projectRoot: string) {
  const root = resolveProjectPath(projectRoot);
  const files: { path: string; name: string; size: number; modifiedAt: string }[] = [];

  async function walk(currentDir: string) {
    if (files.length >= WORKSPACE_FILE_LIMIT) return;

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= WORKSPACE_FILE_LIMIT) return;
      if (entry.name.startsWith('.') && entry.name !== ROOM_DIR) continue;
      if (entry.isDirectory() && IGNORED_WORKSPACE_DIRS.has(entry.name)) continue;

      const fullPath = resolveWithinProject(root, path.relative(root, path.join(currentDir, entry.name)));
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = await fs.stat(fullPath);
      const relPath = path.relative(root, fullPath).split(path.sep).join('/');
      if (isRoomManagedWorkspaceFile(relPath)) {
        continue;
      }
      files.push({
        path: relPath,
        name: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      });
    }
  }

  await walk(root);
  return files;
}

function getContextResultType(relPath: string): ContextSearchResult['type'] {
  const normalized = relPath.toLowerCase();
  if (normalized.startsWith(`${ROOM_DIR}/tasks/`)) return 'task';
  if (normalized.startsWith(`${ROOM_DIR}/discussions/`)) return 'discussion';
  if (
    normalized.startsWith(`${ROOM_DIR}/documents/`) ||
    normalized.startsWith(`${ROOM_DIR}/reviews/`) ||
    normalized.startsWith(`${ROOM_DIR}/decisions/`) ||
    normalized.startsWith('docs/') ||
    normalized.endsWith('/todo.md') ||
    normalized.endsWith('/roadmap.md') ||
    normalized.endsWith('/requirements.md') ||
    normalized.endsWith('/spec.md')
  ) {
    return 'doc';
  }
  return 'file';
}

function getContextRef(relPath: string): string {
  if (
    relPath.startsWith(`${ROOM_DIR}/documents/`) ||
    relPath.startsWith(`${ROOM_DIR}/reviews/`) ||
    relPath.startsWith(`${ROOM_DIR}/decisions/`) ||
    relPath.startsWith(`${ROOM_DIR}/discussions/`)
  ) {
    return `file:${relPath}`;
  }
  if (relPath.startsWith(`${ROOM_DIR}/tasks/`)) {
    return `task:${path.basename(relPath)}`;
  }
  return `file:${relPath}`;
}

function getContextLabel(type: ContextSearchResult['type'], relPath: string, heading?: string): string {
  if (type === 'workspace') return relPath;
  const prefix = type === 'task' ? 'Task' : type === 'doc' ? 'Doc' : type === 'discussion' ? 'Chat' : 'File';
  return `${prefix}: ${heading || relPath}`;
}

function scoreContextCandidate(relPath: string, query: string, modifiedAtMs: number): number {
  const normalized = relPath.toLowerCase();
  const queryParts = query.split(/\s+/).filter(Boolean);
  let score = 0;

  if (normalized.startsWith(`${ROOM_DIR}/tasks/`)) score += 180;
  if (normalized.startsWith(`${ROOM_DIR}/documents/`)) score += 145;
  if (normalized.startsWith(`${ROOM_DIR}/reviews/`) || normalized.startsWith(`${ROOM_DIR}/decisions/`)) score += 130;
  if (normalized.startsWith(`${ROOM_DIR}/discussions/`)) score += 90;
  if (normalized.startsWith('docs/')) score += 150;
  if (!normalized.includes('/')) score += 90;
  if (/\b(todo|roadmap|plan|spec|requirement|requirements|issue|bug|feature|implementation|ticket|backlog|notes?)\b/.test(normalized)) score += 80;
  if (normalized.endsWith('.md') || normalized.endsWith('.mdx') || normalized.endsWith('.txt')) score += 45;
  if (normalized.endsWith('.ts') || normalized.endsWith('.tsx') || normalized.endsWith('.js') || normalized.endsWith('.jsx')) score += 25;

  if (queryParts.length > 0) {
    const basename = path.basename(normalized);
    const allMatch = queryParts.every(part => normalized.includes(part));
    if (!allMatch) return -1;
    score += 220;
    for (const part of queryParts) {
      if (basename.includes(part)) score += 80;
      if (normalized.startsWith(part)) score += 60;
    }
  }

  const ageHours = Math.max(0, (Date.now() - modifiedAtMs) / 36e5);
  score += Math.max(0, 60 - Math.min(60, ageHours / 12));
  return score;
}

async function readContextSearchPreview(filePath: string, size: number): Promise<string> {
  if (size > CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES) return '';
  const buffer = await fs.readFile(filePath).catch(() => Buffer.alloc(0));
  if (buffer.includes(0)) return '';
  return buffer.toString('utf-8');
}

function extractMarkdownHeading(content: string): string | undefined {
  const heading = content
    .split('\n')
    .map(line => line.trim())
    .find(line => /^#{1,3}\s+\S/.test(line));
  return heading?.replace(/^#{1,3}\s+/, '').trim().slice(0, 100);
}

async function readSkillPreview(projectRoot: string, filename: string): Promise<SkillPreviewItem> {
  const safeFilename = sanitizeFileName(filename);
  if (!safeFilename.toLowerCase().endsWith('.md')) {
    return { filename: safeFilename, readable: false, error: 'Skill filename must end with .md.' };
  }

  for (const source of ['skills', 'roles'] as const) {
    const candidate = resolveWithinProject(projectRoot, ROOM_DIR, source, safeFilename);
    try {
      const content = await readTextFileWithLimit(candidate, DISCUSSION_CONTEXT_FILE_LIMIT_BYTES);
      return {
        filename: safeFilename,
        readable: true,
        source,
        bytes: Buffer.byteLength(content, 'utf-8'),
        heading: extractMarkdownHeading(content)
      };
    } catch {}
  }

  return { filename: safeFilename, readable: false, error: 'Skill file was not found in .room/skills or .room/roles.' };
}

function describeSkillDelivery(provider: string, cliPreset?: string, stdinFormat?: string): string {
  if (provider !== 'Local CLI') {
    return 'Sent in the provider system instruction as an Active Skills block.';
  }
  if (cliPreset === 'codewhale' || cliPreset === 'agy') {
    return 'Sent inside the composed prompt argument under # Instructions and Active Skills.';
  }
  if (cliPreset && cliPreset !== 'none') {
    return 'Sent to the local CLI through stdin with instructions before the request.';
  }
  return stdinFormat === 'json'
    ? 'Sent to the custom command as JSON systemInstruction plus prompt.'
    : 'Sent to the custom command as plain text instructions before the request.';
}

async function searchContextItems(projectRoot: string, query = ''): Promise<ContextSearchResult[]> {
  const root = resolveProjectPath(projectRoot);
  const normalizedQuery = query.trim().toLowerCase();
  const results: Array<ContextSearchResult & { score: number }> = [
    {
      ref: 'workspace:overview',
      label: 'Workspace Overview',
      type: 'workspace' as const,
      detail: '.room/context/overview.md',
      score: normalizedQuery ? ('workspace overview'.includes(normalizedQuery) ? 500 : -1) : 500
    },
    {
      ref: 'workspace:structure',
      label: 'Workspace Structure',
      type: 'workspace' as const,
      detail: '.room/context/structure.md',
      score: normalizedQuery ? ('workspace structure architecture'.includes(normalizedQuery) ? 490 : -1) : 490
    }
  ].filter(result => result.score >= 0);
  let scanned = 0;

  async function walk(currentDir: string) {
    if (scanned >= CONTEXT_SEARCH_SCAN_LIMIT) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (scanned >= CONTEXT_SEARCH_SCAN_LIMIT) return;
      if (entry.name.startsWith('.') && entry.name !== ROOM_DIR) continue;
      if (entry.isDirectory() && IGNORED_WORKSPACE_DIRS.has(entry.name)) continue;

      const fullPath = resolveWithinProject(root, path.relative(root, path.join(currentDir, entry.name)));
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      scanned += 1;
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      if (stat.size > WORKSPACE_FILE_READ_LIMIT_BYTES) continue;

      const relPath = path.relative(root, fullPath).split(path.sep).join('/');
      const normalized = relPath.toLowerCase();
      if (!isSearchableRoomContextFile(relPath)) {
        continue;
      }
      const shouldReadPreview = /\.(md|mdx|txt)$/i.test(relPath) || normalized.startsWith('docs/') || normalized.startsWith(`${ROOM_DIR}/`);
      const preview = shouldReadPreview ? await readContextSearchPreview(fullPath, stat.size) : '';
      const previewSearch = preview.toLowerCase();
      const isLikelyContext =
        normalizedQuery ||
        normalized.startsWith(`${ROOM_DIR}/`) ||
        normalized.startsWith('docs/') ||
        !normalized.includes('/') ||
        /\.(md|mdx|txt)$/i.test(relPath);
      if (!isLikelyContext) continue;

      let score = scoreContextCandidate(relPath, normalizedQuery, stat.mtimeMs);
      if (score < 0 && normalizedQuery && previewSearch) {
        const queryParts = normalizedQuery.split(/\s+/).filter(Boolean);
        if (queryParts.every(part => previewSearch.includes(part))) {
          score = 210 + Math.max(0, 60 - Math.min(60, (Date.now() - stat.mtimeMs) / 36e5 / 12));
        }
      }
      if (score < 0) continue;
      const type = getContextResultType(relPath);
      const heading = preview ? extractMarkdownHeading(preview) : undefined;
      results.push({
        ref: getContextRef(relPath),
        label: getContextLabel(type, relPath, heading),
        type,
        path: relPath,
        detail: `${formatBytes(stat.size)} · modified ${stat.mtime.toISOString().slice(0, 10)}`,
        modifiedAt: stat.mtime.toISOString(),
        size: stat.size,
        score
      });
    }
  }

  await walk(root);
  const byRef = new Map<string, ContextSearchResult & { score: number }>();
  for (const result of results) {
    const existing = byRef.get(result.ref);
    if (!existing || result.score > existing.score) byRef.set(result.ref, result);
  }
  return Array.from(byRef.values())
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, CONTEXT_SEARCH_RESULT_LIMIT)
    .map(({ score, ...result }) => result);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readFirstExistingFile(paths: string[]): Promise<string> {
  for (const filePath of paths) {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {}
  }
  return '';
}

async function readMergedDirs(dirs: string[]): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of dirs) {
    const files = await safeReadDir(dir);
    for (const file of files) {
      names.add(file);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function dedupeDiscussionSummaryFiles(files: string[]): string[] {
  const summaryByDiscussion = new Map<string, string>();
  const result: string[] = [];

  for (const file of files) {
    const match = file.match(/^(.*)-((?:discussion)-\d+)-summary\.md$/);
    if (!match) {
      result.push(file);
      continue;
    }

    const discussionId = match[2];
    const current = summaryByDiscussion.get(discussionId);
    if (!current) {
      summaryByDiscussion.set(discussionId, file);
      result.push(file);
      continue;
    }

    const preferred = preferDiscussionSummaryFilename(current, file);
    summaryByDiscussion.set(discussionId, preferred);
    const currentIndex = result.indexOf(current);
    if (currentIndex >= 0) {
      result[currentIndex] = preferred;
    }
  }

  return Array.from(new Set(result)).sort((a, b) => a.localeCompare(b));
}

function preferDiscussionSummaryFilename(a: string, b: string): string {
  const score = (file: string): number => {
    const basename = file.replace(/-discussion-\d+-summary\.md$/, '');
    const nonAscii = [...basename].filter(ch => ch.charCodeAt(0) > 127).length;
    const hyphens = (basename.match(/-/g) || []).length;
    return (nonAscii * 3) - hyphens;
  };
  return score(b) >= score(a) ? b : a;
}

async function removeSupersededDiscussionSummaries(documentsDir: string, keepFilename: string): Promise<void> {
  const match = keepFilename.match(/-discussion-\d+-summary\.md$/);
  if (!match) return;

  const suffix = match[0];
  try {
    const files = await safeReadDir(documentsDir);
    await Promise.all(files
      .filter(file => file.endsWith(suffix) && file !== keepFilename)
      .map(file => fs.rm(resolveWithinProject(documentsDir, file), { force: true })));
  } catch {
    // Best-effort cleanup; saving the requested file should still proceed.
  }
}

async function readTextFileWithLimit(filePath: string, maxBytes: number): Promise<string> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error('Selected item is not a file.');
  }
  if (stat.size > maxBytes) {
    throw new Error('File is too large to include as discussion context.');
  }

  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) {
    throw new Error('Binary files cannot be included as discussion context.');
  }
  return buffer.toString('utf-8');
}

function normalizeContextRef(rawRef: unknown): string | null {
  if (typeof rawRef !== 'string') return null;
  const ref = rawRef.trim();
  if (!ref) return null;
  return ref;
}

async function buildDiscussionContext(projectRoot: string, rawRefs: unknown): Promise<string> {
  if (!Array.isArray(rawRefs)) return '';

  const sections: string[] = [];
  let totalBytes = 0;

  for (const rawRef of rawRefs) {
    const ref = normalizeContextRef(rawRef);
    if (!ref) continue;

    let label = ref;
    let content = '';
    try {
      if (ref === 'workspace:overview') {
        continue;
      } else if (ref === 'workspace:structure') {
        continue;
      } else if (ref.startsWith('file:')) {
        const relPath = sanitizeWorkspaceRelativePath(ref.slice('file:'.length));
        label = `Workspace File: ${relPath}`;
        content = await readTextFileWithLimit(
          resolveWithinProject(projectRoot, relPath),
          DISCUSSION_CONTEXT_FILE_LIMIT_BYTES
        );
      } else if (ref.startsWith('document:')) {
        const filename = sanitizeFileName(ref.slice('document:'.length));
        label = `Document: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinProject(projectRoot, ROOM_DIR, 'documents', filename),
          resolveWithinProject(projectRoot, ROOM_DIR, 'reviews', filename),
          resolveWithinProject(projectRoot, ROOM_DIR, 'decisions', filename)
        ]);
      } else if (ref.startsWith('task:')) {
        const filename = sanitizeFileName(ref.slice('task:'.length));
        label = `Task: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinProject(projectRoot, ROOM_DIR, 'tasks', filename)
        ]);
      } else if (ref.startsWith('discussion:')) {
        const filename = sanitizeFileName(ref.slice('discussion:'.length));
        if (!filename.toLowerCase().endsWith('.md')) {
          throw new Error('Only markdown discussion transcripts can be included as context.');
        }
        label = `Previous Discussion: ${filename}`;
        content = await readFirstExistingFile([
          resolveWithinProject(projectRoot, ROOM_DIR, 'discussions', filename)
        ]);
      }
    } catch (error: any) {
      content = `[Unable to include context: ${error.message}]`;
    }

    if (!content.trim()) continue;

    const section = `\n\n---\n## ${label}\n\n${content.trim()}`;
    totalBytes += Buffer.byteLength(section, 'utf-8');
    if (totalBytes > DISCUSSION_CONTEXT_TOTAL_LIMIT) {
      sections.push('\n\n---\n## Context Limit\n\nAdditional selected context was omitted because the context bundle reached the size limit.');
      break;
    }
    sections.push(section);
  }

  return sections.join('');
}

function sanitizeWorkspaceFolderName(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    throw new Error('Workspace name is required.');
  }
  const safeName = trimmed.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim();
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('Invalid workspace name.');
  }
  return safeName;
}

async function initializeRoomWorkspace(projectRoot: string): Promise<void> {
  const roomDir = resolveWithinProject(projectRoot, ROOM_DIR);
  await fs.mkdir(roomDir, { recursive: true });

  const subdirs = [
    'tasks',
    'discussions',
    'documents',
    'roles',
    'skills',
    'members',
    'context'
  ];

  for (const dir of subdirs) {
    await fs.mkdir(resolveWithinProject(roomDir, dir), { recursive: true });
  }

  const projectMdPath = resolveWithinProject(roomDir, 'context', 'overview.md');
  const projectMdExists = await fs.stat(projectMdPath).then(() => true).catch(() => false);
  if (!projectMdExists) {
    await fs.writeFile(
      projectMdPath,
      `# Workspace Name\n\n## Overview\nDescribe what this workspace is for.\n\n## Goals\n- \n\n## Source Material\n- \n\n## Open Questions\n- \n`,
      'utf-8'
    );
  }

  const structureMdPath = resolveWithinProject(roomDir, 'context', 'structure.md');
  const structureMdExists = await fs.stat(structureMdPath).then(() => true).catch(() => false);
  if (!structureMdExists) {
    await fs.writeFile(
      structureMdPath,
      `# Workspace Structure\n\n## Overview\nDescribe the important parts of this workspace and how they relate to each other.\n\n## Key Areas\n- \n`,
      'utf-8'
    );
  }
}

function resolveRendererAssetPath(rawPath: string): string {
  const decodedPath = decodeURIComponent(rawPath || '/index.html');
  const normalizedPath = decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`;
  const candidate = path.resolve(rendererRoot, `.${normalizedPath}`);
  const rel = path.relative(rendererRoot, candidate);

  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid app resource path.');
  }

  return candidate;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAllowed(value: string, allowed: readonly string[]): value is string {
  return allowed.includes(value);
}

function sanitizeAgentFileName(name: string): string {
  const normalized = path.basename(name.toLowerCase()).trim();
  return normalized.replace(/[^a-z0-9_-]/g, '-');
}

function isObjectWithAllowedKeys(value: unknown, allowedKeys: readonly string[]): boolean {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function validateProjectConfig(rawConfig: unknown): { success: true; config: ProjectConfig } | { success: false; error: string } {
  if (!isPlainObject(rawConfig)) {
    return { success: false, error: 'Invalid project config format.' };
  }

  if (!isObjectWithAllowedKeys(rawConfig, ALLOWED_PROJECT_CONFIG_KEYS)) {
    return { success: false, error: 'Project config contains unsupported keys.' };
  }

  const mainAgentRaw = typeof rawConfig.mainAgent === 'string' ? rawConfig.mainAgent.trim() : 'none';
  if (!ALLOWED_PROJECT_MAIN_AGENT_SET.has(mainAgentRaw)) {
    return { success: false, error: 'Invalid main agent.' };
  }
  const mainAgent = mainAgentRaw as ProjectMainAgent;

  if (rawConfig.modelName !== undefined && rawConfig.modelName !== null && typeof rawConfig.modelName !== 'string') {
    return { success: false, error: 'Invalid model name format.' };
  }
  const modelName = typeof rawConfig.modelName === 'string' ? normalizeLocalCliModelName(rawConfig.modelName) : undefined;

  if (rawConfig.allowDangerousCli !== undefined && typeof rawConfig.allowDangerousCli !== 'boolean') {
    return { success: false, error: 'Invalid dangerous permission flag.' };
  }

  return {
    success: true,
    config: {
      mainAgent,
      ...(modelName ? { modelName } : {}),
      allowDangerousCli: rawConfig.allowDangerousCli === true
    }
  };
}

function validateMcpConfig(rawConfig: unknown): { success: true; config: McpConfig } | { success: false; error: string } {
  if (!isPlainObject(rawConfig)) {
    return { success: false, error: 'Invalid MCP config format.' };
  }

  if (!isObjectWithAllowedKeys(rawConfig, ALLOWED_MCP_CONFIG_KEYS)) {
    return { success: false, error: 'MCP config contains unsupported keys.' };
  }

  if (!isPlainObject(rawConfig.mcpServers)) {
    return { success: false, error: 'MCP config.mcpServers must be an object.' };
  }

  const mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};

  for (const [serverName, serverConfig] of Object.entries(rawConfig.mcpServers)) {
    if (typeof serverName !== 'string' || !serverName.trim()) {
      return { success: false, error: 'MCP server name must be a non-empty string.' };
    }

    if (!isPlainObject(serverConfig)) {
      return { success: false, error: `Invalid MCP server config for ${serverName}.` };
    }

    const rawServerConfig = serverConfig as Record<string, unknown>;
    if (rawServerConfig.command === undefined || typeof rawServerConfig.command !== 'string' || !rawServerConfig.command.trim()) {
      return { success: false, error: `Missing or invalid command for MCP server ${serverName}.` };
    }

    if (rawServerConfig.args !== undefined) {
      if (!Array.isArray(rawServerConfig.args) || !rawServerConfig.args.every((arg) => typeof arg === 'string')) {
        return { success: false, error: `Invalid args for MCP server ${serverName}.` };
      }
    }

    if (rawServerConfig.env !== undefined) {
      if (!isPlainObject(rawServerConfig.env)) {
        return { success: false, error: `Invalid env for MCP server ${serverName}.` };
      }
      const envEntries = Object.entries(rawServerConfig.env as Record<string, unknown>);
      for (const [key, value] of envEntries) {
        if (typeof key !== 'string' || typeof value !== 'string') {
          return { success: false, error: `Invalid env value for MCP server ${serverName}.` };
        }
      }
    }

    const args = Array.isArray(rawServerConfig.args)
      ? rawServerConfig.args.filter((arg): arg is string => typeof arg === 'string')
      : undefined;
    const env = isPlainObject(rawServerConfig.env)
      ? Object.fromEntries(
          Object.entries(rawServerConfig.env as Record<string, unknown>).filter(([, v]) => typeof v === 'string') as [string, string][]
        )
      : undefined;

    mcpServers[serverName] = {
      command: rawServerConfig.command.trim(),
      ...(args && args.length > 0 ? { args } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {})
    };
  }

  return { success: true, config: { mcpServers } };
}

async function readProjectConfigFromDisk(projectRoot: string): Promise<ProjectConfig> {
  const projectConfigPath = resolveWithinProject(projectRoot, ROOM_DIR, 'config.json');
  try {
    const content = await fs.readFile(projectConfigPath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = validateProjectConfig(parsed);
    if (validated.success) {
      return validated.config;
    }
    return { mainAgent: 'none', allowDangerousCli: false };
  } catch {
    return { mainAgent: 'none', allowDangerousCli: false };
  }
}

async function readMcpConfigFromDisk(projectRoot: string): Promise<McpConfig> {
  const mcpPath = resolveWithinProject(projectRoot, ROOM_DIR, 'mcp.json');
  try {
    const content = await fs.readFile(mcpPath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = validateMcpConfig(parsed);
    if (validated.success) {
      return validated.config;
    }
    return { mcpServers: {} };
  } catch {
    return { mcpServers: {} };
  }
}

function getApiKeysPath(): string {
  return path.join(app.getPath('userData'), 'api-keys.json');
}

async function readApiKeysFromDisk(): Promise<ApiKeyConfig> {
  try {
    const content = await fs.readFile(getApiKeysPath(), 'utf-8');
    const parsed = JSON.parse(content);
    if (!isPlainObject(parsed)) return {};

    return {
      geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : undefined,
      anthropicApiKey: typeof parsed.anthropicApiKey === 'string' ? parsed.anthropicApiKey : undefined,
      openaiApiKey: typeof parsed.openaiApiKey === 'string' ? parsed.openaiApiKey : undefined
    };
  } catch {
    return {};
  }
}

async function writeApiKeysToDisk(config: ApiKeyConfig): Promise<void> {
  const filePath = getApiKeysPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  try {
    await fs.chmod(filePath, 0o600);
  } catch {}
}

async function applyApiKeysToEnvironment(): Promise<ApiKeyConfig> {
  const keys = await readApiKeysFromDisk();
  if (keys.geminiApiKey) process.env.GEMINI_API_KEY = keys.geminiApiKey;
  if (keys.anthropicApiKey) process.env.ANTHROPIC_API_KEY = keys.anthropicApiKey;
  if (keys.openaiApiKey) process.env.OPENAI_API_KEY = keys.openaiApiKey;
  return keys;
}

function apiKeyStatus(keys: ApiKeyConfig = {}) {
  return {
    gemini: !!(keys.geminiApiKey || process.env.GEMINI_API_KEY),
    anthropic: !!(keys.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    openai: !!(keys.openaiApiKey || process.env.OPENAI_API_KEY)
  };
}

function isDangerousAgentAllowed(projectRoot: string): Promise<boolean> {
  return readProjectConfigFromDisk(projectRoot)
    .then((projectConfig) => projectConfig.allowDangerousCli)
    .catch(() => false);
}

function validateAgentConfig(rawAgent: unknown): { success: true; agent: AgentConfig } | { success: false; error: string } {
  const engineValidated = validateEngineAgentConfig(rawAgent);
  if (!engineValidated.success) {
    return engineValidated;
  }
  return engineValidated;
}

// IPC Main Handlers
ipcMain.handle('select-project-dir', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = bindCurrentProjectRoot(result.filePaths[0]);
  const roomPath = resolveWithinProject(selectedPath, ROOM_DIR);
  let isRoomProject = false;

  try {
    const stats = await fs.stat(roomPath);
    isRoomProject = stats.isDirectory();
  } catch {
    isRoomProject = false;
  }

  return {
    path: selectedPath,
    isRoomProject,
  };
});

ipcMain.handle('open-project-dir', async (event, dirPath: string) => {
  const projectRoot = resolveProjectPath(dirPath);

  bindCurrentProjectRoot(projectRoot);
  const roomPath = resolveWithinProject(projectRoot, ROOM_DIR);
  let isRoomProject = false;

  try {
    const stats = await fs.stat(roomPath);
    isRoomProject = stats.isDirectory();
  } catch {
    isRoomProject = false;
  }

  return {
    path: projectRoot,
    isRoomProject,
  };
});

ipcMain.handle('create-workspace', async (event, workspaceName: string) => {
  if (!mainWindow) return null;
  try {
    const safeWorkspaceName = sanitizeWorkspaceFolderName(workspaceName);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Create ROOM workspace',
      defaultPath: path.join(app.getPath('documents'), safeWorkspaceName),
      buttonLabel: 'Create Workspace',
      properties: ['createDirectory']
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const projectRoot = resolveProjectPath(result.filePath);
    const existing = await fs.stat(projectRoot).then(() => true).catch(() => false);
    if (existing) {
      return { success: false, error: 'A folder with this workspace name already exists.' };
    }

    await fs.mkdir(projectRoot, { recursive: true });
    await initializeRoomWorkspace(projectRoot);
    bindCurrentProjectRoot(projectRoot);

    return {
      success: true,
      path: projectRoot,
      isRoomProject: true
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('room-init', async (event, dirPath: string) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    await initializeRoomWorkspace(projectRoot);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-project-data', async (event, dirPath: string) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const roomDir = resolveWithinProject(projectRoot, ROOM_DIR);
    const projectMd = await readFirstExistingFile([
      resolveWithinProject(roomDir, 'context', 'overview.md'),
      resolveWithinProject(roomDir, 'workspace.md'),
      resolveWithinProject(roomDir, 'project.md')
    ]);
    const archMd = await readFirstExistingFile([
      resolveWithinProject(roomDir, 'context', 'structure.md'),
      resolveWithinProject(roomDir, 'architecture', 'current.md')
    ]);
    const hasScanData = await fs.stat(resolveWithinProject(roomDir, 'context', 'project-map.json'))
      .then(stat => stat.isFile())
      .catch(() => false);

    const tasksDir = resolveWithinProject(roomDir, 'tasks');
    const decisionsDir = resolveWithinProject(roomDir, 'decisions');
    const reviewsDir = resolveWithinProject(roomDir, 'reviews');
    const discussionsDir = resolveWithinProject(roomDir, 'discussions');
    const documentsDir = resolveWithinProject(roomDir, 'documents');
    const rolesDir = resolveWithinProject(roomDir, 'roles');
    const skillsDir = resolveWithinProject(roomDir, 'skills');

    const tasks = (await safeReadDir(tasksDir))
      .filter(file => file.toLowerCase().endsWith('.md'));
    const decisions = await safeReadDir(decisionsDir);
    const reviews = await safeReadDir(reviewsDir);
    const discussions = (await safeReadDir(discussionsDir))
      .filter(file => file.toLowerCase().endsWith('.md'));
    const documents = dedupeDiscussionSummaryFiles(await readMergedDirs([documentsDir, reviewsDir, decisionsDir]));
    const skills = await readMergedDirs([rolesDir, skillsDir]);
    const agents = await loadAgents(projectRoot);

    return {
      success: true,
      projectMd,
      archMd,
      hasScanData,
      tasks,
      decisions,
      reviews,
      documents,
      discussions,
      skills,
      agents
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-room-file', async (event, { dirPath, section, filename }: { dirPath: string; section: string; filename: string }) => {
  try {
    if (!isAllowed(section, ALLOWED_ROOM_FILE_SECTIONS)) {
      return { success: false, error: 'Invalid ROOM file section.' };
    }

    const projectRoot = requireBoundProjectRoot(dirPath);
    const safeFilename = sanitizeFileName(filename);
    const sectionsToTry = section === 'documents'
      ? ['documents', 'reviews', 'decisions']
      : section === 'skills'
        ? ['skills', 'roles']
        : [section];

    let filePath = '';
    let sourceSection = '';
    for (const sectionToTry of sectionsToTry) {
      const candidate = resolveWithinProject(projectRoot, ROOM_DIR, sectionToTry, safeFilename);
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

    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, content, sourceSection };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-workspace-files', async (event, dirPath: string) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const files = await listWorkspaceFiles(projectRoot);
    return { success: true, files, truncated: files.length >= WORKSPACE_FILE_LIMIT };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-context-items', async (event, { dirPath, query }: { dirPath: string; query?: string }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const items = await searchContextItems(projectRoot, query || '');
    return { success: true, items };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-workspace-file', async (event, { dirPath, filePath }: { dirPath: string; filePath: string }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const safeFilePath = sanitizeWorkspaceRelativePath(filePath);
    const resolvedPath = resolveWithinProject(projectRoot, safeFilePath);
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      return { success: false, error: 'Selected item is not a file.' };
    }
    if (stat.size > WORKSPACE_FILE_READ_LIMIT_BYTES) {
      return { success: false, error: 'File is too large to preview.' };
    }

    const buffer = await fs.readFile(resolvedPath);
    if (buffer.includes(0)) {
      return { success: false, error: 'Binary files cannot be previewed.' };
    }

    return { success: true, content: buffer.toString('utf-8') };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('run-scan', async (event, { dirPath, mainAgent, modelName, allowDangerousCli }: { dirPath: string; mainAgent?: string; modelName?: string; allowDangerousCli?: boolean }) => {
  try {
    await applyApiKeysToEnvironment();
    const projectRoot = requireBoundProjectRoot(dirPath);
    const scanResult = await scanDirectory(projectRoot);
    await writeScanData(projectRoot, scanResult);
    const projectConfig = await readProjectConfigFromDisk(projectRoot);
    const dangerModeAllowed = !!allowDangerousCli && projectConfig.allowDangerousCli;

    // If main agent is configured and available, run AI codebase analysis
    const safeMainAgent = mainAgent && SUPPORTED_LOCAL_CLI_PRESETS_SET.has(mainAgent) ? mainAgent : 'none';
    if (safeMainAgent && safeMainAgent !== 'none') {
      const provider = new LocalCliProvider({
        cliPreset: safeMainAgent as any,
        cwd: projectRoot,
        modelName: normalizeLocalCliModelName(modelName),
        permissionMode: dangerModeAllowed ? 'dangerous' : 'safe'
      });

      const prompt = `Please review the files in this directory. Create a comprehensive, professional project overview (README style) detailing the core technologies, codebase structure, and data layer. Focus on Clean Architecture if applicable. Use the dominant natural language already present in the workspace files and project context. If the workspace mixes languages, preserve that mix when it helps clarity. Output the result in clean Markdown format starting directly with the title # (do not wrap the output in \`\`\`markdown block).`;

      console.log(`[Main Agent Scan] Executing AI scan with agent: ${mainAgent}...`);
      const aiSummary = await provider.execute(prompt, 'You are the principal codebase scanner. Analyze the repository files and write a detailed project overview. Do not force a default language; follow the language used by the workspace content.');

      if (aiSummary && aiSummary.trim()) {
        const projectMdPath = resolveWithinProject(projectRoot, ROOM_DIR, 'context', 'overview.md');
        await fs.mkdir(path.dirname(projectMdPath), { recursive: true });
        await fs.writeFile(projectMdPath, aiSummary, 'utf-8');
        console.log(`[Main Agent Scan] Successfully enriched context/overview.md using AI scan.`);
      }
    }

    return { success: true, message: 'Scan complete' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('run-discussion', async (event, { dirPath, topic, agentNames, maxRounds, reviewMode, contextRefs, discussionId: requestedDiscussionId, qualityGate, moderatorName, autoSummary, summaryAgentName, useProjectSummaryAgent }: { dirPath: string; topic: string; agentNames?: string[]; maxRounds?: number; reviewMode?: boolean; contextRefs?: string[]; discussionId?: string; qualityGate?: boolean; moderatorName?: string; autoSummary?: boolean; summaryAgentName?: string; useProjectSummaryAgent?: boolean }) => {
  const safeRequestedDiscussionId = typeof requestedDiscussionId === 'string' && /^discussion-\d+$/.test(requestedDiscussionId)
    ? requestedDiscussionId
    : '';
  const discussionId = safeRequestedDiscussionId || `discussion-${Date.now()}`;
  const roundLimit = Number.isFinite(maxRounds) ? Math.max(1, Math.min(10, Math.floor(maxRounds || 1))) : 2;
  const sendDiscussionEvent = (payload: any) => {
    event.sender.send('discussion-event', payload);
  };
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const engine = new DiscussionEngine(projectRoot);
    await applyApiKeysToEnvironment();
    const additionalContext = await buildDiscussionContext(projectRoot, contextRefs);
    let log = await engine.runDiscussion(
      discussionId,
      `Discussion: ${topic.slice(0, 30)}...`,
      topic,
      agentNames && agentNames.length > 0 ? agentNames : [],
      roundLimit,
      {
        onEvent: sendDiscussionEvent,
        reviewMode: !!reviewMode,
        additionalContext
      }
    );

    const moderatorActions: Array<{ type: 'task' | 'adr'; id?: string; title?: string; filename?: string }> = [];

    if (qualityGate) {
      const verdict = await engine.evaluateDiscussion(discussionId, moderatorName);
      if (verdict.executed) {
        moderatorActions.push(
          ...verdict.executed.createdTaskCards.map(card => ({ type: 'task' as const, id: card.id, title: card.title })),
          ...verdict.executed.createdAdrs.map(adr => ({ type: 'adr' as const, id: adr.id, filename: adr.filename }))
        );
      }

      const discussionsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'discussions');
      const finalLogPath = resolveWithinProject(discussionsDir, `${discussionId}.json`);
      try {
        log = JSON.parse(await fs.readFile(finalLogPath, 'utf-8'));
      } catch {}
    }

    let summary: { filename: string; content: string } | undefined;
    if (autoSummary) {
      const projectConfig = await readProjectConfigFromDisk(projectRoot);
      const projectSummaryAgent = useProjectSummaryAgent ? createProjectSummaryAgent(projectConfig) : undefined;
      const summaryAgentNames = summaryAgentName
        ? [summaryAgentName]
        : (useProjectSummaryAgent ? [] : (agentNames || []));
      summary = await engine.summarizeDiscussion(
        discussionId,
        summaryAgentNames,
        projectSummaryAgent
      );
    }

    return { success: true, log, summary, moderatorActions };
  } catch (error: any) {
    sendDiscussionEvent({
      type: 'discussion_failed',
      discussionId,
      error: error.message
    });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('run-task', async (event, { dirPath, task, taskType, doerName, reviewerNames, maxCycles, contextRefs }: { dirPath: string; task: string; taskType?: string; doerName?: string; reviewerNames?: string[]; maxCycles?: number; contextRefs?: string[] }) => {
  const taskId = `task-${Date.now()}`;
  const cycleLimit = Number.isFinite(maxCycles) ? Math.max(1, Math.min(5, Math.floor(maxCycles || 1))) : 2;
  const sendDiscussionEvent = (payload: any) => {
    event.sender.send('discussion-event', payload);
  };

  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const engine = new DiscussionEngine(projectRoot);
    await applyApiKeysToEnvironment();
    const agents = await loadAgents(projectRoot);
    const doer = doerName
      ? agents.find(agent => agent.name.toLowerCase() === doerName.toLowerCase())
      : agents.find(agent => {
          const text = `${agent.name} ${agent.role}`.toLowerCase();
          return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('writer') || text.includes('researcher') || text.includes('designer') || text.includes('producer');
        });

    if (!doer) {
      return { success: false, error: 'Select a Doer AI member before running the task.' };
    }

    const additionalContext = await buildDiscussionContext(projectRoot, contextRefs);
    const result = await engine.runCodingTask(
      taskId,
      `Task: ${task.slice(0, 40)}...`,
      task,
      doer.name,
      reviewerNames || [],
      cycleLimit,
      {
        onEvent: sendDiscussionEvent,
        additionalContext,
        taskType
      }
    );

    return { success: true, result };
  } catch (error: any) {
    sendDiscussionEvent({
      type: 'discussion_failed',
      discussionId: taskId,
      error: error.message
    });
    return { success: false, error: error.message };
  }
});

function createProjectSummaryAgent(projectConfig: ProjectConfig): AgentConfig | undefined {
  if (!projectConfig.mainAgent || projectConfig.mainAgent === 'none') {
    return undefined;
  }

  return {
    name: 'Project Summary Agent',
    role: 'Room Reporter',
    provider: 'Local CLI',
    modelName: projectConfig.modelName || undefined,
    systemPrompt: `You are the Room Reporter for this workspace.

Your job is to turn chat transcripts into durable workspace memory.
Do not contribute new ideas. Capture what was decided, what remains open, useful context, risks, options, and next steps.
Use the same natural language as the chat unless the user explicitly asks otherwise.`,
    cliPreset: projectConfig.mainAgent as AgentConfig['cliPreset'],
    stdinFormat: 'text',
    permissionMode: 'safe'
  };
}

ipcMain.handle('summarize-discussion', async (event, { dirPath, discussionId, agentNames, summaryAgentName, useProjectSummaryAgent }: { dirPath: string; discussionId: string; agentNames?: string[]; summaryAgentName?: string; useProjectSummaryAgent?: boolean }) => {
  try {
    await applyApiKeysToEnvironment();
    const projectRoot = requireBoundProjectRoot(dirPath);
    const safeDiscussionId = typeof discussionId === 'string' && /^discussion-\d+$/.test(discussionId)
      ? discussionId
      : '';
    if (!safeDiscussionId) {
      return { success: false, error: 'Invalid discussion id.' };
    }

    const engine = new DiscussionEngine(projectRoot);
    const projectConfig = await readProjectConfigFromDisk(projectRoot);
    const projectSummaryAgent = useProjectSummaryAgent ? createProjectSummaryAgent(projectConfig) : undefined;
    const summaryAgentNames = summaryAgentName
      ? [summaryAgentName]
      : (useProjectSummaryAgent ? [] : (agentNames || []));
    const summary = await engine.summarizeDiscussion(safeDiscussionId, summaryAgentNames, projectSummaryAgent);
    return { success: true, ...summary };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate-tasks-from-discussion', async (event, { dirPath, discussionId, moderatorName }: { dirPath: string; discussionId: string; moderatorName?: string }) => {
  try {
    await applyApiKeysToEnvironment();
    const projectRoot = requireBoundProjectRoot(dirPath);
    const safeDiscussionId = typeof discussionId === 'string' && /^discussion-\d+$/.test(discussionId)
      ? discussionId
      : '';
    if (!safeDiscussionId) {
      return { success: false, error: 'Invalid discussion id.' };
    }

    const engine = new DiscussionEngine(projectRoot);
    const result = await engine.generateTasksFromDiscussion(safeDiscussionId, moderatorName);
    return { success: true, ...result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-task-board', async (event, { dirPath }: { dirPath: string }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const board = await loadTaskBoard(projectRoot);
    return { success: true, cards: board.cards };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-room-file', async (event, { dirPath, section, filename, content }: { dirPath: string; section: string; filename: string; content: string }) => {
  try {
    if (!isAllowed(section, ['documents', 'tasks'] as const)) {
      return { success: false, error: 'Invalid ROOM file section.' };
    }
    if (typeof content !== 'string') {
      return { success: false, error: 'Invalid file content.' };
    }

    const projectRoot = requireBoundProjectRoot(dirPath);
    const safeFilename = sanitizeFileName(filename || 'untitled', 'untitled');
    const fileNameWithExt = safeFilename.endsWith('.md') ? safeFilename : `${safeFilename}.md`;
    const sectionDir = resolveWithinProject(projectRoot, ROOM_DIR, section);
    await fs.mkdir(sectionDir, { recursive: true });
    if (section === 'documents') {
      await removeSupersededDiscussionSummaries(sectionDir, fileNameWithExt);
    }
    const filePath = resolveWithinProject(sectionDir, fileNameWithExt);
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, filename: fileNameWithExt };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-context-file', async (event, { dirPath, filename, content }: { dirPath: string; filename: string; content: string }) => {
  try {
    if (filename !== 'overview.md' && filename !== 'structure.md') {
      return { success: false, error: 'Invalid context file.' };
    }
    if (typeof content !== 'string') {
      return { success: false, error: 'Invalid file content.' };
    }

    const projectRoot = requireBoundProjectRoot(dirPath);
    const contextDir = resolveWithinProject(projectRoot, ROOM_DIR, 'context');
    await fs.mkdir(contextDir, { recursive: true });
    const filePath = resolveWithinProject(contextDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-skill', async (event, { dirPath, name, content, source }: { dirPath: string; name: string; content: string; source?: string }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const targetSection = source === 'roles' ? 'roles' : 'skills';
    const skillsDir = resolveWithinProject(projectRoot, ROOM_DIR, targetSection);
    await fs.mkdir(skillsDir, { recursive: true });
    const filename = sanitizeFileName(name || 'untitled', 'untitled');
    const fileNameWithExt = filename.endsWith('.md') ? filename : `${filename}.md`;
    const filePath = resolveWithinProject(skillsDir, fileNameWithExt);
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-agent', async (event, { dirPath, agent }: { dirPath: string; agent: unknown }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const agentsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'members');
    const validated = validateAgentConfig(agent);
    if (!validated.success) {
      return { success: false, error: validated.error };
    }

    if (validated.agent.provider === 'Local CLI') {
      try {
        assertLocalCliExecutionAllowed(validated.agent, await isDangerousAgentAllowed(projectRoot));
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }

    await fs.mkdir(agentsDir, { recursive: true });
    const safeAgentName = sanitizeAgentFileName(validated.agent.name);
    const filename = `${safeAgentName || 'agent'}.json`;
    const filePath = resolveWithinProject(agentsDir, filename);
    await fs.writeFile(filePath, JSON.stringify(validated.agent, null, 2), 'utf-8');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('preview-agent-skills', async (event, { dirPath, agent }: { dirPath: string; agent: any }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const skills: string[] = Array.isArray(agent?.skills)
      ? agent.skills.filter((skill: unknown): skill is string => typeof skill === 'string')
      : [];
    const items = await Promise.all(skills.map(skill => readSkillPreview(projectRoot, skill)));
    const readableCount = items.filter(item => item.readable).length;
    return {
      success: true,
      delivery: describeSkillDelivery(agent?.provider || '', agent?.cliPreset, agent?.stdinFormat),
      readableCount,
      totalCount: items.length,
      items
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-agent', async (event, { dirPath, agentName }: { dirPath: string; agentName: string }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const safeAgentName = sanitizeFileName((agentName || 'agent').toLowerCase(), 'agent');
    const filename = `${safeAgentName.replace(/[^a-z0-9_-]/g, '-')}.json`;
    const filePaths = [
      resolveWithinProject(projectRoot, ROOM_DIR, 'members', filename),
      resolveWithinProject(projectRoot, ROOM_DIR, 'agents', filename)
    ];
    let deleted = false;
    for (const filePath of filePaths) {
      try {
        await fs.unlink(filePath);
        deleted = true;
        break;
      } catch {}
    }
    if (!deleted) {
      return { success: false, error: 'Agent was not found.' };
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('detect-local-agents', async () => {
  try {
    const agents = await detectLocalAgents();
    return { success: true, agents };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-api-keys', async () => {
  try {
    const keys = await applyApiKeysToEnvironment();
    return { success: true, status: apiKeyStatus(keys) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-api-keys', async (_, payload: ApiKeyConfig) => {
  try {
    const existing = await readApiKeysFromDisk();
    const next: ApiKeyConfig = { ...existing };

    if (typeof payload?.geminiApiKey === 'string' && payload.geminiApiKey.trim()) {
      next.geminiApiKey = payload.geminiApiKey.trim();
    }
    if (typeof payload?.anthropicApiKey === 'string' && payload.anthropicApiKey.trim()) {
      next.anthropicApiKey = payload.anthropicApiKey.trim();
    }
    if (typeof payload?.openaiApiKey === 'string' && payload.openaiApiKey.trim()) {
      next.openaiApiKey = payload.openaiApiKey.trim();
    }

    await writeApiKeysToDisk(next);
    const keys = await applyApiKeysToEnvironment();
    return { success: true, status: apiKeyStatus(keys) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-api-keys', async () => {
  try {
    await writeApiKeysToDisk({});
    if (ORIGINAL_API_ENV.geminiApiKey) {
      process.env.GEMINI_API_KEY = ORIGINAL_API_ENV.geminiApiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    if (ORIGINAL_API_ENV.anthropicApiKey) {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_API_ENV.anthropicApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    if (ORIGINAL_API_ENV.openaiApiKey) {
      process.env.OPENAI_API_KEY = ORIGINAL_API_ENV.openaiApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    return { success: true, status: apiKeyStatus(ORIGINAL_API_ENV) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('detect-cli-models', async (_, cliId: string) => {
  try {
    await applyApiKeysToEnvironment();
    const presetClis = ['codewhale', 'agy', 'gemini', 'claude', 'codex', 'copilot'];
    const bin = presetClis.includes(cliId) ? cliId : null;
    if (!bin) {
      return { success: true, models: [] };
    }
    const resolvedPath = resolveOnPath(bin);
    if (!resolvedPath) {
      return { success: true, models: getFallbackModels(cliId) };
    }

    let models: { value: string; label: string }[] = [];

    if (cliId === 'gemini') {
      const geminiKey = process.env.GEMINI_API_KEY || '';
      if (geminiKey) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
          if (res.ok) {
            const data: any = await res.json();
            models = (data.models || [])
              .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
              .map((m: any) => ({
                value: m.name.replace('models/', ''),
                label: m.displayName || m.name
              }));
          }
        } catch {}
      }
    } else if (cliId === 'claude') {
      const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
      if (anthropicKey) {
        try {
          const res = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01'
            }
          });
          if (res.ok) {
            const data: any = await res.json();
            models = (data.data || []).map((m: any) => ({
              value: m.id,
              label: m.display_name || m.id
            }));
          }
        } catch {}
      }
    } else if (cliId === 'codex') {
      const openaiKey = process.env.OPENAI_API_KEY || '';
      if (openaiKey) {
        try {
          const res = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${openaiKey}` }
          });
      if (res.ok) {
        const data: any = await res.json();
        models = (data.data || [])
          .filter((m: any) => m.id && isOpenAiModelAllowed(m.id))
          .map((m: any) => ({
            value: m.id,
            label: m.id
          }));
          }
        } catch {}
      }
    } else if (cliId === 'codewhale') {
      try {
        const result = await execFileP(resolvedPath, ['models'], {
          timeout: 4000,
          maxBuffer: 1024 * 1024
        });
        const stdout = result.stdout;
        if (stdout) {
          const lines = stdout.split('\n');
          for (let line of lines) {
            line = line.trim();
            if (!line || line.toLowerCase().includes('available models') || line.toLowerCase().includes('no models available')) {
              continue;
            }
            const cleanLine = line.replace(/^[\s*]+/, '');
            const parts = cleanLine.split(' ');
            const modelId = parts[0];
            if (modelId) {
              models.push({ value: modelId, label: cleanLine });
            }
          }
        }
      } catch {}
    } else if (cliId === 'agy') {
      try {
        const result = await execFileP(resolvedPath, ['models'], {
          timeout: 4000,
          maxBuffer: 1024 * 1024
        });
        const stdout = result.stdout;
        if (stdout) {
          const output = stdout.replace(/available models:?/ig, ' ').replace(/\s+/g, ' ').trim();
          const knownModels = AGY_FALLBACK_MODELS
            .map(model => model.value)
            .filter(model => model !== 'default');
          for (const modelId of knownModels) {
            if (!output.includes(modelId)) {
              continue;
            }
            models.push({ value: modelId, label: modelId });
          }
        }
      } catch {}
    }

    if (models.length > 0) {
      return { success: true, models };
    }

    return { success: true, models: getFallbackModels(cliId) };
  } catch (error: any) {
    return { success: true, models: getFallbackModels(cliId) };
  }
});

ipcMain.handle('detect-api-models', async (_, { provider, apiKey }: { provider: string; apiKey?: string }) => {
  try {
    await applyApiKeysToEnvironment();
    if (provider === 'Gemini') {
      const geminiKey = apiKey || process.env.GEMINI_API_KEY || '';
      if (!geminiKey) return { success: false, error: 'Gemini API key is not configured.' };
      
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
      if (res.ok) {
        const data: any = await res.json();
        const models = (data.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => ({
            value: m.name.replace('models/', ''),
            label: m.displayName || m.name
          }));
        if (models.length > 0) return { success: true, models };
      } else {
        const errText = await res.text();
        return { success: false, error: `API returned status ${res.status}: ${errText}` };
      }
    } else if (provider === 'Codex') {
      const openaiKey = apiKey || process.env.OPENAI_API_KEY || '';
      if (!openaiKey) return { success: false, error: 'OpenAI API key is not configured.' };

      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${openaiKey}` }
      });
      if (res.ok) {
        const data: any = await res.json();
        const models = (data.data || [])
          .filter((m: any) => m.id && isOpenAiModelAllowed(m.id))
          .map((m: any) => ({
            value: m.id,
            label: m.id
          }));
        if (models.length > 0) return { success: true, models };
      } else {
        const errText = await res.text();
        return { success: false, error: `API returned status ${res.status}: ${errText}` };
      }
    } else if (provider === 'Claude') {
      const anthropicKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
      if (!anthropicKey) return { success: false, error: 'Anthropic API key is not configured.' };

      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        }
      });
      if (res.ok) {
        const data: any = await res.json();
        const models = (data.data || []).map((m: any) => ({
          value: m.id,
          label: m.display_name || m.id
        }));
        if (models.length > 0) return { success: true, models };
      } else {
        const errText = await res.text();
        return { success: false, error: `API returned status ${res.status}: ${errText}` };
      }
    }
    return { success: false, error: 'Unsupported provider or no models found.' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-mcp-config', async (event, dirPath: string) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const config = await readMcpConfigFromDisk(projectRoot);
    return { success: true, config };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-mcp-config', async (event, { dirPath, config }: { dirPath: string; config: any }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const mcpPath = resolveWithinProject(projectRoot, ROOM_DIR, 'mcp.json');
    const validated = validateMcpConfig(config);
    if (!validated.success) {
      return { success: false, error: validated.error };
    }
    await fs.mkdir(path.dirname(mcpPath), { recursive: true });
    await fs.writeFile(mcpPath, JSON.stringify(validated.config, null, 2), 'utf-8');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-project-config', async (event, dirPath: string) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const config = await readProjectConfigFromDisk(projectRoot);
    return { success: true, config };
  } catch (error: any) {
    if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: true, config: { mainAgent: 'none' } };
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-project-config', async (event, { dirPath, config }: { dirPath: string; config: any }) => {
  try {
    const projectRoot = requireBoundProjectRoot(dirPath);
    const configPath = resolveWithinProject(projectRoot, ROOM_DIR, 'config.json');
    const validated = validateProjectConfig(config);
    if (!validated.success) {
      return { success: false, error: validated.error };
    }
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(validated.config, null, 2), 'utf-8');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

async function safeReadDir(dirPath: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dirPath);
    return files.filter(f => !f.startsWith('.'));
  } catch {
    return [];
  }
}
