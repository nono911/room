import * as path from 'path';
import { createHash } from 'crypto';
import { GeminiProvider } from '../providers/gemini.js';
import { ClaudeProvider } from '../providers/claude.js';
import { CodexProvider } from '../providers/codex.js';
import { Provider } from '../providers/provider.js';
import {
  resolveRoomPath,
  resolveSourceStatePath,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from '../workspace.js';
import { executeRecordedRun } from '../runRecords.js';
import { withCurrentScanSnapshot } from '../scanSnapshot.js';
import { readUtf8FileBounded } from '../boundedFs.js';
import { withAiRunAdmission } from '../aiRunAdmission.js';
import type { AgentConfig } from '../agents/registry.js';
import { createExecutionParticipantSnapshots } from '../discussion/executionParticipants.js';

export interface ImpactReport {
  affectedFiles: string[];
  affectedApis: string[];
  databaseChanges: string[];
  riskLevel: 'Low' | 'Medium' | 'High';
  reasoning: string;
  status?: 'complete' | 'analysisUnavailable' | 'heuristicFallback';
}

export async function analyzeFeatureImpact(
  workspace: WorkspaceInput,
  featureDescription: string
): Promise<ImpactReport> {
  const resolvedWorkspace = resolveWorkspaceLocation(workspace);
  const execution = resolveImpactExecution();
  const participants = createExecutionParticipantSnapshots(
    resolvedWorkspace.roomId,
    [execution.agent]
  );
  const operationId = createHash('sha256')
    .update(featureDescription)
    .digest('hex')
    .slice(0, 24);
  return withAiRunAdmission(resolvedWorkspace, `impact:${operationId}`, () =>
    executeRecordedRun(resolvedWorkspace, 'impact', undefined, () =>
      analyzeFeatureImpactInternal(resolvedWorkspace, featureDescription, execution.provider),
    undefined, participants)
  );
}

async function analyzeFeatureImpactInternal(
  workspace: WorkspaceInput,
  featureDescription: string,
  provider: Provider | null
): Promise<ImpactReport> {
  const readFirstExistingFile = async (paths: string[], maxBytes = 1024 * 1024) => {
    for (const filePath of paths) {
      try {
        return await readUtf8FileBounded(filePath, maxBytes);
      } catch {}
    }
    return '';
  };
  const sourceContext = resolveWorkspaceLocation(workspace).sourceId
    ? await withCurrentScanSnapshot(workspace, async sourceScanDir => ({
        projectMap: await readFirstExistingFile(
          [path.join(sourceScanDir, 'project-map.json')],
          2 * 1024 * 1024
        ),
        overview: await readFirstExistingFile([path.join(sourceScanDir, 'overview.md')])
      }))
    : undefined;
  const roomProjectMap = await readFirstExistingFile([
    resolveRoomPath(workspace, 'context', 'project-map.json'),
    resolveRoomPath(workspace, 'project-map.json')
  ]);
  const roomProjectMd = await readFirstExistingFile([
    resolveRoomPath(workspace, 'context', 'overview.md'),
    resolveRoomPath(workspace, 'workspace.md'),
    resolveRoomPath(workspace, 'project.md')
  ]);
  const projectMap = sourceContext?.projectMap || roomProjectMap;
  const projectMd = sourceContext?.overview || roomProjectMd;

  const prompt = `Perform a Feature Impact Analysis for the following proposed change:
"${featureDescription}"

=== Repository Tech Stack & Context ===
${projectMd}

=== Repository Directory Index ===
${projectMap}

Please analyze which modules are likely affected and output your response in JSON format matching this structure:
{
  "affectedFiles": ["list of file paths or patterns"],
  "affectedApis": ["list of endpoints or service functions affected"],
  "databaseChanges": ["list of tables, keys, or schema modifications"],
  "riskLevel": "Low" | "Medium" | "High",
  "reasoning": "A concise explanation of why this risk level was chosen and what safety measures to take."
}
IMPORTANT: Return ONLY the raw JSON string without markdown blocks or wrapper text so that it can be parsed.`;

  if (!provider) {
    return createFallbackImpactReport(featureDescription, projectMap, 'No AI provider API key is configured.');
  }

  try {
    const rawResult = await provider.execute(prompt, "You are a Repository Intelligence Assistant.");
    let cleaned = rawResult.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    return JSON.parse(cleaned.trim()) as ImpactReport;
  } catch {
    console.warn('AI Impact analysis failed; returning a conservative fallback.');
    return createFallbackImpactReport(
      featureDescription,
      projectMap,
      'AI impact analysis failed.'
    );
  }
}

function resolveImpactExecution(): { provider: Provider | null; agent: AgentConfig } {
  const base = {
    role: 'Repository impact analysis',
    systemPrompt: 'Analyze repository impact without modifying files.'
  };
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: new ClaudeProvider({}),
      agent: {
        ...base,
        id: 'runtime_impact_anthropic',
        name: 'Impact Analyzer',
        provider: 'Claude',
        modelName: 'claude-3-5-sonnet-20241022'
      }
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: new CodexProvider({}),
      agent: {
        ...base,
        id: 'runtime_impact_openai',
        name: 'Impact Analyzer',
        provider: 'Codex',
        modelName: 'gpt-4o'
      }
    };
  }
  if (process.env.GEMINI_API_KEY) {
    return {
      provider: new GeminiProvider({}),
      agent: {
        ...base,
        id: 'runtime_impact_gemini',
        name: 'Impact Analyzer',
        provider: 'Gemini',
        modelName: 'gemini-1.5-flash'
      }
    };
  }
  return {
    provider: null,
    agent: {
      ...base,
      id: 'runtime_impact_heuristic',
      name: 'Impact Heuristic',
      provider: 'Local heuristic',
      modelName: 'keyword-ranking-v1'
    }
  };
}

