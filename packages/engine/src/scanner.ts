import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveWorkspaceLocation, type WorkspaceInput } from './workspace.js';

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
}

export async function scanDirectory(dirPath: string): Promise<ScanResult> {
  const result: ScanResult = {
    projectName: path.basename(dirPath),
    technologies: {
      languages: [],
      frontend: [],
      backend: [],
      database: [],
      tools: []
    },
    fileCount: 0,
    structure: {}
  };

  const ignoredDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'dist-packaged',
    'build',
    '.next',
    '.room',
    'out',
    '.gemini',
    'coverage',
    'release',
    'releases',
    '.gradle',
    'target',
    '.cache'
  ]);
  const languagesDetected = new Set<string>();
  const frontends = new Set<string>();
  const backends = new Set<string>();
  const databases = new Set<string>();
  const tools = new Set<string>();

  async function traverse(currentPath: string, depth = 0) {
    if (depth > 5) return; // Guard depth

    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return; // Skip folders we cannot read
    }

    const relPath = path.relative(dirPath, currentPath);
    const filesInDir: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        await traverse(path.join(currentPath, entry.name), depth + 1);
      } else if (entry.isFile()) {
        result.fileCount++;
        filesInDir.push(entry.name);

        // Analyze extensions
        const ext = path.extname(entry.name);
        if (ext === '.ts' || ext === '.tsx') languagesDetected.add('TypeScript');
        else if (ext === '.js' || ext === '.jsx') languagesDetected.add('JavaScript');
        else if (ext === '.go') languagesDetected.add('Go');
        else if (ext === '.py') languagesDetected.add('Python');
        else if (ext === '.rs') languagesDetected.add('Rust');
        else if (ext === '.java') languagesDetected.add('Java');
        else if (ext === '.rb') languagesDetected.add('Ruby');
        else if (ext === '.cs') languagesDetected.add('C#');
        else if (ext === '.php') languagesDetected.add('PHP');

        // Signature checks
        if (entry.name === 'package.json') {
          try {
            const content = await fs.readFile(path.join(currentPath, entry.name), 'utf-8');
            const pkg = JSON.parse(content);
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            if (deps.react) frontends.add('React');
            if (deps.vue) frontends.add('Vue');
            if (deps.svelte) frontends.add('Svelte');
            if (deps.next) frontends.add('Next.js');
            if (deps.nuxt) frontends.add('Nuxt.js');
            
            if (deps.hono) backends.add('Hono');
            if (deps.express) backends.add('Express');
            if (deps.nest) backends.add('NestJS');
            if (deps.fastify) backends.add('Fastify');
            
            if (deps.prisma) databases.add('Prisma ORM');
            if (deps.mongoose || deps.mongodb) databases.add('MongoDB');
            if (deps.pg || deps.postgres) databases.add('PostgreSQL');
            if (deps.sequelize) databases.add('Sequelize');

            if (deps.tailwindcss) tools.add('TailwindCSS');
            if (deps.electron) tools.add('Electron');
            if (deps.vite) tools.add('Vite');
            if (deps.webpack) tools.add('Webpack');
          } catch {}
        }

        if (entry.name === 'requirements.txt') {
          backends.add('Python');
        }
        if (entry.name === 'go.mod') {
          backends.add('Go Modules');
        }
        if (entry.name === 'Cargo.toml') {
          tools.add('Cargo');
        }
      }
    }

    if (filesInDir.length > 0 && relPath) {
      result.structure[relPath] = filesInDir.slice(0, 10);
    }
  }

  try {
    await traverse(dirPath);
  } catch {}

  result.technologies.languages = Array.from(languagesDetected);
  result.technologies.frontend = Array.from(frontends);
  result.technologies.backend = Array.from(backends);
  result.technologies.database = Array.from(databases);
  result.technologies.tools = Array.from(tools);

  return result;
}

export async function writeScanData(workspace: WorkspaceInput, scan: ScanResult) {
  const roomDir = resolveWorkspaceLocation(workspace).roomRoot;
  const contextDir = path.join(roomDir, 'context');
  await fs.mkdir(contextDir, { recursive: true });

  // Write context/overview.md
  const projectMdPath = path.join(contextDir, 'overview.md');
  const projectMd = `# Project: ${scan.projectName}

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
  await fs.writeFile(projectMdPath, projectMd, 'utf-8');

  // Write context/structure.md
  const currentMdPath = path.join(contextDir, 'structure.md');
  const currentMd = `# Architecture Map: ${scan.projectName}

## Tech Stack Summary
- **Frontend Framework**: ${scan.technologies.frontend[0] || 'Unknown'}
- **Backend Runtime**: ${scan.technologies.backend[0] || 'Unknown'}
- **Database Layer**: ${scan.technologies.database[0] || 'Unknown'}

## Monitored Directories
${Object.keys(scan.structure).length === 0 ? '- None' : Object.keys(scan.structure).map(folder => `- \`${folder}/\``).join('\n')}
`;
  await fs.writeFile(currentMdPath, currentMd, 'utf-8');

  // Write context/project-map.json
  const mapPath = path.join(contextDir, 'project-map.json');
  await fs.writeFile(mapPath, JSON.stringify(scan, null, 2), 'utf-8');
}
