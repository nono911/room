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

function roomContextDone(data: ProjectData): boolean {
  const result = useSetupGuidance({
    activeTab: 'Home',
    projectData: data,
    hasCompletedScan: false,
    selectedDiscussionContextRefs: [],
    selectedCodingTaskContextRefs: [],
    discussionMessages: [],
    codingTaskMessages: [],
    resetAgentForm: vi.fn(),
    setActiveTab: vi.fn(),
    openContextPicker: vi.fn()
  });
  return result.setupItems.find(item => item.label === 'Review Room context')!.done;
}

describe('source-less setup guidance', () => {
  it('completes Room context review from useful Room memory without a Source scan', () => {
    expect(roomContextDone(projectData(
      '# Personal Room\n\nWe are designing the source-independent support workflow.'
    ))).toBe(true);
  });

  it('keeps legacy placeholder Room context incomplete without a Source scan', () => {
    expect(roomContextDone(projectData(
      '# Overview\n\nDescribe what this workspace is for.'
    ))).toBe(false);
  });

  it('keeps the first-launch Personal Room placeholder incomplete', () => {
    expect(roomContextDone(projectData(
      '# Personal Room\n\n## Overview\nYour source-independent ROOM memory.'
    ))).toBe(false);
  });
});
