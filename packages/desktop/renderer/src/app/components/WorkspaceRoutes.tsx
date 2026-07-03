import { OverviewScreen } from '../../components/screens/OverviewScreen.js';
import { FilesScreen } from '../../features/workspace-files/components/FilesScreen.js';
import { AIMembersScreen } from '../../features/ai-members/components/AIMembersScreen.js';
import { AgentEditorScreen } from '../../features/ai-members/components/AgentEditorScreen.js';
import { DiscussionsScreen } from '../../features/discussions/components/DiscussionsScreen.js';
import { TaskRunScreen } from '../../features/task-run/components/TaskRunScreen.js';
import { DocumentsScreen } from '../../features/workspace-files/components/DocumentsScreen.js';
import { TaskArchiveScreen } from '../../features/workspace-files/components/TaskArchiveScreen.js';
import { ContextScreen } from '../../features/workspace-files/components/ContextScreen.js';
import { DecisionsScreen } from '../../features/workspace-files/components/DecisionsScreen.js';
import { McpServersScreen } from '../../features/mcp/components/McpServersScreen.js';
import { SettingsScreen } from '../../features/providers/components/SettingsScreen.js';
import {
  taskTypeOptions,
  agentPersonaTemplates,
  teamPresets
} from '../../shared/data/staticData.js';

interface WorkspaceRoutesProps {
  activeTab: string;
  projectPath: string | null;
  projectData: any;
  loading: boolean;
  errorMsg: string | null;
  setErrorMsg: (value: string | null) => void;
  setActiveTab: (tab: string) => void;
  loadProjectData: (path: string) => Promise<void>;
  loadWorkspaceCoreData: (path: string) => Promise<any>;
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
  setLoading: (value: boolean) => void;
  handleAddTeamPreset: (teamName: string) => void;
  startEditAgent: (agent: any) => void;
  handleDeleteAgent: (agentName: string) => void;
  newAgentProvider: string;
  newAgentPreset: any;
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
  setNewAgentPreset: (value: any) => void;
  setNewAgentPermissionMode: (value: any) => void;
  setNewAgentModelCustom: (value: boolean) => void;
  setNewAgentModel: (value: string) => void;
  setSkillPreview: (value: any) => void;
  newAgentModelCustom: boolean;
  newAgentCommand: string;
  setNewAgentCommand: (value: string) => void;
  newAgentStdinFormat: any;
  setNewAgentStdinFormat: (value: any) => void;
  newAgentPermissionMode: any;
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
  discussionMessages: any[];
  highlightedDiscussionMessage: any;
  selectedDiscussionContextRefs: string[];
  selectedDiscussionAgents: string[];
  setSelectedDiscussionAgents: (value: string[] | ((prev: string[]) => string[])) => void;
  temporaryDiscussionAgents: any[];
  setTemporaryDiscussionAgents: (value: any[] | ((prev: any[]) => any[])) => void;
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
  projectConfig: any;
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
  enableTaskRunWriteAccess: () => void;
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
  setLastCodingTaskResult: (value: any) => void;
  setCodingTaskMessages: (value: any[] | ((prev: any[]) => any[])) => void;
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
  taskRunView: any;
  setTaskRunView: (value: any) => void;
  handleUpdateProjectConfig: any;
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
    projectData,
    loading,
    errorMsg,
    setErrorMsg,
    setActiveTab,
    loadProjectData,
    loadWorkspaceCoreData,
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
    setLoading,
    handleAddTeamPreset,
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
    setNewAgentPermissionMode,
    setNewAgentModelCustom,
    setNewAgentModel,
    setSkillPreview,
    newAgentModelCustom,
    newAgentCommand,
    setNewAgentCommand,
    newAgentStdinFormat,
    setNewAgentStdinFormat,
    newAgentPermissionMode,
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
    discussionMessages,
    highlightedDiscussionMessage,
    selectedDiscussionContextRefs,
    selectedDiscussionAgents,
    setSelectedDiscussionAgents,
    temporaryDiscussionAgents,
    setTemporaryDiscussionAgents,
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
    projectConfig,
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
    enableTaskRunWriteAccess,
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
    setLastCodingTaskResult,
    setCodingTaskMessages,
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
    taskRunView,
    setTaskRunView,
    selectedTaskCardId,
    setSelectedTaskCardId,
    setContinuedFromTaskId,
    handleUpdateProjectConfig,
    contentTheme,
    setContentTheme,
    contentFontFamily,
    setContentFontFamily,
    contentFontSize,
    setContentFontSize,
    contentLineHeight,
    setContentLineHeight
  } = props;

  if (activeTab === 'Discussions') {
    return (
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
        temporaryDiscussionAgents={temporaryDiscussionAgents}
        setTemporaryDiscussionAgents={setTemporaryDiscussionAgents}
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
    );
  }

  if (activeTab === 'Task Run') {
    return (
      <TaskRunScreen
        projectPath={projectPath}
        loadProjectData={loadProjectData}
        ensureTemplateSkills={ensureTemplateSkills}
        projectData={projectData}
        taskBoardCards={taskBoardCards}
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
        scrollToDiscussionMessage={scrollToDiscussionMessage}
        setActiveTab={setActiveTab}
        loadRoomFilePreview={loadRoomFilePreview}
        loading={loading}
        taskRunView={taskRunView}
        setTaskRunView={setTaskRunView}
        selectedTaskCardId={selectedTaskCardId}
        setSelectedTaskCardId={setSelectedTaskCardId}
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
        setActiveTab={setActiveTab}
        setCodingTaskInput={setCodingTaskInput}
        setSelectedTaskCardId={setSelectedTaskCardId}
        setSelectedCodingTaskContextRefs={setSelectedCodingTaskContextRefs}
        setContinuedFromTaskId={setContinuedFromTaskId}
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
}
