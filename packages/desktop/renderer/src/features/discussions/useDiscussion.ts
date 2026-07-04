import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import type { ProjectData, TaskBoardCard, UIMessage } from '../../types/domain.js';
import { api } from '../../shared/ipc/client.js';
import {
  advanceAgentProgressMessage,
  formatAgentDisplayName,
  formatDiscussionLogMessages,
  getAgentProgressMessage,
  getDiscussionIdFromFile
} from '../../shared/lib/streaming.js';

interface UseDiscussionDeps {
  projectPath: string | null;
  projectData: ProjectData | null;
  loadProjectData: (pathStr: string) => Promise<void>;
  setActiveTab: (tab: string) => void;
  setInitialSelectedFile: (value: { section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null) => void;
  setTaskBoardCards: (cards: TaskBoardCard[]) => void;
  setLoading: (value: boolean) => void;
  setErrorMsg: (value: string | null) => void;
}

type PersistedDiscussionAgent = {
  id?: string;
  name: string;
  isVirtual?: boolean;
};

type TemporaryDiscussionAgent = {
  id: string;
  name: string;
};

interface ResolveDiscussionSelectionOptions {
  projectAgents: PersistedDiscussionAgent[];
  selectedDiscussionMemberIds: string[];
  selectedLegacyDiscussionAgentNames?: string[];
  temporaryDiscussionAgents: TemporaryDiscussionAgent[];
  selectedTemporaryDiscussionAgentIds: string[];
}

interface DiscussionSelectionResolution {
  selectedSavedNames: string[];
  selectedLegacyNames: string[];
  selectedTemporaryNames: string[];
  selectedAgentNames: string[];
}

function dedupeStringsInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getPersistedDiscussionAgents(projectData: ProjectData | null): PersistedDiscussionAgent[] {
  return (projectData?.agents || []).filter((agent: PersistedDiscussionAgent) => !agent.isVirtual);
}

function getSavedDiscussionAgentsById(projectAgents: PersistedDiscussionAgent[]): Map<string, PersistedDiscussionAgent & { id: string }> {
  return new Map(
    projectAgents
      .filter((agent): agent is PersistedDiscussionAgent & { id: string } => typeof agent.id === 'string' && agent.id.length > 0)
      .map((agent) => [agent.id, agent])
  );
}

function getTemporaryDiscussionAgentsById(temporaryDiscussionAgents: TemporaryDiscussionAgent[]): Map<string, TemporaryDiscussionAgent> {
  return new Map(temporaryDiscussionAgents.map((agent) => [agent.id, agent]));
}

export function resolveDiscussionSelection({
  projectAgents,
  selectedDiscussionMemberIds,
  selectedLegacyDiscussionAgentNames = [],
  temporaryDiscussionAgents,
  selectedTemporaryDiscussionAgentIds
}: ResolveDiscussionSelectionOptions): DiscussionSelectionResolution {
  const memberById = getSavedDiscussionAgentsById(projectAgents);
  const temporaryAgentById = getTemporaryDiscussionAgentsById(temporaryDiscussionAgents);
  const availablePersistedNames = new Set(projectAgents.map((agent) => agent.name));
  const selectedSavedNames = selectedDiscussionMemberIds
    .map((memberId) => memberById.get(memberId)?.name)
    .filter((name): name is string => Boolean(name));
  const selectedLegacyNames = selectedLegacyDiscussionAgentNames
    .filter((name) => availablePersistedNames.has(name));
  const selectedTemporaryNames = selectedTemporaryDiscussionAgentIds
    .map((temporaryId) => temporaryAgentById.get(temporaryId)?.name)
    .filter((name): name is string => Boolean(name));

  return {
    selectedSavedNames,
    selectedLegacyNames,
    selectedTemporaryNames,
    selectedAgentNames: [...selectedSavedNames, ...selectedLegacyNames, ...selectedTemporaryNames]
  };
}

export function useDiscussion({
  projectPath,
  projectData,
  loadProjectData,
  setActiveTab,
  setInitialSelectedFile,
  setTaskBoardCards,
  setLoading,
  setErrorMsg
}: UseDiscussionDeps) {
  const [selectedDiscussionMemberIds, setSelectedDiscussionMemberIds] = useState<string[]>([]);
  const [selectedLegacyDiscussionAgentNames, setSelectedLegacyDiscussionAgentNames] = useState<string[]>([]);
  const [selectedTemporaryDiscussionAgentIds, setSelectedTemporaryDiscussionAgentIds] = useState<string[]>([]);
  const [temporaryDiscussionAgents, setTemporaryDiscussionAgents] = useState<any[]>([]);
  const [discussionReviewMode, setDiscussionReviewMode] = useState<boolean>(true);
  const [discussionMaxRounds, setDiscussionMaxRounds] = useState<number>(6);
  const [discussionQualityGate, setDiscussionQualityGate] = useState<boolean>(false);
  const [discussionModeratorName, setDiscussionModeratorName] = useState<string>('');
  const [discussionAutoSummary, setDiscussionAutoSummary] = useState<boolean>(false);
  const [discussionSummaryAgentName, setDiscussionSummaryAgentName] = useState<string>('__project__');
  const [selectedDiscussionContextRefs, setSelectedDiscussionContextRefs] = useState<string[]>(['workspace:overview', 'workspace:structure']);
  const [activeDiscussionId, setActiveDiscussionId] = useState<string | null>(null);
  const [lastDiscussionLog, setLastDiscussionLog] = useState<any | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [lastDiscussionTopic, setLastDiscussionTopic] = useState<string>('');
  const [highlightedDiscussionMessage, setHighlightedDiscussionMessage] = useState<number | null>(null);
  const [userInputTopic, setUserInputTopic] = useState<string>('');
  const [discussionMessages, setDiscussionMessages] = useState<UIMessage[]>([]);
  const [activeDiscussionRunId, setActiveDiscussionRunId] = useState<string | null>(null);
  const [discussionInterruptMessage, setDiscussionInterruptMessage] = useState<string>('');
  const [discussionInterruptPending, setDiscussionInterruptPending] = useState<boolean>(false);
  const persistedDiscussionAgents = getPersistedDiscussionAgents(projectData);
  const {
    selectedSavedNames,
    selectedLegacyNames,
    selectedTemporaryNames,
    selectedAgentNames: selectedDiscussionAgents
  } = resolveDiscussionSelection({
    projectAgents: persistedDiscussionAgents,
    selectedDiscussionMemberIds,
    selectedLegacyDiscussionAgentNames,
    temporaryDiscussionAgents,
    selectedTemporaryDiscussionAgentIds
  });

  useEffect(() => {
    const savedAgentIds = new Set(
      persistedDiscussionAgents
        .filter((agent): agent is PersistedDiscussionAgent & { id: string } => typeof agent.id === 'string' && agent.id.length > 0)
        .map((agent) => agent.id)
    );
    const persistedNames = new Set(persistedDiscussionAgents.map((agent) => agent.name));
    const temporaryIds = new Set(
      (temporaryDiscussionAgents as TemporaryDiscussionAgent[])
        .map((agent) => agent.id)
        .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0)
    );

    setSelectedDiscussionMemberIds((prev) => {
      const next = dedupeStringsInOrder(prev.filter((memberId) => savedAgentIds.has(memberId)));
      return arraysEqual(prev, next) ? prev : next;
    });
    setSelectedLegacyDiscussionAgentNames((prev) => {
      const next = dedupeStringsInOrder(prev.filter((agentName) => persistedNames.has(agentName)));
      return arraysEqual(prev, next) ? prev : next;
    });
    setSelectedTemporaryDiscussionAgentIds((prev) => {
      const next = dedupeStringsInOrder(prev.filter((agentId) => temporaryIds.has(agentId)));
      return arraysEqual(prev, next) ? prev : next;
    });
  }, [persistedDiscussionAgents, temporaryDiscussionAgents]);

