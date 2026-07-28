import { OverviewScreen } from '../../components/screens/OverviewScreen.js';
import { HomeScreen } from '../../components/screens/HomeScreen.js';
import { ActivityScreen } from '../../components/screens/ActivityScreen.js';
import { SkillsCatalogScreen } from '../../components/screens/SkillsCatalogScreen.js';
import { FilesScreen } from '../../features/workspace-files/components/FilesScreen.js';
import { AIMembersScreen } from '../../features/ai-members/components/AIMembersScreen.js';
import { AgentEditorScreen } from '../../features/ai-members/components/AgentEditorScreen.js';
import { TeamDetailScreen } from '../../features/ai-members/components/TeamDetailScreen.js';
import { DiscussionsScreen } from '../../features/discussions/components/DiscussionsScreen.js';
import { TaskRunScreen } from '../../features/task-run/components/TaskRunScreen.js';
import { RunComposerFrame, type RunMode } from '../../features/task-run/components/RunComposerFrame.js';
import { TaskArchiveScreen } from '../../features/workspace-files/components/TaskArchiveScreen.js';
import { McpServersScreen } from '../../features/mcp/components/McpServersScreen.js';
import { SettingsScreen } from '../../features/providers/components/SettingsScreen.js';
import {
  taskTypeOptions,
  agentPersonaTemplates,
  teamPresets
} from '../../shared/data/staticData.js';
import { api } from '../../shared/ipc/client.js';
import { buildTeamRosters } from '../../features/ai-members/lib/teamRoster.js';
import type { DiscussionParticipantKey } from '../../features/discussions/lib/discussionSelection.js';

