import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  LocalCliPermissionMode,
  ProjectData,
  SkillPreviewResult,
  TemplateSkill
} from '../../types/domain.js';
import { api } from '../../shared/ipc/client.js';
import { normalizeProviderId, agentPersonaTemplates, teamPresets } from '../../shared/data/staticData.js';
import { useProviders } from '../providers/context/ProvidersContext.js';

interface UseAgentManagementOptions {
  projectPath: string | null;
  projectData: ProjectData | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  loadProjectData: (path: string) => Promise<void>;
  setSelectedDiscussionAgents: (value: string[] | ((prev: string[]) => string[])) => void;
  setLoading: (value: boolean) => void;
  setErrorMsg: (value: string | null) => void;
}

export function useAgentManagement({
  projectPath,
  projectData,
  activeTab,
  setActiveTab,
  loadProjectData,
  setSelectedDiscussionAgents,
  setLoading,
  setErrorMsg
}: UseAgentManagementOptions) {
  const {
    providers,
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
  const [newAgentPreset, setNewAgentPreset] = useState<'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none'>('none');
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

  useEffect(() => {
    if (providers && providers.length > 0 && !newAgentName && (newAgentRole === 'Assistant' || !newAgentRole) && !editingAgent) {
      const activeOllama = providers.find(p => p.id === 'ollama');
      const activeLMStudio = providers.find(p => p.id === 'lmstudio');
      const geminiConfigured = providers.find(p => p.id === 'gemini')?.hasKey;
      const claudeConfigured = providers.find(p => p.id === 'anthropic')?.hasKey;
      const openaiConfigured = providers.find(p => p.id === 'openai')?.hasKey;

      let defaultProvider = 'gemini';
      if (activeOllama) {
        defaultProvider = 'ollama';
      } else if (activeLMStudio) {
        defaultProvider = 'lmstudio';
      } else if (geminiConfigured) {
        defaultProvider = 'gemini';
      } else if (claudeConfigured) {
        defaultProvider = 'anthropic';
      } else if (openaiConfigured) {
        defaultProvider = 'openai';
      }

      setNewAgentProvider(defaultProvider);
      const models = getModelOptions(defaultProvider, 'none');
      if (models && models.length > 0) {
        setNewAgentModel(models[0].value);
      }
    }
  }, [providers]);

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

  const resetAgentForm = () => {
    setNewAgentName('');
    
    let defaultProvider = 'gemini';
    const activeOllama = providers?.find(p => p.id === 'ollama');
    const activeLMStudio = providers?.find(p => p.id === 'lmstudio');
    const geminiConfigured = providers?.find(p => p.id === 'gemini')?.hasKey;
    const claudeConfigured = providers?.find(p => p.id === 'anthropic')?.hasKey;
    const openaiConfigured = providers?.find(p => p.id === 'openai')?.hasKey;
    
    if (activeOllama) {
      defaultProvider = 'ollama';
    } else if (activeLMStudio) {
      defaultProvider = 'lmstudio';
    } else if (geminiConfigured) {
      defaultProvider = 'gemini';
    } else if (claudeConfigured) {
      defaultProvider = 'anthropic';
    } else if (openaiConfigured) {
      defaultProvider = 'openai';
    }

    setNewAgentProvider(defaultProvider);
    const models = getModelOptions(defaultProvider, 'none');
    setNewAgentModel(models[0]?.value || '');
    setNewAgentModelCustom(false);
    setNewAgentCommand('');
    
    setNewAgentRole('Assistant');
    setNewAgentPrompt('You are a helpful AI assistant in the ROOM workspace. Cooperate with the team to achieve the user objective.');
    
    setNewAgentSkills([]);
    setNewAgentPreset('none');
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

  const startEditAgent = (agent: any) => {
    setEditingAgent(agent);
    setNewAgentName(agent.name);
    setNewAgentRole(agent.role);
    setNewAgentProvider(normalizeProviderId(agent.provider));
    setNewAgentModel(agent.modelName || '');
    setNewAgentModelCustom(false);
    setNewAgentPrompt(agent.systemPrompt);
    setNewAgentSkills(agent.skills || []);
    setSkillPreview(null);
    setNewAgentPreset(agent.cliPreset || 'none');
    setNewAgentCommand(agent.command || '');
    setNewAgentStdinFormat(agent.stdinFormat || 'text');
    setNewAgentPermissionMode(agent.permissionMode || 'safe');
    setEditingSkillSource('skills');
    setActiveTab(`Agent:${agent.name}`);
  };

  const handleSaveAgent = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectPath || !newAgentName.trim() || !newAgentRole.trim() || !newAgentPrompt.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      if (editingAgent && editingAgent.name.toLowerCase() !== newAgentName.trim().toLowerCase()) {
        await api.deleteAgent(projectPath, editingAgent.name);
      }

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
      setLoading(false);
    }
  };

  const handleAddTeamPreset = async (presetName: string) => {
    if (!projectPath) return;
    const preset = teamPresets.find(team => team.name === presetName);
    if (!preset) return;

    const existingNames = new Set((projectData?.agents || []).map((agent: any) => String(agent.name).toLowerCase()));
    const templatesToAdd = preset.roles
      .map(roleName => agentPersonaTemplates.find(template => template.name === roleName))
      .filter((template): template is typeof agentPersonaTemplates[number] => !!template)
      .filter(template => !existingNames.has(template.name.toLowerCase()));

    if (templatesToAdd.length === 0) {
      setErrorMsg('All AI members in this team already exist in the workspace.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      for (const template of templatesToAdd) {
        const provider = normalizeProviderId(template.provider);
        const modelOptions = getModelOptions(provider, 'none');
        const defaultModel = modelOptions[0]?.value;
        const skillFiles = await ensureTemplateSkills(template.skills);
        const res = await api.saveAgent(projectPath, {
          name: template.name,
          role: template.role,
          provider,
          modelName: defaultModel,
          systemPrompt: template.prompt,
          skills: skillFiles
        });

        if (!res.success) {
          setErrorMsg(res.error || `Failed to add ${template.name}.`);
          return;
        }
      }

      await loadProjectData(projectPath);
      setSelectedDiscussionAgents(prev => Array.from(new Set([...prev, ...templatesToAdd.map(template => template.name)])));
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to add team preset.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAgent = async (agentName: string) => {
    if (!projectPath) return;
    const confirmDelete = window.confirm(`Are you sure you want to delete the agent "${agentName}"?`);
    if (!confirmDelete) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.deleteAgent(projectPath, agentName);
      if (res.success) {
        await loadProjectData(projectPath);
        if (activeTab === `Agent:${agentName}`) {
          setActiveTab('AI Members');
          resetAgentForm();
        }
      } else {
        setErrorMsg(res.error || 'Failed to delete agent.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while deleting agent.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustomSkill = async () => {
    if (!projectPath || !customSkillName.trim()) return;
    const rawName = customSkillName.trim();
    const rawDesc = customSkillDesc.trim();
    const formattedName = rawName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const filename = `${formattedName}.md`;
    const defaultContent = `# ${rawName} Skill\n\n${rawDesc || 'Instructions and rules for ' + rawName + '.'}\n`;

    setLoading(true);
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
      setLoading(false);
    }
  };

  const handleSaveEditingSkill = async () => {
    if (!projectPath || !editingSkillFile.trim()) return;
    setLoading(true);
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
      setLoading(false);
    }
  };

  const handlePreviewAgentSkills = async () => {
    if (!projectPath) return;
    setLoading(true);
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
      setLoading(false);
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
    handleRoleChange,
    ensureTemplateSkills,
    resetAgentForm,
    startEditAgent,
    handleSaveAgent,
    handleAddTeamPreset,
    handleDeleteAgent,
    handleAddCustomSkill,
    handleSaveEditingSkill,
    handlePreviewAgentSkills
  };
}
