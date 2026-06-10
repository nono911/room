import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { scanDirectory, writeScanData } from './scanner.js';
import { analyzeFeatureImpact } from './impact/analyzer.js';
import { createNewADR } from './decisions/adr.js';
import { DiscussionEngine } from './discussion/engine.js';

const program = new Command();

program
  .name('room')
  .description('ROOM: AI-native Project Workspace Engine')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize ROOM Project Memory in the current directory')
  .option('-p, --path <path>', 'Path to initialize', '.')
  .action(async (options) => {
    const targetDir = path.resolve(options.path);
    const roomDir = path.join(targetDir, '.room');

    console.log(`Initializing ROOM Project Memory at ${roomDir}...`);

    try {
      await fs.mkdir(roomDir, { recursive: true });

      const subdirs = [
        'context',
        'tasks',
        'discussions',
        'documents',
        'skills',
        'members'
      ];

      for (const dir of subdirs) {
        await fs.mkdir(path.join(roomDir, dir), { recursive: true });
      }

      // Create initial project.md
      const projectMdPath = path.join(roomDir, 'context', 'overview.md');
      const projectMdContent = `# Workspace Name

## Overview
Describe what this workspace is for.

## Goals
- 

## Source Material
- 

## Open Questions
- 
`;
      const projectMdExists = await fs.stat(projectMdPath).then(() => true).catch(() => false);
      if (!projectMdExists) {
        await fs.writeFile(projectMdPath, projectMdContent, 'utf-8');
      }

      // Create initial architecture/current.md
      const archMdPath = path.join(roomDir, 'context', 'structure.md');
      const archMdContent = `# Workspace Structure

## Overview
Describe the important parts of this workspace and how they relate to each other.

## Key Areas
- 
`;
      const archMdExists = await fs.stat(archMdPath).then(() => true).catch(() => false);
      if (!archMdExists) {
        await fs.writeFile(archMdPath, archMdContent, 'utf-8');
      }

      console.log('ROOM Project Memory initialized successfully!');
      console.log(`Created structure under .room/`);
    } catch (error: any) {
      console.error('Failed to initialize ROOM:', error.message);
      process.exit(1);
    }
  });

program
  .command('scan')
  .description('Scan project files and update .room/ metadata')
  .option('-p, --path <path>', 'Path to project directory', '.')
  .action(async (options) => {
    const targetDir = path.resolve(options.path);
    const roomDir = path.join(targetDir, '.room');

    try {
      const stats = await fs.stat(roomDir);
      if (!stats.isDirectory()) {
        throw new Error('ROOM Project Memory is not initialized. Run "room init" first.');
      }
    } catch {
      console.error('Error: ROOM Project Memory is not initialized. Run "room init" first.');
      process.exit(1);
    }

    console.log(`Scanning repository structure at ${targetDir}...`);
    try {
      const result = await scanDirectory(targetDir);
      await writeScanData(targetDir, result);
      console.log('Project scan completed successfully!');
      console.log('Updated .room/context/overview.md');
      console.log('Updated .room/context/structure.md');
      console.log('Updated .room/context/project-map.json');
    } catch (error: any) {
      console.error('Scan failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('impact')
  .description('Analyze the codebase impact of a feature description')
  .argument('<description>', 'Description of the feature to analyze')
  .option('-p, --path <path>', 'Path to project directory', '.')
  .action(async (description, options) => {
    const targetDir = path.resolve(options.path);
    const roomDir = path.join(targetDir, '.room');

    try {
      const stats = await fs.stat(roomDir);
      if (!stats.isDirectory()) {
        throw new Error('ROOM Project Memory is not initialized. Run "room init" first.');
      }
    } catch {
      console.error('Error: ROOM Project Memory is not initialized. Run "room init" first.');
      process.exit(1);
    }

    console.log(`Analyzing impact of feature: "${description}"...`);
    try {
      const report = await analyzeFeatureImpact(targetDir, description);
      console.log('\n=======================================');
      console.log('       FEATURE IMPACT ANALYSIS');
      console.log('=======================================');
      if (report.status && report.status !== 'complete') {
        console.log(`Status: ${report.status}`);
      }
      console.log(`Risk Level: ${report.riskLevel}`);
      console.log(`Reasoning: ${report.reasoning}`);
      console.log('\nAffected Files:');
      if (report.affectedFiles.length > 0) {
        report.affectedFiles.forEach(f => console.log(`  - ${f}`));
      } else {
        console.log('  - None identified');
      }
      console.log('\nAffected APIs:');
      if (report.affectedApis.length > 0) {
        report.affectedApis.forEach(api => console.log(`  - ${api}`));
      } else {
        console.log('  - None identified');
      }
      console.log('\nDatabase Changes:');
      if (report.databaseChanges.length > 0) {
        report.databaseChanges.forEach(db => console.log(`  - ${db}`));
      } else {
        console.log('  - None identified');
      }
      console.log('=======================================\n');
    } catch (error: any) {
      console.error('Impact analysis failed:', error.message);
      process.exit(1);
    }
  });

const adrCmd = program.command('adr').description('Manage Architecture Decision Records (ADRs)');

adrCmd
  .command('new')
  .description('Create a new ADR record')
  .argument('<title>', 'Title of the ADR')
  .option('-p, --path <path>', 'Path to project directory', '.')
  .action(async (title, options) => {
    const targetDir = path.resolve(options.path);
    try {
      const { filename, created } = await createNewADR(targetDir, title);
      if (created) {
        console.log(`Created new ADR at .room/decisions/${filename}`);
      } else {
        console.log(`ADR already exists at .room/decisions/${filename}`);
      }
    } catch (error: any) {
      console.error('Failed to create ADR:', error.message);
      process.exit(1);
    }
  });

program
  .command('review')
  .description('Run a ROOM discussion workflow for a topic')
  .argument('<topic>', 'Topic or proposal to discuss')
  .option('-p, --path <path>', 'Path to project directory', '.')
  .option('-a, --agents <names>', 'Comma-separated AI member names to include')
  .option('-r, --max-rounds <rounds>', 'Maximum review rounds before marking needs_revision', '6')
  .action(async (topic, options) => {
    const targetDir = path.resolve(options.path);
    const discussionId = `discussion-${Date.now()}`;
    const maxRounds = Math.max(1, Math.min(10, Number.parseInt(options.maxRounds, 10) || 6));
    const agentNames = typeof options.agents === 'string'
      ? options.agents.split(',').map((name: string) => name.trim()).filter(Boolean)
      : [];

    if (agentNames.length === 0) {
      console.error('Please provide at least one AI member with --agents "Name One,Name Two".');
      process.exit(1);
    }

    console.log(`Starting ROOM discussion for topic: "${topic}"...`);
    
    try {
      const engine = new DiscussionEngine(targetDir);
      const log = await engine.runDiscussion(
        discussionId,
        `Discussion: ${topic.slice(0, 30)}...`,
        topic,
        agentNames,
        maxRounds,
        { reviewMode: true }
      );

      console.log('\n=======================================');
      console.log('      ROOM DISCUSSION COMPLETED');
      console.log('=======================================');
      console.log(`Saved structured log: .room/discussions/${discussionId}.json`);
      console.log(`Saved transcript: .room/discussions/${discussionId}.md`);
      console.log(`Review status: ${log.status}`);
      console.log(`Total messages exchanged: ${log.messages.length}`);
      console.log('=======================================\n');
    } catch (error: any) {
      console.error('Review workflow failed:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