  const setSelectedDiscussionAgents = useCallback((value: string[] | ((prev: string[]) => string[])) => {
    const previous = [...selectedSavedNames, ...selectedLegacyNames, ...selectedTemporaryNames];
    const nextNames = typeof value === 'function' ? value(previous) : value;
    const remainingSavedIdsByName = new Map<string, string[]>();
    const remainingLegacyNames = new Set(
      persistedDiscussionAgents
        .filter((agent) => !agent.id)
        .map((agent) => agent.name)
    );
    const remainingTemporaryIdsByName = new Map<string, string[]>();

    for (const agent of persistedDiscussionAgents) {
      if (!agent.id) continue;
      const queue = remainingSavedIdsByName.get(agent.name) || [];
      queue.push(agent.id);
      remainingSavedIdsByName.set(agent.name, queue);
    }

    for (const agent of temporaryDiscussionAgents as TemporaryDiscussionAgent[]) {
      const queue = remainingTemporaryIdsByName.get(agent.name) || [];
      queue.push(agent.id);
      remainingTemporaryIdsByName.set(agent.name, queue);
    }

    const nextMemberIds: string[] = [];
    const nextLegacyNames: string[] = [];
    const nextTemporaryIds: string[] = [];

    for (const agentName of nextNames) {
      const savedIds = remainingSavedIdsByName.get(agentName);
      if (savedIds && savedIds.length > 0) {
        const nextMemberId = savedIds.shift();
        if (nextMemberId) {
          nextMemberIds.push(nextMemberId);
          continue;
        }
      }

      if (remainingLegacyNames.has(agentName)) {
        nextLegacyNames.push(agentName);
        remainingLegacyNames.delete(agentName);
        continue;
      }

      const temporaryIds = remainingTemporaryIdsByName.get(agentName);
      if (temporaryIds && temporaryIds.length > 0) {
        const nextTemporaryId = temporaryIds.shift();
        if (nextTemporaryId) {
          nextTemporaryIds.push(nextTemporaryId);
        }
      }
    }

    setSelectedDiscussionMemberIds(dedupeStringsInOrder(nextMemberIds));
    setSelectedLegacyDiscussionAgentNames(dedupeStringsInOrder(nextLegacyNames));
    setSelectedTemporaryDiscussionAgentIds(dedupeStringsInOrder(nextTemporaryIds));
  }, [persistedDiscussionAgents, selectedLegacyNames, selectedSavedNames, selectedTemporaryNames, temporaryDiscussionAgents]);

