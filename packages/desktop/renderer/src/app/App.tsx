import { useState, useEffect } from 'react';

// Imported types for ROOM
import type { ProjectData, TaskBoardCard } from '../types/domain.js';
import { api } from '../shared/ipc/client.js';
import { useTaskRun } from '../features/task-run/useTaskRun.js';
import { useDiscussion } from '../features/discussions/useDiscussion.js';
import { useAgentManagement, resolveAgentDefaultSelection } from '../features/ai-members/useAgentManagement.js';
import { useContextPicker } from '../shared/hooks/useContextPicker.js';
import { useOnboarding } from '../shared/hooks/useOnboarding.js';
import { useContentSettings } from '../shared/hooks/useContentSettings.js';
import { useProjectSettings } from '../features/providers/useProjectSettings.js';
import { useRoomFilePreview } from './hooks/useRoomFilePreview.js';
import { useSetupGuidance } from './hooks/useSetupGuidance.js';
import { useWorkspaceData } from './hooks/useWorkspaceData.js';
import { useWorkspaceLifecycle } from './hooks/useWorkspaceLifecycle.js';
import { AppThemeStyles } from './components/AppThemeStyles.js';
import { WelcomeScreen } from './components/WelcomeScreen.js';
import { WorkspaceRoutes } from './components/WorkspaceRoutes.js';

// Layout and Onboarding components
import { Sidebar } from '../shared/components/Sidebar.js';
import { ErrorBanner } from '../shared/components/ErrorBanner.js';
import { SetupChecklist } from '../components/onboarding/SetupChecklist.js';
import { OnboardingTour } from '../components/onboarding/OnboardingTour.js';
import { ContextPickerPanel } from '../components/context/ContextPickerPanel.js';
import { agentPersonaTemplates, teamPresets } from '../shared/data/staticData.js';
import { useProviders } from '../features/providers/context/ProvidersContext.js';
import { createDiscussionSelectionId } from '../features/discussions/lib/discussionSelection.js';

