import { useState, useEffect } from 'react';
import type { UIMessage, ProjectData } from '../../types/domain.js';
import { api } from '../../shared/ipc/client.js';
import {
  formatAgentDisplayName,
  formatDiscussionLogMessages,
  getAgentProgressMessage,
  advanceAgentProgressMessage
} from '../../shared/lib/streaming.js';
import {
  taskParticipantEntries,
  taskParticipantName
} from './taskParticipantRefs.js';

interface UseTaskRunDeps {
  projectPath: string | null;
  activeSourceId?: string;
  projectData: ProjectData | null;
  loadProjectData: (pathStr: string) => Promise<void>;
  setLoading: (value: boolean) => void;
  setErrorMsg: (value: string | null) => void;
}

/**
 * Task Run feature state + streaming orchestration.
 * Extracted from App.tsx (Phase E). Behavior-preserving: uses functional
 * setState updates and unsubscribes the discussion-event listener in finally.
 */
export function useTaskRun({ projectPath, activeSourceId, projectData, loadProjectData, setLoading, setErrorMsg }: UseTaskRunDeps) {
  const [codingTaskInput, setCodingTaskInput] = useState<string>('');
  const [taskRunType, setTaskRunType] = useState<string>('general');
  const [codingTaskMessages, setCodingTaskMessages] = useState<UIMessage[]>([]);
  const [codingTaskDeveloperName, setCodingTaskDeveloperName] = useState<string>('');
  const [codingTaskReviewerNames, setCodingTaskReviewerNames] = useState<string[]>([]);
  const [codingTaskMaxCycles, setCodingTaskMaxCycles] = useState<number>(2);
  const [selectedCodingTaskContextRefs, setSelectedCodingTaskContextRefs] = useState<string[]>([]);
  const [lastCodingTaskResult, setLastCodingTaskResult] = useState<any | null>(null);
  const [taskRunView, setTaskRunView] = useState<'setup' | 'timeline' | 'artifact' | 'trace'>('setup');
  const [openRounds, setOpenRounds] = useState<Record<number, boolean>>({});
  const [expandedMsgKeys, setExpandedMsgKeys] = useState<Record<string, boolean>>({});
  const [lastMaxRound, setLastMaxRound] = useState<number>(-1);
  const [activeTaskRunId, setActiveTaskRunId] = useState<string | null>(null);
  const [taskInterruptMessage, setTaskInterruptMessage] = useState<string>('');
  const [taskInterruptPending, setTaskInterruptPending] = useState<boolean>(false);
  const [selectedTaskCardId, setSelectedTaskCardId] = useState<string | null>(null);
  const [continuedFromTaskId, setContinuedFromTaskId] = useState<string | null>(null);
  const [temporaryTaskAgents, setTemporaryTaskAgents] = useState<any[]>([]);
  const persistedTaskAgents = (projectData?.agents || []).filter((agent: any) => !agent.isVirtual);
  const taskParticipants = taskParticipantEntries(persistedTaskAgents, temporaryTaskAgents);
  const selectedDoerName = taskParticipantName(codingTaskDeveloperName, taskParticipants);
  const selectedReviewerNames = codingTaskReviewerNames.map(
    reference => taskParticipantName(reference, taskParticipants)
  );

  // Auto-expand the newest cycle when a new one starts
  const maxRound = codingTaskMessages.length > 0 ? Math.max(...codingTaskMessages.map(m => m.round ?? 0)) : 0;
  useEffect(() => {
    if (maxRound > lastMaxRound) {
      setOpenRounds(prev => ({ ...prev, [maxRound]: true }));
      setLastMaxRound(maxRound);
    }
  }, [maxRound, lastMaxRound]);

  const startNewTaskRun = () => {
    setCodingTaskInput('');
    setCodingTaskMessages([]);
    setOpenRounds({});
    setExpandedMsgKeys({});
    setLastMaxRound(-1);
    setLastCodingTaskResult(null);
    setActiveTaskRunId(null);
    setTaskInterruptMessage('');
    setTaskInterruptPending(false);
    setSelectedCodingTaskContextRefs([]);
    setSelectedTaskCardId(null);
    setContinuedFromTaskId(null);
    setTemporaryTaskAgents([]);
    setTaskRunView('setup');
  };
  const resetTaskRun = startNewTaskRun;

  const handleRunCodingTask = async () => {
    if (!projectPath || !codingTaskInput.trim()) return;
    if (taskRunType === 'coding' && !activeSourceId) {
      setErrorMsg('Attach a Source before running a coding task.');
      return;
    }
    if (!codingTaskDeveloperName) {
      setErrorMsg('Select a Doer AI member before running the task.');
      return;
    }
    if (codingTaskReviewerNames.length === 0) {
      setErrorMsg('Select at least one Reviewer or Lead member.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setLastCodingTaskResult(null);
    setOpenRounds({ 0: true });
    setExpandedMsgKeys({});
    setLastMaxRound(0);
    const task = codingTaskInput.trim();
    setCodingTaskInput('');
    setCodingTaskMessages([
      {
        author: 'You',
        role: 'user',
        time: new Date().toLocaleTimeString(),
        text: task,
        round: 0
      },
      {
        author: 'System Engine',
        role: 'system',
        time: new Date().toLocaleTimeString(),
        text: `Starting ${taskRunType} task with ${selectedDoerName}, then review by ${selectedReviewerNames.join(', ')}.`,
        round: 0
      }
    ]);

    const messageId = (taskId: string, round: number, agentName: string) => `${taskId}:${round}:${agentName}`;
    const unsubscribe = api.onDiscussionEvent((event) => {
      if (typeof event.discussionId !== 'string' || !event.discussionId.startsWith('task-')) return;

      if (event.type === 'discussion_started') {
        setActiveTaskRunId(event.discussionId);
        return;
      }

      if (event.type === 'agent_started') {
        const id = messageId(event.discussionId, event.round, event.agentName);
        setCodingTaskMessages(prev => [
          ...prev,
          {
            id,
            author: formatAgentDisplayName(event.agentName, event.providerName, event.modelName),
            role: event.agentName.toLowerCase(),
            time: event.timestamp,
            text: getAgentProgressMessage(0),
            streaming: true,
            progressStep: 0,
            round: event.round,
            contextSummary: `Cycle ${event.round} • ${event.role}`
          }
        ]);
        return;
      }

      if (event.type === 'agent_chunk') {
        const id = messageId(event.discussionId, event.round, event.agentName);
        setCodingTaskMessages(prev => {
          let found = false;
          const updated = prev.map(msg => {
            if (msg.id !== id) return msg;
            found = true;
            return advanceAgentProgressMessage(msg);
          });
          if (found) return updated;
          return [
            ...updated,
            {
              id,
              author: formatAgentDisplayName(event.agentName, event.providerName, event.modelName),
              role: event.agentName.toLowerCase(),
              time: new Date().toLocaleTimeString(),
              text: getAgentProgressMessage(0),
              streaming: true,
              progressStep: 0,
              round: event.round
            }
          ];
        });
        return;
      }

      if (event.type === 'message_completed') {
        const id = messageId(event.discussionId, event.round, event.message.agentName);
        const contextCount = event.message.contextMessages?.length || 0;
        const contextMetrics = event.message.contextMetrics;
        const estimatedTokens = contextMetrics
          ? (contextMetrics.estimatedHistoryTokens || 0) + (contextMetrics.estimatedProjectContextTokens || 0)
          : 0;
        const contextSummary = contextMetrics
          ? `Cycle ${event.round} • Context: ${contextCount} prior message${contextCount === 1 ? '' : 's'} • ~${estimatedTokens.toLocaleString()} tokens${contextMetrics.summaryUsed ? ' • summary used' : ''}`
          : `Cycle ${event.round} • Context: ${contextCount} prior message${contextCount === 1 ? '' : 's'}`;
        setCodingTaskMessages(prev => {
          let found = false;
          const updated = prev.map(msg => {
            if (msg.id !== id) return msg;
            found = true;
            return {
              ...msg,
              text: event.message.content,
              time: event.message.timestamp,
              streaming: false,
              progressStep: undefined,
              round: event.round,
              contextSummary,
              contextMetrics
            };
          });
          if (found) return updated;
          return [
            ...updated,
            {
              id,
              author: formatAgentDisplayName(event.message.agentName, event.message.providerName, event.message.modelName),
              role: event.message.agentName.toLowerCase(),
              time: event.message.timestamp,
              text: event.message.content,
              streaming: false,
              progressStep: undefined,
              round: event.round,
              contextSummary,
              contextMetrics
            }
          ];
        });
        return;
      }

      if (event.type === 'agent_error') {
        setErrorMsg(`${event.agentName} failed: ${event.error}`);
        return;
      }

      if (event.type === 'discussion_interrupted') {
        const round = event.message.round ?? 0;
        setCodingTaskMessages(prev => [
          ...prev,
          {
            id: `${event.discussionId}:interrupt`,
            author: event.message.agentName,
            role: 'user',
            time: event.message.timestamp,
            text: event.message.content,
            round
          },
          {
            author: 'System Engine',
            role: 'system',
            time: new Date().toLocaleTimeString(),
            text: 'Interrupted after the current agent turn. Adjust the task direction before running another pass.',
            round
          }
        ]);
        setTaskInterruptPending(false);
        return;
      }

      if (event.type === 'discussion_completed') {
        setActiveTaskRunId(null);
        setTaskInterruptPending(false);
        return;
      }

      if (event.type === 'discussion_failed') {
        setActiveTaskRunId(null);
        setTaskInterruptPending(false);
        setErrorMsg(event.error);
      }
    });

    try {
      const res = await api.runTask(projectPath, task, {
        sourceId: activeSourceId,
        taskType: taskRunType,
        doerRef: codingTaskDeveloperName,
        reviewerRefs: codingTaskReviewerNames,
        maxCycles: codingTaskMaxCycles,
        contextRefs: selectedCodingTaskContextRefs,
        associatedCardId: selectedTaskCardId || undefined,
        continuedFromTaskId: continuedFromTaskId || undefined,
        temporaryAgents: temporaryTaskAgents
      });
      if (!res.success || !res.result) {
        setErrorMsg(res.error || 'Failed to run task.');
        return;
      }

      setLastCodingTaskResult(res.result);
      setContinuedFromTaskId(null);
      setSelectedTaskCardId(null);
      setCodingTaskMessages([
        ...formatDiscussionLogMessages({ messages: res.result.messages }),
        {
          author: 'System Engine',
          role: 'system',
          time: new Date().toLocaleTimeString(),
          round: res.result.cycles,
          text: res.result.status === 'approved'
            ? `Task approved after ${res.result.cycles} cycle(s). Transcript: ${res.result.markdownFilename}. Artifact: ${res.result.artifactFilename || 'none'}`
            : res.result.status === 'interrupted'
              ? `Task interrupted after ${res.result.cycles} cycle(s). Transcript: ${res.result.markdownFilename}.`
              : `Task still needs revision after ${res.result.cycles} cycle(s). Transcript: ${res.result.markdownFilename}. Artifact: ${res.result.artifactFilename || 'none'}`
        }
      ]);
      await loadProjectData(projectPath);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to run task.');
    } finally {
      unsubscribe();
      setActiveTaskRunId(null);
      setTaskInterruptPending(false);
      setLoading(false);
    }
  };

  const interruptActiveTaskRun = async () => {
    if (!projectPath || !activeTaskRunId || !taskInterruptMessage.trim()) return;
    setErrorMsg(null);
    setTaskInterruptPending(true);
    try {
      const res = await api.interruptRun(projectPath, activeTaskRunId, taskInterruptMessage);
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to interrupt the active task run.');
        setTaskInterruptPending(false);
        return;
      }
      setTaskInterruptMessage('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to interrupt the active task run.');
      setTaskInterruptPending(false);
    }
  };

  const continueTaskRunFromPivot = () => {
    if (!lastCodingTaskResult || lastCodingTaskResult.status !== 'interrupted') return;
    const messages = Array.isArray(lastCodingTaskResult.messages) ? lastCodingTaskResult.messages : [];
    const pivotMessage = [...messages]
      .reverse()
      .find((message: any) => message.type === 'user' && String(message.content || '').startsWith('Interrupt & Pivot:'));
    const pivotText = String(pivotMessage?.content || '').replace(/^Interrupt & Pivot:\s*/i, '').trim();
    const originalTask = String(lastCodingTaskResult.task || '').trim();
    setCodingTaskInput([
      originalTask ? `Original task:\n${originalTask}` : '',
      pivotText ? `Interrupt & Pivot direction:\n${pivotText}` : 'Continue from the Interrupt & Pivot direction above.'
    ].filter(Boolean).join('\n\n'));
    setContinuedFromTaskId(lastCodingTaskResult.id);
    setTaskRunView('setup');
  };

  const applyTaskTypePreset = (taskType: string) => {
    setTaskRunType(taskType);
    const entries = taskParticipantEntries(
      (projectData?.agents || []).filter((agent: any) => !agent.isVirtual),
      temporaryTaskAgents
    );
    if (entries.length === 0) return;

    const findByTerms = (terms: string[]) => entries.find(entry => {
      const text = `${entry.agent.name} ${entry.agent.role}`.toLowerCase();
      return terms.some(term => text.includes(term));
    });
    const findManyByTerms = (terms: string[]) => entries
      .filter(entry => {
        const text = `${entry.agent.name} ${entry.agent.role}`.toLowerCase();
        return terms.some(term => text.includes(term));
      })
      .map(entry => entry.ref);

    const mapping: Record<string, { doer: string[]; reviewers: string[] }> = {
      coding: {
        doer: ['developer', 'implementer', 'engineer', 'coder'],
        reviewers: ['reviewer', 'senior', 'qa', 'security']
      },
      writing: {
        doer: ['writer', 'screenwriter', 'editorial'],
        reviewers: ['editor', 'reviewer', 'producer']
      },
      film: {
        doer: ['screenwriter', 'writer'],
        reviewers: ['story editor', 'editor', 'producer']
      },
      research: {
        doer: ['researcher', 'research'],
        reviewers: ['reviewer', 'producer', 'analyst']
      },
      business: {
        doer: ['product', 'producer', 'analyst'],
        reviewers: ['reviewer', 'researcher', 'producer']
      },
      design: {
        doer: ['ux', 'designer', 'design'],
        reviewers: ['product', 'reviewer', 'qa']
      },
      general: {
        doer: ['producer', 'product', 'researcher', 'developer', 'writer'],
        reviewers: ['reviewer', 'editor', 'qa', 'producer']
      }
    };

    const preset = mapping[taskType] || mapping.general;
    const doer = findByTerms(preset.doer) || entries[0];
    const reviewers = findManyByTerms(preset.reviewers)
      .filter((reference: string) => reference !== doer.ref)
      .slice(0, 3);
    setCodingTaskDeveloperName(doer.ref);
    setCodingTaskReviewerNames(
      reviewers.length > 0
        ? reviewers
        : entries.filter(entry => entry.ref !== doer.ref).slice(0, 2).map(entry => entry.ref)
    );
  };

  return {
    codingTaskInput, setCodingTaskInput,
    taskRunType, setTaskRunType,
    codingTaskMessages, setCodingTaskMessages,
    codingTaskDeveloperName, setCodingTaskDeveloperName,
    codingTaskReviewerNames, setCodingTaskReviewerNames,
    codingTaskMaxCycles, setCodingTaskMaxCycles,
    selectedCodingTaskContextRefs, setSelectedCodingTaskContextRefs,
    lastCodingTaskResult, setLastCodingTaskResult,
    taskRunView, setTaskRunView,
    openRounds, setOpenRounds,
    expandedMsgKeys, setExpandedMsgKeys,
    lastMaxRound, setLastMaxRound,
    activeTaskRunId,
    taskInterruptMessage, setTaskInterruptMessage,
    taskInterruptPending,
    temporaryTaskAgents, setTemporaryTaskAgents,
    handleRunCodingTask,
    interruptActiveTaskRun,
    continueTaskRunFromPivot,
    applyTaskTypePreset,
    resetTaskRun,
    startNewTaskRun,
    selectedTaskCardId, setSelectedTaskCardId,
    continuedFromTaskId, setContinuedFromTaskId
  };
}
