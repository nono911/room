import React from 'react';
import type { ProjectData, SkillPreviewResult, TemplateSkill } from '../../../types/domain.js';
import { useProviders } from '../../../features/providers/context/ProvidersContext.js';
import { AgentEditorHeader, AgentTemplatePicker, type AgentTemplateOption } from './AgentEditorTop.js';
import { AgentSkillsPanel } from './AgentSkillsPanel.js';
import { isSafeLocalCliPreset } from '../lib/localCliPresets.js';

interface AgentEditorScreenProps {
  activeTab: string;
  projectData: ProjectData | null;
  newAgentProvider: string;
  newAgentPreset: string;
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
  agentPersonaTemplates: AgentTemplateOption[];
  setNewAgentRole: (value: string) => void;
  setNewAgentPrompt: (value: string) => void;
  ensureTemplateSkills: (skills: readonly TemplateSkill[]) => Promise<string[]>;
  setNewAgentSkills: React.Dispatch<React.SetStateAction<string[]>>;
  projectPath: string | null;
  loadProjectData: (path: string) => Promise<void>;
  newAgentRole: string;
  handleRoleChange: (value: string) => void;
  setNewAgentProvider: (value: string) => void;
  setNewAgentPreset: (value: string) => void;
  setNewAgentModelCustom: (value: boolean) => void;
  setNewAgentModel: (value: string) => void;
  setSkillPreview: (value: SkillPreviewResult | null) => void;
  newAgentModelCustom: boolean;
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
  setNewAgentModelCustom,
  setNewAgentModel,
  setSkillPreview,
  newAgentModelCustom,
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
  const isLocalCli = newAgentProvider === 'Local CLI';
  const modelOptions = getModelOptions(newAgentProvider, newAgentPreset);
  const isCustomModel = newAgentModel && !modelOptions.some(opt => opt.value === newAgentModel);
  return (
    <div className="focus-editor-container">
      <AgentEditorHeader
        isNew={isNew}
        agentName={editingAgent?.name || newAgentName}
        onBack={() => {
          resetAgentForm();
          setActiveTab('AI Members');
        }}
        onDelete={() => handleDeleteAgent(editingAgent?.name || newAgentName)}
        loading={loading}
      />

      <form onSubmit={handleSaveAgent} className="focus-editor-card">
        {errorMsg && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '12px 16px', borderRadius: '8px', color: '#ef4444', fontSize: '0.85rem', marginBottom: '16px' }}>
            {errorMsg}
          </div>
        )}

        {isNew && (
          <AgentTemplatePicker
            templates={agentPersonaTemplates}
            setName={setNewAgentName}
            setRole={setNewAgentRole}
            setPrompt={setNewAgentPrompt}
            ensureSkills={ensureTemplateSkills}
            setSkills={setNewAgentSkills}
            setError={setErrorMsg}
            projectPath={projectPath}
            loadProjectData={loadProjectData}
          />
        )}

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
                value={isLocalCli ? `Local CLI:${newAgentPreset}` : newAgentProvider}
                onChange={(e) => {
                  const val = e.target.value;
                  const nextIsLocal = val.startsWith('Local CLI:');
                  const preset = nextIsLocal ? val.slice('Local CLI:'.length) : 'none';
                  const provider = nextIsLocal ? 'Local CLI' : val;
                  setNewAgentProvider(provider);
                  setNewAgentPreset(preset);
                  const defaults = getModelOptions(provider, preset);
                  setNewAgentModelCustom(false);
                  setNewAgentModel(nextIsLocal ? '' : defaults[0]?.value || '');
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
                <optgroup label="API Providers">
                  {providers.map(provider => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Installed Local AI">
                  {detectedClis
                    .filter(cli => cli.available && isSafeLocalCliPreset(cli.id))
                    .map(cli => (
                    <option key={cli.id} value={`Local CLI:${cli.id}`}>
                      {cli.name}{cli.version ? ` · ${cli.version}` : ''}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>Model Name</label>
                <select 
                  value={newAgentModelCustom || isCustomModel
                    ? 'custom'
                    : newAgentModel || (isLocalCli ? '' : modelOptions[0]?.value || '')}
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
                  {isLocalCli && <option value="">CLI default model</option>}
                  {modelOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                  <option value="custom">Custom Model...</option>
                </select>
                {(newAgentModelCustom || isCustomModel || (!isLocalCli && (!newAgentModel || modelOptions.length === 0))) && (
                  <input 
                    type="text"
                    required={!isLocalCli}
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

          </div>

          <AgentSkillsPanel
            workspaceSkills={projectData?.skills || []}
            machineSkills={projectData?.machineSkills || []}
            selectedSkills={newAgentSkills}
            setSelectedSkills={setNewAgentSkills}
            setSkillPreview={setSkillPreview}
            skillPreview={skillPreview}
            handlePreviewAgentSkills={handlePreviewAgentSkills}
            editingSkillFile={editingSkillFile}
            setEditingSkillFile={setEditingSkillFile}
            loadRoomFilePreview={loadRoomFilePreview}
            editingSkillContent={editingSkillContent}
            setEditingSkillContent={setEditingSkillContent}
            editingSkillSource={editingSkillSource}
            setEditingSkillSource={setEditingSkillSource}
            handleSaveEditingSkill={handleSaveEditingSkill}
            customSkillName={customSkillName}
            setCustomSkillName={setCustomSkillName}
            customSkillDesc={customSkillDesc}
            setCustomSkillDesc={setCustomSkillDesc}
            handleAddCustomSkill={handleAddCustomSkill}
            loading={loading}
          />
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
            Sent to the model as the primary persona contract, then ROOM appends selected skills, discussion protocol, and Room context.
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
