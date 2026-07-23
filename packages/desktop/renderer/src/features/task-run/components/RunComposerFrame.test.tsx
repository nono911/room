import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunComposerFrame } from './RunComposerFrame.js';

describe('RunComposerFrame', () => {
  it('shows preflight readiness and changes run mode explicitly', () => {
    const onModeChange = vi.fn();
    render(
      <RunComposerFrame
        mode="Think"
        onModeChange={onModeChange}
        preflight={[
          { label: 'Participants', value: '2 selected', ready: true },
          { label: 'Context', value: 'Not attached', ready: false }
        ]}
      >
        <div>Composer body</div>
      </RunComposerFrame>
    );

    expect(screen.getByText('1/2 ready')).toBeDefined();
    expect(screen.getByText('Composer body')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onModeChange).toHaveBeenCalledWith('Review');
  });
});
