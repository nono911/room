import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../../../types/domain.js';
import { ContextScreen } from './ContextScreen.js';

describe('ContextScreen Room terminology', () => {
  it('describes source-independent context as Room data', () => {
    render(
      <ContextScreen
        projectPath="room_personal"
        projectData={{ projectMd: '', archMd: '' } as ProjectData}
        loadWorkspaceCoreData={vi.fn(async () => true)}
        setErrorMsg={vi.fn()}
      />
    );

    expect(screen.getByText(/Room context and structure stored under ROOM Home/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/how this Room and its Sources are organized/i)).toBeTruthy();
    expect(screen.queryByText(/Workspace context and structure/i)).toBeNull();
  });
});
