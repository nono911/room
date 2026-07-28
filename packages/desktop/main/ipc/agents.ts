import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import {
  detectLocalAgents,
  isMachineSkillReference,
  parseRoomSkillReference,
  readMachineSkill,
  validateAgentConfig as validateEngineAgentConfig,
  withRoomMemberMutation,
  type AgentConfig
} from '@room/engine';
import {
  requireBoundRoom, requireBoundRoomWorkspace, resolveWithinRoomData,
  sanitizeAgentFileName, readTextFileWithLimit,
  extractMarkdownHeading,
  DISCUSSION_CONTEXT_FILE_LIMIT_BYTES
} from './shared.js';
import { writeRoomDataFileAtomically } from './room-file-write.js';
import { createStableId } from './team-store.js';
import { assertJsonBytes, IPC_LIMITS } from './ipc-limits.js';
import { persistAgentWithMachineSkillApproval } from './machine-skill-grants.js';
import { toPublicError } from './public-error.js';
import {
  deleteMemberDurably,
  reconcilePendingMemberDeletions
} from './member-deletion.js';
import { assertNoPendingMemberDeletions } from './member-tombstone.js';

interface SkillPreviewItem {
  filename: string;
  reference?: string;
  readable: boolean;
  source?: 'skills' | 'roles' | 'machine';
  sourceLabel?: string;
  bytes?: number;
  heading?: string;
  error?: string;
}

async function readSkillPreview(projectRoot: string, filename: string): Promise<SkillPreviewItem> {
  if (isMachineSkillReference(filename)) {
    try {
      const { skill, content } = await readMachineSkill(filename);
      return {
        filename: skill.name,
        reference: skill.reference,
        readable: true,
        source: 'machine',
        sourceLabel: skill.sourceLabel,
        bytes: Buffer.byteLength(content, 'utf-8'),
        heading: extractMarkdownHeading(content)
      };
    } catch {
      return {
        filename,
        reference: filename,
        readable: false,
        source: 'machine',
        error: 'Machine skill preview is unavailable.'
      };
    }
  }

  const parsed = parseRoomSkillReference(filename);
  if (!parsed) {
    return { filename, readable: false, error: 'Room skill reference is invalid.' };
  }
  const candidate = resolveWithinRoomData(projectRoot, parsed.source, parsed.filename);
  try {
    const content = await readTextFileWithLimit(candidate, DISCUSSION_CONTEXT_FILE_LIMIT_BYTES);
    return {
      filename: parsed.filename,
      reference: parsed.reference,
      readable: true,
      source: parsed.source,
      bytes: Buffer.byteLength(content, 'utf-8'),
      heading: extractMarkdownHeading(content)
    };
  } catch {
    return {
      filename: parsed.filename,
      reference: parsed.reference,
      readable: false,
      source: parsed.source,
      error: 'Skill file was not found in this Room.'
    };
  }
}

function describeSkillDelivery(): string {
  return 'Sent in the provider system instruction as an Active Skills block.';
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
      const raw = JSON.parse(await readTextFileWithLimit(
        candidatePath,
        512 * 1024
      )) as Record<string, unknown>;
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
  ipcMain.handle('save-agent', async (event, { roomId, agent }: { roomId: string; agent: unknown }) => {
    try {
      assertJsonBytes(agent, 'Agent payload', IPC_LIMITS.agentPayloadBytes);
      requireBoundRoom(roomId);
      await reconcilePendingMemberDeletions(roomId);
      const agentsDir = resolveWithinRoomData(roomId, 'members');
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

      await withRoomMemberMutation(
        requireBoundRoomWorkspace(roomId),
        [`${persistedAgent.id}.json`],
        async () => {
          await assertNoPendingMemberDeletions(roomId, [persistedAgent.id]);
          return persistAgentWithMachineSkillApproval(
            event,
            roomId,
            persistedAgent,
            async () => {
              await fs.mkdir(agentsDir, { recursive: true });
              await writeRoomDataFileAtomically(
                roomId,
                ['members', `${persistedAgent.id}.json`],
                JSON.stringify(persistedAgent, null, 2)
              );

              if (!validated.agent.id) {
                await cleanupLegacyMemberFiles(roomId, persistedAgent, previousName);
              }
            }
          );
        }
      );

      return { success: true, agent: persistedAgent };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('delete-agent', async (
    _event,
    { roomId, agentName, memberId }: { roomId: string; agentName?: string; memberId?: string }
  ) => {
    try {
      requireBoundRoom(roomId);
      const validMemberId = typeof memberId === 'string'
        && /^mem_[a-z0-9][a-z0-9_-]{2,80}$/.test(memberId)
        ? memberId
        : undefined;
      if (memberId !== undefined && validMemberId === undefined) {
        return { success: false, error: 'Invalid member id.' };
      }
      if (!validMemberId) {
        return {
          success: false,
          error: agentName
            ? 'Agent deletion requires a stable member ID.'
            : 'Agent was not found.'
        };
      }
      await deleteMemberDurably(roomId, validMemberId);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('preview-agent-skills', async (_event, { roomId, agent }: { roomId: string; agent: any }) => {
    try {
      assertJsonBytes(agent, 'Agent preview payload', IPC_LIMITS.agentPayloadBytes);
      requireBoundRoom(roomId);
      const skills: string[] = Array.isArray(agent?.skills)
        ? agent.skills
            .slice(0, 64)
            .filter((skill: unknown): skill is string => (
              typeof skill === 'string' && Buffer.byteLength(skill, 'utf-8') <= 1024
            ))
        : [];
      const items = await Promise.all(skills.map(skill => readSkillPreview(roomId, skill)));
      const readableCount = items.filter(item => item.readable).length;
      return {
        success: true,
        delivery: describeSkillDelivery(),
        readableCount,
        totalCount: items.length,
        items
      };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

  ipcMain.handle('detect-local-agents', async () => {
    try {
      const agents = await detectLocalAgents();
      return {
        success: true,
        agents: agents.map(({ path: _path, ...agent }) => agent)
      };
    } catch (error: unknown) {
      return { success: false, error: toPublicError(error) };
    }
  });

}
