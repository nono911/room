import { useState, useEffect } from 'react';

// Imported types for ROOM
import type { ProjectData, TaskBoardCard } from '../types/domain.js';
import { api } from '../shared/ipc/client.js';
import { useTaskRun } from '../features/task-run/useTaskRun.js';
import { useDiscussion } from '../features/discussions/useDiscussion.js';
import { useAgentManagement } from '../features/ai-members/useAgentManagement.js';
import { useContextPicker } from '../shared/hooks/useContextPicker.js';
import { useOnboarding } from '../shared/hooks/useOnboarding.js';
import { useContentSettings } from '../shared/hooks/useContentSettings.js';
import { useProjectSettings } from '../features/providers/useProjectSettings.js';
import { useSetupGuidance } from './hooks/useSetupGuidance.js';
import { useWorkspaceData } from './hooks/useWorkspaceData.js';
import { useWorkspaceLifecycle } from './hooks/useWorkspaceLifecycle.js';
import { AppThemeStyles } from './components/AppThemeStyles.js';
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
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Discussions');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const {
    projectPath,
    isRoomProject,
    newWorkspaceName,
    setNewWorkspaceName,
    recentProjects,
    handleOpenProject,
    handleCreateWorkspace,
    handleSelectRecentProject,
    handleInitProject,
    handleCloseProjectWorkspace
  } = useWorkspaceLifecycle({
    clearWorkspaceDerivedState,
    loadProjectData: (pathStr: string) => loadProjectData(pathStr),
    setLoading,
    setErrorMsg
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
  const {
    loadWorkspaceCoreData,
    loadProjectData
  } = useWorkspaceData({
    setProjectData,
    setHasCompletedScan,
    loadProjectConfig: (pathStr: string) => loadProjectConfig(pathStr),
    loadTaskBoardCards: (pathStr: string) => loadTaskBoardCards(pathStr),
    selectDefaultDiscussionAgents: (agents: any[]) => selectDefaultDiscussionAgents(agents),
    setCodingTaskDeveloperName,
    setCodingTaskReviewerNames,
    setErrorMsg
  });

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

  function clearWorkspaceDerivedState() {
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
  }

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

  const { onboardingSteps, setupItems } = useSetupGuidance({
    activeTab,
    projectData,
    hasCompletedScan,
    selectedDiscussionContextRefs,
    selectedCodingTaskContextRefs,
    discussionMessages,
    codingTaskMessages,
    resetAgentForm,
    setActiveTab,
    openContextPicker
  });

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

  return (
    <>
      <AppThemeStyles
        contentTheme={contentTheme}
        contentFontFamily={contentFontFamily}
        contentFontSize={contentFontSize}
        contentLineHeight={contentLineHeight}
      />
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
