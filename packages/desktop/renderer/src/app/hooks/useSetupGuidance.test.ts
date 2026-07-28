import { describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../../types/domain.js';
import { useSetupGuidance } from './useSetupGuidance.js';

const projectData = (projectMd: string, archMd = ''): ProjectData => ({
  projectMd,
  archMd,
  hasScanData: false,
  tasks: [],
  decisions: [],
  reviews: [],
  documents: [],
  discussions: [],
  skills: [],
  agents: []
});

function setupGuidance(data: ProjectData) {
  const result = useSetupGuidance({
    activeTab: 'Home',
    projectData: data,
    selectedDiscussionContextRefs: [],
    selectedCodingTaskContextRefs: [],
    discussionMessages: [],
    codingTaskMessages: [],
    resetAgentForm: vi.fn(),
    setActiveTab: vi.fn(),
    openContextPicker: vi.fn()
  });
  return result;
}

describe('source-less setup guidance', () => {
  it('does not link onboarding or setup guidance to the removed Context screen', () => {
    const result = setupGuidance(projectData('# Personal Room'));
    expect(result.onboardingSteps.some(step => step.action === 'Open Context')).toBe(false);
    expect(result.setupItems.some(item => item.label === 'Review Room context')).toBe(false);
  });
});
