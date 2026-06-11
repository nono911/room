import React from 'react';
import type { ProjectData, SkillPreviewResult, TemplateSkill } from '../../../types/domain.js';
import { useProviders } from '../../../features/providers/context/ProvidersContext.js';

interface AgentEditorScreenProps {
  activeTab: string;
  projectData: ProjectData | null;
  newAgentProvider: string;
  newAgentPreset: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none';
  newAgentModel: string;
  newAgentName: string;
  setNewAgentName: (value: string) => void;
  editingAgent: any;
  resetAgentForm: () => void;
  setActiveTab: (tab: string) => void;
  handleDeleteAgent: (agentName: string) => void;
  handleSaveAgent: (e: React.FormEvent) => void;
  errorMsg: string | null;
  setErrorMsg: (value: string | null) => void;
  agentPersonaTemplates: any[];
  setNewAgentRole: (value: string) => void;
  setNewAgentPrompt: (value: string) => void;
  ensureTemplateSkills: (skills: readonly TemplateSkill[]) => Promise<string[]>;
  setNewAgentSkills: React.Dispatch<React.SetStateAction<string[]>>;
  projectPath: string | null;
  loadProjectData: (path: string) => Promise<void>;
  newAgentRole: string;
  handleRoleChange: (value: string) => void;
  setNewAgentProvider: (value: string) => void;
  setNewAgentPreset: (value: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none') => void;
  setNewAgentPermissionMode: (value: 'safe' | 'dangerous') => void;
  setNewAgentModelCustom: (value: boolean) => void;
  setNewAgentModel: (value: string) => void;
  setSkillPreview: (value: SkillPreviewResult | null) => void;
  newAgentModelCustom: boolean;
  newAgentCommand: string;
  setNewAgentCommand: (value: string) => void;
  newAgentStdinFormat: 'text' | 'json';
  setNewAgentStdinFormat: (value: 'text' | 'json') => void;
  newAgentPermissionMode: 'safe' | 'dangerous';
  newAgentSkills: string[];
  editingSkillFile: string;
  setEditingSkillFile: (value: string) => void;
  loadRoomFilePreview: (section: 'skills', file: string) => void;
  skillPreview: SkillPreviewResult | null;
  handlePreviewAgentSkills: () => void;
  editingSkillContent: string;
  setEditingSkillContent: (value: string) => void;
  editingSkillSource: 'skills' | 'roles';
  setEditingSkillSource: (value: 'skills' | 'roles') => void;
  handleSaveEditingSkill: () => void;
  customSkillName: string;
  setCustomSkillName: (value: string) => void;
  customSkillDesc: string;
  setCustomSkillDesc: (value: string) => void;
  handleAddCustomSkill: () => void;
  newAgentPrompt: string;
  loading: boolean;
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const AgentEditorScreen: React.FC<AgentEditorScreenProps> = ({
  activeTab,
  projectData,
  newAgentProvider,
  newAgentPreset,
  newAgentModel,
  newAgentName,
  setNewAgentName,
  editingAgent,
  resetAgentForm,
  setActiveTab,
  handleDeleteAgent,
  handleSaveAgent,
  errorMsg,
  setErrorMsg,
  agentPersonaTemplates,
  setNewAgentRole,
  setNewAgentPrompt,
  ensureTemplateSkills,
  setNewAgentSkills,
  projectPath,
  loadProjectData,
  newAgentRole,
  handleRoleChange,
  setNewAgentProvider,
  setNewAgentPreset,
  setNewAgentPermissionMode,
  setNewAgentModelCustom,
  setNewAgentModel,
  setSkillPreview,
  newAgentModelCustom,
  newAgentCommand,
  setNewAgentCommand,
  newAgentStdinFormat,
  setNewAgentStdinFormat,
  newAgentPermissionMode,
  newAgentSkills,
  editingSkillFile,
  setEditingSkillFile,
  loadRoomFilePreview,
  skillPreview,
  handlePreviewAgentSkills,
  editingSkillContent,
  setEditingSkillContent,
  editingSkillSource,
  setEditingSkillSource,
  handleSaveEditingSkill,
  customSkillName,
  setCustomSkillName,
  customSkillDesc,
  setCustomSkillDesc,
  handleAddCustomSkill,
  newAgentPrompt,
  loading
}) => {
  const { providers, detectedClis, getModelOptions } = useProviders();
  const isNew = activeTab === 'Agent:New';
  const availableSkills = projectData?.skills || [];
  const modelOptions = getModelOptions(newAgentProvider, newAgentPreset);
  const isCustomModel = newAgentModel && !modelOptions.some(opt => opt.value === newAgentModel);
  const isLocalCliAgent = newAgentProvider === 'Local CLI';
  const shouldShowModel = isLocalCliAgent || modelOptions.length > 0 || newAgentProvider !== 'Local CLI';

  return (
    <div className="focus-editor-container">
      <div className="focus-editor-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span 
              onClick={() => { resetAgentForm(); setActiveTab('AI Members'); }} 
              style={{ color: 'hsl(var(--accent-purple))', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to AI Members
            </span>
          </div>
          <h2 className="focus-editor-title">
            {isNew ? 'Register New AI Agent' : `Edit Agent: ${editingAgent?.name || newAgentName}`}
          </h2>
        </div>
        {!isNew && (
          <button 
            type="button" 
            className="btn-secondary" 
            onClick={() => handleDeleteAgent(editingAgent?.name || newAgentName)}
            style={{ borderColor: '#ef4444', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 16px' }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Agent
          </button>
        )}
      </div>

      <form onSubmit={handleSaveAgent} className="focus-editor-card">
        {errorMsg && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '12px 16px', borderRadius: '8px', color: '#ef4444', fontSize: '0.85rem', marginBottom: '16px' }}>
            {errorMsg}
          </div>
        )}

        {isNew && (
          <div style={{
            background: 'hsl(var(--bg-input))',
            border: '1px dashed hsl(var(--border-dim))',
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              ⚡ Quick Load Template
            </span>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {agentPersonaTemplates.map(tmpl => (
                <button
                  key={tmpl.name}
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '6px 14px', height: 'auto', borderRadius: '6px' }}
                  onClick={async () => {
                    setNewAgentName(tmpl.name);
                    setNewAgentRole(tmpl.role);
                    setNewAgentPrompt(tmpl.prompt);
                    setErrorMsg(null);

                    try {
                      const skillFiles = await ensureTemplateSkills(tmpl.skills);
                      setNewAgentSkills(skillFiles);
                      if (projectPath) {
                        await loadProjectData(projectPath);
                      }
                    } catch (err: any) {
                      setErrorMsg(err.message || 'Failed to create template skills.');
                    }
                  }}
                >
                  {tmpl.name}
                </button>
              ))}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
              Clicking a template fills role, persona, and recommended skills. Choose the provider and model separately.
            </span>
          </div>
        )}

        {/* 2-Column Section */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', alignItems: 'start' }}>
          {/* Left Column: Config */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Agent Name</label>
              <input 
                type="text"
                required
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="e.g., AppSec Auditor"
                style={{
                  backgroundColor: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: 'white',
                  fontFamily: 'inherit',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Role</label>
              <input 
                type="text"
                required
                value={newAgentRole}
                onChange={(e) => handleRoleChange(e.target.value)}
                placeholder="e.g., Security Specialist"
                style={{
                  backgroundColor: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: 'white',
                  fontFamily: 'inherit',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Provider (AI Agent/Model Type)</label>
              <select 
                value={
                  newAgentProvider === 'Local CLI' 
                    ? `Local CLI:${newAgentPreset}` 
                    : newAgentProvider
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.startsWith('Local CLI:')) {
                    const presetKey = val.replace('Local CLI:', '');
                    setNewAgentProvider('Local CLI');
                    setNewAgentPreset(presetKey as any);
                    setNewAgentPermissionMode('safe');
                    setNewAgentModelCustom(false);
                    setNewAgentModel('');
                    setSkillPreview(null);
                  } else {
                    setNewAgentProvider(val as any);
                    setNewAgentPreset('none');
                    setNewAgentPermissionMode('safe');
                    const defaults = getModelOptions(val);
                    setNewAgentModelCustom(false);
                    setNewAgentModel(defaults[0]?.value || '');
                    setSkillPreview(null);
                  }
                }}
                style={{
                  backgroundColor: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  color: 'white',
                  fontFamily: 'inherit',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              >
                <optgroup label="API Providers">
                  {providers.map(provider => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </optgroup>
                
                <optgroup label="Detected Local CLI Agents">
                  {detectedClis.filter(c => c.available).map(cli => (
                    <option key={cli.id} value={`Local CLI:${cli.id}`}>
                      Local CLI: {cli.name} (Installed)
                    </option>
                  ))}
                </optgroup>
                
                <optgroup label="Other Local CLI Presets">
                  {detectedClis.filter(c => !c.available).map(cli => (
                    <option key={cli.id} value={`Local CLI:${cli.id}`}>
                      Local CLI: {cli.name} (Not Installed)
                    </option>
                  ))}
                  <option value="Local CLI:none">Local CLI: Custom Command...</option>
                </optgroup>
              </select>
            </div>

            {shouldShowModel && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Model Name</label>
                <select 
                  value={newAgentModelCustom || isCustomModel ? 'custom' : newAgentModel || (isLocalCliAgent ? '' : modelOptions[0]?.value || '')}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'custom') {
                      setNewAgentModelCustom(true);
                      setNewAgentModel('');
                    } else {
                      setNewAgentModelCustom(false);
                      setNewAgentModel(val);
                    }
                  }}
                  style={{
                    backgroundColor: 'hsl(var(--bg-input))',
                    border: '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'white',
                    fontFamily: 'inherit',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                >
                  {isLocalCliAgent && (
                    <option value="">Default CLI Model</option>
                  )}
                  {modelOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                  <option value="custom">Custom Model...</option>
                </select>
                {isLocalCliAgent && (
                  <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                    Leave this on Default CLI Model to let the selected local CLI use its own configured default.
                  </span>
                )}
                
                {(newAgentModelCustom || isCustomModel || (!isLocalCliAgent && (!newAgentModel || modelOptions.length === 0))) && (
                  <input 
                    type="text"
                    required={!isLocalCliAgent}
                    value={newAgentModel}
                    onChange={(e) => setNewAgentModel(e.target.value)}
                    placeholder="Enter model identifier (e.g., deepseek-coder)"
                    style={{
                      backgroundColor: 'hsl(var(--bg-input))',
                      border: '1px solid hsl(var(--border-dim))',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: 'white',
                      fontFamily: 'inherit',
                      fontSize: '0.9rem',
                      outline: 'none',
                      marginTop: '6px'
                    }}
                  />
                )}
              </div>
            )}

            {newAgentProvider === 'Local CLI' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px', borderLeft: '2px solid hsl(var(--border-dim))', paddingLeft: '12px' }}>
                {newAgentPreset === 'none' ? (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>CLI Command</label>
                      <input 
                        type="text"
                        required
                        value={newAgentCommand}
                        onChange={(e) => setNewAgentCommand(e.target.value)}
                        placeholder="e.g., node agent.js or python3 script.py"
                        style={{
                          backgroundColor: 'hsl(var(--bg-input))',
                          border: '1px solid hsl(var(--border-dim))',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          color: 'white',
                          fontFamily: 'inherit',
                          fontSize: '0.9rem',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Stdin Format</label>
                      <select 
                        value={newAgentStdinFormat}
                        onChange={(e) => {
                          setNewAgentStdinFormat(e.target.value as any);
                          setSkillPreview(null);
                        }}
                        style={{
                          backgroundColor: 'hsl(var(--bg-input))',
                          border: '1px solid hsl(var(--border-dim))',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          color: 'white',
                          fontFamily: 'inherit',
                          fontSize: '0.9rem',
                          outline: 'none'
                        }}
                      >
                        <option value="text">Plain text prompt</option>
                        <option value="json">JSON payload {"{ prompt, systemInstruction }"}</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <div style={{
                    fontSize: '0.75rem',
                    border: '1px solid hsl(var(--border-dim))',
                    color: 'hsl(var(--text-secondary))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    padding: '12px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    borderRadius: '8px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600 }}>Preset Status:</span>
                      {(() => {
                        const cli = detectedClis.find(c => c.id === newAgentPreset);
                        if (cli?.available) {
                          return <span style={{ color: '#10b981', fontWeight: 600 }}>✓ Installed</span>;
                        }
                        return <span style={{ color: '#ef4444', fontWeight: 600 }}>⚠ Not on PATH</span>;
                      })()}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4' }}>
                      {newAgentPreset === 'claude' && "Safe mode by default; dangerous mode must be explicitly enabled."}
                      {newAgentPreset === 'gemini' && "Safe mode by default; workspace trust and yolo execution are disabled until dangerous mode."}
                      {newAgentPreset === 'codex' && "Safe sandboxed mode by default; network access override is disabled until dangerous mode."}
                      {newAgentPreset === 'copilot' && "Safe mode by default; auto-approve tooling requires dangerous mode."}
                      {newAgentPreset === 'codewhale' && "Safe mode by default; auto-exec and prompt mode disabled until dangerous mode."}
                      {newAgentPreset === 'agy' && "Safe mode by default; skip-permissions behavior disabled until dangerous mode."}
                    </div>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.75rem',
                      color: 'hsl(var(--text-secondary))'
                    }}>
                      <input
                        type="checkbox"
                        checked={newAgentPermissionMode === 'dangerous'}
                        onChange={(e) => setNewAgentPermissionMode(e.target.checked ? 'dangerous' : 'safe')}
                      />
                      <span>
                        <span style={{ fontWeight: 600 }}>Enable dangerous permissions</span>
                        <span style={{ color: 'hsl(var(--text-muted))' }}> (requires explicit opt-in; grants filesystem/network and tool privileges)</span>
                      </span>
                    </label>
                    {newAgentPermissionMode === 'dangerous' && (
                      <div style={{ fontSize: '0.7rem', color: '#ef4444', lineHeight: '1.4' }}>
                        Warning: dangerous mode may allow destructive actions in your workspace.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Skills */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Assign Skills</label>
              <button
                type="button"
                className="btn-secondary"
                disabled={loading || newAgentSkills.length === 0}
                onClick={handlePreviewAgentSkills}
                style={{ fontSize: '0.72rem', padding: '6px 10px', height: 'auto' }}
              >
                Check Skills
              </button>
            </div>
            {availableSkills.length === 0 ? (
              <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>No skills found. Create a custom skill below or save an agent without skills.</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
                {availableSkills.map((skill) => {
                  const isSelected = newAgentSkills.includes(skill);
                  return (
                    <div
                      key={skill}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        gap: '8px',
                        alignItems: 'center',
                        background: editingSkillFile === skill ? 'hsl(var(--accent-purple) / 0.12)' : 'hsl(var(--bg-input))',
                        border: editingSkillFile === skill ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                        borderRadius: '8px',
                        padding: '8px 10px'
                      }}
                    >
                      <label
                        className={`skill-checkbox-chip ${isSelected ? 'selected' : ''}`}
                        style={{ minWidth: 0, width: '100%', justifyContent: 'flex-start' }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSkillPreview(null);
                            setNewAgentSkills(prev =>
                              prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]
                            );
                          }}
                        />
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {isSelected ? '✓ ' : '+ '}
                          {skill.replace('.md', '').replace(/-/g, ' ')}
                        </span>
                      </label>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={loading}
                        onClick={() => loadRoomFilePreview('skills', skill)}
                        style={{ fontSize: '0.72rem', padding: '5px 9px', height: 'auto' }}
                      >
                        Edit
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {skillPreview && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: skillPreview.readableCount === skillPreview.totalCount ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: skillPreview.readableCount === skillPreview.totalCount ? '1px solid rgba(16, 185, 129, 0.28)' : '1px solid rgba(239, 68, 68, 0.28)',
                borderRadius: '8px',
                padding: '10px 12px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'hsl(var(--text-secondary))' }}>
                    {skillPreview.readableCount}/{skillPreview.totalCount} skills readable
                  </span>
                  <span style={{ fontSize: '0.7rem', color: skillPreview.readableCount === skillPreview.totalCount ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                    {skillPreview.readableCount === skillPreview.totalCount ? 'READY' : 'CHECK NEEDED'}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', lineHeight: 1.45 }}>
                  {skillPreview.delivery}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {skillPreview.items.map(item => (
                    <div
                      key={item.filename}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '18px minmax(0, 1fr)',
                        gap: '8px',
                        alignItems: 'start',
                        fontSize: '0.72rem',
                        color: item.readable ? 'hsl(var(--text-secondary))' : '#ef4444'
                      }}
                    >
                      <span>{item.readable ? '✓' : '!'}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.filename}{item.source ? ` · .room/${item.source}` : ''}
                        </span>
                        <span style={{ display: 'block', color: 'hsl(var(--text-muted))', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.readable ? `${item.heading || 'No heading'} · ${formatFileSize(item.bytes || 0)}` : item.error}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {editingSkillFile && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: 'hsl(var(--bg-input))',
                border: '1px solid hsl(var(--border-dim))',
                borderRadius: '8px',
                padding: '12px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
                      Edit Skill
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {editingSkillFile}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={loading}
                    onClick={() => {
                      setEditingSkillFile('');
                      setEditingSkillContent('');
                      setEditingSkillSource('skills');
                    }}
                    style={{ fontSize: '0.72rem', padding: '5px 9px', height: 'auto' }}
                  >
                    Close
                  </button>
                </div>
                <textarea
                  value={editingSkillContent}
                  onChange={(e) => setEditingSkillContent(e.target.value)}
                  rows={10}
                  disabled={loading}
                  style={{
                    width: '100%',
                    resize: 'vertical',
                    minHeight: '180px',
                    backgroundColor: 'hsl(var(--bg-card))',
                    border: '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'white',
                    fontFamily: 'monospace',
                    fontSize: '0.78rem',
                    lineHeight: 1.5,
                    outline: 'none'
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
                    {editingSkillSource === 'roles'
                      ? 'Loaded from legacy .room/roles. Saving migrates this skill to .room/skills.'
                      : 'Saved edits are written to .room/skills and can be assigned immediately.'}
                  </span>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={loading}
                    onClick={handleSaveEditingSkill}
                    style={{ fontSize: '0.78rem', padding: '8px 12px', whiteSpace: 'nowrap' }}
                  >
                    Save Skill
                  </button>
                </div>
              </div>
            )}

            {/* Custom Skill Creator */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '8px', 
              marginTop: '12px', 
              paddingTop: '12px', 
              borderTop: '1px dashed hsl(var(--border-dim))' 
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>Create Custom Skill</span>
              <input 
                type="text"
                placeholder="Role or Skill Name (e.g. Story Continuity)"
                value={customSkillName}
                onChange={(e) => setCustomSkillName(e.target.value)}
                className="custom-skill-input"
                style={{ width: '100%' }}
              />
              <textarea 
                rows={3}
                placeholder="Skill Description / Instructions (e.g. Keep dialogue natural, check continuity, or verify assumptions...)"
                value={customSkillDesc}
                onChange={(e) => setCustomSkillDesc(e.target.value)}
                className="custom-skill-input"
                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.8rem' }}
              />
              <button 
                type="button" 
                className="btn-secondary" 
                style={{ fontSize: '0.8rem', padding: '8px 12px', alignSelf: 'flex-end' }}
                onClick={handleAddCustomSkill}
              >
                + Save Skill
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Row: System Prompt */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>System Prompt & Persona Instructions</label>
          <textarea 
            required
            rows={12}
            value={newAgentPrompt}
            onChange={(e) => setNewAgentPrompt(e.target.value)}
            placeholder="Describe this agent's persona, responsibility, constraints, and output format. This is sent directly to the model."
            style={{
              backgroundColor: 'hsl(var(--bg-input))',
              border: '1px solid hsl(var(--border-dim))',
              borderRadius: '8px',
              padding: '12px 14px',
              color: 'white',
              fontFamily: 'inherit',
              fontSize: '0.85rem',
              outline: 'none',
              resize: 'vertical',
              lineHeight: '1.5',
              minHeight: '200px'
            }}
          />
          <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
            Sent to the model as the primary persona contract, then ROOM appends selected skills, discussion protocol, and workspace context.
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', borderTop: '1px solid hsl(var(--border-dim))', paddingTop: '20px' }}>
          <button type="button" className="btn-secondary" onClick={() => { resetAgentForm(); setActiveTab('AI Members'); }} style={{ height: '38px', padding: '0 20px' }}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={loading} style={{ height: '38px', padding: '0 28px', fontSize: '0.85rem', fontWeight: 600 }}>
            {loading ? 'Saving...' : isNew ? 'Register AI Member' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
};
