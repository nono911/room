import React, { useState, useEffect } from 'react';

// Imported types for ROOM
import type {
  ProjectData,
  ContextPickerItem,
  SkillPreviewResult,
  TaskBoardCard,
  UIMessage,
  LocalCliPermissionMode,
  ProjectConfigState,
  TemplateSkill
} from './types/domain.js';
import { api } from './shared/ipc/client.js';
import {
  formatAgentDisplayName,
  formatDiscussionLogMessages,
  getAgentProgressMessage,
  advanceAgentProgressMessage,
  getDiscussionIdFromFile
} from './shared/lib/streaming.js';
import { useProviders } from './features/providers/context/ProvidersContext.js';
import { useTaskRun } from './features/task-run/useTaskRun.js';

// Layout and Onboarding components
import { Sidebar } from './shared/components/Sidebar.js';
import { ContextPanel } from './shared/components/ContextPanel.js';
import { ErrorBanner } from './shared/components/ErrorBanner.js';
import { SetupChecklist } from './components/onboarding/SetupChecklist.js';
import { OnboardingTour } from './components/onboarding/OnboardingTour.js';
import { ContextPickerPanel } from './components/context/ContextPickerPanel.js';

// Screens
import { OverviewScreen } from './components/screens/OverviewScreen.js';
import { FilesScreen } from './features/workspace-files/components/FilesScreen.js';
import { AIMembersScreen } from './features/ai-members/components/AIMembersScreen.js';
import { AgentEditorScreen } from './features/ai-members/components/AgentEditorScreen.js';
import { DiscussionsScreen } from './components/screens/DiscussionsScreen.js';
import { TaskRunScreen } from './features/task-run/components/TaskRunScreen.js';
import { DocumentsScreen } from './features/workspace-files/components/DocumentsScreen.js';
import { TaskArchiveScreen } from './features/workspace-files/components/TaskArchiveScreen.js';
import { ContextScreen } from './features/workspace-files/components/ContextScreen.js';
import { DecisionsScreen } from './features/workspace-files/components/DecisionsScreen.js';
import { McpServersScreen } from './features/mcp/components/McpServersScreen.js';
import { SettingsScreen } from './features/providers/components/SettingsScreen.js';

import {
  normalizeProviderId,
  taskTypeOptions,
  agentPersonaTemplates,
  teamPresets
} from './shared/data/staticData.js';

