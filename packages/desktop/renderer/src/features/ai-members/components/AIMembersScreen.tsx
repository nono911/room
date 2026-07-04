import React from 'react';
import { api } from '../../../shared/ipc/client.js';
import type { ProjectData } from '../../../types/domain.js';
import { useProviders } from '../../../features/providers/context/ProvidersContext.js';
import { buildTeamRosters } from '../lib/teamRoster.js';
import type { TemplateRowDraft } from '../lib/teamWizard.js';
import { TeamCard } from './TeamCard.js';
import { CreateTeamWizard } from './CreateTeamWizard.js';

interface AIMembersScreenProps {
  projectPath: string | null;
  projectData: ProjectData | null;
  aiMemberDetailsExpanded: boolean;
  setAiMemberDetailsExpanded: (value: boolean | ((prev: boolean) => boolean)) => void;
  resetAgentForm: () => void;
  setActiveTab: (tab: string) => void;
  teamPresets: Array<{ name: string; description: string; roles: string[] }>;
  loadProjectData: (path: string) => Promise<void>;
  startEditAgent: (agent: any) => void;
  handleDeleteAgent: (agentName: string) => void;
}

export const AIMembersScreen: React.FC<AIMembersScreenProps> = ({
  projectPath,
  projectData,
  aiMemberDetailsExpanded,
  setAiMemberDetailsExpanded,
  resetAgentForm,
  setActiveTab,
  teamPresets,
  loadProjectData
}) => {
  const { detectedClis, scanClis } = useProviders();
  const [toolchainScanLoading, setToolchainScanLoading] = React.useState<boolean>(false);
  const [showCreateTeam, setShowCreateTeam] = React.useState(false);
  const [wizardSeed, setWizardSeed] = React.useState<{
    name: string;
    description: string;
    templateRows: TemplateRowDraft[];
  } | null>(null);
  const [teamOperationError, setTeamOperationError] = React.useState<string | null>(null);
  const agents = projectData?.agents || [];
  const { userTeams, unassigned } = buildTeamRosters(
    agents,
    projectData?.teams || [],
    projectData?.unassignedMemberIds || []
  );
  const visibleTeams = unassigned.members.length > 0 ? [...userTeams, unassigned] : userTeams;
  const shouldShowRecommendedTeams = userTeams.length === 0 && !showCreateTeam;
  const teamGridColumns = `repeat(auto-fit, minmax(${aiMemberDetailsExpanded ? '300px' : '250px'}, 1fr))`;

  const openCreateTeamWizard = (seed?: { name: string; description: string; templateRows: TemplateRowDraft[] }) => {
    setWizardSeed(seed || null);
    setTeamOperationError(null);
    setShowCreateTeam(true);
  };

  const buildSeedRows = (roles: string[]): TemplateRowDraft[] =>
    roles.map(role => ({
      id: globalThis.crypto?.randomUUID?.() || `${role}-${Math.random().toString(36).slice(2, 8)}`,
      templateName: role,
      count: 1
    }));

  const handleCreateTeam = async (
    team: { name: string; description?: string },
    members: Array<{
      name: string;
      role: string;
      provider: string;
      modelName?: string;
      systemPrompt: string;
      skills: string[];
    }>,
    skillDrafts: Array<{ name: string; content: string }>
  ) => {
    if (!projectPath) return;

    setTeamOperationError(null);
    const response = await api.createTeamWithMembers(projectPath, team, members, skillDrafts);
    if (!response.success) {
      throw new Error(response.error || 'Failed to create team.');
    }

    await loadProjectData(projectPath);
    setShowCreateTeam(false);
    setWizardSeed(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'white' }}>AI Members</h3>
          <p style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', margin: '4px 0 0 0' }}>
            Organize saved AI members into working teams first, then edit the people inside each team when you need to.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setAiMemberDetailsExpanded(current => {
                localStorage.setItem('room_ai_member_details_expanded', String(!current));
                return !current;
              });
            }}
            style={{ padding: '10px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={aiMemberDetailsExpanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
            </svg>
            {aiMemberDetailsExpanded ? 'Compact Members' : 'Expand Members'}
          </button>
          <button
            onClick={() => {
              openCreateTeamWizard();
            }}
            className="btn-primary"
            style={{ padding: '10px 20px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create Team
          </button>
          <button
            onClick={() => {
              resetAgentForm();
              setActiveTab('Agent:New');
            }}
            className="btn-secondary"
            style={{ padding: '10px 16px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            Register AI Member
          </button>
        </div>
      </div>

      {teamOperationError && (
        <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.28)', borderRadius: '8px', padding: '12px 14px', color: '#fca5a5', fontSize: '0.84rem' }}>
          {teamOperationError}
        </div>
      )}

      {showCreateTeam && (
        <CreateTeamWizard
          existingNames={agents.map((agent: any) => String(agent.name))}
          existingSkillFiles={projectData?.skills || []}
          initialTeamName={wizardSeed?.name || ''}
          initialDescription={wizardSeed?.description || ''}
          initialTemplateRows={wizardSeed?.templateRows}
          onCancel={() => {
            setShowCreateTeam(false);
            setWizardSeed(null);
          }}
          onCreate={async (team, members, skillDrafts) => {
            try {
              await handleCreateTeam(team, members, skillDrafts);
            } catch (error) {
              setTeamOperationError(error instanceof Error ? error.message : 'Failed to create team.');
            }
          }}
        />
      )}

      {shouldShowRecommendedTeams && (
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.68)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '8px',
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div>
            <h4 style={{ fontSize: '0.95rem', margin: 0, color: 'white' }}>Recommended Teams</h4>
            <p style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', margin: '4px 0 0 0' }}>
              Start from a team recipe, then inspect and edit every generated member before anything is saved.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: teamGridColumns, gap: '10px' }}>
            {teamPresets.map(team => (
              <button
                key={team.name}
                type="button"
                onClick={() =>
                  openCreateTeamWizard({
                    name: team.name,
                    description: team.description,
                    templateRows: buildSeedRows(team.roles)
                  })
                }
                style={{
                  textAlign: 'left',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  padding: '14px',
                  background: 'rgba(2, 6, 23, 0.5)',
                  color: 'inherit',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  cursor: 'pointer',
                  minHeight: '164px'
                }}
              >
                <div>
                  <div style={{ fontSize: '0.88rem', color: 'white', fontWeight: 600 }}>{team.name}</div>
                  <div style={{ fontSize: '0.74rem', color: 'hsl(var(--text-muted))', lineHeight: 1.5, marginTop: '4px' }}>
                    {team.description}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignContent: 'flex-start' }}>
                  {team.roles.map(role => (
                    <span
                      key={`${team.name}-${role}`}
                      style={{
                        background: 'rgba(99, 102, 241, 0.12)',
                        border: '1px solid rgba(129, 140, 248, 0.22)',
                        color: 'rgb(199, 210, 254)',
                        fontSize: '0.68rem',
                        padding: '4px 8px',
                        borderRadius: '999px'
                      }}
                    >
                      {role}
                    </span>
                  ))}
                </div>
                <span style={{ marginTop: 'auto', fontSize: '0.76rem', color: 'hsl(var(--text-secondary))' }}>
                  Open starter in wizard
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!shouldShowRecommendedTeams && visibleTeams.length > 0 && (
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.68)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '8px',
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div>
            <h4 style={{ fontSize: '0.95rem', margin: 0, color: 'white' }}>Teams</h4>
            <p style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', margin: '4px 0 0 0' }}>
              Open a team to reorder members, assign saved members, or add fresh members from templates.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: teamGridColumns, gap: '10px' }}>
            {visibleTeams.map(team => (
              <TeamCard key={team.id} team={team} onOpen={() => setActiveTab(`Team:${team.id}`)} />
            ))}
          </div>
        </div>
      )}

      <details className="collapsible-container">
        <summary className="collapsible-summary">
          <span>🔍 Local CLI Toolchain Status ({detectedClis.filter(c => c.available).length} Detected)</span>
        </summary>
        <div className="collapsible-content">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
              Scanning your system PATH and toolchains for compatible local CLI agents.
            </span>
            <button 
              onClick={async () => {
                setToolchainScanLoading(true);
                try {
                  await scanClis();
                } catch (err) {
                  console.error(err);
                } finally {
                  setToolchainScanLoading(false);
                }
              }}
              disabled={toolchainScanLoading}
              className="btn-secondary" 
              style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
            >
              {toolchainScanLoading ? 'Scanning...' : '↻ Rescan Toolchain'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
            {detectedClis.map((cli) => (
              <div key={cli.id} style={{
                background: 'hsl(var(--bg-card))',
                border: '1px solid hsl(var(--border-dim))',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  backgroundColor: cli.available ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: cli.available ? '#10b981' : 'hsl(var(--text-muted))',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  flexShrink: 0
                }}>
                  {cli.name.substring(0, 1)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: cli.available ? 'white' : 'hsl(var(--text-secondary))' }}>{cli.name}</span>
                    <span style={{
                      fontSize: '0.65rem',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 600,
                      backgroundColor: cli.available ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: cli.available ? '#10b981' : '#ef4444'
                    }}>
                      {cli.available ? 'Installed' : 'Not Found'}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'hsl(var(--text-muted))',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: '2px'
                  }} title={cli.path || undefined}>
                    {cli.available ? (cli.version || 'On PATH') : 'Not on PATH'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
};
