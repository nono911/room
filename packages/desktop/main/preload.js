const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectProjectDir: () => ipcRenderer.invoke('select-project-dir'),
  openProjectDir: (dirPath) => ipcRenderer.invoke('open-project-dir', dirPath),
  createWorkspace: (workspaceName) => ipcRenderer.invoke('create-workspace', workspaceName),
  roomInit: (dirPath) => ipcRenderer.invoke('room-init', dirPath),
  getProjectData: (dirPath) => ipcRenderer.invoke('get-project-data', dirPath),
  readRoomFile: (dirPath, section, filename) => ipcRenderer.invoke('read-room-file', { dirPath, section, filename }),
  listWorkspaceFiles: (dirPath) => ipcRenderer.invoke('list-workspace-files', dirPath),
  searchContextItems: (dirPath, query) => ipcRenderer.invoke('search-context-items', { dirPath, query }),
  readWorkspaceFile: (dirPath, filePath) => ipcRenderer.invoke('read-workspace-file', { dirPath, filePath }),
  runScan: (dirPath, mainAgent, modelName, allowDangerousCli) => ipcRenderer.invoke('run-scan', { dirPath, mainAgent, modelName, allowDangerousCli }),
  runDiscussion: (dirPath, topic, agentNames, options = {}) => ipcRenderer.invoke('run-discussion', { dirPath, topic, agentNames, ...options }),
  runTask: (dirPath, task, options = {}) => ipcRenderer.invoke('run-task', { dirPath, task, ...options }),
  summarizeDiscussion: (dirPath, discussionId, options = {}) => ipcRenderer.invoke('summarize-discussion', { dirPath, discussionId, ...options }),
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
  deleteAgent: (dirPath, agentName) => ipcRenderer.invoke('delete-agent', { dirPath, agentName }),
  detectLocalAgents: () => ipcRenderer.invoke('detect-local-agents'),
  loadApiKeys: () => ipcRenderer.invoke('load-api-keys'),
  saveApiKeys: (keys) => ipcRenderer.invoke('save-api-keys', keys),
  clearApiKeys: () => ipcRenderer.invoke('clear-api-keys'),
  detectCliModels: (cliId) => ipcRenderer.invoke('detect-cli-models', cliId),
  detectApiModels: (provider, apiKey) => ipcRenderer.invoke('detect-api-models', { provider, apiKey }),
  loadMcpConfig: (dirPath) => ipcRenderer.invoke('load-mcp-config', dirPath),
  saveMcpConfig: (dirPath, config) => ipcRenderer.invoke('save-mcp-config', { dirPath, config }),
  loadProjectConfig: (dirPath) => ipcRenderer.invoke('load-project-config', dirPath),
  saveProjectConfig: (dirPath, config) => ipcRenderer.invoke('save-project-config', { dirPath, config })
});
