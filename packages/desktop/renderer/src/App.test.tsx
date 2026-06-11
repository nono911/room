import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

import { expect, test, vi } from 'vitest';
import App from './App.js';
import { ProvidersProvider } from './features/providers/context/ProvidersContext.js';

test('renders welcome screen initially, then opens workspace, navigates all tabs, and verifies IPC calls', async () => {
  // Clear localStorage to isolate test run from previous state
  localStorage.clear();

  const mockApi = window.electronAPI as any;

  // Set up mock implementations for the IPC methods
  mockApi.selectProjectDir.mockResolvedValue({
    success: true,
    path: '/mock/path/project-x',
    isRoomProject: true
  });

  mockApi.getProjectData.mockResolvedValue({
    success: true,
    projectMd: '# Welcome to Project X\nThis is a mock project context.',
    archMd: '## Architecture\n- Subsystem A\n- Subsystem B',
    hasScanData: true,
    tasks: ['task1.md'],
    taskRuns: ['run1.json'],
    decisions: ['decision1.md'],
    reviews: [],
    documents: ['doc1.md'],
    discussions: ['discussion1.md'],
    skills: ['skill1.md'],
    agents: [
      { name: 'AgentDoer', role: 'Developer', provider: 'Gemini', model: 'gemini-1.5-pro' }
    ]
  });

  mockApi.loadProviders.mockResolvedValue({
    success: true,
    providers: [
      { id: 'gemini', label: 'Gemini', baseUrl: '', keyless: false, configurable: true }
    ]
  });

  mockApi.detectLocalAgents.mockResolvedValue({
    success: true,
    agents: []
  });

  mockApi.detectApiModels.mockResolvedValue({
    success: true,
    models: [{ value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }]
  });

  mockApi.loadProjectConfig.mockResolvedValue({
    success: true,
    config: {
      mainAgent: 'AgentDoer',
      modelName: 'gemini-1.5-pro',
      allowDangerousCli: false
    }
  });

  // Render the App
  render(
    <ProvidersProvider>
      <App />
    </ProvidersProvider>
  );

  // 1. Initial State Check: Expect to see the welcome screen when projectPath is null
  expect(screen.getByText('Open Existing Workspace')).toBeDefined();

  // 2. Open Workspace Flow
  const openBtn = screen.getByText('Open Existing Workspace');
  fireEvent.click(openBtn);

  // Wait for the mock electron APIs to load and update state (resolves act() warning)
  await waitFor(() => {
    expect(screen.getByText('Active Workspace')).toBeDefined();
  });

  // Dismiss the onboarding tour modal
  await waitFor(() => {
    expect(screen.getByText('Skip')).toBeDefined();
  });
  fireEvent.click(screen.getByText('Skip'));

  // Wait for the onboarding tour modal to be removed
  await waitFor(() => {
    expect(screen.queryByText('Skip')).toBeNull();
  });

  // Verify IPC Contract for loading project workspace
  expect(mockApi.selectProjectDir).toHaveBeenCalled();
  expect(mockApi.getProjectData).toHaveBeenCalledWith('/mock/path/project-x');
  expect(mockApi.loadProviders).toHaveBeenCalled();
  expect(mockApi.detectLocalAgents).toHaveBeenCalled();

  // 3. Smoke Test: Navigate through all screens/tabs to ensure they don't crash
  
  // Overview
  fireEvent.click(screen.getByText('Overview'));
  await waitFor(() => {
    expect(screen.getByText(/Active workspace overview located in/i)).toBeDefined();
  });

  // Files
  fireEvent.click(screen.getByText('Files'));
  await waitFor(() => {
    expect(screen.getByPlaceholderText(/Search workspace files and folders/i)).toBeDefined();
  });

  // AI Members
  fireEvent.click(screen.getByText('AI Members'));
  await waitFor(() => {
    expect(screen.getByText(/Create role-based personas/i)).toBeDefined();
  });

  // Discussions
  fireEvent.click(screen.getByText('Discussions'));
  await waitFor(() => {
    expect(screen.getByText(/Chat History/i)).toBeDefined();
  });

  // Task Run
  fireEvent.click(screen.getByText('Task Run'));
  await waitFor(() => {
    expect(screen.getByText(/Work Request/i)).toBeDefined();
  });

  // Documents
  fireEvent.click(screen.getByText('Documents'));
  await waitFor(() => {
    expect(screen.getByText(/Documents from/i)).toBeDefined();
  });

  // Tasks (Task Archive)
  fireEvent.click(screen.getByText('Task Archive'));
  await waitFor(() => {
    expect(screen.getByText(/Task notes and task run transcripts/i)).toBeDefined();
  });

  // Context
  fireEvent.click(screen.getByText('Context'));
  await waitFor(() => {
    expect(screen.getByText(/Workspace context and structure stored under/i)).toBeDefined();
  });

  // MCP Servers
  fireEvent.click(screen.getByText('MCP Servers'));
  await waitFor(() => {
    expect(screen.getByText(/No servers configured/i)).toBeDefined();
  });

  // Settings
  fireEvent.click(screen.getByText('Settings'));
  await waitFor(() => {
    expect(screen.getByText(/Keys are stored locally on this machine/i)).toBeDefined();
  });

  // Clear mock calls history for clean isolation
  vi.clearAllMocks();
});

