import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  LocalCliPermissionMode,
  ProjectData,
  SkillPreviewResult,
  TemplateSkill
} from '../../types/domain.js';
import { api } from '../../shared/ipc/client.js';
import { useProviders } from '../providers/context/ProvidersContext.js';
import { buildAgentEditorSeed, findAgentForEditorRoute } from './lib/agentEditorState.js';

interface UseAgentManagementOptions {
  projectPath: string | null;
  projectData: ProjectData | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  loadProjectData: (path: string) => Promise<void>;
  setErrorMsg: (value: string | null) => void;
}

export interface AgentDefaultSelection {
  provider: string;
  cliPreset?: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'kiro';
  modelName?: string;
}

export const resolveAgentDefaultSelection = (
  providers: Array<{ id: string; hasKey?: boolean }> | undefined,
  detectedClis: Array<{ id: string; available: boolean }> | undefined,
  getModelOptions: (provider: string, preset?: string) => Array<{ value: string }>
): AgentDefaultSelection => {
  const installedCli = detectedClis?.find(cli => cli.available);
  if (installedCli) {
    return {
      provider: 'Local CLI',
      cliPreset: installedCli.id as AgentDefaultSelection['cliPreset'],
      modelName: ''
    };
  }

  const activeOllama = providers?.find(p => p.id === 'ollama');
  if (activeOllama) {
    return {
      provider: 'ollama',
      modelName: getModelOptions('ollama', 'none')[0]?.value || ''
    };
  }

  const activeLMStudio = providers?.find(p => p.id === 'lmstudio');
  if (activeLMStudio) {
    return {
      provider: 'lmstudio',
      modelName: getModelOptions('lmstudio', 'none')[0]?.value || ''
    };
  }

  const geminiConfigured = providers?.find(p => p.id === 'gemini')?.hasKey;
  if (geminiConfigured) {
    return {
      provider: 'gemini',
      modelName: getModelOptions('gemini', 'none')[0]?.value || ''
    };
  }

  const claudeConfigured = providers?.find(p => p.id === 'anthropic')?.hasKey;
  if (claudeConfigured) {
    return {
      provider: 'anthropic',
      modelName: getModelOptions('anthropic', 'none')[0]?.value || ''
    };
  }

  const openaiConfigured = providers?.find(p => p.id === 'openai')?.hasKey;
  if (openaiConfigured) {
    return {
      provider: 'openai',
      modelName: getModelOptions('openai', 'none')[0]?.value || ''
    };
  }

  return {
    provider: 'gemini',
    modelName: getModelOptions('gemini', 'none')[0]?.value || ''
  };
};

