import type { UIMessage } from '../../types/domain.js';

/**
 * Pure helpers shared by the Discussion and Task Run streaming flows.
 * Extracted from App.tsx (Phase E prep) — no React/state dependency.
 */

export const formatAgentDisplayName = (agentName: string, providerName: string, modelName?: string): string => {
  const cleanModel = modelName?.trim();
  return cleanModel
    ? `${agentName} (${cleanModel})`
    : `${agentName} (${providerName})`;
};

export const formatDiscussionLogMessages = (log: any): UIMessage[] => {
  const messages = Array.isArray(log?.messages) ? log.messages : [];
  let inferredRound = 1;
  const seenAgentsInRound = new Set<string>();

  return messages.map((message: any) => {
    if (message.type === 'user') {
      return {
        author: 'You',
        role: 'user',
        time: message.timestamp || '',
        text: message.content || '',
        round: 0
      };
    }

    let msgRound = message.round;
    if (msgRound === undefined) {
      const agentName = message.agentName || 'agent';
      if (seenAgentsInRound.has(agentName)) {
        inferredRound++;
        seenAgentsInRound.clear();
      }
      seenAgentsInRound.add(agentName);
      msgRound = inferredRound;
    }

    const contextCount = Array.isArray(message.contextMessages) ? message.contextMessages.length : 0;
    return {
      author: formatAgentDisplayName(message.agentName, message.providerName, message.modelName),
      role: String(message.agentName || 'agent').toLowerCase(),
      time: message.timestamp || '',
      text: message.content || '',
      round: msgRound,
      contextSummary: contextCount > 0
        ? `Context: ${contextCount} chat message${contextCount === 1 ? '' : 's'}`
        : 'Context: current message only'
    };
  });
};

export const getAgentProgressMessage = (step = 0): string => {
  const messages = [
    'Reading the workspace context...',
    'Reviewing the discussion so far...',
    'Planning the response...',
    'Checking details before answering...',
    'Preparing the final answer...'
  ];
  return messages[step % messages.length];
};

export const advanceAgentProgressMessage = (message: UIMessage): UIMessage => {
  const nextStep = (message.progressStep || 0) + 1;
  return {
    ...message,
    text: getAgentProgressMessage(nextStep),
    progressStep: nextStep,
    streaming: true
  };
};

export const getDiscussionIdFromFile = (filename: string): string => filename.replace(/\.(md|json)$/i, '');
