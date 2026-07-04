import { describe, expect, it } from 'vitest';
import { resolveDiscussionSelection } from './lib/discussionSelection.js';

describe('resolveDiscussionSelection', () => {
  it('resolves saved member ids and temporary agent ids into execution names', () => {
    const selection = resolveDiscussionSelection({
      projectAgents: [
        { id: 'mem_analyst_a', name: 'Analyst', role: 'Research' },
        { id: 'mem_analyst_b', name: 'Analyst', role: 'Research' },
        { id: 'mem_designer', name: 'Designer', role: 'UX' },
        { name: 'Virtual Critic', role: 'Critic', isVirtual: true }
      ],
      selectedDiscussionMemberIds: ['mem_analyst_b', 'missing_member', 'mem_designer'],
      temporaryDiscussionAgents: [
        { id: 'tmp_red', name: 'Red Team', role: 'Review', provider: 'gemini', systemPrompt: 'Prompt' },
        { id: 'tmp_blue', name: 'Blue Team', role: 'Review', provider: 'gemini', systemPrompt: 'Prompt' }
      ],
      selectedTemporaryDiscussionAgentIds: ['tmp_blue', 'missing_temp', 'tmp_red']
    });

    expect(selection.selectedSavedNames).toEqual(['Analyst', 'Designer']);
    expect(selection.selectedTemporaryNames).toEqual(['Blue Team', 'Red Team']);
    expect(selection.selectedAgentNames).toEqual(['Analyst', 'Designer', 'Blue Team', 'Red Team']);
  });

  it('preserves participant order across temporary, saved, and legacy selections when keyed ordering is provided', () => {
    const selection = resolveDiscussionSelection({
      projectAgents: [
        { id: 'mem_analyst', name: 'Analyst', role: 'Research' },
        { name: 'Legacy Reviewer', role: 'QA' }
      ],
      selectedDiscussionParticipantKeys: ['tmp:tmp_red', 'member:mem_analyst', 'legacy:Legacy Reviewer'],
      selectedDiscussionMemberIds: ['mem_analyst'],
      selectedLegacyDiscussionAgentNames: ['Legacy Reviewer'],
      temporaryDiscussionAgents: [
        { id: 'tmp_red', name: 'Red Team', role: 'Review', provider: 'gemini', systemPrompt: 'Prompt' }
      ],
      selectedTemporaryDiscussionAgentIds: ['tmp_red']
    });

    expect(selection.selectedAgentNames).toEqual(['Red Team', 'Analyst', 'Legacy Reviewer']);
  });
});