interface WorkspaceRoutesProps {
  activeTab: string;
  projectPath: string | null;
  activeSourceId?: string;
  activeSourceName?: string;
  onAttachSource: () => void;
  onScanSource: () => void;
  projectData: any;
  loading: boolean;
  agentOperationLoading: boolean;
  errorMsg: string | null;
  setErrorMsg: (value: string | null) => void;
  setActiveTab: (tab: string) => void;
  loadProjectData: (path: string) => Promise<void>;
  loadRoomFilePreview: (section: any, filename: string) => void;
  openContextPicker: (target: 'discussion' | 'task') => void;
  estimateContextTokens: any;
  setContextSelection: (target: 'discussion' | 'task', refs: string[]) => void;
  toggleContextSelection: (target: 'discussion' | 'task', ref: string) => void;
  getContextLabel: (ref: string) => string;
  scrollToDiscussionMessage: any;
  initialSelectedFile: any;
  setInitialSelectedFile: (value: any) => void;
  taskBoardCards: any[];
  aiMemberDetailsExpanded: boolean;
  setAiMemberDetailsExpanded: (value: boolean | ((prev: boolean) => boolean)) => void;
  resetAgentForm: () => void;
  startEditAgent: (agent: any) => void;
  handleDeleteAgent: (agentName: string) => void;
  newAgentProvider: string;
  newAgentPreset: string;
  newAgentModel: string;
  newAgentName: string;
  setNewAgentName: (value: string) => void;
  editingAgent: any;
  handleSaveAgent: (event: any) => void;
  setNewAgentRole: (value: string) => void;
  setNewAgentPrompt: (value: string) => void;
  ensureTemplateSkills: (skills: any) => Promise<string[]>;
  setNewAgentSkills: (value: string[] | ((prev: string[]) => string[])) => void;
  newAgentRole: string;
  handleRoleChange: (value: string) => void;
  setNewAgentProvider: (value: string) => void;
  setNewAgentPreset: (value: string) => void;
  setNewAgentModelCustom: (value: boolean) => void;
  setNewAgentModel: (value: string) => void;
  setSkillPreview: (value: any) => void;
  newAgentModelCustom: boolean;
  newAgentSkills: string[];
  editingSkillFile: string;
  setEditingSkillFile: (value: string) => void;
  skillPreview: any;
  handlePreviewAgentSkills: () => void;
  editingSkillContent: string;
  setEditingSkillContent: (value: string) => void;
  editingSkillSource: 'skills' | 'roles';
  setEditingSkillSource: (value: 'skills' | 'roles') => void;
  handleSaveEditingSkill: () => void;
  customSkillName: string;
  setCustomSkillName: (value: string) => void;
  customSkillDesc: string;
  setCustomSkillDesc: (value: string) => void;
  handleAddCustomSkill: () => void;
  newAgentPrompt: string;
  activeDiscussionId: string | null;
  summarizeActiveDiscussion: () => void;
  startNewDiscussion: () => void;
  loadDiscussionSession: (filename: string) => void;
  deleteDiscussionSession: (filename: string) => void;
  discussionMessages: any[];
  highlightedDiscussionMessage: any;
  selectedDiscussionContextRefs: string[];
  selectedDiscussionAgents: string[];
  selectedDiscussionParticipantKeys: DiscussionParticipantKey[];
  selectedDiscussionMemberIds: string[];
  setSelectedDiscussionMemberIds: (value: string[] | ((prev: string[]) => string[])) => void;
  appendSelectedDiscussionMemberIds: (memberIds: string[]) => void;
  toggleSelectedDiscussionMemberId: (memberId: string) => void;
  reorderSelectedDiscussionParticipants: (sourceIndex: number, targetIndex: number) => void;
  selectedLegacyDiscussionAgentNames: string[];
  setSelectedLegacyDiscussionAgentNames: (value: string[] | ((prev: string[]) => string[])) => void;
  toggleSelectedLegacyDiscussionAgentName: (agentName: string) => void;
  selectedTemporaryDiscussionAgentIds: string[];
  appendSelectedTemporaryDiscussionAgentIds: (agentIds: string[]) => void;
  toggleSelectedTemporaryDiscussionAgentId: (agentId: string) => void;
  temporaryDiscussionAgents: any[];
  setTemporaryDiscussionAgents: (value: any[] | ((prev: any[]) => any[])) => void;
  clearSelectedDiscussionAgents: () => void;
  discussionReviewMode: any;
  setDiscussionReviewMode: (value: any) => void;
  discussionMaxRounds: number;
  setDiscussionMaxRounds: (value: number) => void;
  discussionQualityGate: any;
  setDiscussionQualityGate: (value: any) => void;
  discussionModeratorName: string;
  setDiscussionModeratorName: (value: string) => void;
  discussionAutoSummary: boolean;
  setDiscussionAutoSummary: any;
  discussionSummaryAgentName: string;
  setDiscussionSummaryAgentName: (value: string) => void;
  userInputTopic: string;
  setUserInputTopic: (value: string) => void;
  activeDiscussionRunId: string | null;
  discussionInterruptMessage: string;
  setDiscussionInterruptMessage: (value: string) => void;
  discussionInterruptPending: boolean;
  interruptActiveDiscussion: () => void;
  handleKeyDown: (event: any) => void;
  handleSendDiscussion: () => void;
  lastDiscussionLog: string;
  saveDiscussionOutput: any;
  generateTasksFromActiveDiscussion: () => void;
  continueActiveDiscussionFromPivot: () => void;
  showInspector: boolean;
  setShowInspector: any;
  codingTaskMessages: any[];
  codingTaskDeveloperName: string;
  setCodingTaskDeveloperName: (value: string | ((prev: string) => string)) => void;
  taskRunType: string;
  applyTaskTypePreset: (value: any) => void;
  codingTaskInput: string;
  setCodingTaskInput: (value: string) => void;
  codingTaskReviewerNames: string[];
  setCodingTaskReviewerNames: (value: string[] | ((prev: string[]) => string[])) => void;
  temporaryTaskAgents: any[];
  setTemporaryTaskAgents: (value: any[] | ((prev: any[]) => any[])) => void;
  codingTaskMaxCycles: number;
  setCodingTaskMaxCycles: (value: number) => void;
  selectedCodingTaskContextRefs: string[];
  setSelectedCodingTaskContextRefs: (value: string[] | ((prev: string[]) => string[])) => void;
  handleRunCodingTask: () => void;
  lastCodingTaskResult: any;
  openRounds: Record<string, boolean>;
  setOpenRounds: (value: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  expandedMsgKeys: Record<string, boolean>;
  setExpandedMsgKeys: (value: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  activeTaskRunId: string | null;
  taskInterruptMessage: string;
  setTaskInterruptMessage: (value: string) => void;
  taskInterruptPending: boolean;
  interruptActiveTaskRun: () => void;
  continueTaskRunFromPivot: () => void;
  startNewTaskRun: () => void;
  taskRunView: any;
  setTaskRunView: (value: any) => void;
  contentTheme: string;
  setContentTheme: (value: string) => void;
  contentFontFamily: string;
  setContentFontFamily: (value: string) => void;
  contentFontSize: string;
  setContentFontSize: (value: string) => void;
  contentLineHeight: string;
  setContentLineHeight: (value: string) => void;
  selectedTaskCardId: string | null;
  setSelectedTaskCardId: (value: string | null) => void;
  setContinuedFromTaskId: (value: string | null) => void;
}

export function WorkspaceRoutes(props: WorkspaceRoutesProps) {
  const {
    activeTab,
    projectPath,
    activeSourceId,
    activeSourceName,
    onAttachSource,
    onScanSource,
    projectData,
    loading,
    agentOperationLoading,
    errorMsg,
    setErrorMsg,
    setActiveTab,
    loadProjectData,
    loadRoomFilePreview,
    openContextPicker,
    estimateContextTokens,
    setContextSelection,
    toggleContextSelection,
    getContextLabel,
    scrollToDiscussionMessage,
    initialSelectedFile,
    setInitialSelectedFile,
    taskBoardCards,
    aiMemberDetailsExpanded,
    setAiMemberDetailsExpanded,
    resetAgentForm,
    startEditAgent,
    handleDeleteAgent,
    newAgentProvider,
    newAgentPreset,
    newAgentModel,
    newAgentName,
    setNewAgentName,
    editingAgent,
    handleSaveAgent,
    setNewAgentRole,
    setNewAgentPrompt,
    ensureTemplateSkills,
    setNewAgentSkills,
    newAgentRole,
    handleRoleChange,
    setNewAgentProvider,
    setNewAgentPreset,
    setNewAgentModelCustom,
    setNewAgentModel,
    setSkillPreview,
    newAgentModelCustom,
    newAgentSkills,
    editingSkillFile,
    setEditingSkillFile,
    skillPreview,
    handlePreviewAgentSkills,
    editingSkillContent,
    setEditingSkillContent,
    editingSkillSource,
    setEditingSkillSource,
    handleSaveEditingSkill,
    customSkillName,
    setCustomSkillName,
    customSkillDesc,
    setCustomSkillDesc,
    handleAddCustomSkill,
    newAgentPrompt,
    activeDiscussionId,
    summarizeActiveDiscussion,
    startNewDiscussion,
    loadDiscussionSession,
    deleteDiscussionSession,
    discussionMessages,
    highlightedDiscussionMessage,
    selectedDiscussionContextRefs,
    selectedDiscussionAgents,
    selectedDiscussionParticipantKeys,
    selectedDiscussionMemberIds,
    setSelectedDiscussionMemberIds,
    appendSelectedDiscussionMemberIds,
    toggleSelectedDiscussionMemberId,
    reorderSelectedDiscussionParticipants,
    selectedLegacyDiscussionAgentNames,
    setSelectedLegacyDiscussionAgentNames,
    toggleSelectedLegacyDiscussionAgentName,
    selectedTemporaryDiscussionAgentIds,
    appendSelectedTemporaryDiscussionAgentIds,
    toggleSelectedTemporaryDiscussionAgentId,
    temporaryDiscussionAgents,
    setTemporaryDiscussionAgents,
    clearSelectedDiscussionAgents,
    discussionReviewMode,
    setDiscussionReviewMode,
    discussionMaxRounds,
    setDiscussionMaxRounds,
    discussionQualityGate,
    setDiscussionQualityGate,
    discussionModeratorName,
    setDiscussionModeratorName,
    discussionAutoSummary,
    setDiscussionAutoSummary,
    discussionSummaryAgentName,
    setDiscussionSummaryAgentName,
    userInputTopic,
    setUserInputTopic,
    activeDiscussionRunId,
    discussionInterruptMessage,
    setDiscussionInterruptMessage,
    discussionInterruptPending,
    interruptActiveDiscussion,
    handleKeyDown,
    handleSendDiscussion,
    lastDiscussionLog,
    saveDiscussionOutput,
    generateTasksFromActiveDiscussion,
    continueActiveDiscussionFromPivot,
    showInspector,
    setShowInspector,
    codingTaskMessages,
    codingTaskDeveloperName,
    setCodingTaskDeveloperName,
    taskRunType,
    applyTaskTypePreset,
    codingTaskInput,
    setCodingTaskInput,
    codingTaskReviewerNames,
    setCodingTaskReviewerNames,
    temporaryTaskAgents,
    setTemporaryTaskAgents,
    codingTaskMaxCycles,
    setCodingTaskMaxCycles,
    selectedCodingTaskContextRefs,
    setSelectedCodingTaskContextRefs,
    handleRunCodingTask,
    lastCodingTaskResult,
    openRounds,
    setOpenRounds,
    expandedMsgKeys,
    setExpandedMsgKeys,
    activeTaskRunId,
    taskInterruptMessage,
    setTaskInterruptMessage,
    taskInterruptPending,
    interruptActiveTaskRun,
    continueTaskRunFromPivot,
    startNewTaskRun,
    taskRunView,
    setTaskRunView,
    selectedTaskCardId,
    setSelectedTaskCardId,
    setContinuedFromTaskId,
    contentTheme,
    setContentTheme,
    contentFontFamily,
    setContentFontFamily,
    contentFontSize,
    setContentFontSize,
    contentLineHeight,
    setContentLineHeight
  } = props;

  const changeRunMode = (mode: RunMode) => {
    if (mode === 'Think' || mode === 'Decide') {
      setDiscussionReviewMode(mode === 'Decide');
    }
    setActiveTab(`Run:${mode}`);
  };
  const discussionPreflight = [
    {
      label: 'Participants',
      value: `${selectedDiscussionParticipantKeys.length || selectedDiscussionAgents.length} selected`,
      ready: selectedDiscussionParticipantKeys.length > 0 || selectedDiscussionAgents.length > 0
    },
    {
      label: 'Context',
      value: `${selectedDiscussionContextRefs.length} attached`,
      ready: selectedDiscussionContextRefs.length > 0
    },
    {
      label: 'Rounds',
      value: `${discussionMaxRounds} maximum`,
      ready: discussionMaxRounds > 0
    },
    {
      label: 'Tools',
      value: 'Agent only',
      ready: true
    }
  ];
  const taskHasWriteAccess = taskRunType !== 'coding' || Boolean(activeSourceId);
  const taskPreflight = [
    {
      label: 'Owner',
      value: codingTaskDeveloperName || 'Not selected',
      ready: !!codingTaskDeveloperName
    },
    {
      label: 'Reviewers',
      value: `${codingTaskReviewerNames.length} selected`,
      ready: codingTaskReviewerNames.length > 0
    },
    {
      label: 'Context',
      value: `${selectedCodingTaskContextRefs.length} attached`,
      ready: selectedCodingTaskContextRefs.length > 0
    },
    {
      label: 'Permissions',
      value: taskHasWriteAccess ? 'Ready' : 'Write access needed',
      ready: taskHasWriteAccess
    }
  ];

  if (activeTab === 'Home') {
    return (
      <HomeScreen
        projectData={projectData}
        activeSourceName={activeSourceName}
        onAttachSource={onAttachSource}
        onScanSource={onScanSource}
        scanLoading={loading}
        activeDiscussionRunId={activeDiscussionRunId}
        activeTaskRunId={activeTaskRunId}
        setActiveTab={setActiveTab}
      />
    );
  }

  if (activeTab === 'Activity') {
    return (
      <ActivityScreen
        projectData={projectData}
        activeDiscussionRunId={activeDiscussionRunId}
        activeTaskRunId={activeTaskRunId}
        lastCodingTaskResult={lastCodingTaskResult}
        setActiveTab={setActiveTab}
        setCodingTaskInput={setCodingTaskInput}
        applyTaskTypePreset={applyTaskTypePreset}
        setInitialSelectedFile={setInitialSelectedFile}
      />
    );
  }

  if (activeTab === 'Skills') {
    return (
      <SkillsCatalogScreen
        projectData={projectData}
        setActiveTab={setActiveTab}
        resetAgentForm={resetAgentForm}
      />
    );
  }

  if (activeTab === 'Discussions' || activeTab === 'Run:Think' || activeTab === 'Run:Decide') {
    const mode: RunMode = activeTab === 'Run:Decide' ? 'Decide' : 'Think';
    return (
      <RunComposerFrame mode={mode} preflight={discussionPreflight} onModeChange={changeRunMode}>
        <DiscussionsScreen
        projectPath={projectPath}
        loadProjectData={loadProjectData}
        ensureTemplateSkills={ensureTemplateSkills}
        projectData={projectData}
        activeDiscussionId={activeDiscussionId}
        summarizeActiveDiscussion={summarizeActiveDiscussion}
        startNewDiscussion={startNewDiscussion}
        loading={loading}
        loadDiscussionSession={loadDiscussionSession}
        deleteDiscussionSession={deleteDiscussionSession}
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
        discussionModeratorName={discussionModeratorName}
        setDiscussionModeratorName={setDiscussionModeratorName}
        discussionAutoSummary={discussionAutoSummary}
        setDiscussionAutoSummary={setDiscussionAutoSummary}
        discussionSummaryAgentName={discussionSummaryAgentName}
        setDiscussionSummaryAgentName={setDiscussionSummaryAgentName}
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
        />
      </RunComposerFrame>
    );
  }

  if (activeTab === 'Task Run' || activeTab === 'Run:Execute' || activeTab === 'Run:Review') {
    const mode: RunMode = activeTab === 'Run:Review' ? 'Review' : 'Execute';
    return (
      <RunComposerFrame mode={mode} preflight={taskPreflight} onModeChange={changeRunMode}>
        <TaskRunScreen
        projectPath={projectPath}
        loadProjectData={loadProjectData}
        ensureTemplateSkills={ensureTemplateSkills}
        projectData={projectData}
        activeSourceId={activeSourceId}
        onAttachSource={onAttachSource}
        taskBoardCards={taskBoardCards}
        codingTaskMessages={codingTaskMessages}
        codingTaskDeveloperName={codingTaskDeveloperName}
        setCodingTaskDeveloperName={setCodingTaskDeveloperName}
        taskRunType={taskRunType}
        applyTaskTypePreset={applyTaskTypePreset}
        taskTypeOptions={taskTypeOptions}
        codingTaskInput={codingTaskInput}
        setCodingTaskInput={setCodingTaskInput}
        codingTaskReviewerNames={codingTaskReviewerNames}
        setCodingTaskReviewerNames={setCodingTaskReviewerNames}
        temporaryTaskAgents={temporaryTaskAgents}
        setTemporaryTaskAgents={setTemporaryTaskAgents}
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
        startNewTaskRun={startNewTaskRun}
        scrollToDiscussionMessage={scrollToDiscussionMessage}
        setActiveTab={setActiveTab}
        loadRoomFilePreview={loadRoomFilePreview}
        loading={loading}
        taskRunView={taskRunView}
        setTaskRunView={setTaskRunView}
        selectedTaskCardId={selectedTaskCardId}
        setSelectedTaskCardId={setSelectedTaskCardId}
        setContinuedFromTaskId={setContinuedFromTaskId}
        />
      </RunComposerFrame>
    );
  }

  if (activeTab === 'AI Members' || activeTab === 'Agents') {
    return (
      <AIMembersScreen
        projectPath={projectPath}
        projectData={projectData}
        aiMemberDetailsExpanded={aiMemberDetailsExpanded}
        setAiMemberDetailsExpanded={setAiMemberDetailsExpanded}
        resetAgentForm={resetAgentForm}
        setActiveTab={setActiveTab}
        teamPresets={teamPresets}
        loadProjectData={loadProjectData}
        startEditAgent={startEditAgent}
        handleDeleteAgent={handleDeleteAgent}
      />
    );
  }

  if (activeTab.startsWith('Team:')) {
    const teamId = activeTab.slice('Team:'.length);
    const { userTeams, unassigned } = buildTeamRosters(
      projectData?.agents || [],
      projectData?.teams || [],
      projectData?.unassignedMemberIds || []
    );
    const team = [...userTeams, unassigned].find(candidate => candidate.id === teamId);

    if (!projectPath || !team) {
      return (
        <div style={{ padding: '32px', color: 'hsl(var(--text-muted))' }}>
          Team not found.
        </div>
      );
    }

    const availableMembers = (projectData?.agents || []).filter(
      (agent: any) => !agent.isVirtual && typeof agent.id === 'string' && agent.id.length > 0
    );

    return (
      <TeamDetailScreen
        projectPath={projectPath}
        team={team}
        availableMembers={availableMembers}
        existingNames={availableMembers.map((agent: any) => String(agent.name))}
        existingSkillFiles={projectData?.skills || []}
        api={{
          updateTeamMembers: api.updateTeamMembers,
          addMembersToTeam: api.addMembersToTeam
        }}
        reloadProjectData={() => loadProjectData(projectPath)}
        setActiveTab={setActiveTab}
        startEditAgent={startEditAgent}
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
        setNewAgentModelCustom={setNewAgentModelCustom}
        setNewAgentModel={setNewAgentModel}
        setSkillPreview={setSkillPreview}
        newAgentModelCustom={newAgentModelCustom}
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
        loading={agentOperationLoading}
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
        setActiveTab={setActiveTab}
        setCodingTaskInput={setCodingTaskInput}
        setSelectedTaskCardId={setSelectedTaskCardId}
        setSelectedCodingTaskContextRefs={setSelectedCodingTaskContextRefs}
        setContinuedFromTaskId={setContinuedFromTaskId}
      />
    );
  }

  if (
    activeTab === 'Files' ||
    activeTab === 'Artifacts' ||
    activeTab === 'Decisions' ||
    activeTab === 'Documents' ||
    activeTab === 'Reviews'
  ) {
    const roomSection = activeTab === 'Decisions'
      ? 'decisions' as const
      : activeTab === 'Documents'
        ? 'documents' as const
        : activeTab === 'Reviews'
          ? 'reviews' as const
          : undefined;
    return (
      <FilesScreen
        projectPath={projectPath}
        activeSourceId={activeSourceId}
        onAttachSource={onAttachSource}
        projectData={projectData}
        initialSelectedFile={initialSelectedFile}
        setInitialSelectedFile={setInitialSelectedFile}
        setErrorMsg={setErrorMsg}
        onAddContext={(ref) => {
          if (!selectedDiscussionContextRefs.includes(ref)) {
            toggleContextSelection('discussion', ref);
          }
          if (!selectedCodingTaskContextRefs.includes(ref)) {
            toggleContextSelection('task', ref);
          }
        }}
        initialTab={activeTab === 'Files' ? 'source' : 'room'}
        roomSection={roomSection}
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
      <h3>Room view unavailable</h3>
      <p style={{ marginTop: '12px', fontSize: '0.9rem' }}>
        Choose an available section from the Room sidebar.
      </p>
    </div>
  );
}
