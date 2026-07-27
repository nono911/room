const { contextBridge, ipcRenderer } = require('electron');

const normalizeOptions = (options) => (
  options && typeof options === 'object' && !Array.isArray(options) ? options : {}
);

const selectOptions = (options, keys) => {
  const source = normalizeOptions(options);
  return Object.fromEntries(keys
    .filter((key) => source[key] !== undefined)
    .map((key) => [key, source[key]]));
};

contextBridge.exposeInMainWorld('electronAPI', {
  initializePersonalRoom: () => ipcRenderer.invoke('initialize-personal-room'),
  attachRoomSource: (roomId) => ipcRenderer.invoke('attach-room-source', { roomId }),
  detachRoomSource: (roomId, sourceId) =>
    ipcRenderer.invoke('detach-room-source', { roomId, sourceId }),
  setActiveRoomSource: (roomId, sourceId) =>
    ipcRenderer.invoke('set-active-room-source', { roomId, sourceId }),
  getProjectData: (roomId) => ipcRenderer.invoke('get-room-data', roomId),
  readRoomFile: (roomId, section, filename) =>
    ipcRenderer.invoke('read-room-file', { roomId, section, filename }),
  listWorkspaceFiles: (roomId, sourceId) =>
    ipcRenderer.invoke('list-source-files', { roomId, sourceId }),
  browseWorkspaceFiles: (roomId, sourceId, directory, query) =>
    ipcRenderer.invoke('browse-source-files', { roomId, sourceId, directory, query }),
  searchContextItems: (roomId, sourceId, query) =>
    ipcRenderer.invoke('search-context-items', { roomId, sourceId, query }),
  readWorkspaceFile: (roomId, sourceId, filePath) =>
    ipcRenderer.invoke('read-source-file', { roomId, sourceId, filePath }),
  revealWorkspaceFile: (roomId, sourceId, filePath) =>
    ipcRenderer.invoke('reveal-source-file', { roomId, sourceId, filePath }),
  loadContextSets: (roomId) => ipcRenderer.invoke('load-context-sets', { roomId }),
  saveContextSets: (roomId, contextSets) =>
    ipcRenderer.invoke('save-context-sets', { roomId, contextSets }),
  runScan: (roomId, sourceId, mainAgent, modelName, allowDangerousCli) =>
    ipcRenderer.invoke('run-scan', {
      roomId,
      sourceId,
      mainAgent,
      modelName,
      allowDangerousCli
    }),
  runDiscussion: (roomId, topic, agentNames, options = {}) =>
    ipcRenderer.invoke('run-discussion', {
      roomId,
      topic,
      agentNames,
      ...selectOptions(options, [
        'sourceId',
        'maxRounds',
        'reviewMode',
        'allowReadOnlyTools',
        'contextRefs',
        'discussionId',
        'qualityGate',
        'moderatorName',
        'autoSummary',
        'summaryAgentName',
        'useProjectSummaryAgent',
        'temporaryAgents'
      ])
    }),
  runTask: (roomId, task, options = {}) => ipcRenderer.invoke('run-task', {
    roomId,
    task,
    ...selectOptions(options, [
      'sourceId',
      'taskType',
      'doerName',
      'reviewerNames',
      'maxCycles',
      'contextRefs',
      'associatedCardId',
      'continuedFromTaskId',
      'taskId',
      'temporaryAgents'
    ])
  }),
  interruptRun: (runId, message) => ipcRenderer.invoke('interrupt-run', { runId, message }),
  summarizeDiscussion: (roomId, discussionId, options = {}) =>
    ipcRenderer.invoke('summarize-discussion', {
      roomId,
      discussionId,
      ...selectOptions(options, [
        'sourceId',
        'agentNames',
        'summaryAgentName',
        'useProjectSummaryAgent'
      ])
    }),
  generateTasksFromDiscussion: (roomId, discussionId, options = {}) =>
    ipcRenderer.invoke('generate-tasks-from-discussion', {
      roomId,
      discussionId,
      ...selectOptions(options, ['sourceId', 'moderatorName'])
    }),
  loadTaskBoard: (roomId) => ipcRenderer.invoke('load-task-board', { roomId }),
  onDiscussionEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('discussion-event', listener);
    return () => ipcRenderer.removeListener('discussion-event', listener);
  },
  saveRoomFile: (roomId, section, filename, content) =>
    ipcRenderer.invoke('save-room-file', { roomId, section, filename, content }),
  saveContextFile: (roomId, filename, content) =>
    ipcRenderer.invoke('save-context-file', { roomId, filename, content }),
  saveSkill: (roomId, name, content, source) =>
    ipcRenderer.invoke('save-skill', { roomId, name, content, source }),
  previewAgentSkills: (roomId, agent) =>
    ipcRenderer.invoke('preview-agent-skills', { roomId, agent }),
  saveAgent: (roomId, agent) => ipcRenderer.invoke('save-agent', { roomId, agent }),
  deleteAgent: (roomId, agentName, memberId) =>
    ipcRenderer.invoke('delete-agent', { roomId, agentName, memberId }),
  loadTeams: (roomId) => ipcRenderer.invoke('load-teams', { roomId }),
  saveTeam: (roomId, team) => ipcRenderer.invoke('save-team', { roomId, team }),
  deleteTeam: (roomId, teamId) => ipcRenderer.invoke('delete-team', { roomId, teamId }),
  updateTeamMembers: (roomId, teamId, memberIds) =>
    ipcRenderer.invoke('update-team-members', { roomId, teamId, memberIds }),
  createTeamWithMembers: (roomId, team, members, skillDrafts = []) =>
    ipcRenderer.invoke('create-team-with-members', { roomId, team, members, skillDrafts }),
  addMembersToTeam: (roomId, teamId, members, skillDrafts = []) =>
    ipcRenderer.invoke('add-members-to-team', { roomId, teamId, members, skillDrafts }),
  detectLocalAgents: () => ipcRenderer.invoke('detect-local-agents'),
  loadProviders: () => ipcRenderer.invoke('load-providers'),
  saveProvider: (provider) => ipcRenderer.invoke('save-provider', provider),
  deleteProvider: (providerId) => ipcRenderer.invoke('delete-provider', providerId),
  testProvider: (providerId) => ipcRenderer.invoke('test-provider', providerId),
  detectCliModels: (cliId) => ipcRenderer.invoke('detect-cli-models', cliId),
  detectApiModels: (providerId) => ipcRenderer.invoke('detect-api-models', { providerId }),
  loadMcpConfig: (roomId) => ipcRenderer.invoke('load-mcp-config', roomId),
  saveMcpConfig: (roomId, config) => ipcRenderer.invoke('save-mcp-config', { roomId, config }),
  loadProjectConfig: (roomId) => ipcRenderer.invoke('load-project-config', roomId),
  saveProjectConfig: (roomId, config) =>
    ipcRenderer.invoke('save-project-config', { roomId, config })
});
