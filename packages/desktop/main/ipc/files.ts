import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  ALLOWED_ROOM_FILE_SECTIONS,
  requireBoundProjectRoot, resolveWithinProject, resolveWithinRoomData,
  sanitizeFileName, isAllowed, isPlainObject
} from './shared.js';
import { readProjectConfigFromDisk, validateProjectConfig } from './config-store.js';

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
        const candidate = resolveWithinRoomData(projectRoot, sectionToTry, safeFilename);
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
      const sectionDir = resolveWithinRoomData(projectRoot, section);
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
      const contextDir = resolveWithinRoomData(projectRoot, 'context');
      await fs.mkdir(contextDir, { recursive: true });
      const filePath = resolveWithinProject(contextDir, filename);
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-skill', async (event, { dirPath, name, content, source }: { dirPath: string; name: string; content: string; source?: 'skills' | 'roles' }) => {
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const subfolder = source === 'roles' ? 'roles' : 'skills';
      const skillsDir = resolveWithinRoomData(projectRoot, subfolder);
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
      const configPath = resolveWithinRoomData(projectRoot, 'config.json');
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
