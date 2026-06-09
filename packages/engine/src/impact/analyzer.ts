import * as fs from 'fs/promises';
import * as path from 'path';
import { GeminiProvider } from '../providers/gemini.js';
import { ClaudeProvider } from '../providers/claude.js';
import { CodexProvider } from '../providers/codex.js';
import { Provider } from '../providers/provider.js';

export interface ImpactReport {
  affectedFiles: string[];
  affectedApis: string[];
  databaseChanges: string[];
  riskLevel: 'Low' | 'Medium' | 'High';
  reasoning: string;
  status?: 'complete' | 'analysisUnavailable' | 'heuristicFallback';
}

export async function analyzeFeatureImpact(
  dirPath: string,
  featureDescription: string
): Promise<ImpactReport> {
  const roomDir = path.join(dirPath, '.room');
  const readFirstExistingFile = async (paths: string[]) => {
    for (const filePath of paths) {
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch {}
    }
    return '';
  };
  
  const projectMap = await readFirstExistingFile([
    path.join(roomDir, 'context', 'project-map.json'),
    path.join(roomDir, 'project-map.json')
  ]);
  const projectMd = await readFirstExistingFile([
    path.join(roomDir, 'context', 'overview.md'),
    path.join(roomDir, 'workspace.md'),
    path.join(roomDir, 'project.md')
  ]);

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

  let provider: Provider;
  if (process.env.ANTHROPIC_API_KEY) {
    provider = new ClaudeProvider({});
  } else if (process.env.OPENAI_API_KEY) {
    provider = new CodexProvider({});
  } else {
    provider = new GeminiProvider({});
  }

  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
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
  } catch (err: any) {
    console.warn('AI Impact analysis failed, returning conservative fallback:', err.message);
    return createFallbackImpactReport(featureDescription, projectMap, `AI impact analysis failed: ${err.message}`);
  }
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
