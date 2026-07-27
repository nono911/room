import React from 'react';
import type { TemplateSkill } from '../../../types/domain.js';

interface AgentEditorHeaderProps {
  isNew: boolean;
  agentName: string;
  onBack: () => void;
  onDelete: () => void;
  loading: boolean;
}

export interface AgentTemplateOption {
  name: string;
  role: string;
  prompt: string;
  skills: readonly TemplateSkill[];
}

interface AgentTemplatePickerProps {
  templates: AgentTemplateOption[];
  setName: (value: string) => void;
  setRole: (value: string) => void;
  setPrompt: (value: string) => void;
  ensureSkills: (skills: readonly TemplateSkill[]) => Promise<string[]>;
  setSkills: React.Dispatch<React.SetStateAction<string[]>>;
  setError: (value: string | null) => void;
  projectPath: string | null;
  loadProjectData: (path: string) => Promise<void>;
}

export const AgentEditorHeader: React.FC<AgentEditorHeaderProps> = ({
  isNew,
  agentName,
  onBack,
  onDelete,
  loading
}) => (
  <div className="focus-editor-header">
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <button
          type="button"
          onClick={onBack}
          style={{ color: 'hsl(var(--accent-purple))', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', border: 0, background: 'transparent', padding: 0 }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to AI Members
        </button>
      </div>
      <h2 className="focus-editor-title">
        {isNew ? 'Register New AI Agent' : `Edit Agent: ${agentName}`}
      </h2>
    </div>
    {!isNew && (
      <button
        type="button"
        className="btn-secondary"
        onClick={onDelete}
        disabled={loading}
        style={{ borderColor: '#ef4444', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 16px' }}
      >
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete Agent
      </button>
    )}
  </div>
);

export const AgentTemplatePicker: React.FC<AgentTemplatePickerProps> = ({
  templates,
  setName,
  setRole,
  setPrompt,
  ensureSkills,
  setSkills,
  setError,
  projectPath,
  loadProjectData
}) => (
  <div style={{ background: 'hsl(var(--bg-input))', border: '1px dashed hsl(var(--border-dim))', borderRadius: '8px', padding: '16px 20px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      ⚡ Quick Load Template
    </span>
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
      {templates.map(template => (
        <button
          key={template.name}
          type="button"
          className="btn-secondary"
          style={{ fontSize: '0.8rem', padding: '6px 14px', height: 'auto', borderRadius: '6px' }}
          onClick={async () => {
            setName(template.name);
            setRole(template.role);
            setPrompt(template.prompt);
            setError(null);
            try {
              setSkills(await ensureSkills(template.skills));
              if (projectPath) await loadProjectData(projectPath);
            } catch (error: unknown) {
              setError(error instanceof Error ? error.message : 'Failed to create template skills.');
            }
          }}
        >
          {template.name}
        </button>
      ))}
    </div>
    <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
      Templates fill role, persona, and Room skills. Installed machine skills remain manually selected.
    </span>
  </div>
);
