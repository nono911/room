import React, { useState, useEffect } from 'react';
import type { ProjectData, TaskBoardCard } from '../../../types/domain.js';
import { renderMarkdownContent } from '../../../shared/lib/markdown/MarkdownContent.js';
import { api } from '../../../shared/ipc/client.js';

interface TaskArchiveScreenProps {
  projectPath: string | null;
  projectData: ProjectData | null;
  taskBoardCards: TaskBoardCard[];
  initialSelectedFile: { section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null;
  setInitialSelectedFile: (val: { section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null) => void;
  setErrorMsg: (value: string | null) => void;
}

export const TaskArchiveScreen: React.FC<TaskArchiveScreenProps> = ({
  projectPath,
  projectData,
  taskBoardCards,
  initialSelectedFile,
  setInitialSelectedFile,
  setErrorMsg
}) => {
  const [selectedTaskFile, setSelectedTaskFile] = useState<string | null>(null);
  const [selectedTaskContent, setSelectedTaskContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setSelectedTaskFile(null);
    setSelectedTaskContent('');
  }, [projectPath]);

  useEffect(() => {
    if (initialSelectedFile && initialSelectedFile.section === 'tasks') {
      loadTaskContent(initialSelectedFile.file);
      setInitialSelectedFile(null);
    }
  }, [initialSelectedFile]);

  const loadTaskContent = async (file: string) => {
    if (!projectPath || !file) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.readRoomFile(projectPath, 'tasks', file);
      if (res.success) {
        setSelectedTaskFile(file);
        setSelectedTaskContent(res.content || '');
      } else {
        setErrorMsg(res.error || `Failed to load ${file}`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to load ${file}`);
    } finally {
      setLoading(false);
    }
  };

  const tasks = projectData?.tasks || [];
  const taskRuns = projectData?.taskRuns || [];
  const hasTaskFiles = tasks.length > 0 || taskRuns.length > 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '24px', minHeight: '520px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {taskBoardCards.length > 0 && (
          <div style={{ background: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '14px 16px' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
              Task Board
            </div>
            {(() => {
              const knownIds = new Set(taskBoardCards.map(card => card.id));
              const childrenOf = new Map<string, TaskBoardCard[]>();
              const roots: TaskBoardCard[] = [];
              for (const card of taskBoardCards) {
                if (card.parentId && knownIds.has(card.parentId)) {
                  const list = childrenOf.get(card.parentId) || [];
                  list.push(card);
                  childrenOf.set(card.parentId, list);
                } else {
                  roots.push(card);
                }
              }
              const renderCard = (card: TaskBoardCard, depth: number): React.ReactNode => (
                <div key={card.id} style={{ marginLeft: depth > 0 ? '14px' : '0px', fontSize: '0.82rem', padding: '2px 0' }}>
                  <span style={{ color: 'hsl(var(--text-muted))' }}>{card.status === 'done' ? '☑' : '☐'} </span>
                  <span style={{ color: 'hsl(var(--accent-purple))', fontWeight: 600 }}>{card.id}</span>
                  <span style={{ color: 'hsl(var(--text-muted))' }}> ({card.kind}) </span>
                  {card.title}
                  {childrenOf.get(card.id)?.map(child => renderCard(child, depth + 1))}
                </div>
              );
              return roots.map(card => renderCard(card, 0));
            })()}
          </div>
        )}
        <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
          Task notes and task run transcripts stored under <code>.room/tasks/</code>.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {!hasTaskFiles ? (
            <div style={{ padding: '20px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>No task files found.</div>
          ) : (
            <>
              {tasks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'hsl(var(--text-muted))' }}>
                    Task Notes
                  </div>
                  {tasks.map((task) => {
                    const selected = selectedTaskFile === task;
                    return (
                      <button
                        key={task}
                        type="button"
                        onClick={() => loadTaskContent(task)}
                        disabled={loading}
                        style={{
                          background: 'hsl(var(--bg-card))',
                          border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                          borderRadius: '8px',
                          padding: '14px 16px',
                          cursor: 'pointer',
                          color: 'inherit',
                          textAlign: 'left',
                          font: 'inherit'
                        }}
                      >
                        {task}
                      </button>
                    );
                  })}
                </div>
              )}
              {taskRuns.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'hsl(var(--text-muted))' }}>
                    Run Transcripts
                  </div>
                  {taskRuns.map((taskRun) => {
                    const selected = selectedTaskFile === taskRun;
                    return (
                      <button
                        key={taskRun}
                        type="button"
                        onClick={() => loadTaskContent(taskRun)}
                        disabled={loading}
                        style={{
                          background: 'hsl(var(--bg-sidebar))',
                          border: selected ? '1px solid hsl(var(--accent-blue))' : '1px solid hsl(var(--border-dim))',
                          borderRadius: '8px',
                          padding: '14px 16px',
                          cursor: 'pointer',
                          color: 'inherit',
                          textAlign: 'left',
                          font: 'inherit'
                        }}
                      >
                        {taskRun}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="markdown-preview" style={{ maxHeight: 'none', height: '520px', fontSize: '0.9rem' }}>
        {renderMarkdownContent(selectedTaskContent || (hasTaskFiles ? '# Select a task file to preview.' : '# No task files found.'), false, 'message-markdown')}
      </div>
    </div>
  );
};
