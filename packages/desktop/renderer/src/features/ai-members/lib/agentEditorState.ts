import { normalizeProviderId } from '../../../shared/data/staticData.js';

export interface AgentEditorSeed {
  editingAgent: any;
  newAgentName: string;
  newAgentRole: string;
  newAgentProvider: string;
  newAgentModel: string;
  newAgentPrompt: string;
  newAgentSkills: string[];
  newAgentPreset: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none';
  newAgentCommand: string;
  newAgentStdinFormat: 'text' | 'json';
  newAgentPermissionMode: 'safe' | 'dangerous';
}

export function buildAgentEditorSeed(agent: any): AgentEditorSeed {
  return {
    editingAgent: agent,
    newAgentName: agent.name,
    newAgentRole: agent.role,
    newAgentProvider: normalizeProviderId(agent.provider),
    newAgentModel: agent.modelName || '',
    newAgentPrompt: agent.systemPrompt,
    newAgentSkills: agent.skills || [],
    newAgentPreset: agent.cliPreset || 'none',
    newAgentCommand: agent.command || '',
    newAgentStdinFormat: agent.stdinFormat || 'text',
    newAgentPermissionMode: agent.permissionMode || 'safe'
  };
}

export function findAgentForEditorRoute(activeTab: string, agents: any[]): any | null {
  if (!activeTab.startsWith('Agent:') || activeTab === 'Agent:New') {
    return null;
  }

  const agentKey = activeTab.slice('Agent:'.length).trim();
  if (!agentKey) {
    return null;
  }

  return agents.find(agent => agent.id === agentKey)
    || agents.find(agent => agent.name === agentKey)
    || null;
}
