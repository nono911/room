import * as path from 'path';
import type { IpcMainInvokeEvent } from 'electron';
import {
  isMachineSkillReference,
  machineSkillContentDigest,
  MAX_ROOM_MEMBERS,
  normalizeMachineSkillReference,
  readRoomTextFile,
  readMachineSkill,
  validateAgentConfig,
  withRoomDataLock,
  type ApprovedMachineSkillSnapshot,
  type AgentConfig,
  type ProviderEntry
} from '@room/engine';
import { confirmNativeApproval } from './native-approval.js';
import { readProviderSecurityRevision } from './provider-store.js';
import { requireBoundRoomWorkspace } from './shared.js';
import { writeRoomDataFileAtomically } from './room-file-write.js';

export interface MachineSkillGrant {
  memberId: string;
  provider: string;
  providerSecurityRevision: string;
  reference: string;
  contentDigest: string;
  approvedAt: string;
}

interface ResolvedAssignment {
  reference: string;
  contentDigest: string;
  label: string;
  provider: string;
  providerSecurityRevision: string;
  content: string;
}

const GRANTS_FILE = ['config', 'machine-skill-grants.json'];
const MAX_MACHINE_SKILLS_PER_MEMBER = 64;
const MAX_MACHINE_SKILL_GRANTS = MAX_ROOM_MEMBERS * MAX_MACHINE_SKILLS_PER_MEMBER;
const MAX_GRANT_LEDGER_BYTES = 16 * 1024 * 1024;
const MAX_EXECUTION_MEMBERS = 32;
const MAX_APPROVED_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MACHINE_SKILL_READ_CONCURRENCY = 4;
const grantQueues = new Map<string, Promise<void>>();

function machineReferences(agent: AgentConfig): string[] {
  const references = Array.from(new Set(
    (agent.skills || [])
      .map(normalizeMachineSkillReference)
      .filter((reference): reference is string => Boolean(reference))
  ));
  if (references.length > MAX_MACHINE_SKILLS_PER_MEMBER) {
    throw new Error('AI member machine skill selection exceeds its limit.');
  }
  return references;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await map(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function withGrantQueue<T>(roomId: string, operation: () => Promise<T>): Promise<T> {
  const previous = grantQueues.get(roomId) || Promise.resolve();
  let release = (): void => {};
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  grantQueues.set(roomId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (grantQueues.get(roomId) === queued) grantQueues.delete(roomId);
  }
}

async function loadGrants(roomId: string): Promise<MachineSkillGrant[]> {
  try {
    const raw = JSON.parse(await readRoomTextFile(
      requireBoundRoomWorkspace(roomId),
      GRANTS_FILE,
      MAX_GRANT_LEDGER_BYTES
    )) as { grants?: unknown };
    if (!Array.isArray(raw.grants) || raw.grants.length > MAX_MACHINE_SKILL_GRANTS) {
      throw new Error('Machine skill grants file is invalid.');
    }
    return raw.grants.filter((grant): grant is MachineSkillGrant => (
      grant !== null
      && typeof grant === 'object'
      && typeof (grant as MachineSkillGrant).memberId === 'string'
      && typeof (grant as MachineSkillGrant).provider === 'string'
      && typeof (grant as MachineSkillGrant).providerSecurityRevision === 'string'
      && /^[a-f0-9]{32}$/.test((grant as MachineSkillGrant).providerSecurityRevision)
      && typeof (grant as MachineSkillGrant).reference === 'string'
      && typeof (grant as MachineSkillGrant).contentDigest === 'string'
      && typeof (grant as MachineSkillGrant).approvedAt === 'string'
    ));
  } catch (error: unknown) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT'
    ) return [];
    throw error;
  }
}

export async function assertMachineSkillGrantLedgerReadable(
  roomId: string
): Promise<void> {
  await loadGrants(roomId);
}

export function serializeMachineSkillGrantLedger(
  grants: MachineSkillGrant[]
): string {
  if (grants.length > MAX_MACHINE_SKILL_GRANTS) {
    throw new Error('Machine skill grant count exceeds the Room capacity.');
  }
  const serialized = JSON.stringify({ grants }, null, 2);
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_GRANT_LEDGER_BYTES) {
    throw new Error('Machine skill grant ledger exceeds its storage limit.');
  }
  return serialized;
}