test('handles streaming events correctly during runTask', async () => {
  localStorage.clear();
  const mockApi = window.electronAPI as any;

  // Mock API setup
  mockApi.selectProjectDir.mockResolvedValue({
    success: true,
    path: '/mock/path/project-x',
    isRoomProject: true
  });

  mockApi.getProjectData.mockResolvedValue({
    success: true,
    projectMd: '# Welcome to Project X\nThis is a mock project context.',
    archMd: '## Architecture\n- Subsystem A\n- Subsystem B',
    hasScanData: true,
    tasks: ['task1.md'],
    taskRuns: ['run1.json'],
    decisions: ['decision1.md'],
    reviews: [],
    documents: ['doc1.md'],
    discussions: ['discussion1.md'],
    skills: ['skill1.md'],
    agents: [
      { name: 'AgentDoer', role: 'Developer', provider: 'Gemini', model: 'gemini-1.5-pro' },
      { name: 'AgentReviewer', role: 'Reviewer', provider: 'Gemini', model: 'gemini-1.5-pro' }
    ]
  });

  mockApi.loadProviders.mockResolvedValue({
    success: true,
    providers: [
      { id: 'gemini', label: 'Gemini', baseUrl: '', keyless: false, configurable: true }
    ]
  });

  mockApi.detectLocalAgents.mockResolvedValue({
    success: true,
    agents: []
  });

  mockApi.detectApiModels.mockResolvedValue({
    success: true,
    models: [{ value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }]
  });

  mockApi.loadProjectConfig.mockResolvedValue({
    success: true,
    config: {
      mainAgent: 'AgentDoer',
      modelName: 'gemini-1.5-pro',
      allowDangerousCli: false
    }
  });

  let capturedCallback: any;
  const mockUnsubscribe = vi.fn();
  mockApi.onDiscussionEvent.mockImplementation((callback: any) => {
    capturedCallback = callback;
    return mockUnsubscribe;
  });

  let resolveRunTaskPromise: any;
  const runTaskPromise = new Promise((resolve) => {
    resolveRunTaskPromise = resolve;
  });
  mockApi.runTask.mockReturnValue(runTaskPromise);

  render(
    <ProvidersProvider>
      <App />
    </ProvidersProvider>
  );

  // Open Workspace
  const openBtn = screen.getByText('Open Existing Workspace');
  fireEvent.click(openBtn);

  await waitFor(() => {
    expect(screen.getByText('Active Workspace')).toBeDefined();
  });

  // Skip Onboarding
  fireEvent.click(screen.getByText('Skip'));

  // Go to Task Run tab
  fireEvent.click(screen.getByText('Task Run'));
  await waitFor(() => {
    expect(screen.getByText(/Work Request/i)).toBeDefined();
  });

  // Select Doer
  const doerSelect = screen.getByLabelText(/^Doer$/i) as HTMLSelectElement;
  fireEvent.change(doerSelect, { target: { value: 'AgentDoer' } });
  await waitFor(() => {
    expect(doerSelect.value).toBe('AgentDoer');
  });

  // Select Reviewer (click checkbox chip for AgentReviewer)
  const reviewerCheckbox = screen.getByLabelText(/AgentReviewer/i) as HTMLInputElement;
  fireEvent.change(reviewerCheckbox, { target: { checked: true } });
  await waitFor(() => {
    expect((screen.getByLabelText(/AgentReviewer/i) as HTMLInputElement).checked).toBe(true);
  });

  // Fill Work Request input
  const workRequestTextarea = screen.getByPlaceholderText(/Describe the work you want the selected AI member to produce/i) as HTMLTextAreaElement;
  fireEvent.change(workRequestTextarea, { target: { value: 'Create a test application' } });
  await waitFor(() => {
    expect(workRequestTextarea.value).toBe('Create a test application');
  });

  // Click Run Doer -> Review Loop
  const runButton = screen.getByText('Run Doer -> Review Loop') as HTMLButtonElement;
  await waitFor(() => {
    expect(runButton.disabled).toBe(false);
  });
  fireEvent.click(runButton);

  // Assert callback is registered
  await waitFor(() => {
    expect(capturedCallback).toBeDefined();
  });

  // Stream Event 1: agent_started
  act(() => {
    capturedCallback({
      type: 'agent_started',
      discussionId: 'task-123',
      agentName: 'AgentDoer',
      providerName: 'Gemini',
      modelName: 'gemini-1.5-pro',
      role: 'Developer',
      round: 0,
      timestamp: '12:00:00 PM'
    });
  });

  // Check that Agent is thinking message is in the UI
  await waitFor(() => {
    expect(screen.getByText('Reading the workspace context...')).toBeTruthy();
  });

  // Stream Event 2: agent_chunk (triggers advanceAgentProgressMessage)
  act(() => {
    capturedCallback({
      type: 'agent_chunk',
      discussionId: 'task-123',
      agentName: 'AgentDoer',
      providerName: 'Gemini',
      modelName: 'gemini-1.5-pro',
      round: 0,
      chunk: 'some progress'
    });
  });

  // Check that progress advanced to step 1
  await waitFor(() => {
    expect(screen.getByText(/Reviewing the discussion so far/i)).toBeTruthy();
  });

  // Stream Event 3: message_completed
  act(() => {
    capturedCallback({
      type: 'message_completed',
      discussionId: 'task-123',
      round: 0,
      message: {
        agentName: 'AgentDoer',
        providerName: 'Gemini',
        modelName: 'gemini-1.5-pro',
        content: 'Final produced content of the task',
        timestamp: '12:01:00 PM',
        contextMessages: []
      }
    });
  });

  // Assert output text is displayed and streaming finishes
  await waitFor(() => {
    expect(screen.getByText('Final produced content of the task')).toBeTruthy();
  });

  // Resolve the task run operation
  resolveRunTaskPromise({
    success: true,
    result: {
      id: 'task-123',
      title: 'Mock Task Run',
      task: 'Create a test application',
      status: 'approved',
      cycles: 1,
      messages: [
        {
          agentName: 'AgentDoer',
          providerName: 'Gemini',
          modelName: 'gemini-1.5-pro',
          content: 'Final produced content of the task',
          timestamp: '12:01:00 PM'
        }
      ],
      markdownFilename: 'task-123.md',
      jsonFilename: 'task-123.json',
      artifactFilename: 'artifact.zip',
      approvedBy: ['AgentReviewer']
    }
  });

  // Wait for the final system message summary to be rendered in timeline view
  await waitFor(() => {
    expect(screen.getByText(/Task approved after 1 cycle\(s\)/i)).toBeDefined();
  });

  // Assert unsubscribe function was called in finally
  expect(mockUnsubscribe).toHaveBeenCalled();
});

