import React from 'react';
import type { ProjectData, UIMessage } from '../../../types/domain.js';
import { renderMarkdownContent } from '../../../shared/lib/markdown/MarkdownContent.js';
import { ContextControl } from '../../../components/context/ContextControl.js';

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
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSendDiscussion: () => void;
  lastDiscussionLog: any;
  saveDiscussionOutput: (target: 'documents' | 'tasks') => void;
  generateTasksFromActiveDiscussion: () => void;
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
  handleKeyDown,
  handleSendDiscussion,
  lastDiscussionLog,
  saveDiscussionOutput,
  generateTasksFromActiveDiscussion,
  showInspector,
  setShowInspector
}) => {
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

  const openDocumentFromBubble = async (filename: string) => {
    await loadRoomFilePreview('documents', filename);
    setActiveTab('Documents');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 16px', background: 'hsl(var(--bg-sidebar))', borderRadius: '12px', border: '1px solid hsl(var(--border-dim))', marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>
              Chat History
            </div>
            <div style={{ fontSize: '0.76rem', color: 'hsl(var(--text-secondary))', marginTop: '3px' }}>
              {activeDiscussionId ? `Continuing ${activeDiscussionId}` : 'New chat'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn-secondary" type="button" onClick={summarizeActiveDiscussion} disabled={loading || !activeDiscussionId} style={{ padding: '7px 12px', fontSize: '0.78rem' }}>
              Summarize Chat
            </button>
            <button className="btn-secondary" type="button" onClick={startNewDiscussion} disabled={loading} style={{ padding: '7px 12px', fontSize: '0.78rem' }}>
              New Chat
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '74px', overflowY: 'auto' }}>
          {discussionFiles.length === 0 ? (
            <span style={{ fontSize: '0.76rem', color: 'hsl(var(--text-muted))' }}>No saved chats yet.</span>
          ) : (
            discussionFiles.slice(0, 12).map(file => {
              const discussionId = getDiscussionIdFromFile(file);
              const selected = activeDiscussionId === discussionId;
              return (
                <button
                  key={file}
                  type="button"
                  className="btn-secondary"
                  disabled={loading}
                  onClick={() => loadDiscussionSession(file)}
                  title={file}
                  style={{
                    padding: '5px 10px',
                    fontSize: '0.72rem',
                    height: 'auto',
                    borderRadius: '14px',
                    maxWidth: '240px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    borderColor: selected ? 'hsl(var(--accent-purple))' : undefined,
                    background: selected ? 'hsl(var(--accent-purple) / 0.14)' : undefined
                  }}
                >
                  {selected ? '✓ ' : ''}
                  {file}
                </button>
              );
            })
          )}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {discussionMessages.length === 0 ? (
          <div className="markdown-preview" style={{ maxHeight: 'none', minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem', textAlign: 'center' }}>
            <div style={{ color: 'white', fontWeight: 700 }}>Start with a question, plan, or review request.</div>
            <div style={{ maxWidth: '520px', lineHeight: 1.45 }}>
              Add context when the answer depends on docs, tasks, or specific files. ROOM will preserve the discussion transcript, message references, and moderator-created tasks or ADRs.
            </div>
            <button type="button" className="btn-secondary" disabled={loading} onClick={() => openContextPicker('discussion')} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
              Add Context
            </button>
          </div>
        ) : discussionMessages.map((msg, idx) => {
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
            const isSelected = selectedDiscussionAgents.includes(agent.name);
            return (
              <label 
                key={agent.name} 
                className={`skill-checkbox-chip ${isSelected ? 'selected' : ''}`}
                style={{ fontSize: '0.75rem', padding: '4px 12px', borderRadius: '16px' }}
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
                {isSelected ? '✓ ' : '+ '}
                {agent.name}
              </label>
            );
          })
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
          <button className="btn-secondary" type="button" onClick={() => setShowInspector(prev => !prev)} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
            {showInspector ? 'Hide Inspector' : 'Inspector'}
          </button>
        </div>
      )}

      {showInspector && lastDiscussionLog && !loading && (
        <div style={{ marginTop: '12px', background: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '14px 16px', maxHeight: '320px', overflowY: 'auto' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'hsl(var(--text-muted))', marginBottom: '8px' }}>
            Discussion Inspector — who used what
          </div>
          {(lastDiscussionLog.messages || []).map((message: any, index: number) => {
            if (message.type === 'user') {
              return (
                <div key={index} style={{ fontSize: '0.85rem', fontWeight: 600, padding: '4px 0' }}>
                  ● {message.agentName} (user)
                </div>
              );
            }
            const refs = Array.isArray(message.references) ? message.references : [];
            const contextCount = Array.isArray(message.contextMessages) ? message.contextMessages.length : 0;
            return (
              <div key={index} style={{ marginLeft: '14px', padding: '4px 0' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  {message.agentName} ({message.providerName})
                </div>
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
