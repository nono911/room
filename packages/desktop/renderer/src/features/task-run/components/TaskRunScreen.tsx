import React from 'react';
import type { ProjectData, UIMessage, TaskBoardCard } from '../../../types/domain.js';
import { renderMarkdownContent } from '../../../shared/lib/markdown/MarkdownContent.js';
import { ContextControl } from '../../../components/context/ContextControl.js';
import { PixelAgentStage, type PixelAgentViewMode } from '../../pixel-agents/PixelAgentStage.js';
import { api } from '../../../shared/ipc/client.js';
import { agentPersonaTemplates } from '../../../shared/data/staticData.js';
import { useProviders } from '../../providers/context/ProvidersContext.js';
import { resolveAgentDefaultSelection } from '../../ai-members/useAgentManagement.js';
import { createAgentInstancesFromTemplate, type AgentLifecycle } from '../../ai-members/lib/agentInstances.js';
import { AgentClonePicker } from '../../ai-members/components/AgentClonePicker.js';

interface TaskRunScreenProps {
  projectPath: string | null;
  loadProjectData: (path: string) => Promise<void>;
  ensureTemplateSkills: (skills: any) => Promise<string[]>;
  projectData: ProjectData | null;
  codingTaskMessages: UIMessage[];
  codingTaskDeveloperName: string;
  setCodingTaskDeveloperName: (value: string) => void;
  taskRunType: string;
  applyTaskTypePreset: (presetValue: string) => void;
  taskTypeOptions: Array<{ value: string; label: string }>;
  codingTaskInput: string;
  setCodingTaskInput: (value: string) => void;
  projectConfig: { allowDangerousCli?: boolean };
  enableTaskRunWriteAccess: () => void;
  codingTaskReviewerNames: string[];
  setCodingTaskReviewerNames: React.Dispatch<React.SetStateAction<string[]>>;
  temporaryTaskAgents: any[];
  setTemporaryTaskAgents: React.Dispatch<React.SetStateAction<any[]>>;
  codingTaskMaxCycles: number;
  setCodingTaskMaxCycles: (value: number) => void;
  selectedCodingTaskContextRefs: string[];
  estimateContextTokens: (target: 'discussion' | 'task') => number;
  openContextPicker: (target: 'task' | 'discussion') => void;
  setContextSelection: (target: 'task' | 'discussion', refs: string[]) => void;
  toggleContextSelection: (target: 'task' | 'discussion', ref: string) => void;
  getContextLabel: (ref: string) => string;
  handleRunCodingTask: () => void;
  lastCodingTaskResult: any;
  setLastCodingTaskResult: (value: any) => void;
  setCodingTaskMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  openRounds: Record<number, boolean>;
  setOpenRounds: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  expandedMsgKeys: Record<string, boolean>;
  setExpandedMsgKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  activeTaskRunId: string | null;
  taskInterruptMessage: string;
  setTaskInterruptMessage: (value: string) => void;
  taskInterruptPending: boolean;
  interruptActiveTaskRun: () => void;
  continueTaskRunFromPivot: () => void;
  scrollToDiscussionMessage: (messageNumber: number) => void;
  setActiveTab: (tab: string) => void;
  loadRoomFilePreview: (section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions' | 'skills', file: string) => void;
  loading: boolean;
  taskRunView: 'setup' | 'timeline' | 'artifact' | 'trace';
  setTaskRunView: (view: 'setup' | 'timeline' | 'artifact' | 'trace') => void;
  taskBoardCards?: TaskBoardCard[];
  selectedTaskCardId: string | null;
  setSelectedTaskCardId: (value: string | null) => void;
}

export const TaskRunScreen: React.FC<TaskRunScreenProps> = ({
  projectPath,
  loadProjectData,
  ensureTemplateSkills,
  projectData,
  codingTaskMessages,
  codingTaskDeveloperName,
  setCodingTaskDeveloperName,
  taskRunType,
  applyTaskTypePreset,
  taskTypeOptions,
  codingTaskInput,
  setCodingTaskInput,
  projectConfig,
  enableTaskRunWriteAccess,
  codingTaskReviewerNames,
  setCodingTaskReviewerNames,
  temporaryTaskAgents,
  setTemporaryTaskAgents,
  codingTaskMaxCycles,
  setCodingTaskMaxCycles,
  selectedCodingTaskContextRefs,
  estimateContextTokens,
  openContextPicker,
  setContextSelection,
  toggleContextSelection,
  getContextLabel,
  handleRunCodingTask,
  lastCodingTaskResult,
  setLastCodingTaskResult,
  setCodingTaskMessages,
  openRounds,
  setOpenRounds,
  expandedMsgKeys,
  setExpandedMsgKeys,
  activeTaskRunId,
  taskInterruptMessage,
  setTaskInterruptMessage,
  taskInterruptPending,
  interruptActiveTaskRun,
  continueTaskRunFromPivot,
  scrollToDiscussionMessage,
  setActiveTab,
  loadRoomFilePreview,
  loading,
  taskRunView,
  setTaskRunView,
  taskBoardCards = [],
  selectedTaskCardId,
  setSelectedTaskCardId
}) => {
  const [pixelAgentViewMode, setPixelAgentViewMode] = React.useState<PixelAgentViewMode>('classic');
  const { providers, detectedClis, getModelOptions } = useProviders();
  const [localRegistering, setLocalRegistering] = React.useState<boolean>(false);
  const registeredProjectAgents = (projectData?.agents || []).filter((agent: any) => !agent.isVirtual);
  const agents = [...registeredProjectAgents, ...temporaryTaskAgents];
  const savedTaskRuns = (projectData?.taskRuns || []).slice(0, 12);
  const taskRunMessagesByRound: Record<number, UIMessage[]> = {};
  
  codingTaskMessages.forEach(msg => {
    const r = msg.round ?? 0;
    if (!taskRunMessagesByRound[r]) {
      taskRunMessagesByRound[r] = [];
    }
    taskRunMessagesByRound[r].push(msg);
  });

  const taskRunRounds = Object.keys(taskRunMessagesByRound).map(Number).sort((a, b) => a - b);
  const selectedDoer = agents.find((agent: any) => agent.name === codingTaskDeveloperName);
  const selectedDoerNeedsWriteAccess = taskRunType === 'coding'
    && selectedDoer?.provider === 'Local CLI'
    && (selectedDoer.permissionMode !== 'dangerous' || !projectConfig.allowDangerousCli);
  const selectedTaskTypeLabel = taskTypeOptions.find(option => option.value === taskRunType)?.label || 'Custom';
  const currentRunTitle = codingTaskInput.trim() || 'Draft run';
  const canRunCodingTask = !loading && codingTaskInput.trim() && codingTaskDeveloperName && codingTaskReviewerNames.length > 0 && !selectedDoerNeedsWriteAccess;
  const taskRunPixelAgents = [codingTaskDeveloperName, ...codingTaskReviewerNames].filter(Boolean);
  const taskRunTabs: Array<{ id: 'setup' | 'timeline' | 'artifact' | 'trace'; label: string; count?: number }> = [
    { id: 'setup', label: 'Setup' },
    { id: 'timeline', label: 'Timeline', count: codingTaskMessages.length || undefined },
    { id: 'artifact', label: 'Artifact', count: lastCodingTaskResult?.artifactFilename ? 1 : undefined },
    { id: 'trace', label: 'Trace' }
  ];

  const runStatusText = loading ? 'running' : lastCodingTaskResult?.status || 'draft';
  const runStatusColor = lastCodingTaskResult?.status === 'approved'
    ? '#10b981'
    : lastCodingTaskResult
      ? 'hsl(var(--accent-orange))'
      : loading
        ? 'hsl(var(--accent-purple))'
        : 'hsl(var(--text-muted))';
  const traceMessages = Array.isArray(lastCodingTaskResult?.messages)
    ? lastCodingTaskResult.messages
    : codingTaskMessages.map(message => ({
        type: message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'agent',
        agentName: message.author,
        providerName: '',
        content: message.text,
        timestamp: message.time,
        round: message.round,
        contextMetrics: message.contextMetrics
      }));
  const latestContextMetrics = [...traceMessages]
    .reverse()
    .find((message: any) => message.contextMetrics)?.contextMetrics;
  const estimatedTraceTokens = latestContextMetrics
    ? (latestContextMetrics.estimatedHistoryTokens || 0) + (latestContextMetrics.estimatedProjectContextTokens || 0)
    : 0;
  const formatMetric = (value: unknown) => typeof value === 'number' ? value.toLocaleString() : '0';

  const handleAddTemplateAgents = async (templateName: string, count: number, lifecycle: AgentLifecycle) => {
    if (!projectPath) return;
    const template = agentPersonaTemplates.find(t => t.name === templateName);
    if (!template) return;

    setLocalRegistering(true);
    try {
      const defaults = resolveAgentDefaultSelection(providers, detectedClis, getModelOptions);
      const skillFiles = await ensureTemplateSkills(template.skills || []);
      const instances = createAgentInstancesFromTemplate({
        template,
        defaults,
        skillFiles,
        count,
        existingNames: [
          ...agents.map((agent: any) => agent.name),
          codingTaskDeveloperName,
          ...codingTaskReviewerNames
        ].filter(Boolean)
      });

      if (lifecycle === 'temporary') {
        setTemporaryTaskAgents(prev => [...prev, ...instances]);
      } else {
        for (const instance of instances) {
          const res = await api.saveAgent(projectPath, instance);
          if (!res.success) {
            alert(res.error || `Failed to save ${instance.name}.`);
            return;
          }
        }
        await loadProjectData(projectPath);
      }

      setCodingTaskReviewerNames(prev => [...prev, ...instances.map(agent => agent.name)]);
    } catch (err: any) {
      alert(err.message || 'Error occurred while adding template agents.');
    } finally {
      setLocalRegistering(false);
    }
  };

  const setupPanel = (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.05fr) minmax(280px, 0.95fr)', gap: '18px', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
            Task Type
          </label>
          <select
            className="form-select"
            value={taskRunType}
            disabled={loading}
            onChange={(e) => applyTaskTypePreset(e.target.value)}
            style={{ height: '36px', fontSize: '0.85rem' }}
          >
            {taskTypeOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {taskBoardCards.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
              Import from Task Board
            </label>
            <select
              className="form-select"
              value={selectedTaskCardId || ""}
              disabled={loading}
              onChange={(e) => {
                const cardId = e.target.value;
                setSelectedTaskCardId(cardId || null);
                const selectedCard = taskBoardCards.find(c => c.id === cardId);
                if (selectedCard) {
                  const detailsText = selectedCard.details ? `\n\nDetails:\n${selectedCard.details}` : '';
                  setCodingTaskInput(`${selectedCard.title}${detailsText}`);
                  
                  if (selectedCard.assignee) {
                    const matchedAgent = agents.find(a => a.name.toLowerCase() === selectedCard.assignee!.toLowerCase());
                    if (matchedAgent) {
                      setCodingTaskDeveloperName(matchedAgent.name);
                    }
                  }
                }
              }}
              style={{ height: '36px', fontSize: '0.85rem' }}
            >
              <option value="">-- Choose a task --</option>
              {taskBoardCards.map(card => (
                <option key={card.id} value={card.id}>
                  {card.id} ({card.status}) - {card.title} {card.assignee ? `[@${card.assignee}]` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
            Work Request
          </label>
          <textarea
            value={codingTaskInput}
            onChange={(e) => setCodingTaskInput(e.target.value)}
            disabled={loading}
            placeholder="Describe the work you want the selected AI member to produce..."
            rows={10}
            style={{
              width: '100%',
              minHeight: '220px',
              resize: 'vertical',
              backgroundColor: 'hsl(var(--bg-input))',
              border: '1px solid hsl(var(--border-dim))',
              borderRadius: '8px',
              padding: '12px 14px',
              color: 'white',
              fontFamily: 'inherit',
              outline: 'none',
              lineHeight: 1.5
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 14px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
            Doer
            <select
              className="form-select"
              value={codingTaskDeveloperName}
              disabled={loading}
              onChange={(e) => setCodingTaskDeveloperName(e.target.value)}
              style={{ height: '36px', fontSize: '0.85rem' }}
            >
              <option value="">Select Doer</option>
              {agents.map((agent: any) => (
                <option key={agent.name} value={agent.name}>{agent.name} - {agent.role}</option>
              ))}
            </select>
          </label>
          {selectedDoerNeedsWriteAccess && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', border: '1px solid hsl(var(--accent-orange) / 0.45)', borderRadius: '8px', background: 'hsl(var(--accent-orange) / 0.09)' }}>
              <span style={{ fontSize: '0.76rem', color: 'hsl(var(--text-secondary))', lineHeight: 1.4 }}>
                This Local CLI Developer needs workspace write access for coding tasks.
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={loading}
                onClick={enableTaskRunWriteAccess}
                style={{ height: '30px', padding: '0 10px', fontSize: '0.72rem', flex: '0 0 auto' }}
              >
                Allow Write
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>
                Reviewers / Leads
              </div>
              <AgentClonePicker
                compact
                disabled={loading}
                busy={localRegistering}
                onAdd={handleAddTemplateAgents}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '112px', overflowY: 'auto' }}>
              {agents.map((agent: any) => {
                const selectedIndex = codingTaskReviewerNames.indexOf(agent.name);
                const selected = selectedIndex !== -1;
                const disabled = loading || agent.name === codingTaskDeveloperName;
                return (
                  <label
                    key={agent.name}
                    className={`skill-checkbox-chip ${selected ? 'selected' : ''}`}
                    style={{ fontSize: '0.74rem', padding: '4px 10px', borderRadius: '14px', opacity: disabled && !selected ? 0.55 : 1 }}
                    title={`${agent.name} - ${agent.role}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabled}
                      onChange={() => {
                        setCodingTaskReviewerNames(prev =>
                          prev.includes(agent.name)
                            ? prev.filter(name => name !== agent.name)
                            : [...prev, agent.name]
                        );
                      }}
                    />
                    {selected ? `✓ ${selectedIndex + 1}. ` : '+ '}
                    {agent.name}
                  </label>
                );
              })}
            </div>

            {codingTaskReviewerNames.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                marginTop: '4px',
                padding: '10px',
                background: 'hsl(var(--bg-sidebar) / 0.5)',
                border: '1px solid hsl(var(--border-dim))',
                borderRadius: '8px',
              }}>
                <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  Review Sequence Order
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {codingTaskReviewerNames.map((name, index) => {
                    const agent = agents.find((a: any) => a.name === name);
                    return (
                      <div
                        key={name}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'hsl(var(--bg-sidebar))',
                          border: '1px solid hsl(var(--border-dim) / 0.8)',
                          borderRadius: '6px',
                          fontSize: '0.76rem'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            background: 'hsl(var(--accent-purple) / 0.15)',
                            border: '1px solid hsl(var(--accent-purple) / 0.35)',
                            color: 'hsl(var(--accent-purple))',
                            fontSize: '0.7rem',
                            fontWeight: 700
                          }}>
                            {index + 1}
                          </span>
                          <span style={{ fontWeight: 500 }}>{name}</span>
                          {agent?.role && (
                            <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.7rem' }}>
                              ({agent.role})
                            </span>
                          )}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={loading || index === 0}
                            onClick={() => {
                              setCodingTaskReviewerNames(prev => {
                                const next = [...prev];
                                const temp = next[index];
                                next[index] = next[index - 1];
                                next[index - 1] = temp;
                                return next;
                              });
                            }}
                            style={{
                              padding: '0 6px',
                              fontSize: '0.7rem',
                              height: '22px',
                              minWidth: '22px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px'
                            }}
                            title="Move Up"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={loading || index === codingTaskReviewerNames.length - 1}
                            onClick={() => {
                              setCodingTaskReviewerNames(prev => {
                                const next = [...prev];
                                const temp = next[index];
                                next[index] = next[index + 1];
                                next[index + 1] = temp;
                                return next;
                              });
                            }}
                            style={{
                              padding: '0 6px',
                              fontSize: '0.7rem',
                              height: '22px',
                              minWidth: '22px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px'
                            }}
                            title="Move Down"
                          >
                            ▼
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', fontSize: '0.78rem', color: 'hsl(var(--text-muted))' }}>
            Review cycles
            <select
              className="form-select"
              value={codingTaskMaxCycles}
              disabled={loading}
              onChange={(e) => setCodingTaskMaxCycles(Number(e.target.value))}
              style={{ height: '32px', minWidth: '72px', fontSize: '0.8rem', padding: '0 8px' }}
            >
              {[1, 2, 3, 4, 5].map(cycles => (
                <option key={cycles} value={cycles}>{cycles}</option>
              ))}
            </select>
          </label>
        </div>

        <ContextControl
          target="task"
          title="Task Context"
          loading={loading}
          selectedRefs={selectedCodingTaskContextRefs}
          estimateContextTokens={estimateContextTokens}
          openContextPicker={openContextPicker}
          setContextSelection={setContextSelection}
          toggleContextSelection={toggleContextSelection}
          getContextLabel={getContextLabel}
        />

        <button
          className="btn-primary"
          type="button"
          onClick={() => {
            setTaskRunView('timeline');
            handleRunCodingTask();
          }}
          disabled={!canRunCodingTask}
          style={{ height: '42px', justifyContent: 'center' }}
        >
          {loading ? 'Running Task...' : 'Run Doer -> Review Loop'}
        </button>
      </div>
    </div>
  );

  const timelinePanel = (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', paddingRight: '6px' }}>
      {codingTaskMessages.length === 0 ? (
        <div className="markdown-preview" style={{ maxHeight: 'none', height: '100%', minHeight: '420px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'hsl(var(--text-muted))', fontSize: '0.9rem', textAlign: 'center' }}>
          <div style={{ color: 'white', fontWeight: 700 }}>No task run yet.</div>
          <div style={{ maxWidth: '520px', lineHeight: 1.45 }}>
            Create a run from Setup. The timeline keeps doer output, reviewer feedback, message references, and final status together.
          </div>
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => setTaskRunView('setup')} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
            Open Setup
          </button>
        </div>
      ) : (
        taskRunRounds.map(r => {
          const msgs = taskRunMessagesByRound[r];
          const isOpen = openRounds[r] ?? false;
          const roundTitle = r === 0 ? 'Setup & Requirements' : `Cycle ${r}`;
          const roundSubtitle = r === 0
            ? 'Initial prompt and system startup'
            : (() => {
                const roundAgents = Array.from(new Set(msgs.filter(m => m.role !== 'system' && m.role !== 'user').map(m => m.author)));
                return roundAgents.length > 0 ? `Participants: ${roundAgents.join(', ')}` : 'Agent running...';
              })();

          return (
            <div
              key={r}
              style={{
                background: 'hsl(var(--bg-card) / 0.25)',
                border: '1px solid hsl(var(--border-dim))',
                borderRadius: '8px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: isOpen ? '0 4px 16px rgba(0, 0, 0, 0.2)' : 'none'
              }}
            >
              <button
                type="button"
                onClick={() => setOpenRounds(prev => ({ ...prev, [r]: !prev[r] }))}
                className="accordion-header"
                style={{
                  padding: '12px 16px',
                  background: isOpen ? 'hsl(var(--bg-sidebar))' : 'transparent',
                  border: 0,
                  borderBottom: isOpen ? '1px solid hsl(var(--border-dim))' : 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                  textAlign: 'left',
                  color: 'inherit'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: isOpen ? 'white' : 'hsl(var(--text-secondary))', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{roundTitle}</span>
                    <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: 'hsl(var(--accent-purple) / 0.15)', color: 'hsl(var(--accent-purple))', fontWeight: 600 }}>
                      {msgs.length} message{msgs.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'hsl(var(--text-muted))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {roundSubtitle}
                  </div>
                </div>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease', color: 'hsl(var(--text-muted))', flex: '0 0 auto' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {isOpen && (
                <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'hsl(var(--bg-app) / 0.2)', maxHeight: 'min(68vh, 760px)', overflowY: 'auto', overscrollBehavior: 'contain', scrollbarGutter: 'stable', paddingRight: '18px' }}>
                  {msgs.map((msg, idx) => {
                    const msgKey = `${msg.id || msg.author}-${r}-${idx}`;
                    const isLong = msg.text.length > 1200;
                    const isMsgExpanded = expandedMsgKeys[msgKey] ?? false;
                    let overlayBg = 'hsl(var(--bg-card))';
                    if (msg.role === 'system') overlayBg = 'hsl(var(--bg-app))';
                    else if (idx % 2 !== 0) overlayBg = 'hsl(var(--bg-card) / 0.7)';

                    return (
                      <div
                        key={msgKey}
                        className={`chat-bubble ${msg.role}`}
                        style={{
                          alignSelf: msg.role === 'system' ? 'center' : idx % 2 === 0 ? 'flex-start' : 'flex-end',
                          borderStyle: msg.role === 'system' ? 'dashed' : 'solid',
                          borderColor: msg.role === 'system' ? 'hsl(var(--accent-orange) / 0.5)' : undefined,
                          maxWidth: msg.role === 'system' ? '92%' : '86%',
                          display: 'flex',
                          flexDirection: 'column'
                        }}
                      >
                        <div className="bubble-meta">
                          <span className="bubble-author">{msg.author}</span>
                          <span>{msg.streaming ? 'Working...' : msg.time}</span>
                        </div>
                        <div style={{ position: 'relative', minWidth: 0 }}>
                          <div style={{ maxHeight: isLong && !isMsgExpanded ? '320px' : 'none', overflow: 'hidden', position: 'relative', transition: 'max-height 0.25s ease' }}>
                            {renderMarkdownContent(msg.text, msg.streaming, 'message-markdown', scrollToDiscussionMessage)}
                          </div>
                          {isLong && !isMsgExpanded && (
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px', background: `linear-gradient(to bottom, transparent, ${overlayBg})`, pointerEvents: 'none' }} />
                          )}
                          {isLong && (
                            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
                              <button type="button" className="btn-secondary" onClick={() => setExpandedMsgKeys(prev => ({ ...prev, [msgKey]: !isMsgExpanded }))} style={{ padding: '4px 10px', fontSize: '0.72rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {isMsgExpanded ? 'Collapse message' : `Show full output (${Math.round(msg.text.length / 100) / 10} KB)`}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  const artifactPanel = (
    <div className="markdown-preview" style={{ maxHeight: 'none', minHeight: '420px', display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
        <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Status</div>
          <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>{lastCodingTaskResult?.status || (loading ? 'running' : 'not started')}</div>
        </div>
        <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Cycles</div>
          <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>{lastCodingTaskResult?.cycles ?? taskRunRounds.filter(r => r > 0).length}</div>
        </div>
        <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Approved By</div>
          <div style={{ marginTop: '4px', color: 'white', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lastCodingTaskResult?.approvedBy?.length ? lastCodingTaskResult.approvedBy.join(', ') : 'Pending'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
        <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Artifact</div>
        <div style={{ color: 'white', fontWeight: 650, wordBreak: 'break-word' }}>
          {lastCodingTaskResult?.artifactFilename || 'No artifact has been produced yet.'}
        </div>
        {lastCodingTaskResult?.statusSummary && (
          <div style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.84rem', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {lastCodingTaskResult.statusSummary}
          </div>
        )}
      </div>

          {lastCodingTaskResult?.markdownFilename && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <button
            className="btn-secondary"
            type="button"
            disabled={loading}
            onClick={() => {
              loadRoomFilePreview('tasks', lastCodingTaskResult.markdownFilename);
              setActiveTab('Tasks');
            }}
            style={{ height: '36px', justifyContent: 'center' }}
          >
            Open Transcript
          </button>
          {lastCodingTaskResult.artifactFilename && (
            <button
              className="btn-secondary"
              type="button"
              disabled={loading}
              onClick={() => {
                loadRoomFilePreview('documents', lastCodingTaskResult.artifactFilename);
                setActiveTab('Documents');
              }}
              style={{ height: '36px', justifyContent: 'center' }}
            >
              Open Artifact
            </button>
          )}
        </div>
      )}
    </div>
  );

  const tracePanel = (
    <div className="markdown-preview" style={{ maxHeight: 'none', minHeight: '420px', display: 'grid', gridTemplateColumns: 'minmax(220px, 0.8fr) minmax(280px, 1.2fr)', gap: '14px', alignItems: 'start', overflow: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Context</div>
          <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>{selectedCodingTaskContextRefs.length} selected</div>
        </div>
        <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Messages</div>
          <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>{traceMessages.length}</div>
        </div>
        <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Prompt Budget</div>
          <div style={{ marginTop: '4px', color: 'white', fontWeight: 600 }}>
            {latestContextMetrics ? `~${estimatedTraceTokens.toLocaleString()} tokens` : 'Pending'}
          </div>
          {latestContextMetrics && (
            <div style={{ marginTop: '4px', color: 'hsl(var(--text-muted))', fontSize: '0.72rem', lineHeight: 1.4 }}>
              history {formatMetric(latestContextMetrics.estimatedHistoryTokens)}/{formatMetric(latestContextMetrics.maxHistoryTokens)} · project {formatMetric(latestContextMetrics.estimatedProjectContextTokens)}/{formatMetric(latestContextMetrics.maxProjectContextTokens)}
            </div>
          )}
        </div>
        <div style={{ padding: '10px 12px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
          <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>Output</div>
          <div style={{ marginTop: '4px', color: 'white', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lastCodingTaskResult?.artifactFilename || lastCodingTaskResult?.markdownFilename || 'Pending'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', color: 'hsl(var(--text-secondary))', lineHeight: 1.5, fontSize: '0.86rem' }}>
        <div style={{ color: 'white', fontWeight: 700 }}>Trace Timeline</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {traceMessages.map((message: any, index: number) => {
            const metrics = message.contextMetrics;
            const contextTokens = metrics ? (metrics.estimatedHistoryTokens || 0) + (metrics.estimatedProjectContextTokens || 0) : 0;
            const isInterrupt = message.type === 'user' && String(message.content || '').startsWith('Interrupt & Pivot:');
            const label = message.type === 'user'
              ? isInterrupt ? 'Human interrupt' : 'User prompt'
              : message.type === 'system'
                ? 'System'
                : `${message.agentName || 'Agent'}${message.providerName ? ` (${message.providerName})` : ''}`;
            return (
              <div key={`${label}-${index}`} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: '8px', alignItems: 'start' }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '999px', background: isInterrupt ? 'hsl(var(--accent-orange))' : message.type === 'agent' ? 'hsl(var(--accent-purple))' : 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 700 }}>
                  {index + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'white', fontWeight: 650, fontSize: '0.84rem' }}>{label}</div>
                  <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.74rem' }}>
                    {message.round !== undefined ? `Cycle ${message.round} · ` : ''}{message.timestamp || ''}
                    {metrics ? ` · context ~${contextTokens.toLocaleString()} tokens · ${metrics.includedMessageCount || 0}/${metrics.totalLogMessages || 0} messages` : ''}
                    {metrics?.summaryUsed ? ' · summary used' : ''}
                    {metrics?.omittedMessageCount > 0 ? ` · ${metrics.omittedMessageCount} omitted` : ''}
                  </div>
                </div>
              </div>
            );
          })}
          {traceMessages.length === 0 && <div style={{ color: 'hsl(var(--text-muted))' }}>No trace messages yet.</div>}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ height: '100%', minHeight: '620px', overflow: 'hidden' }}>
      <section style={{ minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 360px' }}>
            <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>
              Task Run
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', minWidth: 0, flexWrap: 'wrap' }}>
              <span className="project-badge" style={{ borderColor: runStatusColor, color: runStatusColor }}>
                {runStatusText}
              </span>
              <span style={{ fontSize: '0.82rem', color: 'white', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'min(520px, 70vw)' }}>
                {currentRunTitle}
              </span>
              <span style={{ fontSize: '0.76rem', color: 'hsl(var(--text-muted))' }}>
                {selectedTaskTypeLabel} · {selectedDoer?.name || 'No doer'} · {codingTaskMessages.length} msgs · {codingTaskReviewerNames.length} reviewers
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {savedTaskRuns.length > 0 && (
              <button
                className="btn-secondary"
                type="button"
                disabled={loading}
                onClick={() => setActiveTab('Tasks')}
                style={{ height: '34px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flex: '0 0 auto' }}
              >
                Task Archive
              </button>
            )}
            {lastCodingTaskResult?.markdownFilename && (
              <button
                className="btn-secondary"
                type="button"
                disabled={loading}
                onClick={() => {
                  loadRoomFilePreview('tasks', lastCodingTaskResult.markdownFilename);
                  setActiveTab('Tasks');
                }}
                style={{ height: '34px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flex: '0 0 auto' }}
              >
              Transcript
            </button>
          )}
          {lastCodingTaskResult?.status === 'interrupted' && (
            <button
              className="btn-secondary"
              type="button"
              disabled={loading}
              onClick={continueTaskRunFromPivot}
              style={{ height: '34px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flex: '0 0 auto', borderColor: 'hsl(var(--accent-orange) / 0.55)' }}
            >
              Continue from Pivot
            </button>
          )}
          <button
              className="btn-primary"
              type="button"
              disabled={loading}
              onClick={() => {
                setTaskRunView('setup');
                setCodingTaskMessages([]);
                setLastCodingTaskResult(null);
                setOpenRounds({});
                setTemporaryTaskAgents([]);
                setCodingTaskReviewerNames(prev => prev.filter(name => registeredProjectAgents.some((agent: any) => agent.name === name)));
                if (!registeredProjectAgents.some((agent: any) => agent.name === codingTaskDeveloperName)) {
                  setCodingTaskDeveloperName('');
                }
              }}
              style={{ height: '34px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flex: '0 0 auto' }}
            >
              New Run
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid hsl(var(--border-dim))', flex: '0 0 auto' }}>
          {taskRunTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTaskRunView(tab.id)}
              style={{
                height: '36px',
                padding: '0 12px',
                border: 0,
                borderBottom: taskRunView === tab.id ? '2px solid hsl(var(--accent-purple))' : '2px solid transparent',
                background: 'transparent',
                color: taskRunView === tab.id ? 'white' : 'hsl(var(--text-muted))',
                fontWeight: 700,
                fontSize: '0.78rem',
                cursor: 'pointer'
              }}
            >
              {tab.label}{tab.count ? ` ${tab.count}` : ''}
            </button>
          ))}
        </div>

        <PixelAgentStage
          title="Task run office"
          agents={agents}
          selectedAgentNames={taskRunPixelAgents}
          messages={codingTaskMessages}
          loading={loading}
          activeRunId={activeTaskRunId}
          compact={taskRunView !== 'timeline'}
          fill={taskRunView === 'timeline' && pixelAgentViewMode === 'animated'}
          viewMode={pixelAgentViewMode}
          onViewModeChange={setPixelAgentViewMode}
        />

        {loading && activeTaskRunId && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center', padding: '10px 12px', background: 'hsl(var(--accent-orange) / 0.08)', border: '1px solid hsl(var(--accent-orange) / 0.38)', borderRadius: '8px', flex: '0 0 auto' }}>
            <input
              type="text"
              value={taskInterruptMessage}
              onChange={(e) => setTaskInterruptMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && taskInterruptMessage.trim() && !taskInterruptPending) {
                  interruptActiveTaskRun();
                }
              }}
              disabled={taskInterruptPending}
              placeholder="Interrupt & Pivot: tell the Doer what to change after the current agent finishes..."
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
              disabled={taskInterruptPending || !taskInterruptMessage.trim()}
              onClick={interruptActiveTaskRun}
              style={{ padding: '9px 12px', fontSize: '0.78rem', borderColor: 'hsl(var(--accent-orange) / 0.55)' }}
            >
              {taskInterruptPending ? 'Interrupting...' : 'Interrupt & Pivot'}
            </button>
          </div>
        )}

        {!(taskRunView === 'timeline' && pixelAgentViewMode === 'animated') && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: taskRunView === 'timeline' ? 'hidden' : 'auto' }}>
            {taskRunView === 'setup' && setupPanel}
            {taskRunView === 'timeline' && timelinePanel}
            {taskRunView === 'artifact' && artifactPanel}
            {taskRunView === 'trace' && tracePanel}
          </div>
        )}
      </section>
    </div>
  );
};