test('handles streaming events correctly during runDiscussion', async () => {
  localStorage.clear();
  const mockApi = window.electronAPI as any;

  // Mock API setup
  mockApi.selectProjectDir.mockResolvedValue({
    success: true,
    path: '/mock/path/project-x',
    isRoomProject: true
  });

  mockApi.getProjectData.mockResolvedValue({
    success: true,
    projectMd: '# Welcome to Project X\nThis is a mock project context.',
    archMd: '## Architecture\n- Subsystem A\n- Subsystem B',
    hasScanData: true,
    tasks: ['task1.md'],
    taskRuns: ['run1.json'],
    decisions: ['decision1.md'],
    reviews: [],
    documents: ['doc1.md'],
    discussions: ['discussion1.md'],
    skills: ['skill1.md'],
    agents: [
      { name: 'AgentDoer', role: 'Developer', provider: 'Gemini', model: 'gemini-1.5-pro' }
    ]
  });

  mockApi.loadProviders.mockResolvedValue({
    success: true,
    providers: [
      { id: 'gemini', label: 'Gemini', baseUrl: '', keyless: false, configurable: true }
    ]
  });

  mockApi.detectLocalAgents.mockResolvedValue({
    success: true,
    agents: []
  });

  mockApi.detectApiModels.mockResolvedValue({
    success: true,
    models: [{ value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }]
  });

  mockApi.loadProjectConfig.mockResolvedValue({
    success: true,
    config: {
      mainAgent: 'AgentDoer',
      modelName: 'gemini-1.5-pro',
      allowDangerousCli: false
    }
  });

  let capturedCallback: any;
  const mockUnsubscribe = vi.fn();
  mockApi.onDiscussionEvent.mockImplementation((callback: any) => {
    capturedCallback = callback;
    return mockUnsubscribe;
  });

  let resolveRunDiscussionPromise: any;
  const runDiscussionPromise = new Promise((resolve) => {
    resolveRunDiscussionPromise = resolve;
  });
  mockApi.runDiscussion.mockReturnValue(runDiscussionPromise);

  render(
    <ProvidersProvider>
      <App />
    </ProvidersProvider>
  );

  // Open Workspace
  const openBtn = screen.getByText('Open Existing Workspace');
  fireEvent.click(openBtn);

  await waitFor(() => {
    expect(screen.getByText('Active Workspace')).toBeDefined();
  });

  // Skip Onboarding
  fireEvent.click(screen.getByText('Skip'));

  // Go to Discussions tab
  fireEvent.click(screen.getAllByText('Discussions').find(el => el.classList.contains('sidebar-nav-label')) as HTMLElement);
  await waitFor(() => {
    expect(screen.getByText(/Chat History/i)).toBeDefined();
  });

  // Select AgentDoer
  const agentCheckbox = screen.getByLabelText(/AgentDoer/i) as HTMLInputElement;
  fireEvent.change(agentCheckbox, { target: { checked: true } });
  await waitFor(() => {
    expect((screen.getByLabelText(/AgentDoer/i) as HTMLInputElement).checked).toBe(true);
  });

  // Fill User Input Topic
  const topicInput = screen.getByPlaceholderText(/Ask selected agents to discuss an idea/i) as HTMLInputElement;
  fireEvent.change(topicInput, { target: { value: 'Let us discuss refactoring' } });
  await waitFor(() => {
    expect(topicInput.value).toBe('Let us discuss refactoring');
  });

  // Click Send
  const sendButton = screen.getByText('Send') as HTMLButtonElement;
  fireEvent.click(sendButton);

  // Assert callback is registered
  await waitFor(() => {
    expect(capturedCallback).toBeDefined();
  });

  // Stream Event 1: agent_started (non-task ID)
  act(() => {
    capturedCallback({
      type: 'agent_started',
      discussionId: 'disc-123',
      agentName: 'AgentDoer',
      providerName: 'Gemini',
      modelName: 'gemini-1.5-pro',
      role: 'Developer',
      round: 0,
      timestamp: '12:00:00 PM'
    });
  });

  // Check that Agent is thinking message is in the UI
  await waitFor(() => {
    expect(screen.getByText('Reading the workspace context...')).toBeTruthy();
  });

  // Stream Event 2: agent_chunk
  act(() => {
    capturedCallback({
      type: 'agent_chunk',
      discussionId: 'disc-123',
      agentName: 'AgentDoer',
      providerName: 'Gemini',
      modelName: 'gemini-1.5-pro',
      round: 0,
      chunk: 'some progress'
    });
  });

  // Check progress advanced
  await waitFor(() => {
    expect(screen.getByText(/Reviewing the discussion so far/i)).toBeTruthy();
  });

  // Stream Event 3: message_completed
  act(() => {
    capturedCallback({
      type: 'message_completed',
      discussionId: 'disc-123',
      round: 0,
      message: {
        agentName: 'AgentDoer',
        providerName: 'Gemini',
        modelName: 'gemini-1.5-pro',
        content: 'Final discussion content',
        timestamp: '12:01:00 PM',
        contextMessages: []
      }
    });
  });

  // Assert output text is displayed
  await waitFor(() => {
    expect(screen.getByText('Final discussion content')).toBeTruthy();
  });

  // Resolve runDiscussion promise
  resolveRunDiscussionPromise({
    success: true,
    log: {
      id: 'disc-123',
      title: 'Mock Discussion',
      status: 'completed',
      messages: [
        {
          type: 'agent',
          agentName: 'AgentDoer',
          providerName: 'Gemini',
          modelName: 'gemini-1.5-pro',
          content: 'Final discussion content',
          timestamp: '12:01:00 PM'
        }
      ]
    }
  });

  // Assert unsubscribe function was called in finally
  await waitFor(() => {
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});

test('discussion path ignores task-* streaming events', async () => {
  localStorage.clear();
  const mockApi = window.electronAPI as any;

  // Mock API setup
  mockApi.selectProjectDir.mockResolvedValue({
    success: true,
    path: '/mock/path/project-x',
    isRoomProject: true
  });

  mockApi.getProjectData.mockResolvedValue({
    success: true,
    projectMd: '# Welcome to Project X\nThis is a mock project context.',
    archMd: '## Architecture\n- Subsystem A\n- Subsystem B',
    hasScanData: true,
    tasks: ['task1.md'],
    taskRuns: ['run1.json'],
    decisions: ['decision1.md'],
    reviews: [],
    documents: ['doc1.md'],
    discussions: ['discussion1.md'],
    skills: ['skill1.md'],
    agents: [
      { name: 'AgentDoer', role: 'Developer', provider: 'Gemini', model: 'gemini-1.5-pro' }
    ]
  });

  mockApi.loadProviders.mockResolvedValue({
    success: true,
    providers: [
      { id: 'gemini', label: 'Gemini', baseUrl: '', keyless: false, configurable: true }
    ]
  });

  mockApi.detectLocalAgents.mockResolvedValue({
    success: true,
    agents: []
  });

  mockApi.detectApiModels.mockResolvedValue({
    success: true,
    models: [{ value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }]
  });

  mockApi.loadProjectConfig.mockResolvedValue({
    success: true,
    config: {
      mainAgent: 'AgentDoer',
      modelName: 'gemini-1.5-pro',
      allowDangerousCli: false
    }
  });

  let capturedCallback: any;
  const mockUnsubscribe = vi.fn();
  mockApi.onDiscussionEvent.mockImplementation((callback: any) => {
    capturedCallback = callback;
    return mockUnsubscribe;
  });

  let resolveRunDiscussionPromise: any;
  const runDiscussionPromise = new Promise((resolve) => {
    resolveRunDiscussionPromise = resolve;
  });
  mockApi.runDiscussion.mockReturnValue(runDiscussionPromise);

  render(
    <ProvidersProvider>
      <App />
    </ProvidersProvider>
  );

  // Open Workspace
  const openBtn = screen.getByText('Open Existing Workspace');
  fireEvent.click(openBtn);

  await waitFor(() => {
    expect(screen.getByText('Active Workspace')).toBeDefined();
  });

  // Skip Onboarding
  fireEvent.click(screen.getByText('Skip'));

  // Go to Discussions tab
  fireEvent.click(screen.getAllByText('Discussions').find(el => el.classList.contains('sidebar-nav-label')) as HTMLElement);
  await waitFor(() => {
    expect(screen.getByText(/Chat History/i)).toBeDefined();
  });

  // Select AgentDoer
  const agentCheckbox = screen.getByLabelText(/AgentDoer/i) as HTMLInputElement;
  fireEvent.change(agentCheckbox, { target: { checked: true } });

  // Fill User Input Topic
  const topicInput = screen.getByPlaceholderText(/Ask selected agents to discuss an idea/i) as HTMLInputElement;
  fireEvent.change(topicInput, { target: { value: 'Let us discuss refactoring' } });

  // Click Send
  const sendButton = screen.getByText('Send') as HTMLButtonElement;
  fireEvent.click(sendButton);

  // Assert callback is registered
  await waitFor(() => {
    expect(capturedCallback).toBeDefined();
  });

  // Stream Event 1: agent_started with a TASK ID (should be ignored by discussion tab!)
  act(() => {
    capturedCallback({
      type: 'agent_started',
      discussionId: 'task-123',
      agentName: 'AgentDoer',
      providerName: 'Gemini',
      modelName: 'gemini-1.5-pro',
      role: 'Developer',
      round: 0,
      timestamp: '12:00:00 PM'
    });
  });

  // Check that Agent Doer is NOT showing up in the discussion messages
  expect(screen.queryByText('Reading the workspace context...')).toBeNull();

  // Resolve runDiscussion promise to finish cleanly
  resolveRunDiscussionPromise({
    success: true,
    log: {
      id: 'disc-123',
      title: 'Mock Discussion',
      status: 'completed',
      messages: []
    }
  });

  // Assert unsubscribe function was called in finally to avoid un-acted state updates
  await waitFor(() => {
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});


