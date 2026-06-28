import React from 'react';
import type { ProjectData, UIMessage } from '../../../types/domain.js';
import { renderMarkdownContent } from '../../../shared/lib/markdown/MarkdownContent.js';
import { ContextControl } from '../../../components/context/ContextControl.js';
import { PixelAgentStage, type PixelAgentViewMode } from '../../pixel-agents/PixelAgentStage.js';
import { api } from '../../../shared/ipc/client.js';
import { agentPersonaTemplates, teamPresets } from '../../../shared/data/staticData.js';
import { useProviders } from '../../providers/context/ProvidersContext.js';
import { resolveAgentDefaultSelection } from '../../ai-members/useAgentManagement.js';

interface DiscussionsScreenProps {
  projectPath: string | null;
  loadProjectData: (path: string) => Promise<void>;
  ensureTemplateSkills: (skills: any) => Promise<string[]>;
  projectData: ProjectData | null;
  activeDiscussionId: string | null;
  summarizeActiveDiscussion: () => void;
  startNewDiscussion: () => void;
  loading: boolean;
  loadDiscussionSession: (file: string) => void;
  discussionMessages: UIMessage[];
  openContextPicker: (target: 'task' | 'discussion') => void;
  highlightedDiscussionMessage: number | null;
  scrollToDiscussionMessage: (messageNumber: number) => void;
  loadRoomFilePreview: (section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions' | 'skills', file: string) => void;
  setActiveTab: (tab: string) => void;
  selectedDiscussionContextRefs: string[];
  estimateContextTokens: (target: 'discussion' | 'task') => number;
  setContextSelection: (target: 'task' | 'discussion', refs: string[]) => void;
  toggleContextSelection: (target: 'task' | 'discussion', ref: string) => void;
  getContextLabel: (ref: string) => string;
  selectedDiscussionAgents: string[];
  setSelectedDiscussionAgents: React.Dispatch<React.SetStateAction<string[]>>;
  discussionReviewMode: boolean;
  setDiscussionReviewMode: React.Dispatch<React.SetStateAction<boolean>>;
  discussionMaxRounds: number;
  setDiscussionMaxRounds: (value: number) => void;
  discussionQualityGate: boolean;
  setDiscussionQualityGate: React.Dispatch<React.SetStateAction<boolean>>;
  discussionModeratorName: string;
  setDiscussionModeratorName: (value: string) => void;
  discussionAutoSummary: boolean;
  setDiscussionAutoSummary: React.Dispatch<React.SetStateAction<boolean>>;
  discussionSummaryAgentName: string;
  setDiscussionSummaryAgentName: (value: string) => void;
  projectConfig: { mainAgent: string };
  userInputTopic: string;
  setUserInputTopic: (value: string) => void;
  activeDiscussionRunId: string | null;
  discussionInterruptMessage: string;
  setDiscussionInterruptMessage: (value: string) => void;
  discussionInterruptPending: boolean;
  interruptActiveDiscussion: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSendDiscussion: () => void;
  lastDiscussionLog: any;
  saveDiscussionOutput: (target: 'documents' | 'tasks') => void;
  generateTasksFromActiveDiscussion: () => void;
  continueActiveDiscussionFromPivot: () => void;
  showInspector: boolean;
  setShowInspector: React.Dispatch<React.SetStateAction<boolean>>;
}

const getDiscussionIdFromFile = (filename: string) => filename.replace(/\.(md|json)$/i, '');

const getSavedDocumentFilename = (text: string): string | null => {
  const match = text.match(/saved to Documents:\s*([^\n]+?\.md)\s*$/i);
  return match?.[1]?.trim() || null;
};

export const DiscussionsScreen: React.FC<DiscussionsScreenProps> = ({
  projectPath,
  loadProjectData,
  ensureTemplateSkills,
  projectData,
  activeDiscussionId,
  summarizeActiveDiscussion,
  startNewDiscussion,
  loading,
  loadDiscussionSession,
  discussionMessages,
  openContextPicker,
  highlightedDiscussionMessage,
  scrollToDiscussionMessage,
  loadRoomFilePreview,
  setActiveTab,
  selectedDiscussionContextRefs,
  estimateContextTokens,
  setContextSelection,
  toggleContextSelection,
  getContextLabel,
  selectedDiscussionAgents,
  setSelectedDiscussionAgents,
  discussionReviewMode,
  setDiscussionReviewMode,
  discussionMaxRounds,
  setDiscussionMaxRounds,
  discussionQualityGate,
  setDiscussionQualityGate,
  discussionModeratorName,
  setDiscussionModeratorName,
  discussionAutoSummary,
  setDiscussionAutoSummary,
  discussionSummaryAgentName,
  setDiscussionSummaryAgentName,
  projectConfig,
  userInputTopic,
  setUserInputTopic,
  activeDiscussionRunId,
  discussionInterruptMessage,
  setDiscussionInterruptMessage,
  discussionInterruptPending,
  interruptActiveDiscussion,
  handleKeyDown,
  handleSendDiscussion,
  lastDiscussionLog,
  saveDiscussionOutput,
  generateTasksFromActiveDiscussion,
  continueActiveDiscussionFromPivot,
  showInspector,
  setShowInspector
}) => {
  const [pixelAgentViewMode, setPixelAgentViewMode] = React.useState<PixelAgentViewMode>('classic');
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const { providers, detectedClis, getModelOptions } = useProviders();
  const [localRegistering, setLocalRegistering] = React.useState<boolean>(false);
  const [showAddTemplateDropdown, setShowAddTemplateDropdown] = React.useState<boolean>(false);
  const [selectedTemplateName, setSelectedTemplateName] = React.useState<string>('');

  const handleRegisterTemplateAgent = async (template: any) => {
    if (!projectPath) return;
    setLocalRegistering(true);
    try {
      const defaults = resolveAgentDefaultSelection(providers, detectedClis, getModelOptions);

      const skillFiles = await ensureTemplateSkills(template.skills || []);

      const res = await api.saveAgent(projectPath, {
        name: template.name,
        role: template.role,
        provider: defaults.provider,
        modelName: defaults.modelName || undefined,
        systemPrompt: template.prompt,
        skills: skillFiles,
        cliPreset: defaults.provider === 'Local CLI' ? defaults.cliPreset : undefined,
        permissionMode: defaults.provider === 'Local CLI' ? 'safe' : undefined
      });

      if (res.success) {
        await loadProjectData(projectPath);
        setSelectedDiscussionAgents(prev => [...prev, template.name]);
      } else {
        alert(res.error || 'Failed to auto-register template agent.');
      }
    } catch (err: any) {
      alert(err.message || 'Error occurred while auto-registering template agent.');
    } finally {
      setLocalRegistering(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', String(index));
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIdx = Number(e.dataTransfer.getData('text/plain'));
    if (isNaN(sourceIdx) || sourceIdx === targetIndex) return;

    setSelectedDiscussionAgents(prev => {
      const next = [...prev];
      const [removed] = next.splice(sourceIdx, 1);
      next.splice(targetIndex, 0, removed);
      return next;
    });
    setDraggedIndex(null);
  };

  const getAlignment = (role: string, idx: number) => {
    if (role === 'system') return 'center';
    if (role.includes('architect')) return 'flex-start';
    if (role.includes('reviewer')) return 'flex-end';
    return idx % 2 === 0 ? 'flex-start' : 'flex-end';
  };

  const discussionFiles = (projectData?.discussions || [])
    .filter(file => {
      try {
        return file.toLowerCase().endsWith('.md');
      } catch (err: any) {
        console.error("CRITICAL ERROR inside filter for file:", file, "type:", typeof file, "error:", err);
        return false;
      }
    })
    .sort((a, b) => b.localeCompare(a));
  const activeDiscussionFile = discussionFiles.find(file => getDiscussionIdFromFile(file) === activeDiscussionId) || '';

  const openDocumentFromBubble = async (filename: string) => {
    await loadRoomFilePreview('documents', filename);
    setActiveTab('Documents');
  };

  const formatMetric = (value: unknown) => typeof value === 'number' ? value.toLocaleString() : '0';
  const getTraceLabel = (message: any) => {
    if (message.type === 'user') {
      return String(message.content || '').startsWith('Interrupt & Pivot:') ? 'Human interrupt' : 'User prompt';
    }
    return `${message.agentName} response`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) auto', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
        <select
          value={activeDiscussionFile}
          onChange={(e) => {
            if (e.target.value) loadDiscussionSession(e.target.value);
          }}
          disabled={loading || discussionFiles.length === 0}
          title={activeDiscussionId ? `Continuing ${activeDiscussionId}` : 'New chat'}
          style={{
            minWidth: 0,
            height: '34px',
            backgroundColor: 'hsl(var(--bg-input))',
            border: '1px solid hsl(var(--border-dim))',
            borderRadius: '6px',
            padding: '0 10px',
            color: activeDiscussionFile ? 'white' : 'hsl(var(--text-muted))',
            fontFamily: 'inherit',
            fontSize: '0.76rem',
            outline: 'none'
          }}
        >
          <option value="">{discussionFiles.length === 0 ? 'No saved chats yet' : 'New chat'}</option>
          {discussionFiles.map(file => (
            <option key={file} value={file}>{file}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn-secondary" type="button" onClick={summarizeActiveDiscussion} disabled={loading || !activeDiscussionId} style={{ padding: '7px 12px', fontSize: '0.78rem' }}>
            Summarize Chat
          </button>
          <button className="btn-secondary" type="button" onClick={startNewDiscussion} disabled={loading} style={{ padding: '7px 12px', fontSize: '0.78rem' }}>
            New Chat
          </button>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <PixelAgentStage
          title="Discussion room"
          agents={projectData?.agents || []}
          selectedAgentNames={selectedDiscussionAgents}
          messages={discussionMessages}
          loading={loading}
          activeRunId={activeDiscussionRunId}
          fill={pixelAgentViewMode === 'animated'}
          viewMode={pixelAgentViewMode}
          onViewModeChange={setPixelAgentViewMode}
        />

        {pixelAgentViewMode === 'classic' && discussionMessages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', background: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '12px', minHeight: '350px' }}>
            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
              <h3 style={{ color: 'white', fontSize: '1.1rem', fontWeight: 700, marginBottom: '6px' }}>Choose a Workspace Template & Suggest Experts</h3>
              <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.8rem', maxWidth: '580px', margin: '0 auto', lineHeight: 1.45 }}>
                Select what type of project or analysis you are doing. ROOM will automatically configure the workflow with recommended AI specialists.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
              {teamPresets.map(preset => {
                const isSelected = preset.roles.every(role => selectedDiscussionAgents.includes(role)) && selectedDiscussionAgents.length === preset.roles.length;
                return (
                  <div
                    key={preset.name}
                    onClick={async () => {
                      if (loading) return;
                      // Auto-register any unregistered agents in the preset
                      const registeredAgents = projectData?.agents || [];
                      const nextSelected: string[] = [];

                      for (const roleName of preset.roles) {
                        const alreadyRegistered = registeredAgents.find((a: any) => a.name.toLowerCase() === roleName.toLowerCase());
                        if (alreadyRegistered) {
                          nextSelected.push(alreadyRegistered.name);
                        } else {
                          const tmpl = agentPersonaTemplates.find(t => t.name.toLowerCase() === roleName.toLowerCase());
                          if (tmpl) {
                            // Register it
                            try {
                              const defaults = resolveAgentDefaultSelection(providers, detectedClis, getModelOptions);
                              const skillFiles = await ensureTemplateSkills(tmpl.skills || []);

                              if (projectPath) {
                                const res = await api.saveAgent(projectPath, {
                                  name: tmpl.name,
                                  role: tmpl.role,
                                  provider: defaults.provider,
                                  modelName: defaults.modelName || undefined,
                                  systemPrompt: tmpl.prompt,
                                  skills: skillFiles,
                                  cliPreset: defaults.provider === 'Local CLI' ? defaults.cliPreset : undefined,
                                  permissionMode: defaults.provider === 'Local CLI' ? 'safe' : undefined
                                });
                                if (res.success) {
                                  nextSelected.push(tmpl.name);
                                }
                              }
                            } catch (err) {
                              console.error("Failed to auto-provision preset agent:", err);
                            }
                          }
                        }
                      }
                      if (projectPath) {
                        await loadProjectData(projectPath);
                      }
                      setSelectedDiscussionAgents(nextSelected);
                    }}
                    style={{
                      padding: '14px',
                      borderRadius: '8px',
                      background: isSelected ? 'hsl(var(--accent-purple) / 0.12)' : 'hsl(var(--bg-input))',
                      border: isSelected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                      cursor: 'pointer',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      userSelect: 'none'
                    }}
                    className="preset-suggest-card"
                  >
                    <div style={{ color: 'white', fontSize: '0.85rem', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{preset.name}</span>
                      {isSelected && <span style={{ color: 'hsl(var(--accent-purple))', fontSize: '0.7rem' }}>● Active</span>}
                    </div>
                    <div style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.72rem', lineHeight: 1.35 }}>
                      {preset.description}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                      {preset.roles.map(r => (
                        <span key={r} style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'hsl(var(--bg-sidebar))', color: 'hsl(var(--text-muted))', border: '1px solid hsl(var(--border-dim))' }}>
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px', gap: '12px' }}>
              <button type="button" className="btn-secondary" disabled={loading} onClick={() => openContextPicker('discussion')} style={{ padding: '8px 16px', fontSize: '0.78rem' }}>
                Add Custom Context Files
              </button>
            </div>
          </div>
        )}

        {pixelAgentViewMode === 'classic' && discussionMessages.length > 0 && discussionMessages.map((msg, idx) => {
          const alignment = getAlignment(msg.role, idx);
          const savedDocumentFilename = msg.role === 'system' ? getSavedDocumentFilename(msg.text) : null;
          return (
            <div
              key={idx}
              id={`discussion-message-${idx + 1}`}
              className={`chat-bubble ${msg.role}`}
              style={{
                alignSelf: alignment,
                borderStyle: msg.role === 'system' ? 'dashed' : 'solid',
                borderColor: highlightedDiscussionMessage === idx + 1
                  ? 'hsl(var(--accent-blue))'
                  : msg.role === 'system'
                    ? 'hsl(var(--accent-orange) / 0.5)'
                    : undefined,
                boxShadow: highlightedDiscussionMessage === idx + 1 ? '0 0 0 2px hsl(var(--accent-blue) / 0.24)' : undefined,
                maxWidth: msg.role === 'system' ? '90%' : '80%',
                scrollMarginBlock: '80px'
              }}
            >
              <div className="bubble-meta">
                <span className="bubble-author">{msg.author}</span>
                <span>{msg.streaming ? 'Working...' : msg.time}</span>
              </div>
              {renderMarkdownContent(msg.text, msg.streaming, 'message-markdown', scrollToDiscussionMessage)}
              {savedDocumentFilename && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={loading}
                    onClick={() => openDocumentFromBubble(savedDocumentFilename)}
                    style={{ padding: '5px 10px', fontSize: '0.72rem', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                  >
                    Open Document
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '24px' }}>
        <ContextControl
          target="discussion"
          title="Context Picker"
          loading={loading}
          selectedRefs={selectedDiscussionContextRefs}
          estimateContextTokens={estimateContextTokens}
          openContextPicker={openContextPicker}
          setContextSelection={setContextSelection}
          toggleContextSelection={toggleContextSelection}
          getContextLabel={getContextLabel}
        />
      </div>

      {/* Dynamic Agent Selector with Drag & Drop Reordering */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px 16px', background: 'hsl(var(--bg-sidebar))', borderRadius: '12px', border: '1px solid hsl(var(--border-dim))', marginTop: '8px', marginBottom: '8px', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase', marginRight: '4px' }}>
          AI Members:
        </span>
        {(projectData?.agents || []).length === 0 ? (
          <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>No AI members registered.</span>
        ) : (
          <>
            {/* 1. Selected & Draggable Agents */}
            {selectedDiscussionAgents.map((agentName, index) => {
              const agent = (projectData?.agents || []).find((a: any) => a.name === agentName);
              if (!agent) return null;
              return (
                <div
                  key={agent.name}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={() => setDraggedIndex(null)}
                  className="skill-checkbox-chip selected"
                  style={{
                    fontSize: '0.75rem',
                    padding: '4px 12px',
                    borderRadius: '16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'grab',
                    opacity: draggedIndex === index ? 0.5 : 1,
                    border: '1px solid hsl(var(--accent-purple) / 0.5)',
                    background: 'hsl(var(--bg-input))',
                    userSelect: 'none',
                    transition: 'all 0.15s ease'
                  }}
                  title="Drag to reorder workflow sequence"
                >
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'hsl(var(--accent-purple))',
                    color: 'white',
                    borderRadius: '50%',
                    width: '16px',
                    height: '16px',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    lineHeight: 1
                  }}>
                    {index + 1}
                  </span>
                  <span style={{ fontWeight: 500, color: 'white' }}>{agent.name}</span>
                  <span 
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDiscussionAgents(prev => prev.filter(name => name !== agent.name));
                    }}
                    style={{
                      cursor: 'pointer',
                      marginLeft: '4px',
                      color: 'hsl(var(--text-muted))',
                      fontSize: '0.85rem',
                      lineHeight: 1,
                      fontWeight: 'bold'
                    }}
                    title="Deselect member"
                  >
                    ×
                  </span>
                </div>
              );
            })}

            {/* 2a. Registered but Unselected Agents */}
            {(projectData?.agents || [])
              .filter((agent: any) => !selectedDiscussionAgents.includes(agent.name))
              .map((agent: any) => (
                <div 
                  key={agent.name} 
                  className="skill-checkbox-chip"
                  onClick={() => {
                    setSelectedDiscussionAgents(prev => [...prev, agent.name]);
                  }}
                  style={{
                    fontSize: '0.75rem',
                    padding: '4px 12px',
                    borderRadius: '16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                    border: '1px dashed hsl(var(--border-dim))',
                    background: 'transparent',
                    userSelect: 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ color: 'hsl(var(--text-muted))' }}>+</span>
                  <span style={{ color: 'hsl(var(--text-secondary))' }}>{agent.name}</span>
                </div>
              ))}

            {/* 2b. Add Template Dropdown */}
            {(() => {
              const unregisteredTemplates = agentPersonaTemplates.filter(
                tmpl => !(projectData?.agents || []).some((a: any) => a.name.toLowerCase() === tmpl.name.toLowerCase())
              );
              if (unregisteredTemplates.length === 0) return null;
              return (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  {showAddTemplateDropdown ? (
                    <>
                      <select
                        value={selectedTemplateName}
                        onChange={(e) => setSelectedTemplateName(e.target.value)}
                        className="form-select"
                        style={{
                          fontSize: '0.75rem',
                          height: '28px',
                          padding: '0 8px',
                          borderRadius: '6px',
                          backgroundColor: 'hsl(var(--bg-input))',
                          border: '1px solid hsl(var(--border-dim))',
                          color: 'white',
                          outline: 'none'
                        }}
                      >
                        <option value="">-- Select Expert --</option>
                        {unregisteredTemplates.map(tmpl => (
                          <option key={tmpl.name} value={tmpl.name}>
                            {tmpl.name} ({tmpl.role})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={!selectedTemplateName || localRegistering}
                        onClick={() => {
                          const tmpl = unregisteredTemplates.find(t => t.name === selectedTemplateName);
                          if (tmpl) {
                            handleRegisterTemplateAgent(tmpl).then(() => {
                              setSelectedTemplateName('');
                              setShowAddTemplateDropdown(false);
                            });
                          }
                        }}
                        style={{
                          padding: '0 10px',
                          fontSize: '0.72rem',
                          height: '28px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer'
                        }}
                      >
                        {localRegistering ? 'Adding...' : 'Add'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setSelectedTemplateName('');
                          setShowAddTemplateDropdown(false);
                        }}
                        style={{
                          padding: '0 8px',
                          fontSize: '0.72rem',
                          height: '28px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddTemplateDropdown(true);
                        if (unregisteredTemplates.length > 0) {
                          setSelectedTemplateName(unregisteredTemplates[0].name);
                        }
                      }}
                      style={{
                        fontSize: '0.72rem',
                        padding: '4px 10px',
                        borderRadius: '16px',
                        border: '1px dotted hsl(var(--accent-purple) / 0.5)',
                        background: 'hsl(var(--accent-purple) / 0.08)',
                        color: 'hsl(var(--text-secondary))',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                        userSelect: 'none'
                      }}
                      title="Add a pre-built AI expert role to this discussion"
                    >
                      <span>+ Expert</span>
                    </button>
                  )}
                </div>
              );
            })()}

            {/* 3. Clear button if any selected */}
            {selectedDiscussionAgents.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedDiscussionAgents([])}
                style={{
                  padding: '3px 8px',
                  fontSize: '0.68rem',
                  height: 'auto',
                  borderRadius: '4px',
                  marginLeft: 'auto'
                }}
              >
                Clear Workflow
              </button>
            )}
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '10px 16px', background: 'hsl(var(--bg-input))', borderRadius: '8px', border: '1px solid hsl(var(--border-dim))', marginBottom: '8px', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={discussionReviewMode}
            disabled={loading}
            onChange={(e) => setDiscussionReviewMode(e.target.checked)}
          />
          Resolve over rounds
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
          Max rounds
          <select
            className="form-select"
            value={discussionMaxRounds}
            disabled={loading || !discussionReviewMode}
            onChange={(e) => setDiscussionMaxRounds(Number(e.target.value))}
            style={{ height: '30px', minWidth: '72px', fontSize: '0.78rem', padding: '0 8px' }}
          >
            {[2, 4, 6, 8, 10].map(rounds => (
              <option key={rounds} value={rounds}>{rounds}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={discussionQualityGate}
            disabled={loading}
            onChange={(e) => setDiscussionQualityGate(e.target.checked)}
          />
          Quality Gate
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
          Moderator
          <select
            className="form-select"
            value={discussionModeratorName}
            disabled={loading || !discussionQualityGate}
            onChange={(e) => setDiscussionModeratorName(e.target.value)}
            style={{ height: '30px', minWidth: '150px', fontSize: '0.78rem', padding: '0 8px' }}
          >
            <option value="">Auto-pick</option>
            {(projectData?.agents || []).map((agent: any) => (
              <option key={agent.name} value={agent.name}>{agent.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={discussionAutoSummary}
            disabled={loading}
            onChange={(e) => setDiscussionAutoSummary(e.target.checked)}
          />
          Auto Summary
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
          Summary agent
          <select
            className="form-select"
            value={discussionSummaryAgentName}
            disabled={loading}
            onChange={(e) => setDiscussionSummaryAgentName(e.target.value)}
            style={{ height: '30px', minWidth: '180px', fontSize: '0.78rem', padding: '0 8px' }}
          >
            <option value="__project__">
              {projectConfig.mainAgent && projectConfig.mainAgent !== 'none'
                ? `Project settings: ${projectConfig.mainAgent}`
                : 'Project settings'}
            </option>
            {(projectData?.agents || []).map((agent: any) => (
              <option key={agent.name} value={agent.name}>{agent.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <input
          type="text"
          value={userInputTopic}
          onChange={(e) => setUserInputTopic(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          placeholder="Ask selected agents to discuss an idea, plan, script, research question, or implementation..."
          style={{
            flex: 1,
            backgroundColor: 'hsl(var(--bg-input))',
            border: '1px solid hsl(var(--border-dim))',
            borderRadius: '8px',
            padding: '12px 16px',
            color: 'white',
            fontFamily: 'inherit',
            outline: 'none'
          }}
        />
        <button className="btn-primary" onClick={handleSendDiscussion} disabled={loading} style={{ padding: '12px 24px' }}>
          {loading ? 'Running...' : 'Send'}
        </button>
      </div>

      {loading && activeDiscussionRunId && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center', marginTop: '10px', padding: '10px 12px', background: 'hsl(var(--accent-orange) / 0.08)', border: '1px solid hsl(var(--accent-orange) / 0.38)', borderRadius: '8px' }}>
          <input
            type="text"
            value={discussionInterruptMessage}
            onChange={(e) => setDiscussionInterruptMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && discussionInterruptMessage.trim() && !discussionInterruptPending) {
                interruptActiveDiscussion();
              }
            }}
            disabled={discussionInterruptPending}
            placeholder="Interrupt & Pivot: tell the room what to change after the current agent finishes..."
            style={{
              minWidth: 0,
              backgroundColor: 'hsl(var(--bg-input))',
              border: '1px solid hsl(var(--border-dim))',
              borderRadius: '6px',
              padding: '9px 12px',
              color: 'white',
              fontFamily: 'inherit',
              outline: 'none'
            }}
          />
          <button
            className="btn-secondary"
            type="button"
            disabled={discussionInterruptPending || !discussionInterruptMessage.trim()}
            onClick={interruptActiveDiscussion}
            style={{ padding: '9px 12px', fontSize: '0.78rem', borderColor: 'hsl(var(--accent-orange) / 0.55)' }}
          >
            {discussionInterruptPending ? 'Interrupting...' : 'Interrupt & Pivot'}
          </button>
        </div>
      )}

      {lastDiscussionLog && !loading && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'flex-end', marginTop: '12px' }}>
          <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', marginRight: '4px' }}>
            Extract outputs
          </span>
          <button className="btn-secondary" type="button" onClick={() => saveDiscussionOutput('documents')} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
            Save Summary to Documents
          </button>
          <button className="btn-secondary" type="button" onClick={() => saveDiscussionOutput('tasks')} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
            Create Task Note
          </button>
          <button className="btn-secondary" type="button" onClick={generateTasksFromActiveDiscussion} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
            Generate Tasks (AI)
          </button>
          {lastDiscussionLog.status === 'interrupted' && (
            <button className="btn-secondary" type="button" onClick={continueActiveDiscussionFromPivot} style={{ padding: '8px 12px', fontSize: '0.78rem', borderColor: 'hsl(var(--accent-orange) / 0.55)' }}>
              Continue from Pivot
            </button>
          )}
          <button className="btn-secondary" type="button" onClick={() => setShowInspector(prev => !prev)} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
            {showInspector ? 'Hide Inspector' : 'Inspector'}
          </button>
        </div>
      )}

      {showInspector && lastDiscussionLog && !loading && (
        <div style={{ marginTop: '12px', background: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '14px 16px', maxHeight: '320px', overflowY: 'auto' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
            Discussion Inspector — context and trace
          </div>
          {(lastDiscussionLog.messages || []).map((message: any, index: number) => {
            const metrics = message.contextMetrics;
            const estimatedTokens = metrics
              ? (metrics.estimatedHistoryTokens || 0) + (metrics.estimatedProjectContextTokens || 0)
              : 0;
            if (message.type === 'user') {
              return (
                <div key={index} style={{ fontSize: '0.85rem', fontWeight: 600, padding: '5px 0' }}>
                  {index + 1}. {getTraceLabel(message)}
                </div>
              );
            }
            const refs = Array.isArray(message.references) ? message.references : [];
            const contextCount = Array.isArray(message.contextMessages) ? message.contextMessages.length : 0;
            return (
              <div key={index} style={{ marginLeft: '14px', padding: '4px 0' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {index + 1}. {message.agentName} ({message.providerName})
                </div>
                {metrics && (
                  <div style={{ marginLeft: '14px', display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px', fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>
                    <span>~{estimatedTokens.toLocaleString()} tokens</span>
                    <span>history {formatMetric(metrics.estimatedHistoryTokens)}/{formatMetric(metrics.maxHistoryTokens)}</span>
                    <span>project {formatMetric(metrics.estimatedProjectContextTokens)}/{formatMetric(metrics.maxProjectContextTokens)}</span>
                    <span>{metrics.includedMessageCount || contextCount}/{metrics.totalLogMessages || contextCount} messages</span>
                    {metrics.omittedMessageCount > 0 && <span>{metrics.omittedMessageCount} omitted</span>}
                    {metrics.summaryUsed && <span>summary used</span>}
                    {metrics.projectContextTrimmed && <span>project trimmed</span>}
                  </div>
                )}
                {refs.length > 0 ? (
                  refs.map((ref: any, refIndex: number) => (
                    <div key={refIndex} style={{ marginLeft: '14px', fontSize: '0.8rem', color: 'hsl(var(--text-secondary))' }}>
                      ↳ used {ref.author}{ref.reason ? ` — ${ref.reason}` : ''}
                    </div>
                  ))
                ) : (
                  <div style={{ marginLeft: '14px', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                    ↳ no explicit references recorded ({contextCount} context message{contextCount === 1 ? '' : 's'} received)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
