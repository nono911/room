import React from 'react';
import { CreateTeamWizard } from './CreateTeamWizard.js';
import type { TeamRoster, RosterMember } from '../lib/teamRoster.js';

interface TeamMutationResult {
  success: boolean;
  error?: string;
}

interface TeamDetailScreenProps {
  projectPath: string;
  team: TeamRoster;
  availableMembers: RosterMember[];
  existingNames: string[];
  existingSkillFiles: string[];
  api: {
    updateTeamMembers: (projectPath: string, teamId: string, memberIds: string[]) => Promise<TeamMutationResult>;
    addMembersToTeam: (
      projectPath: string,
      teamId: string,
      members: unknown[],
      skillDrafts: Array<{ name: string; content: string }>
    ) => Promise<TeamMutationResult>;
  };
  reloadProjectData: () => Promise<void>;
  setActiveTab: (tab: string) => void;
  startEditAgent: (agent: RosterMember) => void;
}

export const TeamDetailScreen: React.FC<TeamDetailScreenProps> = ({
  projectPath,
  team,
  availableMembers,
  existingNames,
  existingSkillFiles,
  api,
  reloadProjectData,
  setActiveTab,
  startEditAgent
}) => {
  const [selectedMemberId, setSelectedMemberId] = React.useState('');
  const [showTemplateWizard, setShowTemplateWizard] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const isReadOnlyTeam = Boolean(team.virtual);

  const persistMemberIds = async (memberIds: string[]) => {
    if (isReadOnlyTeam) return;
    setSaving(true);
    setMutationError(null);
    try {
      const result = await api.updateTeamMembers(projectPath, team.id, memberIds);
      if (!result.success) {
        setMutationError(result.error || 'Failed to update team members.');
        return;
      }
      await reloadProjectData();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Failed to update team members.');
    } finally {
      setSaving(false);
    }
  };

  const moveMember = async (memberId: string, direction: -1 | 1) => {
    const currentIndex = team.memberIds.indexOf(memberId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= team.memberIds.length) return;
    const nextMemberIds = [...team.memberIds];
    [nextMemberIds[currentIndex], nextMemberIds[nextIndex]] = [nextMemberIds[nextIndex], nextMemberIds[currentIndex]];
    await persistMemberIds(nextMemberIds);
  };

  const appendExistingMember = async () => {
    if (!selectedMemberId || team.memberIds.includes(selectedMemberId) || isReadOnlyTeam) return;
    await persistMemberIds([...team.memberIds, selectedMemberId]);
    setSelectedMemberId('');
  };

  const handleAddTemplateMembers = async (
    _teamDraft: { name: string; description?: string },
    members: unknown[],
    skillDrafts: Array<{ name: string; content: string }>
  ) => {
    setSaving(true);
    setMutationError(null);
    try {
      const result = await api.addMembersToTeam(projectPath, team.id, members, skillDrafts);
      if (!result.success) {
        setMutationError(result.error || 'Failed to add generated members.');
        return;
      }
      await reloadProjectData();
      setShowTemplateWizard(false);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Failed to add generated members.');
    } finally {
      setSaving(false);
    }
  };

  const eligibleExistingMembers = availableMembers.filter(
    (member): member is RosterMember & { id: string } =>
      typeof member.id === 'string' && member.id.length > 0 && !team.memberIds.includes(member.id)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', width: '100%' }}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setActiveTab('AI Members')}
        style={{ alignSelf: 'flex-start' }}
      >
        Back to teams
      </button>

      <div
        style={{
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '8px',
          background: 'rgba(15, 23, 42, 0.68)',
          padding: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}
      >
        {mutationError && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.28)',
              borderRadius: '8px',
              padding: '12px 14px',
              color: '#fca5a5',
              fontSize: '0.84rem'
            }}
          >
            {mutationError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ fontSize: '1.18rem', margin: 0, color: 'white' }}>{team.name}</h3>
            <p style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', margin: '6px 0 0 0', lineHeight: 1.5 }}>
              {team.description || (isReadOnlyTeam ? 'These saved members are available to assign into teams.' : 'Reorder members, add saved members, or generate new ones from templates.')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {!isReadOnlyTeam && (
              <>
                <select
                  aria-label="Add existing member"
                  className="form-select"
                  value={selectedMemberId}
                  onChange={(event) => setSelectedMemberId(event.target.value)}
                  disabled={saving || eligibleExistingMembers.length === 0}
                >
                  <option value="">Add existing member</option>
                  {eligibleExistingMembers.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void appendExistingMember()}
                  disabled={!selectedMemberId || saving}
                  aria-label="Add existing member to team"
                >
                  Add existing member
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowTemplateWizard(current => !current)}
                  disabled={saving}
                >
                  {showTemplateWizard ? 'Hide template members' : 'Add template members'}
                </button>
              </>
            )}
          </div>
        </div>

        {showTemplateWizard && !isReadOnlyTeam && (
          <CreateTeamWizard
            mode="add-members"
            initialTeamName={team.name}
            initialDescription={team.description}
            existingNames={existingNames}
            existingSkillFiles={existingSkillFiles}
            onCancel={() => setShowTemplateWizard(false)}
            onCreate={handleAddTemplateMembers}
            submitLabel="Add members"
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {team.members.map((member, index) => (
            <div
              key={member.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: '12px',
                alignItems: 'center',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                background: 'rgba(2, 6, 23, 0.45)',
                padding: '12px 14px'
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', color: 'white', fontWeight: 600 }}>
                  {index + 1}. {member.name}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', marginTop: '4px' }}>
                  {member.role}
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' }}>
                {!isReadOnlyTeam && (
                  <>
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Move ${member.name} up`}
                      onClick={() => member.id ? void moveMember(member.id, -1) : undefined}
                      disabled={index === 0 || saving}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Move ${member.name} down`}
                      onClick={() => member.id ? void moveMember(member.id, 1) : undefined}
                      disabled={index === team.members.length - 1 || saving}
                    >
                      Down
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Edit ${member.name}`}
                  onClick={() => {
                    startEditAgent(member);
                    setActiveTab(member.id ? `Agent:${member.id}` : `Agent:${member.name}`);
                  }}
                >
                  Edit
                </button>
                {!isReadOnlyTeam && (
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Remove ${member.name}`}
                    onClick={() => member.id ? void persistMemberIds(team.memberIds.filter(id => id !== member.id)) : undefined}
                    disabled={saving}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          {team.members.length === 0 && (
            <div
              style={{
                padding: '28px',
                borderRadius: '8px',
                border: '1px dashed rgba(255, 255, 255, 0.12)',
                color: 'hsl(var(--text-muted))',
                textAlign: 'center'
              }}
            >
              No members in this team yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
