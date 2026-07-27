import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  ALLOWED_ROOM_FILE_SECTIONS,
  requireBoundRoom, resolveWithinProject, resolveWithinRoomData,
  sanitizeFileName, isAllowed, isPlainObject
} from './shared.js';
import { readProjectConfigFromDisk, validateProjectConfig } from './config-store.js';
import type { ContextSet } from '../../shared/types/domain.js';

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

async function removeSupersededDiscussionSummaries(documentsDir: string, keepFilename: string): Promise<void> {
  const match = keepFilename.match(/-discussion-\d+-summary\.md$/);
  if (!match) return;

  const suffix = match[0];
  try {
    const { safeReadDir } = await import('./shared.js');
    const files = await safeReadDir(documentsDir);
    await Promise.all(files
      .filter(file => file.endsWith(suffix) && file !== keepFilename)
      .map(file => fs.rm(resolveWithinProject(documentsDir, file), { force: true })));
  } catch {
    // Best-effort cleanup; saving the requested file should still proceed.
  }
}

export function registerFilesIpc(): void {
  ipcMain.handle('load-context-sets', async (event, { roomId }: { roomId: string }) => {
    try {
      requireBoundRoom(roomId);
      const filePath = resolveWithinRoomData(roomId, 'context', 'sets.json');
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return { success: true, contextSets: validateContextSets(JSON.parse(content)) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { success: true, contextSets: [] };
        }
        throw error;
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-context-sets', async (
    event,
    { roomId, contextSets }: { roomId: string; contextSets: unknown }
  ) => {
    try {
      requireBoundRoom(roomId);
      const validated = validateContextSets(contextSets);
      const contextDir = resolveWithinRoomData(roomId, 'context');
      await fs.mkdir(contextDir, { recursive: true });
      await fs.writeFile(
        resolveWithinProject(contextDir, 'sets.json'),
        JSON.stringify(validated, null, 2),
        'utf-8'
      );
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('read-room-file', async (event, { roomId, section, filename }: { roomId: string; section: string; filename: string }) => {
    try {
      if (!isAllowed(section, ALLOWED_ROOM_FILE_SECTIONS)) {
        return { success: false, error: 'Invalid ROOM file section.' };
      }

      requireBoundRoom(roomId);
      const safeFilename = sanitizeFileName(filename);
      const sectionsToTry = section === 'documents'
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

      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, content, sourceSection };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-room-file', async (event, { roomId, section, filename, content }: { roomId: string; section: string; filename: string; content: string }) => {
    try {
      if (!isAllowed(section, ['documents', 'tasks'] as const)) {
        return { success: false, error: 'Invalid ROOM file section.' };
      }
      if (typeof content !== 'string') {
        return { success: false, error: 'Invalid file content.' };
      }

      requireBoundRoom(roomId);
      const safeFilename = sanitizeFileName(filename || 'untitled', 'untitled');
      const fileNameWithExt = safeFilename.endsWith('.md') ? safeFilename : `${safeFilename}.md`;
      const sectionDir = resolveWithinRoomData(roomId, section);
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

  ipcMain.handle('save-context-file', async (event, { roomId, filename, content }: { roomId: string; filename: string; content: string }) => {
    try {
      if (filename !== 'overview.md' && filename !== 'structure.md') {
        return { success: false, error: 'Invalid context file.' };
      }
      if (typeof content !== 'string') {
        return { success: false, error: 'Invalid file content.' };
      }

      requireBoundRoom(roomId);
      const contextDir = resolveWithinRoomData(roomId, 'context');
      await fs.mkdir(contextDir, { recursive: true });
      const filePath = resolveWithinProject(contextDir, filename);
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-skill', async (event, { roomId, name, content, source }: { roomId: string; name: string; content: string; source?: 'skills' | 'roles' }) => {
    try {
      requireBoundRoom(roomId);
      const subfolder = source === 'roles' ? 'roles' : 'skills';
      const skillsDir = resolveWithinRoomData(roomId, subfolder);
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

  ipcMain.handle('load-project-config', async (event, roomId: string) => {
    try {
      requireBoundRoom(roomId);
      const config = await readProjectConfigFromDisk(roomId);
      return { success: true, config };
    } catch (error: any) {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: true, config: { mainAgent: 'none' } };
      }
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-project-config', async (event, { roomId, config }: { roomId: string; config: any }) => {
    try {
      requireBoundRoom(roomId);
      const configPath = resolveWithinRoomData(roomId, 'config.json');
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
}
