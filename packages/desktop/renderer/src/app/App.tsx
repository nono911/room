import { useState, useEffect } from 'react';

// Imported types for ROOM
import type { ProjectData, TaskBoardCard } from '../types/domain.js';
import { api } from '../shared/ipc/client.js';
import { useTaskRun } from '../features/task-run/useTaskRun.js';
import { useDiscussion } from '../features/discussions/useDiscussion.js';
import { useAgentManagement } from '../features/ai-members/useAgentManagement.js';
import { useContextPicker } from '../shared/hooks/useContextPicker.js';
import { useContextSets } from '../shared/hooks/useContextSets.js';
import { useOnboarding } from '../shared/hooks/useOnboarding.js';
import { useContentSettings } from '../shared/hooks/useContentSettings.js';
import { useProjectSettings } from '../features/providers/useProjectSettings.js';
import { useRoomFilePreview } from './hooks/useRoomFilePreview.js';
import { useSetupGuidance } from './hooks/useSetupGuidance.js';
import { useWorkspaceData } from './hooks/useWorkspaceData.js';
import { useWorkspaceLifecycle } from './hooks/useWorkspaceLifecycle.js';
import { AppThemeStyles } from './components/AppThemeStyles.js';
import { WorkspaceRoutes } from './components/WorkspaceRoutes.js';

// Layout and Onboarding components
import { Sidebar } from '../shared/components/Sidebar.js';
import { CommandPalette } from '../shared/components/CommandPalette.js';
import { ErrorBanner } from '../shared/components/ErrorBanner.js';
import { SetupChecklist } from '../components/onboarding/SetupChecklist.js';
import { OnboardingTour } from '../components/onboarding/OnboardingTour.js';
import { ContextPickerPanel } from '../components/context/ContextPickerPanel.js';

const RESTORABLE_WORKSPACE_TABS = new Set([
  'Home',
  'Activity',
  'Skills',
  'Run:Think',
  'Run:Decide',
  'Run:Execute',
  'Run:Review',
  'AI Members',
  'Context',
  'Tasks',
  'Files',
  'Artifacts',
  'Decisions',
  'Documents',
  'Reviews',
  'MCP Servers',
  'Settings'
]);

function workspaceTabStorageKey(projectPath: string): string {
  return `room:last-tab:${projectPath}`;
}

function loadWorkspaceTab(projectPath: string): string {
  const saved = localStorage.getItem(workspaceTabStorageKey(projectPath));
  if (
    saved
    && (
      RESTORABLE_WORKSPACE_TABS.has(saved)
      || saved.startsWith('Agent:')
      || saved.startsWith('Team:')
    )
  ) {
    return saved;
  }
  return 'Home';
}

