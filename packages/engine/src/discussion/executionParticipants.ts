import { createHash } from 'crypto';
import type { AgentConfig } from '../agents/registry.js';
import type { ApprovedMachineSkillSnapshot } from '../skills/machineCatalog.js';
import type { RoomSkillSnapshot } from './roomSkillSnapshot.js';

export interface ExecutionParticipantSnapshot {
  roomId: string;
  referenceKind: 'member' | 'temporary' | 'runtime';
  id: string;
  name: string;
  role: string;
  provider: string;
  modelName?: string;
  configurationDigest: string;
  skillSnapshotDigest: string;
}

export function createExecutionParticipantSnapshots(
  roomId: string,
  agents: readonly AgentConfig[],
  roomSkills: readonly RoomSkillSnapshot[] = [],
  machineSkills: readonly ApprovedMachineSkillSnapshot[] = []
): ExecutionParticipantSnapshot[] {
  return agents.map(agent => {
    const skills = Array.from(new Set(agent.skills || [])).sort();
    const relevantRoomSkills = roomSkills
      .filter(skill => skill.autoMatched || skills.includes(skill.reference))
      .map(skill => [skill.reference, skill.contentDigest])
      .sort(comparePairs);
    const relevantMachineSkills = machineSkills
      .filter(skill => skill.memberId === agent.id)
      .map(skill => [skill.reference, skill.contentDigest])
      .sort(comparePairs);
    const referenceKind = agent.id?.startsWith('mem_')
      ? 'member'
      : agent.id?.startsWith('tmp_') ? 'temporary' : 'runtime';
    const runtimeIdentity = digest({
      name: agent.name,
      role: agent.role,
      provider: agent.provider,
      modelName: agent.modelName || ''
    }).slice(0, 24);
    return {
      roomId,
      referenceKind,
      id: agent.id || `runtime_${runtimeIdentity}`,
      name: agent.name,
      role: agent.role,
      provider: agent.provider,
      ...(agent.modelName ? { modelName: agent.modelName } : {}),
      configurationDigest: digest({
        name: agent.name,
        role: agent.role,
        provider: agent.provider,
        modelName: agent.modelName || '',
        systemPrompt: agent.systemPrompt,
        skills
      }),
      skillSnapshotDigest: digest({
        selectedReferences: skills,
        roomSkills: relevantRoomSkills,
        machineSkills: relevantMachineSkills
      })
    };
  });
}

export function mergeExecutionParticipantSnapshots(
  previous: readonly ExecutionParticipantSnapshot[],
  current: readonly ExecutionParticipantSnapshot[]
): ExecutionParticipantSnapshot[] {
  const snapshots = new Map<string, ExecutionParticipantSnapshot>();
  for (const snapshot of [...previous, ...current]) {
    snapshots.set(
      `${snapshot.referenceKind}:${snapshot.id}:${snapshot.configurationDigest}:${snapshot.skillSnapshotDigest}`,
      snapshot
    );
  }
  return [...snapshots.values()];
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function comparePairs(first: string[], second: string[]): number {
  return first[0].localeCompare(second[0]) || first[1].localeCompare(second[1]);
}