  const resetDiscussion = () => {
    setDiscussionMessages([]);
    setActiveDiscussionId(null);
    setActiveDiscussionRunId(null);
    setLastDiscussionLog(null);
    setLastDiscussionTopic('');
    setSelectedDiscussionContextRefs(['workspace:overview', 'workspace:structure']);
    setTemporaryDiscussionAgents([]);
    setSelectedTemporaryDiscussionAgentIds([]);
    setDiscussionInterruptMessage('');
    setDiscussionInterruptPending(false);
  };

  const selectDefaultDiscussionAgents = (agents: any[]) => {
    const registeredAgents = (agents || []).filter((agent: PersistedDiscussionAgent) => !agent.isVirtual);
    const savedAgents = registeredAgents.filter(
      (agent: PersistedDiscussionAgent): agent is PersistedDiscussionAgent & { id: string } =>
        typeof agent.id === 'string' && agent.id.length > 0
    );

    if (savedAgents.length > 0) {
      const validIds = new Set(savedAgents.map((agent) => agent.id));
      setSelectedDiscussionMemberIds((prev) => {
        const next = prev.filter((memberId) => validIds.has(memberId));
        if (next.length > 0) return next;
        return savedAgents.slice(0, 2).map((agent) => agent.id);
      });
      setSelectedLegacyDiscussionAgentNames([]);
      return;
    }

    if (registeredAgents.length > 0) {
      const names = registeredAgents.map((agent: PersistedDiscussionAgent) => agent.name);
      setSelectedLegacyDiscussionAgentNames((prev) => {
        const next = prev.filter((name) => names.includes(name));
        if (next.length > 0) return next;
        return names.slice(0, 2);
      });
      setSelectedDiscussionMemberIds([]);
    } else {
      setSelectedDiscussionMemberIds([]);
      setSelectedLegacyDiscussionAgentNames([]);
    }
  };

