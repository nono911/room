import * as path from 'path';
import * as fs from 'fs/promises';
import {
  WORKSPACE_FILE_READ_LIMIT_BYTES,
  resolveWithinProject,
  sanitizeWorkspaceRelativePath
} from './shared.js';

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp'
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  css: 'css',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shell',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  yaml: 'yaml',
  yml: 'yaml'
};

function getExtension(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

function getTextMimeType(extension: string): string {
  if (extension === 'json') return 'application/json';
  if (extension === 'md') return 'text/markdown';
  if (extension === 'html') return 'text/html';
  if (extension === 'css') return 'text/css';
  return 'text/plain';
}

export async function readWorkspaceFilePreview(projectRoot: string, filePath: string) {
  const safeFilePath = sanitizeWorkspaceRelativePath(filePath);
  const resolvedPath = resolveWithinProject(projectRoot, safeFilePath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    return { success: false, error: 'Select a file to preview it.' };
  }
  if (stat.size > WORKSPACE_FILE_READ_LIMIT_BYTES) {
    return {
      success: true,
      preview: {
        kind: 'binary' as const,
        mimeType: 'application/octet-stream',
        size: stat.size,
        message: 'This file is too large for an inline preview.'
      }
    };
  }

  const extension = getExtension(safeFilePath);
  const buffer = await fs.readFile(resolvedPath);
  const richMimeType = MIME_BY_EXTENSION[extension];
  if (richMimeType) {
    return {
      success: true,
      preview: {
        kind: extension === 'pdf' ? 'pdf' as const : 'image' as const,
        mimeType: richMimeType,
        dataUrl: `data:${richMimeType};base64,${buffer.toString('base64')}`
      }
    };
  }

  if (buffer.includes(0)) {
    return {
      success: true,
      preview: {
        kind: 'binary' as const,
        mimeType: 'application/octet-stream',
        size: stat.size,
        message: 'Binary files can be revealed in Finder but are not rendered inside ROOM.'
      }
    };
  }

  const content = buffer.toString('utf-8');
  return {
    success: true,
    content,
    preview: {
      kind: 'text' as const,
      content,
      mimeType: getTextMimeType(extension),
      language: LANGUAGE_BY_EXTENSION[extension]
    }
  };
}