export default function App() {
  const {
    dynamicCliModels,
    getModelOptions,
    fetchModelsForProvider
  } = useProviders();
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [isRoomProject, setIsRoomProject] = useState<boolean>(false);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Discussions');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Recent projects state loaded from localStorage
  const [recentProjects, setRecentProjects] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('recentProjects');
      if (saved) {
        return JSON.parse(saved);
      }
      return [];
    } catch {
      return [];
    }
  });

  // Form states for creating custom agents
  const [newAgentName, setNewAgentName] = useState<string>('');
  const [newAgentRole, setNewAgentRole] = useState<string>('');
  const [newAgentProvider, setNewAgentProvider] = useState<string>('gemini');
  const [newAgentCommand, setNewAgentCommand] = useState<string>('');
  const [newAgentPrompt, setNewAgentPrompt] = useState<string>('');
  const [newAgentSkills, setNewAgentSkills] = useState<string[]>([]);
  const [newAgentPreset, setNewAgentPreset] = useState<'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none'>('none');
  const [newAgentStdinFormat, setNewAgentStdinFormat] = useState<'text' | 'json'>('text');
  const [newAgentPermissionMode, setNewAgentPermissionMode] = useState<LocalCliPermissionMode>('safe');
  const [showContextPanel, setShowContextPanel] = useState<boolean>(false);
  const [editingAgent, setEditingAgent] = useState<any | null>(null);
  const [showOnboardingTour, setShowOnboardingTour] = useState<boolean>(false);
  const [onboardingStep, setOnboardingStep] = useState<number>(0);
  const [dismissedOnboarding, setDismissedOnboarding] = useState<boolean>(false);
  const [onboardingSessionDismissed, setOnboardingSessionDismissed] = useState<boolean>(false);
  const [hasCompletedScan, setHasCompletedScan] = useState<boolean>(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);

  // Custom workspace control states
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
  const [customSkillName, setCustomSkillName] = useState<string>('');
  const [customSkillDesc, setCustomSkillDesc] = useState<string>('');
  const [editingSkillFile, setEditingSkillFile] = useState<string>('');
  const [editingSkillContent, setEditingSkillContent] = useState<string>('');
  const [editingSkillSource, setEditingSkillSource] = useState<'skills' | 'roles'>('skills');
  const [skillPreview, setSkillPreview] = useState<SkillPreviewResult | null>(null);
  const [newAgentModel, setNewAgentModel] = useState<string>('');
  const [newAgentModelCustom, setNewAgentModelCustom] = useState<boolean>(false);
  const [selectedDiscussionAgents, setSelectedDiscussionAgents] = useState<string[]>([]);
  const [contextPickerTarget, setContextPickerTarget] = useState<'discussion' | 'task' | null>(null);
  const [contextPickerQuery, setContextPickerQuery] = useState<string>('');
  const [contextPickerTab, setContextPickerTab] = useState<'Suggested' | 'Tasks' | 'Docs' | 'Files'>('Suggested');
  const [contextPickerItems, setContextPickerItems] = useState<ContextPickerItem[]>([]);
  const [contextPickerLoading, setContextPickerLoading] = useState<boolean>(false);



  // Main Workspace Agent & Visual Customizer State
  const [projectConfig, setProjectConfig] = useState<ProjectConfigState>({ mainAgent: 'none', allowDangerousCli: false });
  const [contentTheme, setContentTheme] = useState<string>(() => localStorage.getItem('room_theme') || 'default');
  const [contentFontFamily, setContentFontFamily] = useState<string>(() => localStorage.getItem('room_font_family') || 'system-ui');
  const [contentFontSize, setContentFontSize] = useState<string>(() => localStorage.getItem('room_font_size') || '16px');
  const [contentLineHeight, setContentLineHeight] = useState<string>(() => localStorage.getItem('room_line_height') || '1.6');
  const [discussionReviewMode, setDiscussionReviewMode] = useState<boolean>(true);
  const [discussionMaxRounds, setDiscussionMaxRounds] = useState<number>(6);
  const [discussionQualityGate, setDiscussionQualityGate] = useState<boolean>(false);
  const [discussionModeratorName, setDiscussionModeratorName] = useState<string>('');
  const [discussionAutoSummary, setDiscussionAutoSummary] = useState<boolean>(false);
  const [discussionSummaryAgentName, setDiscussionSummaryAgentName] = useState<string>('__project__');
  const [selectedDiscussionContextRefs, setSelectedDiscussionContextRefs] = useState<string[]>(['workspace:overview', 'workspace:structure']);
  const {
    codingTaskInput, setCodingTaskInput,
    taskRunType,
    codingTaskMessages, setCodingTaskMessages,
    codingTaskDeveloperName, setCodingTaskDeveloperName,
    codingTaskReviewerNames, setCodingTaskReviewerNames,
    codingTaskMaxCycles, setCodingTaskMaxCycles,
    selectedCodingTaskContextRefs, setSelectedCodingTaskContextRefs,
    lastCodingTaskResult, setLastCodingTaskResult,
    taskRunView, setTaskRunView,
    openRounds, setOpenRounds,
    expandedMsgKeys, setExpandedMsgKeys,
    setLastMaxRound,
    handleRunCodingTask,
    applyTaskTypePreset
  } = useTaskRun({
    projectPath,
    projectData,
    loadProjectData: (p: string) => loadProjectData(p),
    setLoading,
    setErrorMsg
  });
  const [activeDiscussionId, setActiveDiscussionId] = useState<string | null>(null);
  const [lastDiscussionLog, setLastDiscussionLog] = useState<any | null>(null);
  const [taskBoardCards, setTaskBoardCards] = useState<TaskBoardCard[]>([]);
  const [showInspector, setShowInspector] = useState(false);
  const [lastDiscussionTopic, setLastDiscussionTopic] = useState<string>('');
  const [initialSelectedFile, setInitialSelectedFile] = useState<{ section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null>(null);
  const [highlightedDiscussionMessage, setHighlightedDiscussionMessage] = useState<number | null>(null);
  const [aiMembersSidebarExpanded, setAiMembersSidebarExpanded] = useState<boolean>(() => localStorage.getItem('room_ai_members_sidebar_expanded') === 'true');
  const [aiMemberDetailsExpanded, setAiMemberDetailsExpanded] = useState<boolean>(() => localStorage.getItem('room_ai_member_details_expanded') !== 'false');

  useEffect(() => {
    if (!projectPath || !contextPickerTarget) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setContextPickerLoading(true);
      try {
        const res = await api.searchContextItems(projectPath, contextPickerQuery);
        if (cancelled) return;
        if (res.success) {
          setContextPickerItems(res.items || []);
        } else {
          setContextPickerItems([]);
          setErrorMsg(res.error || 'Failed to search context.');
        }
      } catch (err: any) {
        if (!cancelled) {
          setContextPickerItems([]);
          setErrorMsg(err.message || 'Failed to search context.');
        }
      } finally {
        if (!cancelled) {
          setContextPickerLoading(false);
        }
      }
    }, contextPickerQuery.trim() ? 180 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectPath, contextPickerTarget, contextPickerQuery]);

  useEffect(() => {
    if (!projectPath || !isRoomProject || !projectData || onboardingSessionDismissed) return;
    const key = `room_onboarding_seen:${projectPath}`;
    const seen = localStorage.getItem(key) === 'true';
    setDismissedOnboarding(seen);
    if (!seen) {
      setOnboardingStep(0);
      setShowOnboardingTour(true);
    }
  }, [projectPath, isRoomProject, projectData, onboardingSessionDismissed]);

  useEffect(() => {
    if (!scanStartedAt) return;
    const messages = [
      'Scanning repository files and detecting project structure...',
      'Updating readable workspace overview and structure...',
      projectConfig.mainAgent && projectConfig.mainAgent !== 'none'
        ? 'Running the configured main agent to enrich the workspace overview...'
        : 'Refreshing workspace metadata...'
    ];
    setScanStatus(messages[0]);
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - scanStartedAt;
      const index = elapsed > 7000 ? 2 : elapsed > 2500 ? 1 : 0;
      setScanStatus(messages[index]);
    }, 500);
    return () => window.clearInterval(interval);
  }, [scanStartedAt, projectConfig.mainAgent]);

  // Fetch dynamic models when Local CLI preset or provider changes
  useEffect(() => {
    if (newAgentProvider) {
      fetchModelsForProvider(newAgentProvider, newAgentPreset);
    }
  }, [newAgentProvider, newAgentPreset]);

  // Sync newAgentModel when options become available
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

  // User input topic and timeline state
  const [userInputTopic, setUserInputTopic] = useState<string>('');
  const [discussionMessages, setDiscussionMessages] = useState<UIMessage[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState<string>('');

  const clearWorkspaceDerivedState = () => {
    setProjectData(null);
    setDiscussionMessages([]);
    setCodingTaskMessages([]);
    setOpenRounds({});
    setExpandedMsgKeys({});
    setLastMaxRound(-1);
    setActiveDiscussionId(null);
    setLastDiscussionLog(null);
    setLastDiscussionTopic('');
    setLastCodingTaskResult(null);
    setSelectedDiscussionContextRefs(['workspace:overview', 'workspace:structure']);
    setSelectedCodingTaskContextRefs(['workspace:overview', 'workspace:structure']);
    setContextPickerTarget(null);
    setContextPickerItems([]);
    setShowOnboardingTour(false);
    setDismissedOnboarding(false);
    setOnboardingSessionDismissed(false);
    setHasCompletedScan(false);
    setScanStatus('');
    setScanStartedAt(null);
    setActiveTab('Discussions');
  };

  const addRecentProject = (pathStr: string) => {
    setRecentProjects(prev => {
      const filtered = prev.filter(p => p !== pathStr);
      const updated = [pathStr, ...filtered].slice(0, 5); // Keep up to 5 unique paths
      localStorage.setItem('recentProjects', JSON.stringify(updated));
      return updated;
    });
  };

  const handleOpenProject = async () => {
    setErrorMsg(null);
    try {
      const result = await api.selectProjectDir();
      if (!result) return;

      clearWorkspaceDerivedState();
      setProjectPath(result.path);
      setIsRoomProject(result.isRoomProject);

      addRecentProject(result.path);

      if (result.isRoomProject) {
        await loadProjectData(result.path);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to open project.');
    }
  };

  const handleCreateWorkspace = async () => {
    const workspaceName = newWorkspaceName.trim();
    if (!workspaceName) {
      setErrorMsg('Workspace name is required.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.createWorkspace(workspaceName);
      if (!result) return;
      if (!result.success || !result.path) {
        setErrorMsg(result.error || 'Failed to create workspace.');
        return;
      }

      clearWorkspaceDerivedState();
      setProjectPath(result.path);
      setIsRoomProject(true);
      setNewWorkspaceName('');
      addRecentProject(result.path);
      await loadProjectData(result.path);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create workspace.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRecentProject = async (pathStr: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await api.openProjectDir(pathStr);
      if (!result) {
        throw new Error('Project directory could not be accessed.');
      }

      clearWorkspaceDerivedState();
      setProjectPath(result.path);
      setIsRoomProject(result.isRoomProject);

      addRecentProject(result.path);

      if (result.isRoomProject) {
        await loadProjectData(result.path);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to open recent project. It might have been deleted or moved.');
      // Remove stale path from the list
      setRecentProjects(prev => {
        const filtered = prev.filter(p => p !== pathStr);
        localStorage.setItem('recentProjects', JSON.stringify(filtered));
        return filtered;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInitProject = async () => {
    if (!projectPath) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.roomInit(projectPath);
      if (res.success) {
        clearWorkspaceDerivedState();
        setIsRoomProject(true);
        addRecentProject(projectPath);
        setProjectPath(projectPath);
        await loadProjectData(projectPath);
      } else {
        setErrorMsg(res.error || 'Failed to initialize .room.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize project.');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseProjectWorkspace = () => {
    setProjectPath(null);
    setIsRoomProject(false);
    clearWorkspaceDerivedState();
  };

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
    setNewAgentRole('');
    setNewAgentProvider('gemini');
    setNewAgentModel('');
    setNewAgentModelCustom(false);
    setNewAgentCommand('');
    setNewAgentPrompt('');
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

  const handleSaveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const loadWorkspaceCoreData = async (pathStr: string) => {
    const data = await api.getProjectData(pathStr);
    if (data.success) {
      setHasCompletedScan(!!localStorage.getItem(`room_scan_completed:${pathStr}`) || !!data.hasScanData);
      setProjectData({
        projectMd: data.projectMd,
        archMd: data.archMd,
        hasScanData: data.hasScanData,
        tasks: data.tasks,
        taskRuns: data.taskRuns || [],
        decisions: data.decisions,
        reviews: data.reviews || [],
        documents: data.documents || [],
        discussions: data.discussions,
        skills: data.skills,
        agents: data.agents || []
      });
      return data;
    } else {
      setErrorMsg(data.error || 'Failed to load project metadata.');
      return null;
    }
  };

  const selectDefaultAgents = (agents: any[]) => {
    if (agents && agents.length > 0) {
      const names = agents.map((a: any) => a.name);
      setSelectedDiscussionAgents(prev => {
        const validPrev = prev.filter(name => names.includes(name));
        if (validPrev.length > 0) return validPrev;
        return names.slice(0, 2);
      });
      const developerCandidate = agents.find((agent: any) => {
        const text = `${agent.name} ${agent.role}`.toLowerCase();
        return text.includes('developer') || text.includes('implement') || text.includes('engineer') || text.includes('coder');
      }) || agents[0];
      setCodingTaskDeveloperName(prev => names.includes(prev) ? prev : developerCandidate?.name || '');
      setCodingTaskReviewerNames(prev => {
        const validPrev = prev.filter(name => names.includes(name));
        if (validPrev.length > 0) return validPrev;
        return agents
          .filter((agent: any) => {
            const text = `${agent.name} ${agent.role}`.toLowerCase();
            return text.includes('review') || text.includes('senior') || text.includes('qa');
          })
          .map((agent: any) => agent.name)
          .slice(0, 2);
      });
    } else {
      setSelectedDiscussionAgents([]);
      setCodingTaskDeveloperName('');
      setCodingTaskReviewerNames([]);
    }
  };

  const loadProjectConfig = async (pathStr: string) => {
    try {
      const configRes = await api.loadProjectConfig(pathStr);
      if (configRes.success && configRes.config) {
        setProjectConfig({
          mainAgent: configRes.config.mainAgent || 'none',
          modelName: configRes.config.modelName,
          allowDangerousCli: !!configRes.config.allowDangerousCli
        });
      }
    } catch (err) {
      console.error('Error loading project configuration:', err);
    }
  };

  const loadProjectData = async (pathStr: string) => {
    try {
      const data = await loadWorkspaceCoreData(pathStr);
      if (data) {
        selectDefaultAgents(data.agents || []);
        await loadProjectConfig(pathStr);
        await loadTaskBoardCards(pathStr);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error fetching project data.');
    }
  };



  /*
  const triggerScan = async () => {
    if (!projectPath) return;
    const finishScanStatus = (message: string) => {
      setScanStartedAt(null);
      setScanStatus(message);
      window.setTimeout(() => {
        setScanStatus(current => current === message ? '' : current);
      }, 4000);
    };
    setLoading(true);
    setErrorMsg(null);
    setScanStartedAt(Date.now());
    setScanStatus('Starting repository scan...');
    try {
      const res = await api.runScan(projectPath, projectConfig.mainAgent, projectConfig.modelName, !!projectConfig.allowDangerousCli);
      if (!res.success) {
        finishScanStatus('Scan failed.');
        setErrorMsg(res.error || 'Scan failed.');
        return;
      }
      setScanStatus('Refreshing ROOM workspace data...');
      localStorage.setItem(`room_scan_completed:${projectPath}`, new Date().toISOString());
      setHasCompletedScan(true);
      await loadProjectData(projectPath);
      finishScanStatus('Scan complete. Workspace context is up to date.');
    } catch (err: any) {
      finishScanStatus('Scan failed.');
      setErrorMsg(err.message || 'Scan failed.');
    } finally {
      setLoading(false);
    }
  };
  */

  const handleUpdateProjectConfig = async (key: keyof ProjectConfigState, value: string | boolean) => {
    if (!projectPath) return;
    const newConfig: ProjectConfigState = { ...projectConfig, [key]: value };
    if (key === 'mainAgent') {
      newConfig.modelName = '';
      newConfig.allowDangerousCli = false;
    }
    setProjectConfig(newConfig);
    try {
      await api.saveProjectConfig(projectPath, newConfig);
      if (key === 'mainAgent' && typeof value === 'string' && value !== 'none') {
        const res = await api.detectCliModels(value);
        if (res.success && res.models && res.models.length > 0) {
          const models = res.models;
          const updatedConfig = { ...newConfig, modelName: models[0].value };
          setProjectConfig(updatedConfig);
          await api.saveProjectConfig(projectPath, updatedConfig);
        }
      }
    } catch (err) {
      console.error('Failed to save project settings:', err);
    }
  };

  const enableTaskRunWriteAccess = async () => {
    if (!projectPath || !codingTaskDeveloperName) return;
    const developer = (projectData?.agents || []).find((agent: any) => agent.name === codingTaskDeveloperName);
    if (!developer || developer.provider !== 'Local CLI') return;

    const confirmed = window.confirm('Allow this Local CLI Developer to write in the workspace for coding tasks? This enables dangerous permissions for the selected AI member and dangerous workspace CLI permissions for this project.');
    if (!confirmed) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const nextProjectConfig = { ...projectConfig, allowDangerousCli: true };
      setProjectConfig(nextProjectConfig);
      await api.saveProjectConfig(projectPath, nextProjectConfig);

      const res = await api.saveAgent(projectPath, {
        ...developer,
        permissionMode: 'dangerous'
      });
      if (!res.success) {
        setErrorMsg(res.error || 'Failed to enable write access for this Developer.');
        return;
      }

      await loadProjectData(projectPath);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to enable write access for this Developer.');
    } finally {
      setLoading(false);
    }
  };



  const loadRoomFilePreview = async (
    section: 'skills' | 'documents' | 'decisions' | 'tasks' | 'reviews' | 'discussions',
    filename: string
  ) => {
    if (!projectPath || !filename) return;
    if (section === 'skills') {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await api.readRoomFile(projectPath, section, filename);
        if (!res.success) {
          setErrorMsg(res.error || `Failed to load ${filename}.`);
          return;
        }
        setEditingSkillFile(filename);
        setEditingSkillContent(res.content || '');
        setEditingSkillSource(res.sourceSection === 'roles' ? 'roles' : 'skills');
      } catch (err: any) {
        setErrorMsg(err.message || `Failed to load ${filename}.`);
      } finally {
        setLoading(false);
      }
    } else {
      setInitialSelectedFile({ section, file: filename });
    }
  };

  const openContextPicker = (target: 'discussion' | 'task') => {
    setContextPickerTarget(target);
    setContextPickerQuery('');
    setContextPickerTab('Suggested');
  };

  const closeContextPicker = () => {
    setContextPickerTarget(null);
  };

  const getContextSelection = (target: 'discussion' | 'task') => (
    target === 'discussion' ? selectedDiscussionContextRefs : selectedCodingTaskContextRefs
  );

  const setContextSelection = (target: 'discussion' | 'task', refs: string[]) => {
    if (target === 'discussion') {
      setSelectedDiscussionContextRefs(refs);
    } else {
      setSelectedCodingTaskContextRefs(refs);
    }
  };

  const toggleContextSelection = (target: 'discussion' | 'task', ref: string) => {
    const selectedRefs = getContextSelection(target);
    setContextSelection(
      target,
      selectedRefs.includes(ref)
        ? selectedRefs.filter(item => item !== ref)
        : [...selectedRefs, ref]
    );
  };

  const getContextLabel = (ref: string) => {
    if (ref === 'workspace:overview') return 'Workspace Overview';
    if (ref === 'workspace:structure') return 'Workspace Structure';
    const known = contextPickerItems.find(item => item.ref === ref);
    if (known) return known.label;
    if (ref.startsWith('task:')) return `Task: ${ref.slice('task:'.length)}`;
    if (ref.startsWith('document:')) return `Doc: ${ref.slice('document:'.length)}`;
    if (ref.startsWith('discussion:')) return `Chat: ${ref.slice('discussion:'.length)}`;
    if (ref.startsWith('file:')) return `File: ${ref.slice('file:'.length)}`;
    return ref;
  };

  const getFilteredContextItems = () => {
    if (contextPickerTab === 'Tasks') {
      return contextPickerItems.filter(item => item.type === 'task' || /task|todo|plan|issue|bug|ticket|backlog/i.test(`${item.label} ${item.path || ''}`));
    }
    if (contextPickerTab === 'Docs') {
      return contextPickerItems.filter(item => item.type === 'doc' || item.type === 'workspace');
    }
    if (contextPickerTab === 'Files') {
      return contextPickerItems.filter(item => item.type === 'file');
    }
    return contextPickerItems;
  };

  const estimateContextTokens = (target: 'discussion' | 'task') => {
    const selectedRefs = getContextSelection(target);
    const bytes = selectedRefs.reduce((total, ref) => {
      const item = contextPickerItems.find(candidate => candidate.ref === ref);
      return total + (item?.size || 12000);
    }, 0);
    return Math.max(selectedRefs.length * 80, Math.round(bytes / 4));
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

  const handleSendDiscussion = async () => {
    if (!userInputTopic.trim() || !projectPath) return;
    const availableAgentNames = new Set((projectData?.agents || []).map((agent: any) => agent.name));
    const validSelectedAgents = selectedDiscussionAgents.filter(name => availableAgentNames.has(name));
    if (selectedDiscussionAgents.length === 0) {
      setErrorMsg('Please select at least one participating agent.');
      return;
    }
    if (validSelectedAgents.length === 0) {
      setErrorMsg('Selected agents are not available in this workspace.');
      return;
    }
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
        const contextSummary = contextCount > 0
          ? `Context: topic + ${contextCount} prior message${contextCount === 1 ? '' : 's'}`
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
              contextSummary
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
              contextSummary
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
      const res = await api.runDiscussion(projectPath, userTopic, validSelectedAgents, {
        reviewMode: discussionReviewMode,
        maxRounds: discussionReviewMode ? discussionMaxRounds : 1,
        contextRefs,
        discussionId: activeDiscussionId || undefined,
        qualityGate: discussionQualityGate,
        moderatorName: discussionModeratorName || undefined,
        autoSummary: discussionAutoSummary,
        summaryAgentName: discussionSummaryAgentName !== '__project__' ? discussionSummaryAgentName : undefined,
        useProjectSummaryAgent: discussionSummaryAgentName === '__project__'
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendDiscussion();
    }
  };



  const onboardingSteps = [
    {
      title: 'ROOM starts with shared project memory',
      body: 'Keep a short workspace overview and attach the files, notes, or documents that should guide discussions, tasks, and decisions.',
      action: 'Open Context',
      run: () => setActiveTab('Context')
    },
    {
      title: 'AI Members are reusable teammates',
      body: 'Create role-based agents from templates, choose a provider, assign skills, and check that the selected skills can be delivered.',
      action: 'Open AI Members',
      run: () => setActiveTab('AI Members')
    },
    {
      title: 'Skills are reusable instructions',
      body: 'Skills are Markdown files. You can edit them, assign them to agents, and use Check Skills to confirm they will be sent at runtime.',
      action: 'Create Agent',
      run: () => {
        resetAgentForm();
        setActiveTab('Agent:New');
      }
    },
    {
      title: 'Context Picker keeps large repos manageable',
      body: 'Use Add Context in Discussions or Task Run to attach the docs, tasks, and files that should become the evidence trail for the run.',
      action: 'Open Discussions',
      run: () => setActiveTab('Discussions')
    },
    {
      title: 'Runs leave a traceable trail',
      body: 'Give one agent the work, choose reviewers, and let ROOM keep the message references, created tasks, ADRs, and artifacts connected.',
      action: 'Open Task Run',
      run: () => setActiveTab('Task Run')
    }
  ];

  const markOnboardingSeen = () => {
    if (projectPath) {
      localStorage.setItem(`room_onboarding_seen:${projectPath}`, 'true');
    }
    setDismissedOnboarding(true);
    setOnboardingSessionDismissed(true);
    setShowOnboardingTour(false);
  };

  const isPlaceholderContext = (content?: string) => {
    const normalized = (content || '').trim();
    if (!normalized) return true;
    return normalized.includes('Describe what this workspace is for.') ||
      normalized.includes('Describe the important parts of this workspace and how they relate to each other.');
  };

  const hasUsefulContext = (hasCompletedScan || !!projectData?.hasScanData) && !!projectData && (
    !isPlaceholderContext(projectData.projectMd) ||
    !isPlaceholderContext(projectData.archMd)
  );

  const setupItems = [
    {
      label: 'Review workspace context',
      done: hasUsefulContext,
      action: 'Open',
      run: () => setActiveTab('Context')
    },
    {
      label: 'Create AI member',
      done: (projectData?.agents || []).length > 0,
      action: 'Open',
      run: () => setActiveTab('AI Members')
    },
    {
      label: 'Add or edit skills',
      done: (projectData?.skills || []).length > 0,
      action: 'Edit',
      run: () => {
        resetAgentForm();
        setActiveTab('Agent:New');
      }
    },
    {
      label: 'Attach useful context',
      done: selectedDiscussionContextRefs.length > 2 || selectedCodingTaskContextRefs.length > 2,
      action: 'Pick',
      run: () => openContextPicker(activeTab === 'Task Run' ? 'task' : 'discussion')
    },
    {
      label: 'Create a traceable run',
      done: discussionMessages.length > 0 || codingTaskMessages.length > 0 || (projectData?.discussions || []).length > 0 || (projectData?.tasks || []).length > 0,
      action: 'Start',
      run: () => setActiveTab('Discussions')
    }
  ];

  const renderMainTab = () => {
    if (activeTab === 'Discussions') {
      return (
        <DiscussionsScreen
          projectData={projectData}
          activeDiscussionId={activeDiscussionId}
          summarizeActiveDiscussion={summarizeActiveDiscussion}
          startNewDiscussion={startNewDiscussion}
          loading={loading}
          loadDiscussionSession={loadDiscussionSession}
          discussionMessages={discussionMessages}
          openContextPicker={openContextPicker}
          highlightedDiscussionMessage={highlightedDiscussionMessage}
          scrollToDiscussionMessage={scrollToDiscussionMessage}
          loadRoomFilePreview={loadRoomFilePreview}
          setActiveTab={setActiveTab}
          selectedDiscussionContextRefs={selectedDiscussionContextRefs}
          estimateContextTokens={estimateContextTokens}
          setContextSelection={setContextSelection}
          toggleContextSelection={toggleContextSelection}
          getContextLabel={getContextLabel}
          selectedDiscussionAgents={selectedDiscussionAgents}
          setSelectedDiscussionAgents={setSelectedDiscussionAgents}
          discussionReviewMode={discussionReviewMode}
          setDiscussionReviewMode={setDiscussionReviewMode}
          discussionMaxRounds={discussionMaxRounds}
          setDiscussionMaxRounds={setDiscussionMaxRounds}
          discussionQualityGate={discussionQualityGate}
          setDiscussionQualityGate={setDiscussionQualityGate}
          discussionModeratorName={discussionModeratorName}
          setDiscussionModeratorName={setDiscussionModeratorName}
          discussionAutoSummary={discussionAutoSummary}
          setDiscussionAutoSummary={setDiscussionAutoSummary}
          discussionSummaryAgentName={discussionSummaryAgentName}
          setDiscussionSummaryAgentName={setDiscussionSummaryAgentName}
          projectConfig={projectConfig}
          userInputTopic={userInputTopic}
          setUserInputTopic={setUserInputTopic}
          handleKeyDown={handleKeyDown}
          handleSendDiscussion={handleSendDiscussion}
          lastDiscussionLog={lastDiscussionLog}
          saveDiscussionOutput={saveDiscussionOutput}
          generateTasksFromActiveDiscussion={generateTasksFromActiveDiscussion}
          showInspector={showInspector}
          setShowInspector={setShowInspector}
        />
      );
    }

    if (activeTab === 'Task Run') {
      return (
        <TaskRunScreen
          projectData={projectData}
          codingTaskMessages={codingTaskMessages}
          codingTaskDeveloperName={codingTaskDeveloperName}
          setCodingTaskDeveloperName={setCodingTaskDeveloperName}
          taskRunType={taskRunType}
          applyTaskTypePreset={applyTaskTypePreset}
          taskTypeOptions={taskTypeOptions}
          codingTaskInput={codingTaskInput}
          setCodingTaskInput={setCodingTaskInput}
          projectConfig={projectConfig}
          enableTaskRunWriteAccess={enableTaskRunWriteAccess}
          codingTaskReviewerNames={codingTaskReviewerNames}
          setCodingTaskReviewerNames={setCodingTaskReviewerNames}
          codingTaskMaxCycles={codingTaskMaxCycles}
          setCodingTaskMaxCycles={setCodingTaskMaxCycles}
          selectedCodingTaskContextRefs={selectedCodingTaskContextRefs}
          estimateContextTokens={estimateContextTokens}
          openContextPicker={openContextPicker}
          setContextSelection={setContextSelection}
          toggleContextSelection={toggleContextSelection}
          getContextLabel={getContextLabel}
          handleRunCodingTask={handleRunCodingTask}
          lastCodingTaskResult={lastCodingTaskResult}
          setLastCodingTaskResult={setLastCodingTaskResult}
          setCodingTaskMessages={setCodingTaskMessages}
          openRounds={openRounds}
          setOpenRounds={setOpenRounds}
          expandedMsgKeys={expandedMsgKeys}
          setExpandedMsgKeys={setExpandedMsgKeys}
          scrollToDiscussionMessage={scrollToDiscussionMessage}
          setActiveTab={setActiveTab}
          loadRoomFilePreview={loadRoomFilePreview}
          loading={loading}
          taskRunView={taskRunView}
          setTaskRunView={setTaskRunView}
        />
      );
    }

    if (activeTab === 'AI Members' || activeTab === 'Agents') {
      return (
        <AIMembersScreen
          projectData={projectData}
          aiMemberDetailsExpanded={aiMemberDetailsExpanded}
          setAiMemberDetailsExpanded={setAiMemberDetailsExpanded}
          resetAgentForm={resetAgentForm}
          setActiveTab={setActiveTab}
          teamPresets={teamPresets}
          loading={loading}
          setLoading={setLoading}
          handleAddTeamPreset={handleAddTeamPreset}
          startEditAgent={startEditAgent}
          handleDeleteAgent={handleDeleteAgent}
        />
      );
    }

    if (activeTab.startsWith('Agent:')) {
      return (
        <AgentEditorScreen
          activeTab={activeTab}
          projectData={projectData}
          newAgentProvider={newAgentProvider}
          newAgentPreset={newAgentPreset}
          newAgentModel={newAgentModel}
          newAgentName={newAgentName}
          setNewAgentName={setNewAgentName}
          editingAgent={editingAgent}
          resetAgentForm={resetAgentForm}
          setActiveTab={setActiveTab}
          handleDeleteAgent={handleDeleteAgent}
          handleSaveAgent={handleSaveAgent}
          errorMsg={errorMsg}
          setErrorMsg={setErrorMsg}
          agentPersonaTemplates={agentPersonaTemplates}
          setNewAgentRole={setNewAgentRole}
          setNewAgentPrompt={setNewAgentPrompt}
          ensureTemplateSkills={ensureTemplateSkills}
          setNewAgentSkills={setNewAgentSkills}
          projectPath={projectPath}
          loadProjectData={loadProjectData}
          newAgentRole={newAgentRole}
          handleRoleChange={handleRoleChange}
          setNewAgentProvider={setNewAgentProvider}
          setNewAgentPreset={setNewAgentPreset}
          setNewAgentPermissionMode={setNewAgentPermissionMode}
          setNewAgentModelCustom={setNewAgentModelCustom}
          setNewAgentModel={setNewAgentModel}
          setSkillPreview={setSkillPreview}
          newAgentModelCustom={newAgentModelCustom}
          newAgentCommand={newAgentCommand}
          setNewAgentCommand={setNewAgentCommand}
          newAgentStdinFormat={newAgentStdinFormat}
          setNewAgentStdinFormat={setNewAgentStdinFormat}
          newAgentPermissionMode={newAgentPermissionMode}
          newAgentSkills={newAgentSkills}
          editingSkillFile={editingSkillFile}
          setEditingSkillFile={setEditingSkillFile}
          loadRoomFilePreview={loadRoomFilePreview}
          skillPreview={skillPreview}
          handlePreviewAgentSkills={handlePreviewAgentSkills}
          editingSkillContent={editingSkillContent}
          setEditingSkillContent={setEditingSkillContent}
          editingSkillSource={editingSkillSource}
          setEditingSkillSource={setEditingSkillSource}
          handleSaveEditingSkill={handleSaveEditingSkill}
          customSkillName={customSkillName}
          setCustomSkillName={setCustomSkillName}
          customSkillDesc={customSkillDesc}
          setCustomSkillDesc={setCustomSkillDesc}
          handleAddCustomSkill={handleAddCustomSkill}
          newAgentPrompt={newAgentPrompt}
          loading={loading}
        />
      );
    }

    if (activeTab === 'Context' || activeTab === 'Architecture') {
      return (
        <ContextScreen
          projectPath={projectPath}
          projectData={projectData}
          loadWorkspaceCoreData={loadWorkspaceCoreData}
          setErrorMsg={setErrorMsg}
        />
      );
    }

    if (activeTab === 'Decisions') {
      return (
        <DecisionsScreen
          projectPath={projectPath}
          projectData={projectData}
          initialSelectedFile={initialSelectedFile}
          setInitialSelectedFile={setInitialSelectedFile}
          setErrorMsg={setErrorMsg}
        />
      );
    }

    if (activeTab === 'Tasks') {
      return (
        <TaskArchiveScreen
          projectPath={projectPath}
          projectData={projectData}
          taskBoardCards={taskBoardCards}
          initialSelectedFile={initialSelectedFile}
          setInitialSelectedFile={setInitialSelectedFile}
          setErrorMsg={setErrorMsg}
        />
      );
    }

    if (activeTab === 'Documents' || activeTab === 'Reviews') {
      return (
        <DocumentsScreen
          projectPath={projectPath}
          projectData={projectData}
          initialSelectedFile={initialSelectedFile}
          setInitialSelectedFile={setInitialSelectedFile}
          setErrorMsg={setErrorMsg}
        />
      );
    }

    if (activeTab === 'Files') {
      return (
        <FilesScreen
          projectPath={projectPath}
          setErrorMsg={setErrorMsg}
        />
      );
    }

    if (activeTab === 'Overview') {
      return (
        <OverviewScreen
          projectData={projectData}
        />
      );
    }

    if (activeTab === 'MCP Servers') {
      return (
        <McpServersScreen
          projectPath={projectPath}
          setErrorMsg={setErrorMsg}
        />
      );
    }

    if (activeTab === 'Settings') {
      return (
        <SettingsScreen
          loading={loading}
          projectConfig={projectConfig}
          handleUpdateProjectConfig={handleUpdateProjectConfig}
          contentTheme={contentTheme}
          setContentTheme={setContentTheme}
          contentFontFamily={contentFontFamily}
          setContentFontFamily={setContentFontFamily}
          contentFontSize={contentFontSize}
          setContentFontSize={setContentFontSize}
          contentLineHeight={contentLineHeight}
          setContentLineHeight={setContentLineHeight}
          projectAgents={projectData?.agents || []}
        />
      );
    }

    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--text-muted))' }}>
        <h3>{activeTab} Workspace Module</h3>
        <p style={{ marginTop: '12px', fontSize: '0.9rem' }}>This component is scheduled to be wired in a subsequent sprint.</p>
      </div>
    );
  };

  const themeStyles: Record<string, string> = {
    ocean: `
      :root {
        --bg-app: 215 40% 4%;
        --bg-sidebar: 215 40% 6%;
        --bg-panel: 215 35% 8%;
        --bg-card: 215 30% 12%;
        --bg-input: 215 30% 10%;
        --accent-purple: 195 90% 50%;
        --accent-blue: 210 90% 55%;
        --glow-purple: rgba(34, 211, 238, 0.15);
        --border-glow: 195 80% 40% / 0.3;
        --border-focus: 210 90% 60% / 0.6;
      }
    `,
    forest: `
      :root {
        --bg-app: 140 30% 3%;
        --bg-sidebar: 140 30% 5%;
        --bg-panel: 140 25% 7%;
        --bg-card: 140 20% 11%;
        --bg-input: 140 20% 9%;
        --accent-purple: 142 70% 50%;
        --accent-blue: 84 70% 50%;
        --glow-purple: rgba(34, 197, 94, 0.15);
        --border-glow: 142 60% 40% / 0.3;
        --border-focus: 142 80% 50% / 0.6;
      }
    `,
    twilight: `
      :root {
        --bg-app: 280 40% 4%;
        --bg-sidebar: 280 40% 6%;
        --bg-panel: 280 35% 8%;
        --bg-card: 280 30% 12%;
        --bg-input: 280 30% 10%;
        --accent-purple: 295 85% 60%;
        --accent-blue: 320 85% 60%;
        --glow-purple: rgba(217, 70, 239, 0.15);
        --border-glow: 295 80% 50% / 0.3;
        --border-focus: 295 90% 65% / 0.6;
      }
    `,
    nord: `
      :root {
        --bg-app: 220 16% 12%;
        --bg-sidebar: 220 16% 14%;
        --bg-panel: 220 14% 17%;
        --bg-card: 220 12% 22%;
        --bg-input: 220 12% 19%;
        --accent-purple: 193 43% 67%;
        --accent-blue: 210 34% 63%;
        --glow-purple: rgba(136, 192, 208, 0.15);
        --border-glow: 193 40% 50% / 0.3;
        --border-focus: 210 40% 60% / 0.6;
      }
    `,
    cyberpunk: `
      :root {
        --bg-app: 0 0% 0%;
        --bg-sidebar: 0 0% 2%;
        --bg-panel: 0 0% 4%;
        --bg-card: 0 0% 9%;
        --bg-input: 0 0% 7%;
        --accent-purple: 24 95% 60%;
        --accent-blue: 180 100% 50%;
        --glow-purple: rgba(249, 115, 22, 0.15);
        --border-glow: 24 90% 50% / 0.4;
        --border-focus: 180 100% 50% / 0.6;
      }
    `
  };

  return (
    <>
      <style>{`
        ${themeStyles[contentTheme] || ''}
        .chat-bubble,
        .markdown-preview,
        .adr-preview,
        .focus-editor-card textarea,
        .focus-editor-card input,
        .focus-editor-card select,
        .task-list {
          font-family: ${contentFontFamily} !important;
          font-size: ${contentFontSize} !important;
          line-height: ${contentLineHeight} !important;
        }
        .message-markdown {
          color: inherit;
          overflow-wrap: anywhere;
        }
        .markdown-preview .message-markdown {
          padding: 20px 22px;
          max-width: 920px;
        }
        .message-markdown > :last-child {
          margin-bottom: 0 !important;
        }
        .message-markdown ul {
          display: flex;
          flex-direction: column;
          gap: 0.25em;
        }
        .message-markdown strong {
          color: hsl(var(--text-primary));
          font-weight: 700;
        }
        .message-markdown em {
          color: hsl(var(--text-secondary));
        }
        .message-markdown code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 0.86em;
          background: hsl(var(--bg-input));
          border: 1px solid hsl(var(--border-dim));
          border-radius: 5px;
          padding: 0.08em 0.32em;
        }
        .message-markdown pre code {
          background: transparent;
          border: 0;
          border-radius: 0;
          padding: 0;
        }
      `}</style>
      <div className="titlebar-drag">
        ROOM — AI-Native Project Workspace
      </div>
      <OnboardingTour
        showOnboardingTour={showOnboardingTour}
        onboardingStep={onboardingStep}
        onboardingSteps={onboardingSteps}
        markOnboardingSeen={markOnboardingSeen}
        setOnboardingStep={setOnboardingStep}
      />
      <ContextPickerPanel
        contextPickerTarget={contextPickerTarget}
        selectedRefs={contextPickerTarget ? getContextSelection(contextPickerTarget) : []}
        filteredItems={getFilteredContextItems()}
        contextPickerTab={contextPickerTab}
        setContextPickerTab={setContextPickerTab}
        contextPickerQuery={contextPickerQuery}
        setContextPickerQuery={setContextPickerQuery}
        contextPickerLoading={contextPickerLoading}
        closeContextPicker={closeContextPicker}
        toggleContextSelection={toggleContextSelection}
        getContextLabel={getContextLabel}
        estimateContextTokens={estimateContextTokens}
        setContextSelection={setContextSelection}
      />

      {projectPath === null ? (
        <div className="welcome-container" style={{ maxWidth: '640px', margin: '0 auto' }}>
          <div className="welcome-card" style={{ width: '100%' }}>
            <img className="welcome-app-icon" src="./room-icon.png" alt="ROOM" />
            <h1 className="welcome-logo">ROOM</h1>
            <p className="welcome-desc">
              Build a shared room for context, tasks, documents, roles, AI members, and discussion logs across any kind of project.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateWorkspace();
                    }
                  }}
                  disabled={loading}
                  placeholder="New workspace name"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    backgroundColor: 'hsl(var(--bg-input))',
                    border: '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    color: 'white',
                    fontFamily: 'inherit',
                    outline: 'none'
                  }}
                />
                <button className="btn-primary" onClick={handleCreateWorkspace} disabled={loading || !newWorkspaceName.trim()} style={{ whiteSpace: 'nowrap' }}>
                  {loading ? 'Creating...' : 'Create Workspace'}
                </button>
              </div>
              <button className="btn-secondary" onClick={handleOpenProject} disabled={loading}>
                {loading ? 'Opening...' : 'Open Existing Workspace'}
              </button>
            </div>
            {errorMsg && <p style={{ color: 'hsl(var(--accent-orange))', marginTop: '16px', fontSize: '0.9rem' }}>{errorMsg}</p>}

            {recentProjects.length > 0 && (
              <div style={{ marginTop: '32px', textAlign: 'left', borderTop: '1px solid hsl(var(--border-dim))', paddingTop: '24px' }}>
                <h4 style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', marginBottom: '16px', fontWeight: 600, letterSpacing: '0.05em' }}>Recent Workspaces</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {recentProjects.map((pathStr) => (
                    <button
                      key={pathStr}
                      onClick={() => handleSelectRecentProject(pathStr)}
                      disabled={loading}
                      className="btn-recent-project"
                      style={{
                        background: 'hsl(var(--bg-input))',
                        border: '1px solid hsl(var(--border-dim))',
                        color: 'hsl(var(--text-secondary))',
                        padding: '12px 16px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        outline: 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden', marginRight: '16px' }}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0, color: 'hsl(var(--accent-purple))' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span style={{ fontWeight: 600, color: 'white', flexShrink: 0 }}>{pathStr.split(/[/\\]/).pop()}</span>
                        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{pathStr}</span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--accent-purple))', fontWeight: 600, flexShrink: 0 }}>Open →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="app-container" style={{
          gridTemplateColumns: [
            sidebarExpanded ? '240px' : '64px',
            '1fr',
            showContextPanel ? '340px' : ''
          ].filter(Boolean).join(' ')
        }}>
          {/* Left Sidebar */}
          <Sidebar
            sidebarExpanded={sidebarExpanded}
            setSidebarExpanded={setSidebarExpanded}
            projectPath={projectPath}
            handleCloseProjectWorkspace={handleCloseProjectWorkspace}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            aiMembersSidebarExpanded={aiMembersSidebarExpanded}
            setAiMembersSidebarExpanded={setAiMembersSidebarExpanded}
            projectData={projectData}
            startEditAgent={startEditAgent}
            resetAgentForm={resetAgentForm}
          />

          {/* Main Content Pane */}
          <main className="main-content">
            {!isRoomProject ? (
              <div className="welcome-container">
                <div className="welcome-card" style={{ maxWidth: '480px' }}>
                  <h2 style={{ marginBottom: '12px' }}>Initialize ROOM Memory</h2>
                  <p className="welcome-desc" style={{ marginBottom: '24px' }}>
                    The selected folder <code>{projectPath}</code> does not have a <code>.room/</code> workspace initialized.
                  </p>
                  <button className="btn-primary" onClick={handleInitProject} disabled={loading}>
                    {loading ? 'Initializing...' : 'Initialize .room/ directory'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <header className="timeline-header">
                  <div className="project-title-bar" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{activeTab}</h3>
                      <span className="project-badge">Active Workspace</span>
                    </div>
                    {projectPath && (
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {projectPath}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => {
                        setOnboardingStep(0);
                        setShowOnboardingTour(true);
                      }}
                      style={{
                        padding: '8px 12px',
                        fontSize: '0.85rem',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      ?
                      Tour
                    </button>
                    <button 
                      className="btn-secondary" 
                      onClick={() => setShowContextPanel(!showContextPanel)} 
                      style={{ 
                        padding: '8px 14px', 
                        fontSize: '0.85rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        height: '36px',
                        borderColor: showContextPanel ? 'hsl(var(--accent-purple))' : undefined,
                        background: showContextPanel ? 'hsl(var(--accent-purple) / 0.12)' : undefined,
                        color: showContextPanel ? 'white' : undefined,
                        cursor: 'pointer'
                      }}
                    >
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                      </svg>
                      {showContextPanel ? 'Hide Context' : 'Show Context'}
                    </button>
                  </div>
                </header>

                <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
                  <ErrorBanner errorMsg={errorMsg} onClear={() => setErrorMsg(null)} />
                  <SetupChecklist
                    dismissedOnboarding={dismissedOnboarding}
                    scanStatus={scanStatus}
                    scanStartedAt={scanStartedAt}
                    loading={loading}
                    setupItems={setupItems}
                    markOnboardingSeen={markOnboardingSeen}
                    setOnboardingStep={setOnboardingStep}
                    setShowOnboardingTour={setShowOnboardingTour}
                  />
                  {renderMainTab()}
                </div>
              </>
            )}
          </main>

          {/* Right Panel - Project Context */}
          {showContextPanel && (
            <ContextPanel
              projectData={projectData}
              setActiveTab={setActiveTab}
            />
          )}
        </div>
      )}
    </>
  );
}