  const buildDiscussionSummaryMarkdown = () => {
    if (!lastDiscussionLog) return '';
    const messages = lastDiscussionLog.messages || [];
    return `# Discussion Summary: ${lastDiscussionLog.title || lastDiscussionTopic || 'Untitled'}

## Topic
${lastDiscussionLog.topic || lastDiscussionTopic || 'Untitled'}

## Status
${lastDiscussionLog.status || 'completed'}

## AI Members
${Array.from(new Set(messages.map((message: any) => message.agentName))).map(name => `- ${name}`).join('\n') || '- None'}

## Transcript
${messages.map((message: any, index: number) => `### ${index + 1}. ${message.agentName} (${message.providerName})

${message.content}`).join('\n\n')}
`;
  };

  const buildDiscussionTaskMarkdown = () => {
    if (!lastDiscussionLog) return '';
    return `# Follow-up Tasks: ${lastDiscussionLog.title || lastDiscussionTopic || 'Untitled'}

## Source Discussion
- Topic: ${lastDiscussionLog.topic || lastDiscussionTopic || 'Untitled'}
- Status: ${lastDiscussionLog.status || 'completed'}

## Tasks
- [ ] Review the discussion transcript.
- [ ] Extract concrete next actions.
- [ ] Assign owners or AI members.
- [ ] Decide which context or documents should be updated.

## Notes
This task note was created from a ROOM discussion. Refine it before treating it as the source of truth.
`;
  };

  const safeDocumentSlug = (input: string): string => {
    const slug = (input || 'discussion')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    return slug || 'discussion';
  };

