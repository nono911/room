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
  selectProjectDir: () => ipcRenderer.invoke('select-project-dir'),
  openProjectDir: (dirPath) => ipcRenderer.invoke('open-project-dir', dirPath),
  listRoomWorkspaces: () => ipcRenderer.invoke('list-room-workspaces'),
  createWorkspace: (workspaceName) => ipcRenderer.invoke('create-workspace', workspaceName),
  roomInit: (dirPath) => ipcRenderer.invoke('room-init', dirPath),
  getProjectData: (dirPath) => ipcRenderer.invoke('get-project-data', dirPath),
  readRoomFile: (dirPath, section, filename) => ipcRenderer.invoke('read-room-file', { dirPath, section, filename }),
  listWorkspaceFiles: (dirPath) => ipcRenderer.invoke('list-workspace-files', dirPath),
  browseWorkspaceFiles: (dirPath, directory, query) => ipcRenderer.invoke('browse-workspace-files', { dirPath, directory, query }),
  searchContextItems: (dirPath, query) => ipcRenderer.invoke('search-context-items', { dirPath, query }),
  readWorkspaceFile: (dirPath, filePath) => ipcRenderer.invoke('read-workspace-file', { dirPath, filePath }),
  revealWorkspaceFile: (dirPath, filePath) => ipcRenderer.invoke('reveal-workspace-file', { dirPath, filePath }),
  loadContextSets: (dirPath) => ipcRenderer.invoke('load-context-sets', { dirPath }),
  saveContextSets: (dirPath, contextSets) => ipcRenderer.invoke('save-context-sets', { dirPath, contextSets }),
  runScan: (dirPath, mainAgent, modelName, allowDangerousCli) => ipcRenderer.invoke('run-scan', { dirPath, mainAgent, modelName, allowDangerousCli }),
  runDiscussion: (dirPath, topic, agentNames, options = {}) => ipcRenderer.invoke('run-discussion', {
    dirPath,
    topic,
    agentNames,
    ...selectOptions(options, [
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
  runTask: (dirPath, task, options = {}) => ipcRenderer.invoke('run-task', {
    dirPath,
    task,
    ...selectOptions(options, [
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
  summarizeDiscussion: (dirPath, discussionId, options = {}) => ipcRenderer.invoke('summarize-discussion', {
    dirPath,
    discussionId,
    ...selectOptions(options, ['agentNames', 'summaryAgentName', 'useProjectSummaryAgent'])
  }),
  generateTasksFromDiscussion: (dirPath, discussionId, options = {}) => ipcRenderer.invoke('generate-tasks-from-discussion', {
    dirPath,
    discussionId,
    ...selectOptions(options, ['moderatorName'])
  }),
  loadTaskBoard: (dirPath) => ipcRenderer.invoke('load-task-board', { dirPath }),
  onDiscussionEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('discussion-event', listener);
    return () => ipcRenderer.removeListener('discussion-event', listener);
  },
  saveRoomFile: (dirPath, section, filename, content) => ipcRenderer.invoke('save-room-file', { dirPath, section, filename, content }),
  saveContextFile: (dirPath, filename, content) => ipcRenderer.invoke('save-context-file', { dirPath, filename, content }),
  saveSkill: (dirPath, name, content, source) => ipcRenderer.invoke('save-skill', { dirPath, name, content, source }),
  previewAgentSkills: (dirPath, agent) => ipcRenderer.invoke('preview-agent-skills', { dirPath, agent }),
  saveAgent: (dirPath, agent) => ipcRenderer.invoke('save-agent', { dirPath, agent }),
  deleteAgent: (dirPath, agentName, memberId) => ipcRenderer.invoke('delete-agent', { dirPath, agentName, memberId }),
  loadTeams: (dirPath) => ipcRenderer.invoke('load-teams', { dirPath }),
  saveTeam: (dirPath, team) => ipcRenderer.invoke('save-team', { dirPath, team }),
  deleteTeam: (dirPath, teamId) => ipcRenderer.invoke('delete-team', { dirPath, teamId }),
  updateTeamMembers: (dirPath, teamId, memberIds) => ipcRenderer.invoke('update-team-members', { dirPath, teamId, memberIds }),
  createTeamWithMembers: (dirPath, team, members, skillDrafts = []) =>
    ipcRenderer.invoke('create-team-with-members', { dirPath, team, members, skillDrafts }),
  addMembersToTeam: (dirPath, teamId, members, skillDrafts = []) =>
    ipcRenderer.invoke('add-members-to-team', { dirPath, teamId, members, skillDrafts }),
  detectLocalAgents: () => ipcRenderer.invoke('detect-local-agents'),
  loadProviders: () => ipcRenderer.invoke('load-providers'),
  saveProvider: (provider) => ipcRenderer.invoke('save-provider', provider),
  deleteProvider: (providerId) => ipcRenderer.invoke('delete-provider', providerId),
  testProvider: (providerId) => ipcRenderer.invoke('test-provider', providerId),
  detectCliModels: (cliId) => ipcRenderer.invoke('detect-cli-models', cliId),
  detectApiModels: (providerId) => ipcRenderer.invoke('detect-api-models', { providerId }),
  loadMcpConfig: (dirPath) => ipcRenderer.invoke('load-mcp-config', dirPath),
  saveMcpConfig: (dirPath, config) => ipcRenderer.invoke('save-mcp-config', { dirPath, config }),
  loadProjectConfig: (dirPath) => ipcRenderer.invoke('load-project-config', dirPath),
  saveProjectConfig: (dirPath, config) => ipcRenderer.invoke('save-project-config', { dirPath, config })
});
