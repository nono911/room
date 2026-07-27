import React, { useState, useEffect } from 'react';
import type { ProjectData } from '../../../types/domain.js';
import { renderMarkdownContent } from '../../../shared/lib/markdown/MarkdownContent.js';
import { api } from '../../../shared/ipc/client.js';

interface DocumentsScreenProps {
  projectPath: string | null;
  projectData: ProjectData | null;
  initialSelectedFile: { section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null;
  setInitialSelectedFile: (val: { section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null) => void;
  setErrorMsg: (value: string | null) => void;
}

export const DocumentsScreen: React.FC<DocumentsScreenProps> = ({
  projectPath,
  projectData,
  initialSelectedFile,
  setInitialSelectedFile,
  setErrorMsg
}) => {
  const [selectedReviewFile, setSelectedReviewFile] = useState<string | null>(null);
  const [selectedReviewSection, setSelectedReviewSection] = useState<'documents' | 'reviews' | 'discussions' | null>(null);
  const [selectedReviewContent, setSelectedReviewContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<'documents' | 'reviews' | 'discussions'>('documents');

  useEffect(() => {
    setSelectedReviewFile(null);
    setSelectedReviewSection(null);
    setSelectedReviewContent('');
    setActiveSection('documents');
  }, [projectPath]);

  const loadReviewContent = async (section: 'documents' | 'reviews' | 'discussions', file: string) => {
    if (!projectPath || !file) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.readRoomFile(projectPath, section, file);
      if (res.success) {
        setSelectedReviewFile(file);
        setSelectedReviewSection(section);
        setSelectedReviewContent(res.content || '');
      } else {
        setErrorMsg(res.error || `Failed to load ${file}`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to load ${file}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialSelectedFile) {
      if (initialSelectedFile.section === 'documents' || initialSelectedFile.section === 'reviews' || initialSelectedFile.section === 'discussions') {
        setActiveSection(initialSelectedFile.section);
        loadReviewContent(initialSelectedFile.section, initialSelectedFile.file);
      }
      setInitialSelectedFile(null);
    }
  }, [initialSelectedFile]);

  const documentFiles = projectData?.documents || [];
  const reviewFiles = projectData?.reviews || [];
  const discussionFiles = (projectData?.discussions || []).filter(file => file.toLowerCase().endsWith('.md'));
  const filesBySection = {
    documents: documentFiles,
    reviews: reviewFiles,
    discussions: discussionFiles
  };
  const items = filesBySection[activeSection].map(file => ({ section: activeSection, file }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px', minHeight: '520px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
          Durable documents, reviews, and discussion transcripts stored in this Room.
        </div>
        <div className="document-section-tabs">
          {(['documents', 'reviews', 'discussions'] as const).map(section => (
            <button
              type="button"
              key={section}
              className={activeSection === section ? 'active' : ''}
              onClick={() => {
                setActiveSection(section);
                setSelectedReviewFile(null);
                setSelectedReviewContent('');
              }}
            >
              <span>{section}</span>
              <small>{filesBySection[section].length}</small>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {items.length === 0 ? (
            <div style={{ padding: '20px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>No {activeSection} found yet.</div>
          ) : (
            items.map(({ section, file }) => {
              const selected = selectedReviewFile === file && selectedReviewSection === section;
              return (
                <button
                  key={`${section}:${file}`}
                  type="button"
                  onClick={() => loadReviewContent(section, file)}
                  disabled={loading}
                  style={{
                    background: 'hsl(var(--bg-card))',
                    border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    padding: '14px 16px',
                    cursor: 'pointer',
                    color: 'inherit',
                    textAlign: 'left',
                    font: 'inherit',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                >
                  <span>{file}</span>
                  <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.75rem' }}>{section}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
      <div className="markdown-preview" style={{ maxHeight: 'none', height: '520px', fontSize: '0.9rem' }}>
        {renderMarkdownContent(selectedReviewContent || (items.length > 0 ? `# Select ${activeSection.slice(0, -1)} to preview.` : `# No ${activeSection} found.`), false, 'message-markdown')}
      </div>
    </div>
  );
};