  const scrollToDiscussionMessage = (messageNumber: number) => {
    const element = document.getElementById(`discussion-message-${messageNumber}`);
    if (!element) return;
    setHighlightedDiscussionMessage(messageNumber);
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      setHighlightedDiscussionMessage(current => current === messageNumber ? null : current);
    }, 1800);
  };

  const startNewDiscussion = () => {
    setActiveDiscussionId(null);
    setLastDiscussionLog(null);
    setLastDiscussionTopic('');
    setDiscussionMessages([]);
    setActiveDiscussionRunId(null);
    setTemporaryDiscussionAgents([]);
    setSelectedTemporaryDiscussionAgentIds([]);
    setDiscussionInterruptMessage('');
    setDiscussionInterruptPending(false);
  };

  const loadTaskBoardCards = async (dirPath: string) => {
    try {
      const res = await api.loadTaskBoard(dirPath);
      if (res.success && res.cards) {
        setTaskBoardCards(res.cards);
      } else if (!res.success && res.error) {
        setErrorMsg(`Failed to load Task Board: ${res.error}`);
      }
    } catch (err: any) {
      setErrorMsg(`Failed to load Task Board: ${err.message}`);
    }
  };

  const loadDiscussionSession = async (filename: string) => {
    if (!projectPath) return;
    const discussionId = getDiscussionIdFromFile(filename);
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.readRoomFile(projectPath, 'discussions', `${discussionId}.json`);
      if (!res.success || !res.content) {
        setErrorMsg(res.error || `Failed to load ${filename}.`);
        return;
      }

      const log = JSON.parse(res.content);
      setActiveDiscussionId(log.id || discussionId);
      setLastDiscussionLog(log);
      setLastDiscussionTopic(log.topic || '');
      setDiscussionMessages(formatDiscussionLogMessages(log));
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to load ${filename}.`);
    } finally {
      setLoading(false);
    }
  };

  const saveDiscussionOutput = async (section: 'documents' | 'tasks') => {
    if (!projectPath || !lastDiscussionLog) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const discussionId = lastDiscussionLog.id || activeDiscussionId;
    const titleSource = lastDiscussionLog.topic || lastDiscussionLog.title || lastDiscussionTopic || discussionId || 'discussion';
    const filename = section === 'documents'
      ? discussionId
        ? `${safeDocumentSlug(titleSource)}-${discussionId}-summary.md`
        : `discussion-${timestamp}-summary.md`
      : `discussion-${timestamp}-tasks.md`;
    const content = section === 'documents'
      ? buildDiscussionSummaryMarkdown()
      : buildDiscussionTaskMarkdown();

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.saveRoomFile(projectPath, section, filename, content);
      if (!res.success) {
        setErrorMsg(res.error || `Failed to save ${filename}.`);
        return;
      }
      await loadProjectData(projectPath);
      setActiveTab(section === 'documents' ? 'Documents' : 'Tasks');
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to save ${filename}.`);
    } finally {
      setLoading(false);
    }
  };

  const summarizeActiveDiscussion = async () => {
    if (!projectPath || !activeDiscussionId) {
      setErrorMsg('Select or run a chat before summarizing it.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.summarizeDiscussion(projectPath, activeDiscussionId, {
        agentNames: selectedDiscussionAgents,
        summaryAgentName: discussionSummaryAgentName !== '__project__' ? discussionSummaryAgentName : undefined,
        useProjectSummaryAgent: discussionSummaryAgentName === '__project__'
      });
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to summarize chat.');
        return;
      }

      await loadProjectData(projectPath);
      if (res.filename) {
        setInitialSelectedFile({ section: 'documents', file: res.filename });
      }
      setActiveTab('Documents');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to summarize chat.');
    } finally {
      setLoading(false);
    }
  };

  const generateTasksFromActiveDiscussion = async () => {
    if (!projectPath || !activeDiscussionId) {
      setErrorMsg('Run or select a chat before generating tasks.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.generateTasksFromDiscussion(projectPath, activeDiscussionId, {
        moderatorName: discussionModeratorName || undefined
      });
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to generate tasks.');
        return;
      }

      await loadProjectData(projectPath);
      setActiveTab('Tasks');

      if (res.createdTaskCards && res.createdTaskCards.length === 0) {
        setErrorMsg('All tasks from this discussion are already present on the task board.');
      } else if (res.errors && res.errors.length > 0) {
        setErrorMsg(`Generated tasks with warnings:\n\n` + res.errors.join('\n'));
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate tasks.');
    } finally {
      setLoading(false);
    }
  };

  const continueActiveDiscussionFromPivot = () => {
    if (!lastDiscussionLog || lastDiscussionLog.status !== 'interrupted') return;
    const messages = Array.isArray(lastDiscussionLog.messages) ? lastDiscussionLog.messages : [];
    const pivotMessage = [...messages]
      .reverse()
      .find((message: any) => message.type === 'user' && String(message.content || '').startsWith('Interrupt & Pivot:'));
    const pivotText = String(pivotMessage?.content || '').replace(/^Interrupt & Pivot:\s*/i, '').trim();
    setUserInputTopic(pivotText
      ? `Continue from the Interrupt & Pivot direction:\n\n${pivotText}`
      : 'Continue from the Interrupt & Pivot direction above.'
    );
  };

  const handleSendDiscussion = async () => {
    if (!userInputTopic.trim() || !projectPath) return;
    const validSelectedAgents = [...selectedSavedNames, ...selectedLegacyNames, ...selectedTemporaryNames];
    if (
      selectedDiscussionMemberIds.length === 0
      && selectedLegacyDiscussionAgentNames.length === 0
      && selectedTemporaryDiscussionAgentIds.length === 0
    ) {
      setErrorMsg('Please select at least one participating agent.');
      return;
    }
    if (validSelectedAgents.length === 0) {
      setErrorMsg('Selected agents are not available in this workspace.');
      return;
    }
    const persistedAgentNames = new Set((projectData?.agents || [])
      .filter((agent: any) => !agent.isVirtual)
      .map((agent: any) => agent.name));
    const safeModeratorName = persistedAgentNames.has(discussionModeratorName) ? discussionModeratorName : undefined;
    const hasPersistedSummaryAgent = persistedAgentNames.has(discussionSummaryAgentName);
    const useProjectSummary = discussionSummaryAgentName === '__project__' || (!!discussionSummaryAgentName && !hasPersistedSummaryAgent);
    setLoading(true);
    setErrorMsg(null);
    const userTopic = userInputTopic;
    const contextRefs = selectedDiscussionContextRefs;
    setUserInputTopic('');
    setLastDiscussionLog(null);
    setLastDiscussionTopic(userTopic);
    const userMessage: UIMessage = {
      author: 'You',
      role: 'user',
      time: new Date().toLocaleTimeString(),
      text: userTopic
    };

    setDiscussionMessages(prev => [
      ...prev,
      userMessage,
      {
        author: 'System Engine',
        role: 'system',
        time: new Date().toLocaleTimeString(),
        text: `Initializing ${validSelectedAgents.join(' ↔ ')} workflow for topic: "${userTopic}"...`
      }
    ]);

    const messageId = (discussionId: string, round: number, agentName: string) => `${discussionId}:${round}:${agentName}`;
    const unsubscribe = api.onDiscussionEvent((event) => {
      if (event.discussionId.startsWith('task-')) return;

      if (event.type === 'discussion_started') {
        setActiveDiscussionRunId(event.discussionId);
        setActiveDiscussionId(event.discussionId);
        return;
      }

      if (event.type === 'agent_started') {
        const id = messageId(event.discussionId, event.round, event.agentName);
        setDiscussionMessages(prev => [
          ...prev,
          {
            id,
            author: formatAgentDisplayName(event.agentName, event.providerName, event.modelName),
            role: event.agentName.toLowerCase(),
            time: event.timestamp,
            text: getAgentProgressMessage(0),
            streaming: true,
            progressStep: 0
          }
        ]);
        return;
      }

      if (event.type === 'agent_chunk') {
        const id = messageId(event.discussionId, event.round, event.agentName);
        setDiscussionMessages(prev => {
          let found = false;
          const updated = prev.map((msg) => {
            if (msg.id !== id) return msg;
            found = true;
            return {
              ...advanceAgentProgressMessage(msg)
            };
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
              progressStep: 0
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
        const contextSummary = contextCount > 0
          ? contextMetrics
            ? `Context: topic + ${contextCount} prior message${contextCount === 1 ? '' : 's'} • ~${estimatedTokens.toLocaleString()} tokens${contextMetrics.summaryUsed ? ' • summary used' : ''}`
            : `Context: topic + ${contextCount} prior message${contextCount === 1 ? '' : 's'}`
          : 'Context: topic only';
        setDiscussionMessages(prev => {
          let found = false;
          const updated = prev.map((msg) => {
            if (msg.id !== id) return msg;
            found = true;
            return {
              ...msg,
              text: event.message.content,
              time: event.message.timestamp,
              streaming: false,
              progressStep: undefined,
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
        setDiscussionMessages(prev => [
          ...prev,
          {
            id: `${event.discussionId}:interrupt`,
            author: event.message.agentName,
            role: 'user',
            time: event.message.timestamp,
            text: event.message.content
          },
          {
            author: 'System Engine',
            role: 'system',
            time: new Date().toLocaleTimeString(),
            text: 'Interrupted after the current agent turn. Continue this chat with the pivot direction when ready.'
          }
        ]);
        setDiscussionInterruptPending(false);
        return;
      }

      if (event.type === 'discussion_completed') {
        setActiveDiscussionRunId(null);
        setDiscussionInterruptPending(false);
        return;
      }

      if (event.type === 'discussion_failed') {
        setActiveDiscussionRunId(null);
        setDiscussionInterruptPending(false);
        setErrorMsg(event.error);
      }
    });

    try {
      const res = await api.runDiscussion(projectPath, userTopic, validSelectedAgents, {
        reviewMode: discussionReviewMode,
        maxRounds: discussionReviewMode ? discussionMaxRounds : 1,
        contextRefs,
        discussionId: activeDiscussionId || undefined,
        qualityGate: discussionQualityGate,
        moderatorName: safeModeratorName,
        autoSummary: discussionAutoSummary,
        summaryAgentName: hasPersistedSummaryAgent ? discussionSummaryAgentName : undefined,
        useProjectSummaryAgent: useProjectSummary,
        temporaryAgents: temporaryDiscussionAgents
      });
      if (res.success && res.log) {
        setLastDiscussionLog(res.log);
        setLastDiscussionTopic(userTopic);
        setActiveDiscussionId(res.log.id);
        const formatted = formatDiscussionLogMessages(res.log);
        const statusMessage = discussionReviewMode && res.log.status === 'approved'
          ? [{
              author: 'System Engine',
              role: 'system',
              time: new Date().toLocaleTimeString(),
              text: 'Review loop completed: output passed the active gate.'
            }]
          : [];
        const actionMessages = (res.moderatorActions || []).map(action => ({
          author: 'System Engine',
          role: 'system',
          time: new Date().toLocaleTimeString(),
          text: action.type === 'task'
            ? `Moderator created task card ${action.id}: ${action.title}`
            : `Moderator created ${action.filename}`
        }));
        const summaryMessage = res.summary?.filename
          ? [{
              author: 'System Engine',
              role: 'system',
              time: new Date().toLocaleTimeString(),
              text: `Auto Summary saved to Documents: ${res.summary.filename}`
            }]
          : [];
        setDiscussionMessages([...formatted, ...statusMessage, ...actionMessages, ...summaryMessage]);
        await loadProjectData(projectPath);
      } else {
        setErrorMsg(res.error || 'Failed to complete discussion execution. Check API credentials.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to run agent workflow.');
    } finally {
      unsubscribe();
      setActiveDiscussionRunId(null);
      setDiscussionInterruptPending(false);
      setLoading(false);
    }
  };

  const interruptActiveDiscussion = async () => {
    if (!activeDiscussionRunId || !discussionInterruptMessage.trim()) return;
    setErrorMsg(null);
    setDiscussionInterruptPending(true);
    try {
      const res = await api.interruptRun(activeDiscussionRunId, discussionInterruptMessage);
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to interrupt the active chat.');
        setDiscussionInterruptPending(false);
        return;
      }
      setDiscussionInterruptMessage('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to interrupt the active chat.');
      setDiscussionInterruptPending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendDiscussion();
    }
  };

  return {
    selectedDiscussionAgents, setSelectedDiscussionAgents,
    selectedDiscussionMemberIds, setSelectedDiscussionMemberIds,
    selectedLegacyDiscussionAgentNames, setSelectedLegacyDiscussionAgentNames,
    selectedTemporaryDiscussionAgentIds, setSelectedTemporaryDiscussionAgentIds,
    temporaryDiscussionAgents, setTemporaryDiscussionAgents,
    discussionReviewMode, setDiscussionReviewMode,
    discussionMaxRounds, setDiscussionMaxRounds,
    discussionQualityGate, setDiscussionQualityGate,
    discussionModeratorName, setDiscussionModeratorName,
    discussionAutoSummary, setDiscussionAutoSummary,
    discussionSummaryAgentName, setDiscussionSummaryAgentName,
    selectedDiscussionContextRefs, setSelectedDiscussionContextRefs,
    activeDiscussionId,
    lastDiscussionLog,
    showInspector, setShowInspector,
    lastDiscussionTopic,
    highlightedDiscussionMessage,
    userInputTopic, setUserInputTopic,
    discussionMessages,
    activeDiscussionRunId,
    discussionInterruptMessage, setDiscussionInterruptMessage,
    discussionInterruptPending,
    resetDiscussion,
    selectDefaultDiscussionAgents,
    scrollToDiscussionMessage,
    startNewDiscussion,
    loadTaskBoardCards,
    loadDiscussionSession,
    saveDiscussionOutput,
    summarizeActiveDiscussion,
    generateTasksFromActiveDiscussion,
    continueActiveDiscussionFromPivot,
    interruptActiveDiscussion,
    handleSendDiscussion,
    handleKeyDown
  };
}