async function resolveAssignment(
  agent: AgentConfig,
  reference: string,
  providerSecurityRevision: string
): Promise<ResolvedAssignment> {
  const loaded = await readMachineSkill(reference);
  return {
    reference: loaded.skill.reference,
    contentDigest: machineSkillContentDigest(loaded.content),
    label: `${loaded.skill.name} · ${loaded.skill.sourceLabel}`,
    provider: agent.provider,
    providerSecurityRevision,
    content: loaded.content
  };
}

export async function persistAgentWithMachineSkillApproval(
  event: IpcMainInvokeEvent,
  roomId: string,
  agent: AgentConfig & { id: string },
  persistMember: () => Promise<void>
): Promise<void> {
  await withGrantQueue(
    roomId,
    () => persistAgentWithMachineSkillApprovalLocked(event, roomId, agent, persistMember)
  );
}

async function persistAgentWithMachineSkillApprovalLocked(
  event: IpcMainInvokeEvent,
  roomId: string,
  agent: AgentConfig & { id: string },
  persistMember: () => Promise<void>
): Promise<void> {
  const workspace = requireBoundRoomWorkspace(roomId);
  const references = machineReferences(agent);
  // Only a machine-skill assignment binds a grant to the provider, so a member
  // without one must not depend on the provider being resolvable here.
  const providerSecurityRevision = references.length === 0
    ? ''
    : await readProviderSecurityRevision(
      agent.provider,
      path.dirname(path.dirname(workspace.roomRoot))
    );
  const assignments = await mapWithConcurrency(
    references,
    MACHINE_SKILL_READ_CONCURRENCY,
    reference => resolveAssignment(agent, reference, providerSecurityRevision)
  );
  const grantsBeforeApproval = await loadGrants(roomId);
  const priorMember = await readRoomTextFile(
    requireBoundRoomWorkspace(roomId),
    ['members', `${agent.id}.json`],
    512 * 1024
  ).then(content => {
    const validated = validateAgentConfig(JSON.parse(content));
    if (!validated.success) throw new Error('Existing AI member data is invalid.');
    return validated.agent;
  }).catch((error: unknown) => {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT'
    ) return undefined;
    throw error;
  });
  const approvedAssignments: Array<{
    assignment: ResolvedAssignment;
    nativeApproved: boolean;
  }> = [];

  for (const assignment of assignments) {
    const existing = priorMember
      && priorMember.provider === assignment.provider
      && (priorMember.skills || []).includes(assignment.reference)
      ? grantsBeforeApproval.find(grant => (
      grant.memberId === agent.id
      && grant.provider === assignment.provider
      && grant.providerSecurityRevision === assignment.providerSecurityRevision
      && grant.reference === assignment.reference
      && grant.contentDigest === assignment.contentDigest
      ))
      : undefined;
    if (existing) {
      approvedAssignments.push({ assignment, nativeApproved: false });
      continue;
    }
    const approved = await confirmNativeApproval(
      event,
      'Allow machine skill',
      `Allow ${agent.name} to use ${assignment.label}?`,
      `ROOM will read this machine-local skill and include its instructions in requests sent to ${agent.provider}. Approval is bound to this member, provider configuration, and current skill content.`
    );
    if (!approved) throw new Error('Machine skill assignment was not approved.');
    approvedAssignments.push({ assignment, nativeApproved: true });
  }

  await withRoomDataLock(workspace.roomRoot, 'machine-skill-grants', async () => {
    const priorGrants = await loadGrants(roomId);
    const retained = priorGrants.filter(grant => grant.memberId !== agent.id);
    const nextMemberGrants = approvedAssignments.map(({ assignment, nativeApproved }) => {
      const existing = priorGrants.find(grant => (
        grant.memberId === agent.id
        && grant.provider === assignment.provider
        && grant.providerSecurityRevision === assignment.providerSecurityRevision
        && grant.reference === assignment.reference
        && grant.contentDigest === assignment.contentDigest
      ));
      if (existing) return existing;
      if (!nativeApproved) {
        throw new Error(`Machine skill ${assignment.label} requires native approval again.`);
      }
      return {
        memberId: agent.id,
        provider: assignment.provider,
        providerSecurityRevision: assignment.providerSecurityRevision,
        reference: assignment.reference,
        contentDigest: assignment.contentDigest,
        approvedAt: new Date().toISOString()
      };
    });
    const nextGrants = [...retained, ...nextMemberGrants];
    await writeRoomDataFileAtomically(
      roomId,
      GRANTS_FILE,
      serializeMachineSkillGrantLedger(nextGrants)
    );
    try {
      await persistMember();
    } catch (error) {
      await writeRoomDataFileAtomically(
        roomId,
        GRANTS_FILE,
        serializeMachineSkillGrantLedger(priorGrants)
      );
      throw error;
    }
  });
}

