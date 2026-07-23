import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import { detectLocalAgents, validateAgentConfig as validateEngineAgentConfig, assertLocalCliExecutionAllowed, type AgentConfig } from '@room/engine';
import {
  requireBoundProjectRoot, resolveWithinProject, resolveWithinRoomData,
  sanitizeFileName, sanitizeAgentFileName, readTextFileWithLimit,
  extractMarkdownHeading,
  DISCUSSION_CONTEXT_FILE_LIMIT_BYTES
} from './shared.js';
import { isDangerousAgentAllowed } from './config-store.js';
import { createStableId, removeMemberFromTeams } from './team-store.js';

interface SkillPreviewItem {
  filename: string;
  readable: boolean;
  source?: 'skills' | 'roles';
  bytes?: number;
  heading?: string;
  error?: string;
}

async function readSkillPreview(projectRoot: string, filename: string): Promise<SkillPreviewItem> {
  const safeFilename = sanitizeFileName(filename);
  if (!safeFilename.toLowerCase().endsWith('.md')) {
    return { filename: safeFilename, readable: false, error: 'Skill filename must end with .md.' };
  }

  for (const source of ['skills', 'roles'] as const) {
    const candidate = resolveWithinRoomData(projectRoot, source, safeFilename);
    try {
      const content = await readTextFileWithLimit(candidate, DISCUSSION_CONTEXT_FILE_LIMIT_BYTES);
      return {
        filename: safeFilename,
        readable: true,
        source,
        bytes: Buffer.byteLength(content, 'utf-8'),
        heading: extractMarkdownHeading(content)
      };
    } catch {}
  }

  return { filename: safeFilename, readable: false, error: 'Skill file was not found in this ROOM Home workspace.' };
}

function describeSkillDelivery(provider: string, cliPreset?: string, stdinFormat?: string): string {
  if (provider !== 'Local CLI') {
    return 'Sent in the provider system instruction as an Active Skills block.';
  }
  if (cliPreset === 'codewhale' || cliPreset === 'agy') {
    return 'Sent inside the composed prompt argument under # Instructions and Active Skills.';
  }
  if (cliPreset && cliPreset !== 'none') {
    return 'Sent to the local CLI through stdin with instructions before the request.';
  }
  return stdinFormat === 'json'
    ? 'Sent to the custom command as JSON systemInstruction plus prompt.'
    : 'Sent to the custom command as plain text instructions before the request.';
}

function validateAgentConfig(rawAgent: unknown): { success: true; agent: AgentConfig } | { success: false; error: string } {
  const engineValidated = validateEngineAgentConfig(rawAgent);
  if (!engineValidated.success) {
    return engineValidated;
  }
  return engineValidated;
}

function getLegacyMemberFileCandidates(projectRoot: string, name: string): string[] {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName) {
    return [];
  }

  const lowerName = normalizedName.toLowerCase();
  const candidates = new Set<string>([
    resolveWithinRoomData(projectRoot, 'members', `${sanitizeAgentFileName(normalizedName) || 'agent'}.json`),
    resolveWithinRoomData(projectRoot, 'members', `${encodeURIComponent(lowerName)}.json`)
  ]);

  if (!/[\\/]/.test(normalizedName)) {
    candidates.add(resolveWithinRoomData(projectRoot, 'members', `${lowerName}.json`));
  }

  return [...candidates];
}

