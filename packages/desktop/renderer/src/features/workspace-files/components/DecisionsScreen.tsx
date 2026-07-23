import React, { useState, useEffect } from 'react';
import type { ProjectData } from '../../../types/domain.js';
import { renderMarkdownContent } from '../../../shared/lib/markdown/MarkdownContent.js';
import { api } from '../../../shared/ipc/client.js';

interface DecisionsScreenProps {
  projectPath: string | null;
  projectData: ProjectData | null;
  initialSelectedFile: { section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null;
  setInitialSelectedFile: (val: { section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null) => void;
  setErrorMsg: (value: string | null) => void;
}

export const DecisionsScreen: React.FC<DecisionsScreenProps> = ({
  projectPath,
  projectData,
  initialSelectedFile,
  setInitialSelectedFile,
  setErrorMsg
}) => {
  const [selectedDecisionFile, setSelectedDecisionFile] = useState<string | null>(null);
  const [selectedDecisionContent, setSelectedDecisionContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setSelectedDecisionFile(null);
    setSelectedDecisionContent('');
  }, [projectPath]);

  useEffect(() => {
    if (initialSelectedFile && initialSelectedFile.section === 'decisions') {
      loadDecisionContent(initialSelectedFile.file);
      setInitialSelectedFile(null);
    }
  }, [initialSelectedFile]);

  const loadDecisionContent = async (file: string) => {
    if (!projectPath || !file) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.readRoomFile(projectPath, 'decisions', file);
      if (res.success) {
        setSelectedDecisionFile(file);
        setSelectedDecisionContent(res.content || '');
      } else {
        setErrorMsg(res.error || `Failed to load ${file}`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to load ${file}`);
    } finally {
      setLoading(false);
    }
  };

  const decisions = projectData?.decisions || [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px', minHeight: '520px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
          Decision records stored in this ROOM Home workspace.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {decisions.length === 0 ? (
            <div style={{ padding: '20px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>No decision records found.</div>
          ) : (
            decisions.map((dec) => {
              const selected = selectedDecisionFile === dec;
              return (
                <button
                  key={dec}
                  type="button"
                  onClick={() => loadDecisionContent(dec)}
                  disabled={loading}
                  style={{
                    background: 'hsl(var(--bg-card))',
                    border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    padding: '16px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: 'inherit',
                    textAlign: 'left',
                    font: 'inherit'
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{dec}</span>
                  <span style={{ color: 'hsl(var(--accent-purple))', fontSize: '0.8rem', fontWeight: 600 }}>Preview ADR</span>
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className="markdown-preview" style={{ maxHeight: 'none', height: '520px', fontSize: '0.9rem' }}>
        {renderMarkdownContent(selectedDecisionContent || (decisions.length > 0 ? '# Select an ADR to preview.' : '# No decision records found.'), false, 'message-markdown')}
      </div>
    </div>
  );
};
