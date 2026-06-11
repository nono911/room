import { BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { scanDirectory, writeScanData, loadAgents, LocalCliProvider, normalizeLocalCliModelName } from '@room/engine';
import {
  ROOM_DIR, SUPPORTED_LOCAL_CLI_PRESETS_SET, WORKSPACE_FILE_LIMIT, WORKSPACE_FILE_READ_LIMIT_BYTES,
  CONTEXT_SEARCH_SCAN_LIMIT, CONTEXT_SEARCH_RESULT_LIMIT, CONTEXT_SEARCH_PREVIEW_LIMIT_BYTES,
  IGNORED_WORKSPACE_DIRS,
  resolveProjectPath, bindCurrentProjectRoot, requireBoundProjectRoot, resolveWithinProject,
  sanitizeFileName, sanitizeWorkspaceRelativePath, formatBytes, safeReadDir, readFirstExistingFile,
  readMergedDirs, readProjectConfigFromDisk, applyApiKeysToEnvironment, extractMarkdownHeading,
  type ContextSearchResult
} from './shared.js';

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
  const files: { path: string; name: string; size: number; modifiedAt: string; kind: 'file' | 'directory' }[] = [];

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
      const relPath = path.relative(root, fullPath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        const stat = await fs.stat(fullPath);
        files.push({
          path: relPath,
          name: entry.name,
          size: 0,
          modifiedAt: stat.mtime.toISOString(),
          kind: 'directory'
        });
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = await fs.stat(fullPath);
      if (isRoomManagedWorkspaceFile(relPath)) {
        continue;
      }
      files.push({
        path: relPath,
        name: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        kind: 'file'
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

export function registerWorkspaceIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('select-project-dir', async () => {
    const mainWindow = getMainWindow();
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
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    try {
      const safeWorkspaceName = sanitizeWorkspaceFolderName(workspaceName);
      const { app } = await import('electron');
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

      const taskFiles = (await safeReadDir(tasksDir))
        .filter(file => file.toLowerCase().endsWith('.md'));
      const taskRuns = taskFiles.filter(file => /^task-\d+\.md$/i.test(file));
      const tasks = taskFiles.filter(file => !/^task-\d+\.md$/i.test(file));
      const decisions = await safeReadDir(decisionsDir);
      const reviews = await safeReadDir(reviewsDir);
      const discussions = (await safeReadDir(discussionsDir))
        .filter(file => file.toLowerCase().endsWith('.md'));
      const documents = dedupeDiscussionSummaryFiles(await readMergedDirs([documentsDir, reviewsDir, decisionsDir]));
      const skills = await readMergedDirs([skillsDir, rolesDir]);
      const agents = await loadAgents(projectRoot);

      return {
        success: true,
        projectMd,
        archMd,
        hasScanData,
        tasks,
        taskRuns,
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
      const safeFilePath = typeof filePath === 'string' && filePath.trim()
        ? sanitizeWorkspaceRelativePath(filePath)
        : '';
      const resolvedPath = safeFilePath ? resolveWithinProject(projectRoot, safeFilePath) : projectRoot;
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) {
        if (stat.isDirectory()) {
          const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
          const preview = entries
            .filter(entry => !entry.name.startsWith('.') || entry.name === ROOM_DIR)
            .slice(0, 200)
            .map(entry => `${entry.isDirectory() ? '[dir]' : '[file]'} ${entry.name}`)
            .join('\n');
          return {
            success: true,
            content: `# ${safeFilePath || path.basename(projectRoot)}\n\n${preview || 'Directory is empty.'}`
          };
        }
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
}
