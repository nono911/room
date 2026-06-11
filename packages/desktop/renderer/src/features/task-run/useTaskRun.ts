import { useState, useEffect } from 'react';
import type { UIMessage, ProjectData } from '../../types/domain.js';
import { api } from '../../shared/ipc/client.js';
import {
  formatAgentDisplayName,
  formatDiscussionLogMessages,
  getAgentProgressMessage,
  advanceAgentProgressMessage
} from '../../shared/lib/streaming.js';

interface UseTaskRunDeps {
  projectPath: string | null;
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
export function useTaskRun({ projectPath, projectData, loadProjectData, setLoading, setErrorMsg }: UseTaskRunDeps) {
  const [codingTaskInput, setCodingTaskInput] = useState<string>('');
  const [taskRunType, setTaskRunType] = useState<string>('general');
  const [codingTaskMessages, setCodingTaskMessages] = useState<UIMessage[]>([]);
  const [codingTaskDeveloperName, setCodingTaskDeveloperName] = useState<string>('');
  const [codingTaskReviewerNames, setCodingTaskReviewerNames] = useState<string[]>([]);
  const [codingTaskMaxCycles, setCodingTaskMaxCycles] = useState<number>(2);
  const [selectedCodingTaskContextRefs, setSelectedCodingTaskContextRefs] = useState<string[]>(['workspace:overview', 'workspace:structure']);
  const [lastCodingTaskResult, setLastCodingTaskResult] = useState<any | null>(null);
  const [taskRunView, setTaskRunView] = useState<'setup' | 'timeline' | 'artifact' | 'trace'>('setup');
  const [openRounds, setOpenRounds] = useState<Record<number, boolean>>({});
  const [expandedMsgKeys, setExpandedMsgKeys] = useState<Record<string, boolean>>({});
  const [lastMaxRound, setLastMaxRound] = useState<number>(-1);

  // Auto-expand the newest cycle when a new one starts
  const maxRound = codingTaskMessages.length > 0 ? Math.max(...codingTaskMessages.map(m => m.round ?? 0)) : 0;
  useEffect(() => {
    if (maxRound > lastMaxRound) {
      setOpenRounds(prev => ({ ...prev, [maxRound]: true }));
      setLastMaxRound(maxRound);
    }
  }, [maxRound, lastMaxRound]);

  const resetTaskRun = () => {
    setCodingTaskMessages([]);
    setOpenRounds({});
    setExpandedMsgKeys({});
    setLastMaxRound(-1);
    setLastCodingTaskResult(null);
  };

  const handleRunCodingTask = async () => {
    if (!projectPath || !codingTaskInput.trim()) return;
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
        text: `Starting ${taskRunType} task with ${codingTaskDeveloperName}, then review by ${codingTaskReviewerNames.join(', ')}.`,
        round: 0
      }
    ]);

    const messageId = (taskId: string, round: number, agentName: string) => `${taskId}:${round}:${agentName}`;
    const unsubscribe = api.onDiscussionEvent((event) => {
      if (!event.discussionId.startsWith('task-')) return;

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
              contextSummary: `Cycle ${event.round} • Context: ${contextCount} prior message${contextCount === 1 ? '' : 's'}`
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
              contextSummary: `Cycle ${event.round} • Context: ${contextCount} prior message${contextCount === 1 ? '' : 's'}`
            }
          ];
        });
        return;
      }

      if (event.type === 'agent_error') {
        setErrorMsg(`${event.agentName} failed: ${event.error}`);
        return;
      }

      if (event.type === 'discussion_failed') {
        setErrorMsg(event.error);
      }
    });

    try {
      const res = await api.runTask(projectPath, task, {
        taskType: taskRunType,
        doerName: codingTaskDeveloperName,
        reviewerNames: codingTaskReviewerNames,
        maxCycles: codingTaskMaxCycles,
        contextRefs: selectedCodingTaskContextRefs
      });
      if (!res.success || !res.result) {
        setErrorMsg(res.error || 'Failed to run task.');
        return;
      }

      setLastCodingTaskResult(res.result);
      setCodingTaskMessages([
        ...formatDiscussionLogMessages({ messages: res.result.messages }),
        {
          author: 'System Engine',
          role: 'system',
          time: new Date().toLocaleTimeString(),
          round: res.result.cycles,
          text: res.result.status === 'approved'
            ? `Task approved after ${res.result.cycles} cycle(s). Transcript: ${res.result.markdownFilename}. Artifact: ${res.result.artifactFilename || 'none'}`
            : `Task still needs revision after ${res.result.cycles} cycle(s). Transcript: ${res.result.markdownFilename}. Artifact: ${res.result.artifactFilename || 'none'}`
        }
      ]);
      await loadProjectData(projectPath);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to run task.');
    } finally {
      unsubscribe();
      setLoading(false);
    }
  };

  const applyTaskTypePreset = (taskType: string) => {
    setTaskRunType(taskType);
    const agents = projectData?.agents || [];
    if (agents.length === 0) return;

    const findByTerms = (terms: string[]) => agents.find((agent: any) => {
      const text = `${agent.name} ${agent.role}`.toLowerCase();
      return terms.some(term => text.includes(term));
    });
    const findManyByTerms = (terms: string[]) => agents
      .filter((agent: any) => {
        const text = `${agent.name} ${agent.role}`.toLowerCase();
        return terms.some(term => text.includes(term));
      })
      .map((agent: any) => agent.name);

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
    const doer = findByTerms(preset.doer) || agents[0];
    const reviewers = findManyByTerms(preset.reviewers)
      .filter((name: string) => name !== doer.name)
      .slice(0, 3);
    setCodingTaskDeveloperName(doer.name);
    setCodingTaskReviewerNames(reviewers.length > 0 ? reviewers : agents.filter((agent: any) => agent.name !== doer.name).slice(0, 2).map((agent: any) => agent.name));
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
    handleRunCodingTask,
    applyTaskTypePreset,
    resetTaskRun
  };
}
