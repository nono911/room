import React from 'react';
import type { ProjectData, MaskedProvider } from '../../../types/domain.js';
import { useProviders } from '../../../features/providers/context/ProvidersContext.js';

interface AIMembersScreenProps {
  projectData: ProjectData | null;
  aiMemberDetailsExpanded: boolean;
  setAiMemberDetailsExpanded: (value: boolean | ((prev: boolean) => boolean)) => void;
  resetAgentForm: () => void;
  setActiveTab: (tab: string) => void;
  teamPresets: Array<{ name: string; description: string; roles: string[] }>;
  loading: boolean;
  setLoading: (value: boolean) => void;
  handleAddTeamPreset: (teamName: string) => void;
  startEditAgent: (agent: any) => void;
  handleDeleteAgent: (agentName: string) => void;
}

const LEGACY_PROVIDER_IDS: Record<string, string> = {
  Gemini: 'gemini',
  Claude: 'anthropic',
  Codex: 'openai'
};

const normalizeProviderId = (value: string) => LEGACY_PROVIDER_IDS[value] || value;

const providerLabel = (providers: MaskedProvider[], id: string) =>
  providers.find(provider => provider.id === normalizeProviderId(id))?.label || id;

export const AIMembersScreen: React.FC<AIMembersScreenProps> = ({
  projectData,
  aiMemberDetailsExpanded,
  setAiMemberDetailsExpanded,
  resetAgentForm,
  setActiveTab,
  teamPresets,
  loading,
  setLoading,
  handleAddTeamPreset,
  startEditAgent,
  handleDeleteAgent
}) => {
  const { providers, detectedClis, scanClis } = useProviders();
  const agents = projectData?.agents || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', width: '100%' }}>
      {/* Dashboard Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'white' }}>AI Members</h3>
          <p style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', margin: '4px 0 0 0' }}>
            Create role-based personas from templates or custom instructions. Saved AI members live in <code>.room/members/</code>.
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
              resetAgentForm();
              setActiveTab('Agent:New');
            }}
            className="btn-primary"
            style={{ padding: '10px 20px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Register AI Member
          </button>
        </div>
      </div>

      <div style={{
        background: 'hsl(var(--bg-card))',
        border: '1px solid hsl(var(--border-dim))',
        borderRadius: '8px',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h4 style={{ fontSize: '0.95rem', margin: 0, color: 'white' }}>Recommended Teams</h4>
            <p style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', margin: '4px 0 0 0' }}>
              Add a starter team for a common workflow. Existing members are skipped.
            </p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
          {teamPresets.map(team => {
            const missingRoles = team.roles.filter(role => !agents.some((agent: any) => String(agent.name).toLowerCase() === role.toLowerCase()));
            const allAdded = missingRoles.length === 0;
            return (
              <div
                key={team.name}
                style={{
                  background: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  minHeight: '156px'
                }}
              >
                <div>
                  <div style={{ fontSize: '0.86rem', color: 'white', fontWeight: 600 }}>{team.name}</div>
                  <div style={{ fontSize: '0.74rem', color: 'hsl(var(--text-muted))', lineHeight: 1.5, marginTop: '3px' }}>
                    {team.description}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1, alignContent: 'flex-start' }}>
                  {team.roles.map(role => {
                    const exists = agents.some((agent: any) => String(agent.name).toLowerCase() === role.toLowerCase());
                    return (
                      <span
                        key={role}
                        style={{
                          background: exists ? 'hsl(var(--bg-card))' : 'hsl(var(--accent-purple) / 0.12)',
                          border: exists ? '1px solid hsl(var(--border-dim))' : '1px solid hsl(var(--accent-purple) / 0.35)',
                          color: exists ? 'hsl(var(--text-muted))' : 'hsl(var(--text-secondary))',
                          fontSize: '0.7rem',
                          padding: '4px 8px',
                          borderRadius: '14px'
                        }}
                      >
                        {role}{exists ? ' · added' : ''}
                      </span>
                    );
                  })}
                </div>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => handleAddTeamPreset(team.name)}
                  disabled={loading || allAdded}
                  style={{ height: '34px', padding: '0 14px', fontSize: '0.8rem', alignSelf: 'flex-start' }}
                >
                  {allAdded ? 'Added' : 'Add Team'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Registered Agents Grid */}
      {agents.length === 0 ? (
        <div style={{ padding: '60px 40px', textAlign: 'center', color: 'hsl(var(--text-muted))', border: '1px dashed hsl(var(--border-dim))', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ color: 'hsl(var(--text-muted))' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>No AI members registered in this workspace. Add a recommended team or register one manually.</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: aiMemberDetailsExpanded ? 'repeat(auto-fill, minmax(320px, 1fr))' : 'repeat(auto-fill, minmax(260px, 1fr))', gap: aiMemberDetailsExpanded ? '20px' : '10px' }}>
          {agents.map((agent: any, idx: number) => {
            const providerClass = normalizeProviderId(agent.provider).toLowerCase();
            return (
              <div key={idx} style={{
                background: 'hsl(var(--bg-card))',
                border: '1px solid hsl(var(--border-dim))',
                borderLeft: `4px solid ${
                  providerClass === 'claude' ? 'hsl(var(--accent-purple))' :
                  providerClass === 'gemini' ? 'hsl(var(--accent-blue))' :
                  providerClass === 'codex' ? 'hsl(var(--accent-orange))' : 'hsl(var(--accent-green))'
                }`,
                borderRadius: '12px',
                padding: aiMemberDetailsExpanded ? '16px 20px' : '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: aiMemberDetailsExpanded ? '12px' : '8px',
                position: 'relative'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'white' }}>{agent.name}</h4>
                    <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 500, marginTop: '2px' }}>{agent.role}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Edit Button */}
                    <button 
                      className="agent-action-btn"
                      onClick={() => startEditAgent(agent)}
                      title="Edit Agent Config"
                    >
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    {/* Delete Button */}
                    <button 
                      className="agent-action-btn delete"
                      onClick={() => handleDeleteAgent(agent.name)}
                      title="Delete Agent"
                    >
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{
                    backgroundColor: 
                    providerClass === 'claude' ? 'rgba(139, 92, 246, 0.1)' : 
                    providerClass === 'gemini' ? 'rgba(59, 130, 246, 0.1)' : 
                    providerClass === 'codex' ? 'rgba(249, 115, 22, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                    color: 
                    providerClass === 'claude' ? 'hsl(var(--accent-purple))' : 
                    providerClass === 'gemini' ? 'hsl(var(--accent-blue))' : 
                    providerClass === 'codex' ? 'hsl(var(--accent-orange))' : 'hsl(var(--accent-green))',
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}>
                    {providerLabel(providers, agent.provider)}
                  </span>
                  {agent.provider !== 'Local CLI' && agent.modelName && (
                    <span style={{
                      fontSize: '0.7rem',
                      color: 'hsl(var(--text-secondary))',
                      backgroundColor: 'hsl(var(--bg-input))',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid hsl(var(--border-dim))'
                    }}>
                      {agent.modelName}
                    </span>
                  )}
                  {agent.provider === 'Local CLI' && (
                    <>
                      <span style={{
                        fontSize: '0.7rem',
                        color: 'hsl(var(--text-muted))',
                        backgroundColor: 'hsl(var(--bg-input))',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid hsl(var(--border-dim))',
                        fontFamily: 'monospace'
                      }}>
                        {agent.cliPreset && agent.cliPreset !== 'none' ? `Preset: ${agent.cliPreset === 'claude' ? 'Claude Code' : agent.cliPreset === 'gemini' ? 'Gemini CLI' : agent.cliPreset === 'codex' ? 'Codex CLI' : agent.cliPreset === 'copilot' ? 'GitHub Copilot CLI' : agent.cliPreset === 'codewhale' ? 'CodeWhale' : agent.cliPreset === 'agy' ? 'Antigravity CLI' : agent.cliPreset}` : `$ ${agent.command}`}
                      </span>
                      <span style={{
                        fontSize: '0.7rem',
                        color: 'hsl(var(--text-secondary))',
                        backgroundColor: 'hsl(var(--bg-input))',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid hsl(var(--border-dim))'
                      }}>
                        {agent.modelName ? `Model: ${agent.modelName}` : 'Model: Default CLI config'}
                      </span>
                      {agent.permissionMode === 'dangerous' && (
                        <span style={{
                          fontSize: '0.7rem',
                          color: '#ef4444',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          fontFamily: 'monospace'
                        }}>
                          dangerous permissions enabled
                        </span>
                      )}
                    </>
                  )}
                </div>

                {aiMemberDetailsExpanded && (
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'hsl(var(--text-secondary))',
                    lineHeight: '1.5',
                    background: 'hsl(var(--bg-input))',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid hsl(var(--border-dim))',
                    maxHeight: '60px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {agent.systemPrompt}
                  </div>
                )}

                {aiMemberDetailsExpanded && agent.skills && agent.skills.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto', paddingTop: '8px' }}>
                    {agent.skills.map((skill: string) => (
                      <span key={skill} style={{
                        backgroundColor: 'hsl(var(--bg-input))',
                        color: 'hsl(var(--text-muted))',
                        fontSize: '0.65rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: '1px solid hsl(var(--border-dim))',
                        fontWeight: 500
                      }}>
                        {skill.replace('.md', '').replace(/-/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Collapsible Local CLI ToolchainAccordion */}
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
                setLoading(true);
                try {
                  await scanClis();
                } catch (err) {
                  console.error(err);
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="btn-secondary" 
              style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
            >
              ↻ Rescan Toolchain
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
