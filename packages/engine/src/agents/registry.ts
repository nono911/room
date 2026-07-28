import * as fs from 'fs/promises';
import * as path from 'path';
import { PERSONA_TEMPLATES, DEFAULT_MEMBER_NAMES } from './personaTemplates.js';
import { normalizeProviderId, isValidProviderId } from '../providers/registry.js';
import {
  resolveRoomPath,
  resolveWorkspaceLocation,
  type WorkspaceInput
} from '../workspace.js';
import { normalizeMachineSkillReference } from '../skills/machineCatalog.js';
import { parseRoomSkillReference } from '../skills/roomSkillReference.js';
import { readRoomTextFile, writeRoomTextFile } from '../roomFile.js';
import { listDirectoryNamesBounded } from '../boundedFs.js';
import { withRoomDataLock } from '../roomDataLock.js';

export interface AgentConfig {
  id?: string;
  name: string;
  role: string;
  provider: string;
  modelName?: string;
  systemPrompt: string;
  skills?: string[];
  command?: string;
  cliPreset?: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'kiro' | 'none';
  stdinFormat?: 'text' | 'json';
  permissionMode?: 'safe' | 'dangerous';
  strategy?: string;
  isVirtual?: boolean;
}

const MEMBER_ID_PATTERN = /^mem_[a-z0-9][a-z0-9_-]{2,80}$/;
export const MAX_AGENT_SKILLS = 64;
export const MAX_ROOM_MEMBERS = 128;
const MAX_MEMBER_DIRECTORY_ENTRIES = 1_000;
const MAX_MEMBER_FILE_BYTES = 128 * 1024;
const MAX_MEMBER_AGGREGATE_BYTES = 8 * 1024 * 1024;
const memberMutationQueues = new Map<string, Promise<void>>();

function exceedsUtf8Bytes(value: string, maxBytes: number): boolean {
  return Buffer.byteLength(value, 'utf-8') > maxBytes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeSkillReference(skill: unknown): string | null {
  if (typeof skill !== 'string') return null;
  const trimmed = skill.trim();
  if (exceedsUtf8Bytes(trimmed, 512)) return null;
  if (trimmed.startsWith('machine://')) {
    return normalizeMachineSkillReference(trimmed);
  }
  return parseRoomSkillReference(trimmed)?.reference || null;
}

function normalizeMemberId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('Invalid member id.');
  }

  const trimmed = value.trim();
  if (!MEMBER_ID_PATTERN.test(trimmed)) {
    throw new Error('Invalid member id.');
  }

  return trimmed;
}

function encodeAgentFileBase(value: string): string {
  const encoded = encodeURIComponent(value.trim().toLowerCase());
  return encoded.startsWith('.') ? `member-${encoded}` : encoded;
}

async function resolveAgentFilePath(agentsDir: string, agent: AgentConfig): Promise<string> {
  if (agent.id) {
    return path.join(agentsDir, `${agent.id}.json`);
  }

  const legacyFileName = `${agent.name.toLowerCase()}.json`;
  if (!/[\\/]/.test(agent.name)) {
    const legacyFilePath = path.join(agentsDir, legacyFileName);
    try {
      await fs.access(legacyFilePath);
      return legacyFilePath;
    } catch {}
  }

  return path.join(agentsDir, `${encodeAgentFileBase(agent.name)}.json`);
}

export function validateAgentConfig(rawAgent: unknown): { success: true; agent: AgentConfig } | { success: false; error: string } {
  if (!isPlainObject(rawAgent)) {
    return { success: false, error: 'Invalid agent payload.' };
  }

  const name = typeof rawAgent.name === 'string' ? rawAgent.name.trim() : '';
  const role = typeof rawAgent.role === 'string' ? rawAgent.role.trim() : '';
  const provider = typeof rawAgent.provider === 'string' ? rawAgent.provider.trim() : '';
  const systemPrompt = typeof rawAgent.systemPrompt === 'string' ? rawAgent.systemPrompt.trim() : '';
  const modelName = typeof rawAgent.modelName === 'string' ? rawAgent.modelName.trim() : '';
  const strategy = typeof rawAgent.strategy === 'string' ? rawAgent.strategy.trim() : '';
  let id: string | undefined;

  if (!name || !role || !systemPrompt) {
    return { success: false, error: 'Agent name, role and system prompt are required.' };
  }
  if (
    exceedsUtf8Bytes(name, 256)
    || exceedsUtf8Bytes(role, 512)
    || exceedsUtf8Bytes(provider, 256)
    || exceedsUtf8Bytes(modelName, 512)
    || exceedsUtf8Bytes(systemPrompt, 64 * 1024)
    || exceedsUtf8Bytes(strategy, 32 * 1024)
  ) {
    return { success: false, error: 'Agent field exceeds its size limit.' };
  }

  try {
    id = normalizeMemberId(rawAgent.id);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Invalid member id.' };
  }

  const normalizedProvider = provider === 'Local CLI' ? provider : normalizeProviderId(provider);
  if (normalizedProvider === 'Local CLI') {
    return {
      success: false,
      error: 'Local CLI agents are disabled until ROOM can enforce OS-level Source confinement.'
    };
  }
  if (!isValidProviderId(normalizedProvider)) {
    return { success: false, error: 'Invalid provider.' };
  }

  if (Array.isArray(rawAgent.skills) && rawAgent.skills.length > MAX_AGENT_SKILLS) {
    return { success: false, error: `An AI member can use at most ${MAX_AGENT_SKILLS} skills.` };
  }
  const rawSkills = Array.isArray(rawAgent.skills) ? rawAgent.skills : [];
  const normalizedSkills = rawSkills.map(sanitizeSkillReference);
  if (normalizedSkills.some(skill => skill === null)) {
    return {
      success: false,
      error: 'Agent skills must use a qualified Room or machine skill reference.'
    };
  }
  const skills = Array.from(new Set(normalizedSkills as string[]));

  return {
    success: true,
    agent: {
      id,
      name,
      role,
      provider: normalizedProvider,
      modelName: modelName || undefined,
      systemPrompt,
      skills,
      strategy: strategy || undefined
    }
  };
}

