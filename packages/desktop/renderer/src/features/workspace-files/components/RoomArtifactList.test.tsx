import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoomArtifactList } from './RoomArtifactList.js';

describe('RoomArtifactList', () => {
  it('shows documents, reviews, and decisions once with a disjoint total', () => {
    render(
      <RoomArtifactList
        projectData={{
          projectMd: '',
          archMd: '',
          tasks: [],
          taskRuns: [],
          decisions: ['decision.md'],
          reviews: ['review.md'],
          documents: ['document.md'],
          discussions: [],
          skills: [],
          agents: []
        }}
        selected={null}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText('3 traceable outputs')).toBeDefined();
    expect(screen.getAllByText('document.md')).toHaveLength(1);
    expect(screen.getAllByText('review.md')).toHaveLength(1);
    expect(screen.getAllByText('decision.md')).toHaveLength(1);
  });
});