async function cleanupLegacyMemberFiles(
  projectRoot: string,
  persistedAgent: AgentConfig & { id: string },
  previousName?: string
): Promise<void> {
  const candidateNames = new Set(
    [previousName, persistedAgent.name]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase())
  );
  const idFilePath = resolveWithinRoomData(projectRoot, 'members', `${persistedAgent.id}.json`);
  const candidatePaths = [
    ...getLegacyMemberFileCandidates(projectRoot, persistedAgent.name),
    ...(previousName ? getLegacyMemberFileCandidates(projectRoot, previousName) : [])
  ];
  const seenPaths = new Set<string>();

  for (const candidatePath of candidatePaths) {
    if (candidatePath === idFilePath || seenPaths.has(candidatePath)) {
      continue;
    }
    seenPaths.add(candidatePath);

    try {
      const raw = JSON.parse(await fs.readFile(candidatePath, 'utf-8')) as Record<string, unknown>;
      const rawName = typeof raw.name === 'string' ? raw.name.trim().toLowerCase() : '';
      const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (rawId || !candidateNames.has(rawName)) {
        continue;
      }
      await fs.unlink(candidatePath);
    } catch {}
  }
}

export function registerAgentsIpc(): void {
  ipcMain.handle('save-agent', async (event, { dirPath, agent }: { dirPath: string; agent: unknown }) => {
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const agentsDir = resolveWithinRoomData(projectRoot, 'members');
      const previousName = typeof (agent as { previousName?: unknown })?.previousName === 'string'
        ? (agent as { previousName?: string }).previousName?.trim() || undefined
        : undefined;
      const validated = validateAgentConfig(agent);
      if (!validated.success) {
        return { success: false, error: validated.error };
      }

      const persistedAgent: AgentConfig & { id: string } = validated.agent.id
        ? { ...validated.agent, id: validated.agent.id }
        : { ...validated.agent, id: createStableId('mem', validated.agent.name) };

      if (persistedAgent.provider === 'Local CLI') {
        try {
          assertLocalCliExecutionAllowed(persistedAgent, await isDangerousAgentAllowed(projectRoot));
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }

      await fs.mkdir(agentsDir, { recursive: true });
      const filePath = resolveWithinProject(agentsDir, `${persistedAgent.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(persistedAgent, null, 2), 'utf-8');

      if (!validated.agent.id) {
        await cleanupLegacyMemberFiles(projectRoot, persistedAgent, previousName);
      }

      return { success: true, agent: persistedAgent };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-agent', async (
    event,
    { dirPath, agentName, memberId }: { dirPath: string; agentName?: string; memberId?: string }
  ) => {
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const filePaths: string[] = [];
      if (typeof memberId === 'string' && /^mem_[a-z0-9][a-z0-9_-]{2,80}$/.test(memberId)) {
        filePaths.push(resolveWithinRoomData(projectRoot, 'members', `${memberId}.json`));
      }
      if (agentName) {
        const safeAgentName = sanitizeFileName(agentName.toLowerCase(), 'agent');
        const filename = `${safeAgentName.replace(/[^a-z0-9_-]/g, '-')}.json`;
        filePaths.push(
          resolveWithinRoomData(projectRoot, 'members', filename),
          resolveWithinRoomData(projectRoot, 'agents', filename)
        );
      }

      const seenPaths = new Set<string>();
      let deleted = false;
      for (const filePath of filePaths) {
        if (seenPaths.has(filePath)) {
          continue;
        }
        seenPaths.add(filePath);
        try {
          await fs.unlink(filePath);
          deleted = true;
        } catch {}
      }
      if (!deleted) {
        return { success: false, error: 'Agent was not found.' };
      }
      if (memberId) {
        await removeMemberFromTeams(projectRoot, memberId);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('preview-agent-skills', async (event, { dirPath, agent }: { dirPath: string; agent: any }) => {
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const skills: string[] = Array.isArray(agent?.skills)
        ? agent.skills.filter((skill: unknown): skill is string => typeof skill === 'string')
        : [];
      const items = await Promise.all(skills.map(skill => readSkillPreview(projectRoot, skill)));
      const readableCount = items.filter(item => item.readable).length;
      return {
        success: true,
        delivery: describeSkillDelivery(agent?.provider || '', agent?.cliPreset, agent?.stdinFormat),
        readableCount,
        totalCount: items.length,
        items
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('detect-local-agents', async () => {
    try {
      const agents = await detectLocalAgents();
      return { success: true, agents };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('detect-cli-models', async (_, cliId: string) => {
    try {
      const { applyApiKeysToEnvironment: applyKeys } = await import('./provider-store.js');
      await applyKeys();
      const { resolveOnPath, getFallbackModels, isOpenAiModelAllowed, AGY_FALLBACK_MODELS } = await import('@room/engine');
      const { promisify } = await import('util');
      const { execFile } = await import('child_process');
      const execFileP = promisify(execFile);

      const presetClis = ['codewhale', 'agy', 'gemini', 'claude', 'codex', 'copilot'];
      const bin = presetClis.includes(cliId) ? cliId : null;
      if (!bin) {
        return { success: true, models: [] };
      }
      const resolvedPath = resolveOnPath(bin);
      if (!resolvedPath) {
        return { success: true, models: getFallbackModels(cliId) };
      }

      let models: { value: string; label: string }[] = [];

      if (cliId === 'gemini') {
        const geminiKey = process.env.GEMINI_API_KEY || '';
        if (geminiKey) {
          try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
            if (res.ok) {
              const data: any = await res.json();
              models = (data.models || [])
                .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
                .map((m: any) => ({
                  value: m.name.replace('models/', ''),
                  label: m.displayName || m.name
                }));
            }
          } catch {}
        }
      } else if (cliId === 'claude') {
        const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
        if (anthropicKey) {
          try {
            const res = await fetch('https://api.anthropic.com/v1/models', {
              headers: {
                'x-api-key': anthropicKey,
                'anthropic-version': '2023-06-01'
              }
            });
            if (res.ok) {
              const data: any = await res.json();
              models = (data.data || []).map((m: any) => ({
                value: m.id,
                label: m.display_name || m.id
              }));
            }
          } catch {}
        }
      } else if (cliId === 'codex') {
        const openaiKey = process.env.OPENAI_API_KEY || '';
        if (openaiKey) {
          try {
            const res = await fetch('https://api.openai.com/v1/models', {
              headers: { 'Authorization': `Bearer ${openaiKey}` }
            });
        if (res.ok) {
          const data: any = await res.json();
          models = (data.data || [])
            .filter((m: any) => m.id && isOpenAiModelAllowed(m.id))
            .map((m: any) => ({
              value: m.id,
              label: m.id
            }));
            }
          } catch {}
        }
      } else if (cliId === 'codewhale') {
        try {
          const result = await execFileP(resolvedPath, ['models'], {
            timeout: 4000,
            maxBuffer: 1024 * 1024
          });
          const stdout = result.stdout;
          if (stdout) {
            const lines = stdout.split('\n');
            for (let line of lines) {
              line = line.trim();
              if (!line || line.toLowerCase().includes('available models') || line.toLowerCase().includes('no models available')) {
                continue;
              }
              const cleanLine = line.replace(/^[\s*]+/, '');
              const parts = cleanLine.split(' ');
              const modelId = parts[0];
              if (modelId) {
                models.push({ value: modelId, label: cleanLine });
              }
            }
          }
        } catch {}
      } else if (cliId === 'agy') {
        try {
          const result = await execFileP(resolvedPath, ['models'], {
            timeout: 4000,
            maxBuffer: 1024 * 1024
          });
          const stdout = result.stdout;
          if (stdout) {
            const output = stdout.replace(/available models:?/ig, ' ').replace(/\s+/g, ' ').trim();
            const knownModels = AGY_FALLBACK_MODELS
              .map(model => model.value)
              .filter(model => model !== 'default');
            for (const modelId of knownModels) {
              if (!output.includes(modelId)) {
                continue;
              }
              models.push({ value: modelId, label: modelId });
            }
          }
        } catch {}
      }

      if (models.length > 0) {
        return { success: true, models };
      }

      return { success: true, models: getFallbackModels(cliId) };
    } catch (error: any) {
      const { getFallbackModels } = await import('@room/engine');
      return { success: true, models: getFallbackModels(cliId) };
    }
  });
}
