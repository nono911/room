import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { scanDirectory, writeScanData } from './scanner.js';
import { analyzeFeatureImpact } from './impact/analyzer.js';
import { createNewADR } from './decisions/adr.js';
import { DiscussionEngine } from './discussion/engine.js';
import {
  attachRoomSource,
  ensurePersonalRoom,
  toRoomOnlyLocation,
  toWorkspaceLocation
} from './roomHome.js';
import { createDiscussionRunId } from './discussion/runId.js';
import { executeRecordedRun } from './runRecords.js';
import type { WorkspaceInput, WorkspaceLocation } from './workspace.js';
import { resolveSourceStatePath } from './workspace.js';

const program = new Command();

interface CliWorkspace extends WorkspaceLocation {
  rootDevice?: string;
  rootInode?: string;
  rootBirthtimeNs?: string;
}

program
  .name('room')
  .description('ROOM: AI-native Room and Source engine')
  .version('1.0.0');

async function resolveCliWorkspace(targetDir?: string): Promise<CliWorkspace> {
  const room = await ensurePersonalRoom();
  if (!targetDir) return toRoomOnlyLocation(room);
  const canonicalTarget = await fs.realpath(targetDir);
  const source = room.manifest.sources.find(item => item.canonicalPath === canonicalTarget);
  if (!source) throw new Error('Source is not attached. Run "room init" first.');
  const stat = await fs.lstat(canonicalTarget, { bigint: true });
  if (
    stat.isSymbolicLink()
    || !stat.isDirectory()
    || stat.dev.toString() !== source.rootDevice
    || stat.ino.toString() !== source.rootInode
    || stat.birthtimeNs.toString() !== source.rootBirthtimeNs
  ) {
    throw new Error('The attached Source root changed after authorization.');
  }
  return {
    ...toWorkspaceLocation(room, source.id),
    rootDevice: source.rootDevice,
    rootInode: source.rootInode,
    rootBirthtimeNs: source.rootBirthtimeNs
  };
}

program
  .command('init')
  .description('Create a Personal Room and attach a Source directory')
  .option('-p, --path <path>', 'Source directory to attach', '.')
  .option('-n, --name <name>', 'Source name')
  .action(async (options) => {
    const targetDir = path.resolve(options.path);
    console.log(`Attaching Source ${targetDir} to the Personal Room...`);

    try {
      const personalRoom = await ensurePersonalRoom();
      const record = await attachRoomSource(personalRoom, targetDir, options.name);
      console.log('Source attached to Personal Room.');
      console.log(`ROOM data: ${record.roomRoot}`);
      console.log(`Source: ${targetDir}`);
    } catch (error: any) {
      console.error('Failed to initialize ROOM:', error.message);
      process.exit(1);
    }
  });

program
  .command('scan')
  .description('Scan Source files and update Room metadata')
  .option('-p, --path <path>', 'Path to Source directory', '.')
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
      const workspace = await resolveCliWorkspace(targetDir);
      await executeRecordedRun(workspace, 'scan', workspace.sourceId, async () => {
        const result = await scanDirectory(targetDir, {
          device: workspace.rootDevice!,
          inode: workspace.rootInode!,
          birthtimeNs: workspace.rootBirthtimeNs!
        });
        await writeScanData(workspace, result);
      });
      console.log('Source scan completed successfully!');
      console.log(`Updated ${resolveSourceStatePath(workspace, 'scan', 'current.json')}`);
    } catch (error: any) {
      console.error('Scan failed:', error.message);
      process.exit(1);
    }
  });

program
  .command('impact')
  .description('Analyze the codebase impact of a feature description')
  .argument('<description>', 'Description of the feature to analyze')
  .option('-p, --path <path>', 'Path to Source directory', '.')
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
  .option('-p, --path <path>', 'Optional attached Source directory')
  .action(async (title, options) => {
    const targetDir = options.path ? path.resolve(options.path) : undefined;
    try {
      const workspace = await resolveCliWorkspace(targetDir);
      const { filename, created } = await createNewADR(workspace, title);
      const roomRoot = workspace.roomRoot;
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
  .option('-p, --path <path>', 'Optional attached Source directory')
  .option('-a, --agents <names>', 'Comma-separated AI member names to include')
  .option('-r, --max-rounds <rounds>', 'Maximum review rounds before marking needs_revision', '6')
  .action(async (topic, options) => {
    const targetDir = options.path ? path.resolve(options.path) : undefined;
    const discussionId = createDiscussionRunId();
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
      console.log(`Review status: ${log.status}`);
      console.log(`Total messages exchanged: ${log.messages.length}`);
      console.log('=======================================\n');
    } catch (error: any) {
      console.error('Review workflow failed:', error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
