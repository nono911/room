import React, { useState, useEffect } from 'react';
import type { ProjectData } from '../../../types/domain.js';
import { api } from '../../../shared/ipc/client.js';

interface ContextScreenProps {
  projectPath: string | null;
  projectData: ProjectData | null;
  loadWorkspaceCoreData: (pathStr: string) => Promise<any>;
  setErrorMsg: (value: string | null) => void;
}

export const ContextScreen: React.FC<ContextScreenProps> = ({
  projectPath,
  projectData,
  loadWorkspaceCoreData,
  setErrorMsg
}) => {
  const [contextOverviewDraft, setContextOverviewDraft] = useState<string>('');
  const [contextStructureDraft, setContextStructureDraft] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setContextOverviewDraft(projectData?.projectMd || '');
    setContextStructureDraft(projectData?.archMd || '');
  }, [projectData]);

  const saveContextDrafts = async () => {
    if (!projectPath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const overviewRes = await api.saveContextFile(projectPath, 'overview.md', contextOverviewDraft);
      if (!overviewRes.success) {
        setErrorMsg(overviewRes.error || 'Failed to save workspace overview.');
        return;
      }

      const structureRes = await api.saveContextFile(projectPath, 'structure.md', contextStructureDraft);
      if (!structureRes.success) {
        setErrorMsg(structureRes.error || 'Failed to save workspace structure.');
        return;
      }

      await loadWorkspaceCoreData(projectPath);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save workspace context.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', minHeight: '560px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center' }}>
        <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
          Workspace context and structure stored under <code>.room/context/</code>. These are included by the Discuss Context Picker.
        </div>
        <button
          className="btn-primary"
          type="button"
          onClick={saveContextDrafts}
          disabled={loading || !projectPath}
          style={{ padding: '9px 16px', whiteSpace: 'nowrap' }}
        >
          {loading ? 'Saving...' : 'Save Context'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', minHeight: 0 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
            Overview
          </span>
          <textarea
            value={contextOverviewDraft}
            onChange={(e) => setContextOverviewDraft(e.target.value)}
            disabled={loading}
            placeholder="Describe the project, goals, source material, constraints, and open questions..."
            style={{
              height: '520px',
              resize: 'vertical',
              backgroundColor: 'hsl(var(--bg-input))',
              border: '1px solid hsl(var(--border-dim))',
              borderRadius: '8px',
              padding: '14px 16px',
              color: 'white',
              fontFamily: 'inherit',
              lineHeight: 1.6,
              outline: 'none'
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
            Structure
          </span>
          <textarea
            value={contextStructureDraft}
            onChange={(e) => setContextStructureDraft(e.target.value)}
            disabled={loading}
            placeholder="Describe key areas, documents, characters, systems, constraints, or how this workspace is organized..."
            style={{
              height: '520px',
              resize: 'vertical',
              backgroundColor: 'hsl(var(--bg-input))',
              border: '1px solid hsl(var(--border-dim))',
              borderRadius: '8px',
              padding: '14px 16px',
              color: 'white',
              fontFamily: 'inherit',
              lineHeight: 1.6,
              outline: 'none'
            }}
          />
        </label>
      </div>
    </div>
  );
};
