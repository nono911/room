import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import { detectLocalAgents, validateAgentConfig as validateEngineAgentConfig, assertLocalCliExecutionAllowed, type AgentConfig } from '@room/engine';
import {
  ROOM_DIR,
  requireBoundProjectRoot, resolveWithinProject,
  sanitizeFileName, sanitizeAgentFileName, readTextFileWithLimit,
  isDangerousAgentAllowed, extractMarkdownHeading,
  DISCUSSION_CONTEXT_FILE_LIMIT_BYTES
} from './shared.js';

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
    const candidate = resolveWithinProject(projectRoot, ROOM_DIR, source, safeFilename);
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

  return { filename: safeFilename, readable: false, error: 'Skill file was not found in .room/skills or legacy .room/roles.' };
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

export function registerAgentsIpc(): void {
  ipcMain.handle('save-agent', async (event, { dirPath, agent }: { dirPath: string; agent: unknown }) => {
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const agentsDir = resolveWithinProject(projectRoot, ROOM_DIR, 'members');
      const validated = validateAgentConfig(agent);
      if (!validated.success) {
        return { success: false, error: validated.error };
      }

      if (validated.agent.provider === 'Local CLI') {
        try {
          assertLocalCliExecutionAllowed(validated.agent, await isDangerousAgentAllowed(projectRoot));
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }

      await fs.mkdir(agentsDir, { recursive: true });
      const safeAgentName = sanitizeAgentFileName(validated.agent.name);
      const filename = `${safeAgentName || 'agent'}.json`;
      const filePath = resolveWithinProject(agentsDir, filename);
      await fs.writeFile(filePath, JSON.stringify(validated.agent, null, 2), 'utf-8');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-agent', async (event, { dirPath, agentName }: { dirPath: string; agentName: string }) => {
    try {
      const projectRoot = requireBoundProjectRoot(dirPath);
      const safeAgentName = sanitizeFileName((agentName || 'agent').toLowerCase(), 'agent');
      const filename = `${safeAgentName.replace(/[^a-z0-9_-]/g, '-')}.json`;
      const filePaths = [
        resolveWithinProject(projectRoot, ROOM_DIR, 'members', filename),
        resolveWithinProject(projectRoot, ROOM_DIR, 'agents', filename)
      ];
      let deleted = false;
      for (const filePath of filePaths) {
        try {
          await fs.unlink(filePath);
          deleted = true;
          break;
        } catch {}
      }
      if (!deleted) {
        return { success: false, error: 'Agent was not found.' };
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