export default function App() {
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Home');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const {
    room,
    activeSource,
    activeSourceId,
    initializingRoom,
    projectPath,
    isRoomProject,
    handleOpenProject,
    handleDetachSource
  } = useWorkspaceLifecycle({
    clearWorkspaceDerivedState,
    restoreWorkspaceRoute: (pathStr: string) => setActiveTab(loadWorkspaceTab(pathStr)),
    loadProjectData: (pathStr: string) => loadProjectData(pathStr),
    setLoading,
    setErrorMsg
  });

  const [hasCompletedScan, setHasCompletedScan] = useState<boolean>(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);

  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
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
    activeTaskRunId,
    taskInterruptMessage, setTaskInterruptMessage,
    taskInterruptPending,
    temporaryTaskAgents, setTemporaryTaskAgents,
    handleRunCodingTask,
    interruptActiveTaskRun,
    continueTaskRunFromPivot,
    applyTaskTypePreset,
    selectedTaskCardId,
    setSelectedTaskCardId,
    setContinuedFromTaskId
  } = useTaskRun({
    projectPath,
    activeSourceId,
    projectData,
    loadProjectData: async (p: string) => {
      await loadProjectData(p);
    },
    setLoading,
    setErrorMsg
  });
  const [taskBoardCards, setTaskBoardCards] = useState<TaskBoardCard[]>([]);
  const [initialSelectedFile, setInitialSelectedFile] = useState<{ section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null>(null);
  const {
    selectedDiscussionAgents,
    selectedDiscussionParticipantKeys,
    selectedDiscussionMemberIds, setSelectedDiscussionMemberIds,
    appendSelectedDiscussionMemberIds,
    toggleSelectedDiscussionMemberId,
    reorderSelectedDiscussionParticipants,
    selectedLegacyDiscussionAgentNames, setSelectedLegacyDiscussionAgentNames,
    toggleSelectedLegacyDiscussionAgentName,
    selectedTemporaryDiscussionAgentIds,
    appendSelectedTemporaryDiscussionAgentIds,
    toggleSelectedTemporaryDiscussionAgentId,
    temporaryDiscussionAgents, setTemporaryDiscussionAgents,
    clearSelectedDiscussionAgents,
    discussionReviewMode, setDiscussionReviewMode,
    discussionMaxRounds, setDiscussionMaxRounds,
    discussionQualityGate, setDiscussionQualityGate,
    discussionAllowReadOnlyTools, setDiscussionAllowReadOnlyTools,
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
  } = useDiscussion({
    projectPath,
    activeSourceId,
    projectData,
    loadProjectData: async (p: string) => {
      await loadProjectData(p);
    },
    setActiveTab,
    setInitialSelectedFile,
    setTaskBoardCards,
    setLoading,
    setErrorMsg
  });
  useEffect(() => {
    if (activeTab === 'Run:Think' || activeTab === 'Discussions') {
      setDiscussionReviewMode(false);
    } else if (activeTab === 'Run:Decide') {
      setDiscussionReviewMode(true);
    }
  }, [activeTab, setDiscussionReviewMode]);
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
    activeSourceId,
    selectedDiscussionContextRefs,
    setSelectedDiscussionContextRefs,
    selectedCodingTaskContextRefs,
    setSelectedCodingTaskContextRefs,
    setErrorMsg
  });
  const {
    contextSets,
    contextSetsLoading,
    contextSetsMutating,
    saveContextSet,
    deleteContextSet
  } = useContextSets({ projectPath, setErrorMsg });
  const {
    showOnboardingTour, setShowOnboardingTour,
    onboardingStep, setOnboardingStep,
    dismissedOnboarding,
    markOnboardingSeen,
    resetOnboarding
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
      'Scanning Source files and detecting structure...',
      'Updating the Room overview and Source structure...',
      projectConfig.mainAgent && projectConfig.mainAgent !== 'none'
        ? 'Running the configured scanner agent to enrich the Room overview...'
        : 'Refreshing Room metadata...'
    ];
    setScanStatus(messages[0]);
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - scanStartedAt;
      const index = elapsed > 7000 ? 2 : elapsed > 2500 ? 1 : 0;
      setScanStatus(messages[index]);
    }, 500);
    return () => window.clearInterval(interval);
  }, [scanStartedAt, projectConfig.mainAgent]);

  useEffect(() => {
    if (projectPath && isRoomProject) {
      localStorage.setItem(workspaceTabStorageKey(projectPath), activeTab);
    }
  }, [activeTab, isRoomProject, projectPath]);

  function clearWorkspaceDerivedState() {
    setProjectData(null);
    setCodingTaskMessages([]);
    setOpenRounds({});
    setExpandedMsgKeys({});
    setLastMaxRound(-1);
    setLastCodingTaskResult(null);
    setSelectedTaskCardId(null);
    setContinuedFromTaskId(null);
    resetDiscussion();
    setSelectedCodingTaskContextRefs(['workspace:overview', 'workspace:structure']);
    resetContextPicker();
    resetOnboarding();
    setHasCompletedScan(false);
    setScanStatus('');
    setScanStartedAt(null);
    setActiveTab('Home');
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
  } = useAgentManagement({
    projectPath,
    projectData,
    activeTab,
    setActiveTab,
    loadProjectData: async (pathStr: string) => {
      await loadProjectData(pathStr);
    },
    setErrorMsg
  });
  const { loadRoomFilePreview } = useRoomFilePreview({
    projectPath,
    setInitialSelectedFile,
    setEditingSkillFile,
    setEditingSkillContent,
    setEditingSkillSource,
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
      setScanStatus('Refreshing Room data...');
      localStorage.setItem(`room_scan_completed:${projectPath}`, new Date().toISOString());
      setHasCompletedScan(true);
      await loadProjectData(projectPath);
      finishScanStatus('Scan complete. Room context is up to date.');
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

    const confirmed = window.confirm('Allow this Local CLI Developer to write in the active Source for coding tasks? This enables dangerous permissions for the selected AI member and Source.');
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

  return (
    <>
      <AppThemeStyles
        contentTheme={contentTheme}
        contentFontFamily={contentFontFamily}
        contentFontSize={contentFontSize}
        contentLineHeight={contentLineHeight}
      />
      <div className="titlebar-drag">
        ROOM — AI-Native Room
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
        contextSets={contextSets}
        contextSetsLoading={contextSetsLoading}
        contextSetsMutating={contextSetsMutating}
        saveContextSet={saveContextSet}
        deleteContextSet={deleteContextSet}
      />
      <CommandPalette enabled={!!projectPath && isRoomProject} setActiveTab={setActiveTab} />

      {initializingRoom ? (
        <div className="room-boot-state">
          <div className="room-boot-orb" />
          <h1>Opening Personal Room</h1>
          <p>Preparing your source-independent memory…</p>
        </div>
      ) : projectPath === null || !isRoomProject ? (
        <div className="room-boot-state">
          <h1>Personal Room could not open</h1>
          <p>{errorMsg || 'Restart ROOM to try again.'}</p>
        </div>
      ) : (
        <div className="app-container" style={{
          gridTemplateColumns: [
            sidebarExpanded ? '240px' : '64px',
            '1fr'
          ].filter(Boolean).join(' ')
        }}>
          {/* Left Sidebar */}
          <Sidebar
            sidebarExpanded={sidebarExpanded}
            setSidebarExpanded={setSidebarExpanded}
            projectPath={projectPath}
            roomName={room?.name}
            activeSource={activeSource}
            onAttachSource={() => void handleOpenProject()}
            onDetachSource={() => void handleDetachSource()}
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
            <div id="room-main-scroll" style={{ flex: 1, padding: '24px 32px 32px', overflowY: 'auto' }}>
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
              <WorkspaceRoutes
                activeTab={activeTab}
                projectPath={projectPath}
                activeSourceId={activeSourceId}
                onAttachSource={() => void handleOpenProject()}
                projectData={projectData}
                loading={loading}
                agentOperationLoading={agentOperationLoading}
                errorMsg={errorMsg}
                setErrorMsg={setErrorMsg}
                setActiveTab={setActiveTab}
                loadProjectData={async (pathStr: string) => {
                  await loadProjectData(pathStr);
                }}
                loadWorkspaceCoreData={loadWorkspaceCoreData}
                loadRoomFilePreview={loadRoomFilePreview}
                openContextPicker={openContextPicker}
                estimateContextTokens={estimateContextTokens}
                setContextSelection={setContextSelection}
                toggleContextSelection={toggleContextSelection}
                getContextLabel={getContextLabel}
                scrollToDiscussionMessage={scrollToDiscussionMessage}
                initialSelectedFile={initialSelectedFile}
                setInitialSelectedFile={setInitialSelectedFile}
                taskBoardCards={taskBoardCards}
                aiMemberDetailsExpanded={aiMemberDetailsExpanded}
                setAiMemberDetailsExpanded={setAiMemberDetailsExpanded}
                resetAgentForm={resetAgentForm}
                startEditAgent={startEditAgent}
                handleDeleteAgent={handleDeleteAgent}
                newAgentProvider={newAgentProvider}
                newAgentPreset={newAgentPreset}
                newAgentModel={newAgentModel}
                newAgentName={newAgentName}
                setNewAgentName={setNewAgentName}
                editingAgent={editingAgent}
                handleSaveAgent={handleSaveAgent}
                setNewAgentRole={setNewAgentRole}
                setNewAgentPrompt={setNewAgentPrompt}
                ensureTemplateSkills={ensureTemplateSkills}
                setNewAgentSkills={setNewAgentSkills}
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
                activeDiscussionId={activeDiscussionId}
                summarizeActiveDiscussion={summarizeActiveDiscussion}
                startNewDiscussion={startNewDiscussion}
                loadDiscussionSession={loadDiscussionSession}
                discussionMessages={discussionMessages}
                highlightedDiscussionMessage={highlightedDiscussionMessage}
                selectedDiscussionContextRefs={selectedDiscussionContextRefs}
                selectedDiscussionAgents={selectedDiscussionAgents}
                selectedDiscussionParticipantKeys={selectedDiscussionParticipantKeys}
                selectedDiscussionMemberIds={selectedDiscussionMemberIds}
                setSelectedDiscussionMemberIds={setSelectedDiscussionMemberIds}
                appendSelectedDiscussionMemberIds={appendSelectedDiscussionMemberIds}
                toggleSelectedDiscussionMemberId={toggleSelectedDiscussionMemberId}
                reorderSelectedDiscussionParticipants={reorderSelectedDiscussionParticipants}
                selectedLegacyDiscussionAgentNames={selectedLegacyDiscussionAgentNames}
                setSelectedLegacyDiscussionAgentNames={setSelectedLegacyDiscussionAgentNames}
                toggleSelectedLegacyDiscussionAgentName={toggleSelectedLegacyDiscussionAgentName}
                selectedTemporaryDiscussionAgentIds={selectedTemporaryDiscussionAgentIds}
                appendSelectedTemporaryDiscussionAgentIds={appendSelectedTemporaryDiscussionAgentIds}
                toggleSelectedTemporaryDiscussionAgentId={toggleSelectedTemporaryDiscussionAgentId}
                temporaryDiscussionAgents={temporaryDiscussionAgents}
                setTemporaryDiscussionAgents={setTemporaryDiscussionAgents}
                clearSelectedDiscussionAgents={clearSelectedDiscussionAgents}
                discussionReviewMode={discussionReviewMode}
                setDiscussionReviewMode={setDiscussionReviewMode}
                discussionMaxRounds={discussionMaxRounds}
                setDiscussionMaxRounds={setDiscussionMaxRounds}
                discussionQualityGate={discussionQualityGate}
                setDiscussionQualityGate={setDiscussionQualityGate}
                discussionAllowReadOnlyTools={discussionAllowReadOnlyTools}
                setDiscussionAllowReadOnlyTools={setDiscussionAllowReadOnlyTools}
                discussionModeratorName={discussionModeratorName}
                setDiscussionModeratorName={setDiscussionModeratorName}
                discussionAutoSummary={discussionAutoSummary}
                setDiscussionAutoSummary={setDiscussionAutoSummary}
                discussionSummaryAgentName={discussionSummaryAgentName}
                setDiscussionSummaryAgentName={setDiscussionSummaryAgentName}
                projectConfig={projectConfig}
                userInputTopic={userInputTopic}
                setUserInputTopic={setUserInputTopic}
                activeDiscussionRunId={activeDiscussionRunId}
                discussionInterruptMessage={discussionInterruptMessage}
                setDiscussionInterruptMessage={setDiscussionInterruptMessage}
                discussionInterruptPending={discussionInterruptPending}
                interruptActiveDiscussion={interruptActiveDiscussion}
                handleKeyDown={handleKeyDown}
                handleSendDiscussion={handleSendDiscussion}
                lastDiscussionLog={lastDiscussionLog}
                saveDiscussionOutput={saveDiscussionOutput}
                generateTasksFromActiveDiscussion={generateTasksFromActiveDiscussion}
                continueActiveDiscussionFromPivot={continueActiveDiscussionFromPivot}
                showInspector={showInspector}
                setShowInspector={setShowInspector}
                codingTaskMessages={codingTaskMessages}
                codingTaskDeveloperName={codingTaskDeveloperName}
                setCodingTaskDeveloperName={setCodingTaskDeveloperName}
                taskRunType={taskRunType}
                applyTaskTypePreset={applyTaskTypePreset}
                codingTaskInput={codingTaskInput}
                setCodingTaskInput={setCodingTaskInput}
                enableTaskRunWriteAccess={enableTaskRunWriteAccess}
                codingTaskReviewerNames={codingTaskReviewerNames}
                setCodingTaskReviewerNames={setCodingTaskReviewerNames}
                temporaryTaskAgents={temporaryTaskAgents}
                setTemporaryTaskAgents={setTemporaryTaskAgents}
                codingTaskMaxCycles={codingTaskMaxCycles}
                setCodingTaskMaxCycles={setCodingTaskMaxCycles}
                selectedCodingTaskContextRefs={selectedCodingTaskContextRefs}
                setSelectedCodingTaskContextRefs={setSelectedCodingTaskContextRefs}
                handleRunCodingTask={handleRunCodingTask}
                lastCodingTaskResult={lastCodingTaskResult}
                setLastCodingTaskResult={setLastCodingTaskResult}
                setCodingTaskMessages={setCodingTaskMessages}
                openRounds={openRounds}
                setOpenRounds={setOpenRounds}
                expandedMsgKeys={expandedMsgKeys}
                setExpandedMsgKeys={setExpandedMsgKeys}
                activeTaskRunId={activeTaskRunId}
                taskInterruptMessage={taskInterruptMessage}
                setTaskInterruptMessage={setTaskInterruptMessage}
                taskInterruptPending={taskInterruptPending}
                interruptActiveTaskRun={interruptActiveTaskRun}
                continueTaskRunFromPivot={continueTaskRunFromPivot}
                taskRunView={taskRunView}
                setTaskRunView={setTaskRunView}
                selectedTaskCardId={selectedTaskCardId}
                setSelectedTaskCardId={setSelectedTaskCardId}
                setContinuedFromTaskId={setContinuedFromTaskId}
                handleUpdateProjectConfig={handleUpdateProjectConfig}
                contentTheme={contentTheme}
                setContentTheme={setContentTheme}
                contentFontFamily={contentFontFamily}
                setContentFontFamily={setContentFontFamily}
                contentFontSize={contentFontSize}
                setContentFontSize={setContentFontSize}
                contentLineHeight={contentLineHeight}
                setContentLineHeight={setContentLineHeight}
              />
            </div>
          </main>
        </div>
      )}
    </>
  );
}
