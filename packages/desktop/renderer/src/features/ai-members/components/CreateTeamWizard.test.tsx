import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateTeamWizard } from './CreateTeamWizard.js';

describe('CreateTeamWizard', () => {
  it('builds a multi-template team payload with editable member drafts', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <CreateTeamWizard
        existingNames={['Existing Member']}
        existingSkillFiles={[]}
        onCancel={vi.fn()}
        onCreate={onCreate}
      />
    );

    fireEvent.change(screen.getByLabelText('Team name'), {
      target: { value: 'Product Design' }
    });
    fireEvent.change(screen.getByLabelText('Team description'), {
      target: { value: 'Cross-functional product design group.' }
    });

    fireEvent.change(screen.getAllByLabelText('Template')[0], {
      target: { value: 'UX' }
    });
    fireEvent.change(screen.getAllByLabelText('Count')[0], {
      target: { value: '2' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add template row' }));

    fireEvent.change(screen.getAllByLabelText('Template')[1], {
      target: { value: 'Developer' }
    });

    fireEvent.change(screen.getByLabelText('Member 1 provider'), {
      target: { value: 'anthropic' }
    });
    fireEvent.change(screen.getByLabelText('Member 1 model'), {
      target: { value: 'claude-sonnet-4' }
    });
    fireEvent.change(screen.getByLabelText('Member 1 skills'), {
      target: { value: 'interaction-states.md, accessibility-review.md, custom-collab.md' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    const [team, members, skillDrafts] = onCreate.mock.calls[0];

    expect(team).toEqual({
      name: 'Product Design',
      description: 'Cross-functional product design group.'
    });
    expect(members).toHaveLength(3);
    expect(members[0]).toMatchObject({
      name: 'UX Researcher',
      provider: 'anthropic',
      modelName: 'claude-sonnet-4',
      skills: ['interaction-states.md', 'accessibility-review.md', 'custom-collab.md']
    });
    expect(members.map((member: { name: string }) => member.name)).toEqual([
      'UX Researcher',
      'UX Interaction Designer',
      'Developer Implementer'
    ]);
    expect(skillDrafts.map((draft: { name: string }) => draft.name)).toEqual([
      'accessibility-review.md',
      'custom-collab.md',
      'interaction-states.md',
      'review-feedback-resolution.md',
      'workspace-implementation.md'
    ]);
  });

  it('preserves member count for preset rows that use alias roles', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <CreateTeamWizard
        existingNames={[]}
        existingSkillFiles={[]}
        onCancel={vi.fn()}
        onCreate={onCreate}
        initialTeamName="Editorial"
        initialTemplateRows={[
          { id: 'copywriter-row', templateName: 'Copywriter', count: 1 },
          { id: 'support-row', templateName: 'Support', count: 1 }
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    const [, members] = onCreate.mock.calls[0];

    expect(members).toHaveLength(2);
    expect(members.map((member: { role: string }) => member.role)).toEqual(['Copywriter', 'Support']);
    expect(members.map((member: { name: string }) => member.name)).toEqual([
      'Copywriter Strategy',
      'Support Strategy'
    ]);
  });
});
