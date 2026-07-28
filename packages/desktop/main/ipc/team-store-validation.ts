import { randomUUID } from 'crypto';
import { validateAgentConfig, type AgentConfig } from '@room/engine';
import type { MemberTeam } from '../../shared/types/domain.js';

export const TEAM_ID_PATTERN = /^team_[a-z0-9][a-z0-9_-]{2,80}$/;
const MEMBER_ID_PATTERN = /^mem_[a-z0-9][a-z0-9_-]{2,80}$/;
const MAX_TEAM_MEMBERS = 128;

function slugify(value: string): string {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'team';
}

export function createStableId(prefix: 'team' | 'mem', label: string): string {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  return `${prefix}_${slugify(label)}_${suffix}`;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function parseMemberIds(
  rawIds: unknown,
  options: { requireArray: boolean }
): { success: true; memberIds: string[] } | { success: false; error: string } {
  if (!Array.isArray(rawIds)) {
    return options.requireArray
      ? { success: false, error: 'Persisted team memberIds must be an array.' }
      : { success: true, memberIds: [] };
  }
  const memberIds: string[] = [];
  const seen = new Set<string>();
  for (const rawId of rawIds) {
    if (typeof rawId !== 'string') {
      return { success: false, error: 'Team memberIds must contain only strings.' };
    }
    const memberId = rawId.trim();
    if (!MEMBER_ID_PATTERN.test(memberId)) {
      return { success: false, error: `Invalid member id: ${memberId}` };
    }
    if (seen.has(memberId)) continue;
    seen.add(memberId);
    memberIds.push(memberId);
    if (memberIds.length > MAX_TEAM_MEMBERS) {
      return { success: false, error: `A team can contain at most ${MAX_TEAM_MEMBERS} members.` };
    }
  }
  return { success: true, memberIds };
}

function validateTeamShape(
  rawTeam: unknown,
  options: { allowMissingId: boolean; requireMemberIdsArray: boolean }
): { success: true; team: MemberTeam } | { success: false; error: string } {
  if (!rawTeam || typeof rawTeam !== 'object' || Array.isArray(rawTeam)) {
    return { success: false, error: 'Invalid team payload.' };
  }
  const record = rawTeam as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) return { success: false, error: 'Team name is required.' };
  let id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id && options.allowMissingId) id = createStableId('team', name);
  if (!TEAM_ID_PATTERN.test(id)) {
    return { success: false, error: `Invalid team id: ${id || '(missing)'}` };
  }
  const memberIdsResult = parseMemberIds(record.memberIds, {
    requireArray: options.requireMemberIdsArray
  });
  if (!memberIdsResult.success) return memberIdsResult;
  const now = new Date().toISOString();
  const createdAt = normalizeTimestamp(record.createdAt, now);
  const updatedAt = normalizeTimestamp(record.updatedAt, createdAt);
  const description = normalizeOptionalText(record.description);
  if (
    Buffer.byteLength(name, 'utf-8') > 256
    || Buffer.byteLength(description || '', 'utf-8') > 4 * 1024
    || Buffer.byteLength(createdAt, 'utf-8') > 64
    || Buffer.byteLength(updatedAt, 'utf-8') > 64
  ) {
    return { success: false, error: 'Team field exceeds its size limit.' };
  }
  return {
    success: true,
    team: {
      id,
      name,
      description,
      memberIds: memberIdsResult.memberIds,
      createdAt,
      updatedAt
    }
  };
}

export function validateNewTeamDraft(
  rawTeam: unknown
): { success: true; team: MemberTeam } | { success: false; error: string } {
  return validateTeamShape(rawTeam, {
    allowMissingId: true,
    requireMemberIdsArray: false
  });
}

export function validatePersistedTeamConfig(
  rawTeam: unknown
): { success: true; team: MemberTeam } | { success: false; error: string } {
  return validateTeamShape(rawTeam, {
    allowMissingId: false,
    requireMemberIdsArray: true
  });
}

export function validateMemberPayloads(rawMembers: unknown[]): AgentConfig[] {
  const members = rawMembers.map((rawMember) => {
    const memberRecord = rawMember && typeof rawMember === 'object'
      ? rawMember as Record<string, unknown>
      : {};
    const id = typeof memberRecord.id === 'string'
      ? memberRecord.id.trim()
      : createStableId('mem', String(memberRecord.name || 'member'));
    if (!MEMBER_ID_PATTERN.test(id)) throw new Error(`Invalid member id: ${id}`);
    const result = validateAgentConfig({ ...memberRecord, id });
    if (!result.success) throw new Error(result.error);
    return result.agent;
  });
  const memberIds = members
    .map(member => member.id)
    .filter((id): id is string => Boolean(id));
  if (new Set(memberIds).size !== memberIds.length) {
    throw new Error('Duplicate member ids in team payload.');
  }
  return members;
}
