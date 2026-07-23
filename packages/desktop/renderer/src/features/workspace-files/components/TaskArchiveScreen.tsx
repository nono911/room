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
  setActiveTab: (tab: string) => void;
  setCodingTaskInput: (value: string) => void;
  setSelectedTaskCardId: (value: string | null) => void;
  setSelectedCodingTaskContextRefs: (value: string[]) => void;
  setContinuedFromTaskId: (value: string | null) => void;
}

export const TaskArchiveScreen: React.FC<TaskArchiveScreenProps> = ({
  projectPath,
  projectData,
  taskBoardCards,
  initialSelectedFile,
  setInitialSelectedFile,
  setErrorMsg,
  setActiveTab,
  setCodingTaskInput,
  setSelectedTaskCardId,
  setSelectedCodingTaskContextRefs,
  setContinuedFromTaskId
}) => {
  const [selectedTaskFile, setSelectedTaskFile] = useState<string | null>(null);
  const [selectedTaskCardId, setSelectedTaskCardIdLocal] = useState<string | null>(null);
  const [selectedTaskContent, setSelectedTaskContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setSelectedTaskFile(null);
    setSelectedTaskCardId(null);
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
    setSelectedTaskCardIdLocal(null);
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

  const handleCardClick = (card: TaskBoardCard) => {
    setSelectedTaskFile(null);
    setSelectedTaskCardIdLocal(card.id);

    const assigneeText = card.assignee ? `\n- **Assignee**: \`${card.assignee}\`` : '';
    const parentText = card.parentId ? `\n- **Parent Task**: ${card.parentId}` : '';
    const discText = card.sourceDiscussionId ? `\n- **Source Discussion**: [${card.sourceDiscussionId}](file://discussions/${card.sourceDiscussionId}.md)` : '';
    const detailsText = card.details ? `\n\n### Details\n${card.details}` : '\n\n*No additional details.*';

    const md = `# Task Card: ${card.id}\n\n## ${card.title}\n\n- **Status**: \`${card.status.toUpperCase()}\`\n- **Kind**: \`${card.kind.toUpperCase()}\`\n- **Created At**: ${card.createdAt ? new Date(card.createdAt).toLocaleString() : 'N/A'}${assigneeText}${parentText}${discText}${detailsText}`;
    
    setSelectedTaskContent(md);
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
              const renderCard = (card: TaskBoardCard, depth: number): React.ReactNode => {
                const isSelected = selectedTaskCardId === card.id;
                return (
                  <div
                    key={card.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCardClick(card);
                    }}
                    style={{
                      marginLeft: depth > 0 ? '14px' : '0px',
                      fontSize: '0.82rem',
                      padding: '6px 8px',
                      cursor: 'pointer',
                      borderRadius: '6px',
                      backgroundColor: isSelected ? 'hsl(var(--accent-purple) / 0.15)' : 'transparent',
                      border: isSelected ? '1px solid hsl(var(--accent-purple) / 0.4)' : '1px solid transparent',
                      marginTop: '2px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ color: 'hsl(var(--text-muted))' }}>{card.status === 'done' ? '☑' : '☐'} </span>
                    <span style={{ color: 'hsl(var(--accent-purple))', fontWeight: 650 }}>{card.id}</span>
                    <span style={{ color: 'hsl(var(--text-muted))' }}> ({card.kind}) </span>
                    {card.title}
                    {card.assignee && (
                      <span style={{
                        fontSize: '0.72rem',
                        color: 'hsl(var(--accent-orange))',
                        background: 'hsl(var(--accent-orange) / 0.1)',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        marginLeft: '8px',
                        border: '1px solid hsl(var(--accent-orange) / 0.2)',
                        display: 'inline-block',
                        lineHeight: 1.2
                      }}>
                        @{card.assignee}
                      </span>
                    )}
                    {childrenOf.get(card.id)?.map(child => renderCard(child, depth + 1))}
                  </div>
                );
              };
              return roots.map(card => renderCard(card, 0));
            })()}
          </div>
        )}
        <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>
          Task notes and task run transcripts stored in this ROOM Home workspace.
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
                    const filename = typeof taskRun === 'string' ? taskRun : taskRun.filename;
                    const id = typeof taskRun === 'string' ? taskRun.replace(/\.md$/i, '') : taskRun.id;
                    const title = typeof taskRun === 'string' ? taskRun : taskRun.title;
                    const status = typeof taskRun === 'string' ? 'unknown' : taskRun.status;
                    const associatedCardId = typeof taskRun === 'string' ? '' : taskRun.associatedCardId;
                    const selected = selectedTaskFile === filename;

                    const getStatusColor = (statusVal: string) => {
                      switch (statusVal) {
                        case 'approved': return 'hsl(var(--accent-green))';
                        case 'needs_revision': return 'hsl(var(--accent-orange))';
                        case 'interrupted': return 'hsl(var(--text-muted))';
                        case 'blocked': return 'hsl(var(--accent-red))';
                        default: return 'hsl(var(--accent-purple))';
                      }
                    };

                    return (
                      <button
                        key={filename}
                        type="button"
                        onClick={() => loadTaskContent(filename)}
                        disabled={loading}
                        style={{
                          background: 'hsl(var(--bg-sidebar))',
                          border: selected ? '1px solid hsl(var(--accent-blue))' : '1px solid hsl(var(--border-dim))',
                          borderRadius: '8px',
                          padding: '12px 14px',
                          cursor: 'pointer',
                          color: 'inherit',
                          textAlign: 'left',
                          font: 'inherit',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '8px' }}>
                          <span style={{ fontSize: '0.74rem', color: 'hsl(var(--text-muted))', fontWeight: 650 }}>
                            {id} {associatedCardId && `• ${associatedCardId}`}
                          </span>
                          <span style={{
                            fontSize: '0.64rem',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: `1px solid ${getStatusColor(status)}`,
                            color: getStatusColor(status),
                            textTransform: 'uppercase',
                            lineHeight: 1
                          }}>
                            {status === 'needs_revision' ? 'revision' : status}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.3 }}>
                          {title}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="markdown-preview" style={{ maxHeight: 'none', height: '520px', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {selectedTaskCardId && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid hsl(var(--border-dim))', paddingBottom: '10px' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                const card = taskBoardCards.find(c => c.id === selectedTaskCardId);
                if (card) {
                  const detailsText = card.details ? `\n\nDetails:\n${card.details}` : '';
                  setSelectedTaskCardId(card.id);
                  setCodingTaskInput(`${card.title}${detailsText}`);
                  setActiveTab('Task Run');
                }
              }}
              style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            >
              Run Task →
            </button>
          </div>
        )}
        {(() => {
          if (!selectedTaskFile) return null;

          const selectedRunMeta = typeof selectedTaskFile === 'string'
            ? taskRuns.find((run) => (typeof run === 'string' ? run : run.filename) === selectedTaskFile)
            : null;
          const associatedCardId = selectedRunMeta && typeof selectedRunMeta !== 'string' ? selectedRunMeta.associatedCardId : null;
          const associatedCard = associatedCardId ? taskBoardCards.find(c => c.id === associatedCardId) : null;
          const taskIdStr = selectedTaskFile.replace(/\.md$/i, '');

          return (
            <div style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '6px',
              padding: '10px 14px',
              fontSize: '0.85rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flex: '0 0 auto'
            }}>
              <div>
                <span style={{ color: 'hsl(var(--text-muted))', marginRight: '6px' }}>Run Transcript:</span>
                <strong style={{ color: 'white' }}>{taskIdStr}</strong>
                {associatedCardId && <span style={{ color: 'hsl(var(--text-muted))', marginLeft: '6px' }}>— Linked: {associatedCardId}</span>}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {associatedCard && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleCardClick(associatedCard)}
                    style={{ fontSize: '0.75rem', padding: '4px 10px', height: 'auto', display: 'inline-flex', alignItems: 'center' }}
                  >
                    View Card
                  </button>
                )}
                 <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const artifactFile = selectedTaskFile.replace(/\.md$/i, '') + '-artifact.md';
                    setSelectedCodingTaskContextRefs([
                      'workspace:overview',
                      'workspace:structure',
                      `task:${artifactFile}`
                    ]);
                    if (associatedCardId) {
                      setSelectedTaskCardId(associatedCardId);
                    } else {
                      setSelectedTaskCardId(null);
                    }
                    setContinuedFromTaskId(taskIdStr);

                    // Extract the last reviewer's section from the transcript to prepopulate feedback
                    const lastReviewIndex = selectedTaskContent.lastIndexOf('## Reviewer');
                    let reviewerFeedback = '';
                    if (lastReviewIndex !== -1) {
                      reviewerFeedback = selectedTaskContent.substring(lastReviewIndex).trim();
                      // Strip potential markdown link wrappers
                      reviewerFeedback = reviewerFeedback.replace(/```markdown[\s\S]*?```/g, '').trim();
                    }

                    const feedbackHeader = reviewerFeedback 
                      ? `Here is the reviewer feedback to address:\n\n${reviewerFeedback}\n\n`
                      : '';

                    setCodingTaskInput(`Please revise and continue the work from ${taskIdStr}.\n\n${feedbackHeader}New instructions/feedback:\n\n`);
                    setActiveTab('Task Run');
                  }}
                  style={{ fontSize: '0.75rem', padding: '4px 10px', height: 'auto', display: 'inline-flex', alignItems: 'center' }}
                >
                  Revise/Continue Task →
                </button>
              </div>
            </div>
          );
        })()}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {renderMarkdownContent(selectedTaskContent || (hasTaskFiles ? '# Select a task file to preview.' : '# No task files found.'), false, 'message-markdown')}
        </div>
      </div>
    </div>
  );
};