export function useAgentManagement({
  projectPath,
  projectData,
  activeTab,
  setActiveTab,
  loadProjectData,
  setErrorMsg
}: UseAgentManagementOptions) {
  const {
    providers,
    detectedClis,
    dynamicCliModels,
    getModelOptions,
    fetchModelsForProvider
  } = useProviders();
  const [newAgentName, setNewAgentName] = useState<string>('');
  const [newAgentRole, setNewAgentRole] = useState<string>('Assistant');
  const [newAgentProvider, setNewAgentProvider] = useState<string>('gemini');
  const [newAgentCommand, setNewAgentCommand] = useState<string>('');
  const [newAgentPrompt, setNewAgentPrompt] = useState<string>('You are a helpful AI assistant in the ROOM workspace. Cooperate with the team to achieve the user objective.');
  const [newAgentSkills, setNewAgentSkills] = useState<string[]>([]);
  const [newAgentPreset, setNewAgentPreset] = useState<'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'kiro' | 'none'>('none');
  const [newAgentStdinFormat, setNewAgentStdinFormat] = useState<'text' | 'json'>('text');
  const [newAgentPermissionMode, setNewAgentPermissionMode] = useState<LocalCliPermissionMode>('safe');
  const [editingAgent, setEditingAgent] = useState<any | null>(null);
  const [customSkillName, setCustomSkillName] = useState<string>('');
  const [customSkillDesc, setCustomSkillDesc] = useState<string>('');
  const [editingSkillFile, setEditingSkillFile] = useState<string>('');
  const [editingSkillContent, setEditingSkillContent] = useState<string>('');
  const [editingSkillSource, setEditingSkillSource] = useState<'skills' | 'roles'>('skills');
  const [skillPreview, setSkillPreview] = useState<SkillPreviewResult | null>(null);
  const [newAgentModel, setNewAgentModel] = useState<string>('');
  const [newAgentModelCustom, setNewAgentModelCustom] = useState<boolean>(false);
  const [agentOperationLoading, setAgentOperationLoading] = useState<boolean>(false);

  const hydrateAgentEditor = (agent: any, options?: { pushRoute?: boolean }) => {
    const seed = buildAgentEditorSeed(agent);
    setEditingAgent(seed.editingAgent);
    setNewAgentName(seed.newAgentName);
    setNewAgentRole(seed.newAgentRole);
    setNewAgentProvider(seed.newAgentProvider);
    setNewAgentModel(seed.newAgentModel);
    setNewAgentModelCustom(false);
    setNewAgentPrompt(seed.newAgentPrompt);
    setNewAgentSkills(seed.newAgentSkills);
    setSkillPreview(null);
    setNewAgentPreset(seed.newAgentPreset);
    setNewAgentCommand(seed.newAgentCommand);
    setNewAgentStdinFormat(seed.newAgentStdinFormat);
    setNewAgentPermissionMode(seed.newAgentPermissionMode);
    setEditingSkillSource('skills');

    if (options?.pushRoute !== false) {
      setActiveTab(`Agent:${agent.id || agent.name}`);
    }
  };

  const resetAgentForm = () => {
    setNewAgentName('');

    const defaults = resolveAgentDefaultSelection(providers, detectedClis, getModelOptions);
    setNewAgentProvider(defaults.provider);
    setNewAgentPreset(defaults.cliPreset || 'none');
    setNewAgentModel(defaults.modelName || '');
    setNewAgentModelCustom(false);
    setNewAgentCommand('');

    setNewAgentRole('Assistant');
    setNewAgentPrompt('You are a helpful AI assistant in the ROOM workspace. Cooperate with the team to achieve the user objective.');

    setNewAgentSkills([]);
    setNewAgentStdinFormat('text');
    setNewAgentPermissionMode('safe');
    setCustomSkillName('');
    setCustomSkillDesc('');
    setEditingSkillFile('');
    setEditingSkillContent('');
    setEditingSkillSource('skills');
    setSkillPreview(null);
    setEditingAgent(null);
  };

  useEffect(() => {
    resetAgentForm();
  }, [projectPath]);

  useEffect(() => {
    if (!newAgentName && (newAgentRole === 'Assistant' || !newAgentRole) && !editingAgent) {
      const defaults = resolveAgentDefaultSelection(providers, detectedClis, getModelOptions);
      setNewAgentProvider(defaults.provider);
      setNewAgentPreset(defaults.cliPreset || 'none');
      setNewAgentModel(defaults.modelName || '');
    }
  }, [providers, detectedClis, getModelOptions, newAgentName, newAgentRole, editingAgent]);

  useEffect(() => {
    if (newAgentProvider) {
      fetchModelsForProvider(newAgentProvider, newAgentPreset);
    }
  }, [newAgentProvider, newAgentPreset]);

  useEffect(() => {
    if (newAgentProvider) {
      const models = getModelOptions(newAgentProvider, newAgentPreset);
      if (models && models.length > 0) {
        setNewAgentModel(current => {
          const currentTrimmed = current.trim();
          if (!currentTrimmed) return models[0].value;
          const hasCurrentModel = models.some(m => m.value === currentTrimmed);
          return hasCurrentModel ? current : models[0].value;
        });
      }
    }
  }, [newAgentProvider, newAgentPreset, dynamicCliModels]);

  useEffect(() => {
    if (!activeTab.startsWith('Agent:') || activeTab === 'Agent:New') {
      return;
    }

    const agentKey = activeTab.slice('Agent:'.length).trim();
    if (!agentKey) {
      return;
    }

    const matchedAgent = findAgentForEditorRoute(activeTab, projectData?.agents || []);

    if (!projectData) {
      return;
    }

    if (!matchedAgent || matchedAgent.isVirtual) {
      resetAgentForm();
      setActiveTab('AI Members');
      return;
    }

    const editingMatches = editingAgent
      && ((matchedAgent.id && editingAgent.id === matchedAgent.id) || (!matchedAgent.id && editingAgent.name === matchedAgent.name));

    if (editingMatches) {
      return;
    }

    hydrateAgentEditor(matchedAgent, { pushRoute: false });
  }, [activeTab, editingAgent, projectData?.agents]);

  const handleRoleChange = (roleValue: string) => {
    setNewAgentRole(roleValue);
  };

  const ensureTemplateSkills = async (skills: readonly TemplateSkill[]) => {
    if (!projectPath || skills.length === 0) return [];

    const existingSkills = new Set((projectData?.skills || []).map((skill: string) => skill.toLowerCase()));
    const savedSkillFiles: string[] = [];

    for (const skill of skills) {
      if (!existingSkills.has(skill.filename.toLowerCase())) {
        const content = `# ${skill.title}\n\n${skill.content.trim()}\n`;
        const res = await api.saveSkill(projectPath, skill.filename, content, 'roles');
        if (!res.success) {
          throw new Error(res.error || `Failed to save ${skill.filename}.`);
        }
        existingSkills.add(skill.filename.toLowerCase());
      }

      savedSkillFiles.push(skill.filename);
    }

    return savedSkillFiles;
  };

  const startEditAgent = (agent: any) => {
    hydrateAgentEditor(agent);
  };

  const handleSaveAgent = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectPath || !newAgentName.trim() || !newAgentRole.trim() || !newAgentPrompt.trim()) return;
    setAgentOperationLoading(true);
    setErrorMsg(null);
    try {
      const defaultModel = getModelOptions(newAgentProvider, newAgentPreset)[0]?.value;
      const modelToSave = newAgentProvider === 'Local CLI'
        ? newAgentModel.trim() || undefined
        : newAgentModel.trim() || defaultModel;
      const permissionMode = newAgentProvider === 'Local CLI'
        ? (newAgentPreset === 'none' ? 'dangerous' : newAgentPermissionMode)
        : undefined;
      if (newAgentProvider === 'Local CLI') {
        if (newAgentPreset === 'none') {
          const confirmed = window.confirm('ROOM will execute this custom command from the workspace directory. Custom Local CLI agents require workspace dangerous mode. Continue?');
          if (!confirmed) return;
        } else if (permissionMode === 'dangerous') {
          const confirmed = window.confirm('Warning: This Local CLI preset will run with dangerous permissions enabled. Continue?');
          if (!confirmed) return;
        }
      }

      const res = await api.saveAgent(projectPath, {
        id: editingAgent?.id,
        previousName: !editingAgent?.id ? editingAgent?.name : undefined,
        name: newAgentName.trim(),
        role: newAgentRole.trim(),
        provider: newAgentProvider,
        modelName: modelToSave,
        systemPrompt: newAgentPrompt,
        skills: newAgentSkills,
        command: newAgentProvider === 'Local CLI' ? (newAgentPreset === 'none' ? newAgentCommand : undefined) : undefined,
        cliPreset: newAgentProvider === 'Local CLI' ? newAgentPreset : undefined,
        stdinFormat: newAgentProvider === 'Local CLI' ? newAgentStdinFormat : undefined,
        permissionMode
      });
      if (res.success) {
        resetAgentForm();
        await loadProjectData(projectPath);
        setActiveTab('AI Members');
      } else {
        setErrorMsg(res.error || 'Failed to save custom agent.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while saving agent.');
    } finally {
      setAgentOperationLoading(false);
    }
  };

  const handleDeleteAgent = async (agentName: string) => {
    if (!projectPath) return;
    const confirmDelete = window.confirm(`Are you sure you want to delete the agent "${agentName}"?`);
    if (!confirmDelete) return;

    setAgentOperationLoading(true);
    setErrorMsg(null);
    try {
      const member = editingAgent?.name === agentName
        ? editingAgent
        : (projectData?.agents || []).find((agent: any) => agent.name === agentName);
      const res = await api.deleteAgent(projectPath, agentName, member?.id);
      if (res.success) {
        await loadProjectData(projectPath);
        if (activeTab === `Agent:${agentName}` || (member?.id && activeTab === `Agent:${member.id}`)) {
          setActiveTab('AI Members');
          resetAgentForm();
        }
      } else {
        setErrorMsg(res.error || 'Failed to delete agent.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while deleting agent.');
    } finally {
      setAgentOperationLoading(false);
    }
  };

  const handleAddCustomSkill = async () => {
    if (!projectPath || !customSkillName.trim()) return;
    const rawName = customSkillName.trim();
    const rawDesc = customSkillDesc.trim();
    const formattedName = rawName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const filename = `${formattedName}.md`;
    const defaultContent = `# ${rawName} Skill\n\n${rawDesc || 'Instructions and rules for ' + rawName + '.'}\n`;

    setAgentOperationLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.saveSkill(projectPath, filename, defaultContent, 'skills');
      if (res.success) {
        setCustomSkillName('');
        setCustomSkillDesc('');
        setEditingSkillFile(filename);
        setEditingSkillContent(defaultContent);
        setEditingSkillSource('skills');
        await loadProjectData(projectPath);
        setNewAgentSkills(prev => [...prev, filename]);
      } else {
        setErrorMsg(res.error || 'Failed to save skill.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while saving skill.');
    } finally {
      setAgentOperationLoading(false);
    }
  };

  const handleSaveEditingSkill = async () => {
    if (!projectPath || !editingSkillFile.trim()) return;
    setAgentOperationLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.saveSkill(projectPath, editingSkillFile, editingSkillContent, editingSkillSource);
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to save skill.');
        return;
      }
      await loadProjectData(projectPath);
      setNewAgentSkills(prev => prev.includes(editingSkillFile) ? prev : [...prev, editingSkillFile]);
      setSkillPreview(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while saving skill.');
    } finally {
      setAgentOperationLoading(false);
    }
  };

  const handlePreviewAgentSkills = async () => {
    if (!projectPath) return;
    setAgentOperationLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.previewAgentSkills(projectPath, {
        provider: newAgentProvider,
        cliPreset: newAgentProvider === 'Local CLI' ? newAgentPreset : undefined,
        stdinFormat: newAgentProvider === 'Local CLI' ? newAgentStdinFormat : undefined,
        skills: newAgentSkills
      });
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to check skills.');
        return;
      }
      setSkillPreview({
        delivery: res.delivery || 'Skills are sent as Active Skills in the agent instructions.',
        readableCount: res.readableCount || 0,
        totalCount: res.totalCount || 0,
        items: res.items || []
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while checking skills.');
    } finally {
      setAgentOperationLoading(false);
    }
  };

  return {
    newAgentName,
    setNewAgentName,
    newAgentRole,
    setNewAgentRole,
    newAgentProvider,
    setNewAgentProvider,
    newAgentCommand,
    setNewAgentCommand,
    newAgentPrompt,
    setNewAgentPrompt,
    newAgentSkills,
    setNewAgentSkills,
    newAgentPreset,
    setNewAgentPreset,
    newAgentStdinFormat,
    setNewAgentStdinFormat,
    newAgentPermissionMode,
    setNewAgentPermissionMode,
    editingAgent,
    customSkillName,
    setCustomSkillName,
    customSkillDesc,
    setCustomSkillDesc,
    editingSkillFile,
    setEditingSkillFile,
    editingSkillContent,
    setEditingSkillContent,
    editingSkillSource,
    setEditingSkillSource,
    skillPreview,
    setSkillPreview,
    newAgentModel,
    setNewAgentModel,
    newAgentModelCustom,
    setNewAgentModelCustom,
    agentOperationLoading,
    handleRoleChange,
    ensureTemplateSkills,
    resetAgentForm,
    startEditAgent,
    handleSaveAgent,
    handleDeleteAgent,
    handleAddCustomSkill,
    handleSaveEditingSkill,
    handlePreviewAgentSkills
  };
}
