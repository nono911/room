import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { scanDirectory, writeScanData } from './scanner.js';
import { analyzeFeatureImpact } from './impact/analyzer.js';
import { createNewADR } from './decisions/adr.js';
import { DiscussionEngine } from './discussion/engine.js';
import {
  createRoomWorkspace,
  findRoomWorkspaceBySource,
  toWorkspaceLocation
} from './roomHome.js';
import type { WorkspaceInput } from './workspace.js';

const program = new Command();

program
  .name('room')
  .description('ROOM: AI-native Project Workspace Engine')
  .version('1.0.0');

async function resolveCliWorkspace(targetDir: string): Promise<WorkspaceInput> {
  const central = await findRoomWorkspaceBySource(targetDir);
  if (central) {
    return toWorkspaceLocation(central);
  }

  const legacyRoomRoot = path.join(targetDir, '.room');
  const hasLegacyWorkspace = await fs.stat(legacyRoomRoot)
    .then(stat => stat.isDirectory())
    .catch(() => false);
  if (hasLegacyWorkspace) {
    return targetDir;
  }

  throw new Error('ROOM workspace is not registered. Run "room init" first.');
}

program
  .command('init')
  .description('Create a ROOM Home workspace and attach a source directory')
  .option('-p, --path <path>', 'Source directory to attach', '.')
  .option('-n, --name <name>', 'Workspace name')
  .action(async (options) => {
    const targetDir = path.resolve(options.path);
    console.log(`Registering ROOM workspace for ${targetDir}...`);

    try {
      const { record, created } = await createRoomWorkspace({
        sourceRoot: targetDir,
        name: options.name,
        importLegacy: true
      });
      console.log(created ? 'ROOM workspace created successfully!' : 'ROOM workspace was already registered.');
      console.log(`ROOM data: ${record.roomRoot}`);
      console.log(`Source: ${targetDir}`);
      if (record.manifest.legacyImport) {
        console.log(`Copied ${record.manifest.legacyImport.fileCount} legacy file(s); the original .room was kept unchanged.`);
      }
    } catch (error: any) {
      console.error('Failed to initialize ROOM:', error.message);
      process.exit(1);
    }
  });

program
  .command('scan')
  .description('Scan project files and update ROOM Home metadata')
  .option('-p, --path <path>', 'Path to project directory', '.')
  .action(async (options) => {
    const targetDir = path.resolve(options.path);
    try {
      await resolveCliWorkspace(targetDir);
    } catch (error: unknown) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }

    console.log(`Scanning repository structure at ${targetDir}...`);
    try {
      const result = await scanDirectory(targetDir);
      const workspace = await resolveCliWorkspace(targetDir);
      await writeScanData(workspace, result);
      const roomRoot = typeof workspace === 'string' ? path.join(workspace, '.room') : workspace.roomRoot;
      console.log('Project scan completed successfully!');
      console.log(`Updated ${path.join(roomRoot, 'context', 'overview.md')}`);
      console.log(`Updated ${path.join(roomRoot, 'context', 'structure.md')}`);
      console.log(`Updated ${path.join(roomRoot, 'context', 'project-map.json')}`);
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
    let workspace: WorkspaceInput;
    try {
      workspace = await resolveCliWorkspace(targetDir);
    } catch (error: unknown) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
      return;
    }

    console.log(`Analyzing impact of feature: "${description}"...`);
    try {
      const report = await analyzeFeatureImpact(workspace, description);
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
      const workspace = await resolveCliWorkspace(targetDir);
      const { filename, created } = await createNewADR(workspace, title);
      const roomRoot = typeof workspace === 'string' ? path.join(workspace, '.room') : workspace.roomRoot;
      if (created) {
        console.log(`Created new ADR at ${path.join(roomRoot, 'decisions', filename)}`);
      } else {
        console.log(`ADR already exists at ${path.join(roomRoot, 'decisions', filename)}`);
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
      const workspace = await resolveCliWorkspace(targetDir);
      const engine = new DiscussionEngine(workspace);
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
      console.log(`Saved structured log: ${path.join(engine.roomRoot, 'discussions', `${discussionId}.json`)}`);
      console.log(`Saved transcript: ${path.join(engine.roomRoot, 'discussions', `${discussionId}.md`)}`);
      console.log(`Review status: ${log.status}`);
      console.log(`Total messages exchanged: ${log.messages.length}`);
      console.log('=======================================\n');
    } catch (error: any) {
      console.error('Review workflow failed:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