export default function App() {
  const { providers, getModelOptions, detectedClis } = useProviders();
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

  const [hasCompletedScan, setHasCompletedScan] = useState<boolean>(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);

  // Custom workspace control states
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(true);
  const [hoveredPreset, setHoveredPreset] = useState<any | null>(null);
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
    projectData,
    loadProjectData: (p: string) => loadProjectData(p),
    setLoading,
    setErrorMsg
  });
  const [taskBoardCards, setTaskBoardCards] = useState<TaskBoardCard[]>([]);
  const [initialSelectedFile, setInitialSelectedFile] = useState<{ section: 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions'; file: string } | null>(null);
  const {
    selectedDiscussionAgents,
    queueDiscussionAgentSelectionByNames,
    selectedDiscussionMemberIds, setSelectedDiscussionMemberIds,
    appendSelectedDiscussionMemberIds,
    toggleSelectedDiscussionMemberId,
    reorderSelectedDiscussionMemberIds,
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
    setSelectedTaskCardId(null);
    setContinuedFromTaskId(null);
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
    loadProjectData: (pathStr: string) => loadProjectData(pathStr),
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

      {projectPath === null || !isRoomProject ? (
        <>
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
          {projectPath !== null && !isRoomProject && (
            <div className="modal-backdrop">
              <div className="modal-content" style={{ maxWidth: '860px', width: '90%', animation: 'modalScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                <div className="modal-header">
                  <h3 className="modal-title">Initialize ROOM Workspace</h3>
                </div>
                <div className="modal-body" style={{ gap: '16px' }}>
                  {/* Detailed UX Explanation */}
                  <div style={{ fontSize: '0.82rem', color: 'hsl(var(--text-secondary))', lineHeight: 1.5, textAlign: 'center', marginBottom: '4px', width: '100%' }}>
                    เลือกรูปแบบทีม AI ด้านล่างเพื่อเริ่มเปิดใช้งานโฟลเดอร์นี้เป็นห้องทำงานของ ROOM
                    <br />
                    <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>💡 วางเมาส์ชี้ที่ปุ่มเพื่อดูรายละเอียดบทบาทหน้าที่ของ AI แต่ละตำแหน่ง</span>
                  </div>

                  {/* Compact Template Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '6px' }}>
                    {(() => {
                      const getPresetEmoji = (name: string) => {
                        const lowercaseName = name.toLowerCase();
                        if (lowercaseName.includes('film') || lowercaseName.includes('creative')) return '🎨';
                        if (lowercaseName.includes('software') || lowercaseName.includes('coding')) return '💻';
                        if (lowercaseName.includes('agile')) return '⚡';
                        if (lowercaseName.includes('research') || lowercaseName.includes('analysis')) return '🔍';
                        if (lowercaseName.includes('writing') || lowercaseName.includes('editorial') || lowercaseName.includes('story')) return '✍️';
                        if (lowercaseName.includes('business') || lowercaseName.includes('planning')) return '📈';
                        if (lowercaseName.includes('startup') || lowercaseName.includes('corporate') || lowercaseName.includes('executive')) return '🏢';
                        if (lowercaseName.includes('vetting')) return '🛡️';
                        if (lowercaseName.includes('customer') || lowercaseName.includes('b2c')) return '👥';
                        if (lowercaseName.includes('fintech') || lowercaseName.includes('investing') || lowercaseName.includes('trading')) return '💰';
                        if (lowercaseName.includes('health') || lowercaseName.includes('education')) return '🎓';
                        return '📁';
                      };

                      const handleInitPreset = async (preset: typeof teamPresets[0]) => {
                        if (loading) return;
                        setLoading(true);
                        try {
                          const res = await api.roomInit(projectPath!);
                          if (res.success) {
                            clearWorkspaceDerivedState();
                            const defaults = resolveAgentDefaultSelection(providers, detectedClis, getModelOptions);

                            const nextSelected: string[] = [];
                            for (const roleName of preset.roles) {
                              const tmpl = agentPersonaTemplates.find(t => t.name.toLowerCase() === roleName.toLowerCase());
                              if (tmpl) {
                                try {
                                  const skillFiles = await ensureTemplateSkills(tmpl.skills || []);
                                  const memberId = createDiscussionSelectionId('mem', tmpl.name);

                                  await api.saveAgent(projectPath!, {
                                    id: memberId,
                                    name: tmpl.name,
                                    role: tmpl.role,
                                    provider: defaults.provider,
                                    modelName: defaults.provider === 'Local CLI' ? undefined : (defaults.modelName || undefined),
                                    cliPreset: defaults.provider === 'Local CLI' ? defaults.cliPreset : undefined,
                                    permissionMode: defaults.provider === 'Local CLI' ? 'safe' : undefined,
                                    systemPrompt: tmpl.prompt,
                                    skills: skillFiles
                                  });
                                  nextSelected.push(tmpl.name);
                                } catch (err) {
                                  console.error(err);
                                }
                              }
                            }

                            const workspaceState = await api.openProjectDir(projectPath!);
                            if (workspaceState) {
                              queueDiscussionAgentSelectionByNames(nextSelected);
                              handleSelectRecentProject(projectPath!);
                            }
                          } else {
                            setErrorMsg(res.error || 'Failed to initialize .room.');
                          }
                        } catch (err: any) {
                          setErrorMsg(err.message || 'Error occurred during workspace initialization.');
                        } finally {
                          setLoading(false);
                        }
                      };

                      return teamPresets.map(preset => {
                        const isHovered = hoveredPreset?.name === preset.name;
                        return (
                          <div
                            key={preset.name}
                            onClick={() => handleInitPreset(preset)}
                            onMouseEnter={() => setHoveredPreset(preset)}
                            onMouseLeave={() => setHoveredPreset(null)}
                            style={{
                              padding: '8px 12px',
                              borderRadius: '6px',
                              background: isHovered ? 'hsla(var(--primary-raw), 0.15)' : 'hsl(var(--bg-input))',
                              border: isHovered ? '1px solid hsl(var(--primary))' : '1px solid hsl(var(--border-dim))',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              userSelect: 'none',
                              height: '38px',
                              overflow: 'hidden',
                              boxShadow: isHovered ? '0 0 8px hsla(var(--primary-raw), 0.3)' : 'none'
                            }}
                            className="preset-init-card"
                          >
                            <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>{getPresetEmoji(preset.name)}</span>
                            <span style={{ 
                              color: 'white', 
                              fontSize: '0.76rem', 
                              fontWeight: 600, 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis', 
                              whiteSpace: 'nowrap'
                            }}>
                              {preset.name}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Preset Preview Panel */}
                  <div style={{
                    height: '112px',
                    minHeight: '112px',
                    maxHeight: '112px',
                    borderRadius: '8px',
                    background: 'hsla(var(--bg-card-raw), 0.4)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid hsl(var(--border-dim))',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: '6px',
                    fontSize: '0.8rem',
                    color: 'white',
                    width: '100%',
                    boxSizing: 'border-box',
                    transition: 'all 0.15s ease',
                    boxShadow: 'inset 0 1px 0 0 hsla(0, 0%, 100%, 0.05)'
                  }}>
                    {hoveredPreset ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ fontSize: '0.85rem', color: 'hsl(var(--primary))' }}>
                            {hoveredPreset.name}
                          </strong>
                          <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
                            ({hoveredPreset.roles.length} AI Positions)
                          </span>
                        </div>
                        <div style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.78rem', lineHeight: '1.4' }}>
                          {hoveredPreset.description}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px', alignItems: 'center' }}>
                          <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.72rem', marginRight: '4px' }}>AI ในทีม:</span>
                          {hoveredPreset.roles.map((r: string) => {
                            const tmpl = agentPersonaTemplates.find(t => t.name.toLowerCase() === r.toLowerCase());
                            const roleTitle = tmpl ? tmpl.role : r;
                            return (
                              <span
                                key={r}
                                title={tmpl ? tmpl.prompt : undefined}
                                style={{
                                  fontSize: '0.7rem',
                                  padding: '2px 8px',
                                  borderRadius: '12px',
                                  background: 'hsla(var(--bg-input-raw), 0.6)',
                                  border: '1px solid hsl(var(--border-dim))',
                                  color: 'hsl(var(--text-secondary))'
                                }}
                              >
                                {r} ({roleTitle})
                              </span>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', color: 'hsl(var(--text-muted))', fontSize: '0.78rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <span>💡 วางเมาส์ชี้ที่ปุ่ม Preset เพื่อดูรายละเอียดบทบาทหน้าที่ของ AI ในทีมนี้</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="modal-footer" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button className="btn-secondary" onClick={handleCloseProjectWorkspace} disabled={loading} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={handleInitProject} disabled={loading} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                    {loading ? 'Initializing...' : 'Initialize Empty Workspace'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
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
                projectData={projectData}
                loading={loading}
                agentOperationLoading={agentOperationLoading}
                errorMsg={errorMsg}
                setErrorMsg={setErrorMsg}
                setActiveTab={setActiveTab}
                loadProjectData={loadProjectData}
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
                selectedDiscussionMemberIds={selectedDiscussionMemberIds}
                setSelectedDiscussionMemberIds={setSelectedDiscussionMemberIds}
                appendSelectedDiscussionMemberIds={appendSelectedDiscussionMemberIds}
                toggleSelectedDiscussionMemberId={toggleSelectedDiscussionMemberId}
                reorderSelectedDiscussionMemberIds={reorderSelectedDiscussionMemberIds}
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