export async function loadAgents(workspace: WorkspaceInput): Promise<AgentConfig[]> {
  const membersDir = resolveRoomPath(workspace, 'members');
  const agents: AgentConfig[] = [];
  try {
    const listing = await listDirectoryNamesBounded(
      membersDir,
      MAX_MEMBER_DIRECTORY_ENTRIES
    );
    if (listing.truncated) throw new Error('ROOM member directory exceeds its entry limit.');
    const files = listing.names.filter(file => file.endsWith('.json'));
    if (files.length > MAX_ROOM_MEMBERS) {
      throw new Error(`A Room can contain at most ${MAX_ROOM_MEMBERS} AI members.`);
    }
    let aggregateBytes = 0;
    for (const file of files) {
      const content = await readRoomTextFile(
        workspace,
        ['members', file],
        MAX_MEMBER_FILE_BYTES
      );
      aggregateBytes += Buffer.byteLength(content, 'utf-8');
      if (aggregateBytes > MAX_MEMBER_AGGREGATE_BYTES) {
        throw new Error('ROOM member data exceeds its aggregate read limit.');
      }
      const validated = validateAgentConfig(JSON.parse(content));
      if (validated.success) {
        agents.push(validated.agent);
      } else {
        console.warn(`Ignored invalid agent config file ${file}: ${validated.error}`);
      }
    }
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }

  // Populate built-in agents as virtual fallbacks if not overridden
  const existingNames = new Set(agents.map(a => a.name.toLowerCase()));
  for (const template of PERSONA_TEMPLATES) {
    if (!existingNames.has(template.name.toLowerCase())) {
      agents.push({
        name: template.name,
        role: template.role,
        provider: template.provider,
        systemPrompt: template.prompt,
        skills: [],
        isVirtual: true
      });
    }
  }

  return agents;
}

export async function saveAgent(workspace: WorkspaceInput, agent: AgentConfig): Promise<void> {
  const validated = validateAgentConfig(agent);
  if (!validated.success) {
    throw new Error(validated.error);
  }

  const membersDir = resolveRoomPath(workspace, 'members');
  await fs.mkdir(membersDir, { recursive: true });
  const filePath = await resolveAgentFilePath(membersDir, validated.agent);
  const filename = path.basename(filePath);
  await withRoomMemberMutation(workspace, [filename], () =>
    writeRoomTextFile(
      workspace,
      ['members', filename],
      JSON.stringify(validated.agent, null, 2)
    )
  );
}

export async function createDefaultAgents(workspace: WorkspaceInput) {
  const agentsDir = resolveRoomPath(workspace, 'members');
  await fs.mkdir(agentsDir, { recursive: true });

  const defaults: AgentConfig[] = PERSONA_TEMPLATES
    .filter(template => DEFAULT_MEMBER_NAMES.includes(template.name))
    .map(template => ({
      name: template.name,
      role: template.role,
      provider: template.provider,
      systemPrompt: template.prompt
    }));

  const filenames = defaults.map(agent => `${agent.name.toLowerCase()}.json`);
  await withRoomMemberMutation(workspace, filenames, async () => {
    for (const [index, agent] of defaults.entries()) {
      await writeRoomTextFile(
        workspace,
        ['members', filenames[index]],
        JSON.stringify(agent, null, 2)
      );
    }
  });
}

export async function withRoomMemberMutation<T>(
  workspace: WorkspaceInput,
  memberFilenames: string[],
  operation: () => Promise<T>
): Promise<T> {
  if (
    memberFilenames.length > MAX_ROOM_MEMBERS
    || memberFilenames.some(filename => (
      !filename.endsWith('.json')
      || path.basename(filename) !== filename
      || filename.startsWith('.')
    ))
  ) {
    throw new Error('Invalid ROOM member mutation.');
  }
  const location = resolveWorkspaceLocation(workspace);
  return withMemberMutationQueue(location.roomRoot, () =>
    withRoomDataLock(location.roomRoot, 'members', async () => {
      const membersDir = resolveRoomPath(workspace, 'members');
      await fs.mkdir(membersDir, { recursive: true });
      const listing = await listDirectoryNamesBounded(
        membersDir,
        MAX_MEMBER_DIRECTORY_ENTRIES
      );
      if (listing.truncated) throw new Error('ROOM member directory exceeds its entry limit.');
      const existing = new Set(listing.names.filter(filename => filename.endsWith('.json')));
      const additions = new Set(memberFilenames.filter(filename => !existing.has(filename)));
      if (existing.size + additions.size > MAX_ROOM_MEMBERS) {
        throw new Error(`A Room can contain at most ${MAX_ROOM_MEMBERS} AI members.`);
      }
      return operation();
    })
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

async function withMemberMutationQueue<T>(
  roomRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = memberMutationQueues.get(roomRoot) || Promise.resolve();
  let release = (): void => {};
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  memberMutationQueues.set(roomRoot, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (memberMutationQueues.get(roomRoot) === queued) memberMutationQueues.delete(roomRoot);
  }
}