export async function assertMachineSkillAssignments(
  roomId: string,
  agents: AgentConfig[],
  providerRegistry?: ProviderEntry[]
): Promise<ApprovedMachineSkillSnapshot[]> {
  if (agents.length > MAX_EXECUTION_MEMBERS) {
    throw new Error('AI run participant count exceeds its limit.');
  }
  for (const agent of agents) {
    if ((agent.skills || []).some(isMachineSkillReference) && !agent.id) {
      throw new Error(`Machine skills require ${agent.name} to be resaved with a stable member ID.`);
    }
  }
  const references = Array.from(new Set(agents.flatMap(machineReferences)));
  if (references.length === 0) return [];
  const grants = await loadGrants(roomId);
  const providers = Array.from(new Set(agents.map(agent => agent.provider)));
  const providerRevisions = providerRegistry
    ? new Map(providers.map(provider => {
        const revision = providerRegistry.find(entry => entry.id === provider)
          ?.securityRevision;
        if (!revision || !/^[a-f0-9]{32}$/.test(revision)) {
          throw new Error(`Provider ${provider} has no security revision.`);
        }
        return [provider, revision] as const;
      }))
    : new Map(await Promise.all(providers.map(async provider => {
        const workspace = requireBoundRoomWorkspace(roomId);
        const roomHome = path.dirname(path.dirname(workspace.roomRoot));
        return [provider, await readProviderSecurityRevision(provider, roomHome)] as const;
      })));
  const loadedByReference = new Map(await mapWithConcurrency(
    references,
    MACHINE_SKILL_READ_CONCURRENCY,
    async reference => {
    const loaded = await readMachineSkill(reference);
    return [loaded.skill.reference, loaded] as const;
    }
  ));
  const snapshots: ApprovedMachineSkillSnapshot[] = [];
  let snapshotBytes = 0;
  for (const agent of agents) {
    for (const reference of machineReferences(agent)) {
      const loaded = loadedByReference.get(reference);
      if (!loaded) throw new Error(`Machine skill is unavailable: ${reference}`);
      const assignment = {
        reference: loaded.skill.reference,
        contentDigest: machineSkillContentDigest(loaded.content),
        label: `${loaded.skill.name} · ${loaded.skill.sourceLabel}`,
        provider: agent.provider,
        providerSecurityRevision: providerRevisions.get(agent.provider)
      };
      const approved = grants.some(grant => (
        grant.memberId === agent.id
        && grant.provider === assignment.provider
        && grant.providerSecurityRevision === assignment.providerSecurityRevision
        && grant.reference === assignment.reference
        && grant.contentDigest === assignment.contentDigest
      ));
      if (!approved) {
        throw new Error(`Machine skill ${assignment.label} requires native approval for ${agent.name}.`);
      }
      snapshotBytes += Buffer.byteLength(loaded.content, 'utf-8');
      if (snapshotBytes > MAX_APPROVED_SNAPSHOT_BYTES) {
        throw new Error('Approved machine skill content exceeds the run snapshot limit.');
      }
      snapshots.push({
        memberId: agent.id!,
        provider: agent.provider,
        reference: assignment.reference,
        contentDigest: assignment.contentDigest,
        content: loaded.content
      });
    }
  }
  return snapshots;
}

export async function revokeMachineSkillGrants(
  roomId: string,
  memberId: string
): Promise<void> {
  await withGrantQueue(roomId, async () => {
    const workspace = requireBoundRoomWorkspace(roomId);
    await withRoomDataLock(workspace.roomRoot, 'machine-skill-grants', async () => {
      const grants = await loadGrants(roomId);
      await writeRoomDataFileAtomically(
        roomId,
        GRANTS_FILE,
        serializeMachineSkillGrantLedger(
          grants.filter(grant => grant.memberId !== memberId)
        )
      );
    });
  });
}

export function hasMachineSkillAssignment(rawMembers: unknown[]): boolean {
  return rawMembers.some(member => (
    member !== null
    && typeof member === 'object'
    && Array.isArray((member as { skills?: unknown }).skills)
    && (member as { skills: unknown[] }).skills.some(skill => (
      typeof skill === 'string' && isMachineSkillReference(skill)
    ))
  ));
}
