import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiscussionTeamSelector } from './DiscussionTeamSelector.js';

describe('DiscussionTeamSelector', () => {
  it('adds a whole team without duplicating saved member ids', () => {
    const setSelectedMemberIds = vi.fn();

    render(
      <DiscussionTeamSelector
        teams={[
          {
            id: 'team_product',
            name: 'Product',
            members: [
              { id: 'mem_pm', name: 'PM' },
              { id: 'mem_designer', name: 'Designer' }
            ]
          }
        ]}
        selectedMemberIds={['mem_pm']}
        setSelectedMemberIds={setSelectedMemberIds}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Product' }));

    const updater = setSelectedMemberIds.mock.calls[0][0] as (prev: string[]) => string[];
    expect(updater(['mem_pm'])).toEqual(['mem_pm', 'mem_designer']);
  });

  it('toggles individual members by saved member id', () => {
    const setSelectedMemberIds = vi.fn();
    const teams = [
      {
        id: 'team_research',
        name: 'Research',
        members: [
          { id: 'mem_analyst', name: 'Analyst' }
        ]
      }
    ];
    const { rerender } = render(
      <DiscussionTeamSelector
        teams={teams}
        selectedMemberIds={[]}
        setSelectedMemberIds={setSelectedMemberIds}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Show Research members/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ Analyst' }));

    const addUpdater = setSelectedMemberIds.mock.calls[0][0] as (prev: string[]) => string[];
    expect(addUpdater([])).toEqual(['mem_analyst']);

    setSelectedMemberIds.mockClear();

    rerender(
      <DiscussionTeamSelector
        teams={teams}
        selectedMemberIds={['mem_analyst']}
        setSelectedMemberIds={setSelectedMemberIds}
      />
    );

    if (!screen.queryByRole('button', { name: /Analyst/ })) {
      fireEvent.click(screen.getByRole('button', { name: /Research members/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: /Analyst/ }));

    const removeUpdater = setSelectedMemberIds.mock.calls[0][0] as (prev: string[]) => string[];
    expect(removeUpdater(['mem_analyst'])).toEqual([]);
  });
});
