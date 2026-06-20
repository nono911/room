import React from 'react';
import type { ProjectData, UIMessage } from '../../../types/domain.js';
import { renderMarkdownContent } from '../../../shared/lib/markdown/MarkdownContent.js';
import { ContextControl } from '../../../components/context/ContextControl.js';
import { PixelAgentStage, type PixelAgentViewMode } from '../../pixel-agents/PixelAgentStage.js';

interface DiscussionsScreenProps {
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
  const [pixelAgentViewMode, setPixelAgentViewMode] = React.useState<PixelAgentViewMode>('animated');
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
          <div className="markdown-preview" style={{ maxHeight: 'none', minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem', textAlign: 'center' }}>
            <div style={{ color: 'white', fontWeight: 700 }}>Start with a question, plan, or review request.</div>
            <div style={{ maxWidth: '520px', lineHeight: 1.45 }}>
              Add context when the answer depends on docs, tasks, or specific files. ROOM will preserve the discussion transcript, message references, and moderator-created tasks or ADRs.
            </div>
            <button type="button" className="btn-secondary" disabled={loading} onClick={() => openContextPicker('discussion')} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
              Add Context
            </button>
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

      {/* Dynamic Agent Selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px 16px', background: 'hsl(var(--bg-sidebar))', borderRadius: '12px', border: '1px solid hsl(var(--border-dim))', marginTop: '8px', marginBottom: '8px', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase', marginRight: '4px' }}>
          AI Members:
        </span>
        {(projectData?.agents || []).length === 0 ? (
          <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>No AI members registered.</span>
        ) : (
          (projectData?.agents || []).map((agent: any) => {
            const agentIndex = selectedDiscussionAgents.indexOf(agent.name);
            const isSelected = agentIndex !== -1;
            return (
              <label 
                key={agent.name} 
                className={`skill-checkbox-chip ${isSelected ? 'selected' : ''}`}
                style={{
                  fontSize: '0.75rem',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer'
                }}
              >
                <input 
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    setSelectedDiscussionAgents(prev => 
                      prev.includes(agent.name) 
                        ? prev.filter(name => name !== agent.name) 
                        : [...prev, agent.name]
                    );
                  }}
                />
                {isSelected ? (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'hsl(var(--accent-purple))',
                    color: 'white',
                    borderRadius: '50%',
                    width: '15px',
                    height: '15px',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    marginRight: '2px',
                    lineHeight: 1
                  }}>
                    {agentIndex + 1}
                  </span>
                ) : '+ '}
                {agent.name}
              </label>
            );
          })
        )}
      </div>

      {/* Workflow Sequence */}
      {selectedDiscussionAgents.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          padding: '14px 16px',
          background: 'linear-gradient(135deg, hsl(var(--bg-sidebar)) 0%, hsl(var(--bg-card)) 100%)',
          borderRadius: '12px',
          border: '1px solid hsl(var(--border-dim))',
          marginTop: '8px',
          marginBottom: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase' }}>
              Discussion Workflow Sequence (Order: 1 ➔ 2 ➔ 3):
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSelectedDiscussionAgents([])}
              style={{ padding: '3px 8px', fontSize: '0.68rem', height: 'auto', borderRadius: '4px' }}
            >
              Clear Workflow
            </button>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            marginTop: '2px'
          }}>
            {selectedDiscussionAgents.map((agentName, index) => {
              const isFirst = index === 0;
              const isLast = index === selectedDiscussionAgents.length - 1;
              return (
                <React.Fragment key={agentName}>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'hsl(var(--bg-input))',
                      border: '1px solid hsl(var(--accent-purple) / 0.3)',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      fontSize: '0.78rem',
                      color: 'white',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)'
                    }}
                  >
                    {/* Index badge */}
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      background: 'hsl(var(--accent-purple))',
                      color: 'white',
                      fontSize: '0.68rem',
                      fontWeight: 700
                    }}>
                      {index + 1}
                    </span>

                    <span style={{ fontWeight: 500 }}>{agentName}</span>

                    {/* Move controls */}
                    <div style={{ display: 'inline-flex', gap: '4px', marginLeft: '6px', borderLeft: '1px solid hsl(var(--border-dim))', paddingLeft: '6px' }}>
                      <button
                        type="button"
                        disabled={isFirst}
                        onClick={() => {
                          setSelectedDiscussionAgents(prev => {
                            const next = [...prev];
                            const temp = next[index];
                            next[index] = next[index - 1];
                            next[index - 1] = temp;
                            return next;
                          });
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: isFirst ? 'hsl(var(--text-muted) / 0.3)' : 'hsl(var(--text-secondary))',
                          cursor: isFirst ? 'default' : 'pointer',
                          padding: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem'
                        }}
                        title="Move Up/Left"
                      >
                        ◀
                      </button>
                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => {
                          setSelectedDiscussionAgents(prev => {
                            const next = [...prev];
                            const temp = next[index];
                            next[index] = next[index + 1];
                            next[index + 1] = temp;
                            return next;
                          });
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: isLast ? 'hsl(var(--text-muted) / 0.3)' : 'hsl(var(--text-secondary))',
                          cursor: isLast ? 'default' : 'pointer',
                          padding: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem'
                        }}
                        title="Move Down/Right"
                      >
                        ▶
                      </button>
                    </div>

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDiscussionAgents(prev => prev.filter(name => name !== agentName));
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'hsl(var(--text-muted))',
                        cursor: 'pointer',
                        padding: '0 2px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.75rem',
                        marginLeft: '2px'
                      }}
                      title="Remove from workflow"
                    >
                      ✕
                    </button>
                  </div>

                  {!isLast && (
                    <span style={{
                      color: 'hsl(var(--accent-purple) / 0.5)',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      userSelect: 'none'
                    }}>
                      ➔
                    </span>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

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