function createFallbackImpactReport(featureDescription: string, projectMap: string, reason: string): ImpactReport {
  const candidateFiles = extractProjectMapPaths(projectMap);
  const affectedFiles = rankCandidateFiles(featureDescription, candidateFiles).slice(0, 12);

  if (affectedFiles.length === 0) {
    return {
      affectedFiles: [],
      affectedApis: [],
      databaseChanges: [],
      riskLevel: 'High',
      status: 'analysisUnavailable',
      reasoning: `${reason} No confident impact analysis was produced. Re-run with an AI provider configured or inspect the project map manually before changing code.`
    };
  }

  return {
    affectedFiles,
    affectedApis: [],
    databaseChanges: [],
    riskLevel: 'High',
    status: 'heuristicFallback',
    reasoning: `${reason} This is a conservative keyword match against project-map.json, not a semantic AI impact analysis. Treat the listed files as starting points only and verify APIs/database changes manually.`
  };
}

function extractProjectMapPaths(projectMap: string): string[] {
  if (!projectMap.trim()) {
    return [];
  }

  const paths = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      addPathCandidate(value, paths);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        addPathCandidate(key, paths);
        visit(child);
      }
    }
  };

  try {
    visit(JSON.parse(projectMap));
  } catch {
    const pathPattern = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+|\b[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|py|go|rs|java|kt|swift|sql|yml|yaml)\b/g;
    for (const match of projectMap.matchAll(pathPattern)) {
      addPathCandidate(match[0], paths);
    }
  }

  return [...paths].sort();
}

function addPathCandidate(value: string, paths: Set<string>) {
  const normalized = value.trim().replace(/\\/g, '/');
  if (
    normalized &&
    !normalized.includes(' ') &&
    (normalized.includes('/') || /\.[A-Za-z0-9]+$/.test(normalized))
  ) {
    paths.add(normalized);
  }
}

function rankCandidateFiles(featureDescription: string, candidateFiles: string[]): string[] {
  const tokens = new Set(
    featureDescription
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
  );

  return candidateFiles
    .map((filePath) => {
      const lowerPath = filePath.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lowerPath.includes(token)) {
          score += 1;
        }
      }
      return { filePath, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
    .map(({ filePath }) => filePath);
}
