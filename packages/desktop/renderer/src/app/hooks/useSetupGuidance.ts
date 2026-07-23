import type { ProjectData } from '../../types/domain.js';

interface UseSetupGuidanceOptions {
  activeTab: string;
  projectData: ProjectData | null;
  hasCompletedScan: boolean;
  selectedDiscussionContextRefs: string[];
  selectedCodingTaskContextRefs: string[];
  discussionMessages: unknown[];
  codingTaskMessages: unknown[];
  resetAgentForm: () => void;
  setActiveTab: (tab: string) => void;
  openContextPicker: (target: 'discussion' | 'task') => void;
}

function isPlaceholderContext(content?: string): boolean {
  const normalized = (content || '').trim();
  if (!normalized) return true;
  return normalized.includes('Describe what this workspace is for.') ||
    normalized.includes('Describe the important parts of this workspace and how they relate to each other.');
}

export function useSetupGuidance({
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
}: UseSetupGuidanceOptions) {
  const onboardingSteps = [
    {
      title: 'ROOM starts with shared project memory',
      body: 'Keep a short workspace overview and attach the files, notes, or documents that should guide discussions, tasks, and decisions.',
      action: 'Open Context',
      run: () => setActiveTab('Context')
    },
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

  const hasUsefulContext = (hasCompletedScan || !!projectData?.hasScanData) && !!projectData && (
    !isPlaceholderContext(projectData.projectMd) ||
    !isPlaceholderContext(projectData.archMd)
  );

  const setupItems = [
    {
      label: 'Review workspace context',
      done: hasUsefulContext,
      action: 'Open',
      run: () => setActiveTab('Context')
    },
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
