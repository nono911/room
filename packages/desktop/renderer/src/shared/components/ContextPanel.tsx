import React from 'react';
import type { ProjectData } from '../../types/domain.js';

interface ContextPanelProps {
  projectData: ProjectData | null;
  setActiveTab: (tab: string) => void;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({
  projectData,
  setActiveTab
}) => {
  return (
    <section className="context-panel" style={{ width: '340px', flexShrink: 0 }}>
      <div className="panel-header">
        <span>Room Context</span>
        <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>

      {projectData ? (
        <>
          <div className="panel-section">
            <div className="panel-section-title">Room Overview</div>
            <div className="markdown-preview">
              {projectData.projectMd || '# No description found.'}
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-section-title">Context Structure</div>
            <div className="markdown-preview">
              {projectData.archMd || '# No architecture specifications.'}
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-section-title">Legacy Decisions</div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {projectData.decisions.length === 0 ? (
                <li style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))' }}>No decisions registered yet.</li>
              ) : (
                projectData.decisions.map((dec) => (
                  <li key={dec} style={{
                    fontSize: '0.85rem',
                    background: 'hsl(var(--bg-card))',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid hsl(var(--border-dim))'
                  }}>
                    {dec}
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="panel-section">
            <div className="panel-section-title">AI Members ({(projectData.agents || []).length})</div>
            <div className="skills-list">
              {(projectData.agents || []).map((agent: any) => (
                <span key={agent.name} className="skill-tag" onClick={() => setActiveTab('AI Members')}>
                  {agent.name}
                </span>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{ padding: '24px', textAlign: 'center', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>
          Open your Room to view context metrics here.
        </div>
      )}
    </section>
  );
};
