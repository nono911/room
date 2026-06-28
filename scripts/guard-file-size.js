import * as fs from 'fs';
import * as path from 'path';

const MAX_LINES = 500;
const OFFENDING_FILES = [];

// Directory paths to check recursively
const TARGET_DIRS = [
  path.resolve('packages/engine/src'),
  path.resolve('packages/desktop/main'),
  path.resolve('packages/desktop/renderer/src')
];

// Legacy files whitelisted from build failure (must not grow further)
const IGNORE_LIST = new Set([
  'packages/engine/src/agents/personaTemplates.ts',
  'packages/engine/src/providers/localCli.ts',
  'packages/desktop/renderer/src/app/App.tsx',
  'packages/desktop/renderer/src/app/components/WorkspaceRoutes.tsx',
  'packages/desktop/renderer/src/features/ai-members/components/AgentEditorScreen.tsx',
  'packages/desktop/renderer/src/features/discussions/components/DiscussionsScreen.tsx',
  'packages/desktop/renderer/src/features/discussions/useDiscussion.ts',
  'packages/desktop/renderer/src/features/task-run/components/TaskRunScreen.tsx',
  'packages/desktop/renderer/src/shared/data/staticData.ts'
]);

function scanDir(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else if (stat.isFile() && /\.(ts|tsx)$/.test(file)) {
        // Skip test files
        if (/\.test\.(ts|tsx)$/.test(file)) {
          continue;
        }
        checkFileLines(fullPath);
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${dirPath}:`, err.message);
  }
}

function checkFileLines(filePath) {
  try {
    const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    if (IGNORE_LIST.has(relativePath)) {
      return; // Skip whitelisted legacy files
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const count = lines.length;
    if (count > MAX_LINES) {
      OFFENDING_FILES.push({ path: relativePath, count });
    }
  } catch (err) {
    console.error(`Error checking file ${filePath}:`, err.message);
  }
}

console.log('--- Checking file size limits (Max 500 lines) ---');
for (const targetDir of TARGET_DIRS) {
  if (fs.existsSync(targetDir)) {
    scanDir(targetDir);
  }
}

if (OFFENDING_FILES.length > 0) {
  console.error('\n❌ BUILD FAILED: The following files exceed the 500 lines limit:');
  for (const item of OFFENDING_FILES) {
    console.error(`  - ${item.path} (${item.count} lines)`);
  }
  console.error('\nPlease refactor these files by splitting them into logical sub-modules before building.');
  process.exit(1);
} else {
  console.log('✅ All source files are within the 500 lines limit.');
  process.exit(0);
}
