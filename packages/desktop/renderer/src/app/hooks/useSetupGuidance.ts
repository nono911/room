import type { ProjectData } from '../../types/domain.js';

interface UseSetupGuidanceOptions {
  activeTab: string;
  projectData: ProjectData | null;
  selectedDiscussionContextRefs: string[];
  selectedCodingTaskContextRefs: string[];
  discussionMessages: unknown[];
  codingTaskMessages: unknown[];
  resetAgentForm: () => void;
  setActiveTab: (tab: string) => void;
  openContextPicker: (target: 'discussion' | 'task') => void;
}

export function useSetupGuidance({
  activeTab,
  projectData,
  selectedDiscussionContextRefs,
  selectedCodingTaskContextRefs,
  discussionMessages,
  codingTaskMessages,
  resetAgentForm,
  setActiveTab,
  openContextPicker
}: UseSetupGuidanceOptions) {
  const onboardingSteps = [
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
      action: 'Start Think Run',
      run: () => setActiveTab('Run:Think')
    },
    {
      title: 'Runs leave a traceable trail',
      body: 'Give one agent the work, choose reviewers, and let ROOM keep the message references, created tasks, ADRs, and artifacts connected.',
      action: 'Start Execute Run',
      run: () => setActiveTab('Run:Execute')
    }
  ];

  const setupItems = [
    {
      label: 'Create AI member',
      done: (projectData?.agents || []).some(agent => !agent.isVirtual),
      action: 'Open',
      run: () => setActiveTab('AI Members')
    },
    {
      label: 'Add or edit skills',
      done: (projectData?.skills || []).length > 0 ||
        (projectData?.agents || []).some(agent => Array.isArray(agent.skills) && agent.skills.length > 0),
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
      run: () => openContextPicker(activeTab === 'Task Run' || activeTab === 'Run:Execute' || activeTab === 'Run:Review' ? 'task' : 'discussion')
    },
    {
      label: 'Create a traceable run',
      done: discussionMessages.length > 0 || codingTaskMessages.length > 0 || (projectData?.discussions || []).length > 0 || (projectData?.tasks || []).length > 0,
      action: 'Start',
      run: () => setActiveTab('Run:Think')
    }
  ];

  return {
    onboardingSteps,
    setupItems
  };
}
