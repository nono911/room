import { useState, useEffect } from 'react';

// Imported types for ROOM
import type {
  ProjectData,
  TaskBoardCard,
} from '../types/domain.js';
import { api } from '../shared/ipc/client.js';
import { useTaskRun } from '../features/task-run/useTaskRun.js';
import { useDiscussion } from '../features/discussions/useDiscussion.js';
import { useAgentManagement } from '../features/ai-members/useAgentManagement.js';
import { useContextPicker } from '../shared/hooks/useContextPicker.js';
import { useOnboarding } from '../shared/hooks/useOnboarding.js';
import { useContentSettings } from '../shared/hooks/useContentSettings.js';
import { useProjectSettings } from '../features/providers/useProjectSettings.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';

// Layout and Onboarding components
import { Sidebar } from '../shared/components/Sidebar.js';
import { ContextPanel } from '../shared/components/ContextPanel.js';
import { ErrorBanner } from '../shared/components/ErrorBanner.js';
import { SetupChecklist } from '../components/onboarding/SetupChecklist.js';
import { OnboardingTour } from '../components/onboarding/OnboardingTour.js';
import { ContextPickerPanel } from '../components/context/ContextPickerPanel.js';

// Screens
import { OverviewScreen } from '../components/screens/OverviewScreen.js';
import { FilesScreen } from '../features/workspace-files/components/FilesScreen.js';
import { AIMembersScreen } from '../features/ai-members/components/AIMembersScreen.js';
import { AgentEditorScreen } from '../features/ai-members/components/AgentEditorScreen.js';
import { DiscussionsScreen } from '../features/discussions/components/DiscussionsScreen.js';
import { TaskRunScreen } from '../features/task-run/components/TaskRunScreen.js';
import { DocumentsScreen } from '../features/workspace-files/components/DocumentsScreen.js';
import { TaskArchiveScreen } from '../features/workspace-files/components/TaskArchiveScreen.js';
import { ContextScreen } from '../features/workspace-files/components/ContextScreen.js';
import { DecisionsScreen } from '../features/workspace-files/components/DecisionsScreen.js';
import { McpServersScreen } from '../features/mcp/components/McpServersScreen.js';
import { SettingsScreen } from '../features/providers/components/SettingsScreen.js';

import {
  taskTypeOptions,
  agentPersonaTemplates,
  teamPresets
} from '../shared/data/staticData.js';

export default function App() {
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

  const [showContextPanel, setShowContextPanel] = useState<boolean>(false);
  const [hasCompletedScan, setHasCompletedScan] = useState<boolean>(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);

  // Custom workspace control states
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
  // Main Workspace Agent & Visual Customizer State
  const {
    projectConfig,
    setProjectConfig,
    loadProjectConfig,
    handleUpdateProjectConfig
  } = useProjectSettings({ projectPath });
  const {
    contentTheme, setContentTheme,
    contentFontFamily, setContentFontFamily,
    contentFontSize, setContentFontSize,
    contentLineHeight, setContentLineHeight
  } = useContentSettings();
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
  const [taskBoardCards, setTaskBoardCards] = useState<TaskBoardCard[]>([]);
  const [initialSelectedFile, setInitialSelectedFile] = useState<{ section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null>(null);
  const {
    selectedDiscussionAgents, setSelectedDiscussionAgents,
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
    highlightedDiscussionMessage,
    userInputTopic, setUserInputTopic,
    discussionMessages,
    resetDiscussion,
    selectDefaultDiscussionAgents,
    scrollToDiscussionMessage,
    startNewDiscussion,
    loadTaskBoardCards,
    loadDiscussionSession,
    saveDiscussionOutput,
    summarizeActiveDiscussion,
    generateTasksFromActiveDiscussion,
    handleSendDiscussion,
    handleKeyDown
  } = useDiscussion({
    projectPath,
    projectData,
    loadProjectData: (p: string) => loadProjectData(p),
    setActiveTab,
    setInitialSelectedFile,
    setTaskBoardCards,
    setLoading,
    setErrorMsg
  });
  const {
    contextPickerTarget,
    contextPickerQuery, setContextPickerQuery,
    contextPickerTab, setContextPickerTab,
    contextPickerLoading,
    openContextPicker,
    closeContextPicker,
    resetContextPicker,
    getContextSelection,
    setContextSelection,
    toggleContextSelection,
    getContextLabel,
    getFilteredContextItems,
    estimateContextTokens
  } = useContextPicker({
    projectPath,
    selectedDiscussionContextRefs,
    setSelectedDiscussionContextRefs,
    selectedCodingTaskContextRefs,
    setSelectedCodingTaskContextRefs,
    setErrorMsg
  });
  const {
    showOnboardingTour, setShowOnboardingTour,
    onboardingStep, setOnboardingStep,
    dismissedOnboarding,
    markOnboardingSeen,
    resetOnboarding,
    startOnboardingTour
  } = useOnboarding({
    projectPath,
    isRoomProject,
    projectData
  });
  const [aiMembersSidebarExpanded, setAiMembersSidebarExpanded] = useState<boolean>(() => localStorage.getItem('room_ai_members_sidebar_expanded') === 'true');
  const [aiMemberDetailsExpanded, setAiMemberDetailsExpanded] = useState<boolean>(() => localStorage.getItem('room_ai_member_details_expanded') !== 'false');

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

  const [newWorkspaceName, setNewWorkspaceName] = useState<string>('');

  const clearWorkspaceDerivedState = () => {
    setProjectData(null);
    setCodingTaskMessages([]);
    setOpenRounds({});
    setExpandedMsgKeys({});
    setLastMaxRound(-1);
    setLastCodingTaskResult(null);
    resetDiscussion();
    setSelectedCodingTaskContextRefs(['workspace:overview', 'workspace:structure']);
    resetContextPicker();
    resetOnboarding();
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
    selectDefaultDiscussionAgents(agents);
    if (agents && agents.length > 0) {
      const names = agents.map((a: any) => a.name);
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
      setCodingTaskDeveloperName('');
      setCodingTaskReviewerNames([]);
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

  const {
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
  } = useAgentManagement({
    projectPath,
    projectData,
    activeTab,
    setActiveTab,
    loadProjectData: (pathStr: string) => loadProjectData(pathStr),
    setSelectedDiscussionAgents,
    setLoading,
    setErrorMsg
  });



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
        <WelcomeScreen
          newWorkspaceName={newWorkspaceName}
          setNewWorkspaceName={setNewWorkspaceName}
          loading={loading}
          handleCreateWorkspace={handleCreateWorkspace}
          handleOpenProject={handleOpenProject}
          errorMsg={errorMsg}
          recentProjects={recentProjects}
          handleSelectRecentProject={handleSelectRecentProject}
        />
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
	                      onClick={startOnboardingTour}
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
