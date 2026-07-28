import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentSkillsPanel } from './AgentSkillsPanel.js';

const machineSkills = [
  {
    reference: 'machine://codex/playwright',
    name: 'playwright',
    description: 'Browser automation',
    source: 'codex' as const,
    sourceLabel: 'Codex',
    relativePath: 'playwright/SKILL.md',
    modifiedAt: '2026-07-23T00:00:00.000Z'
  },
  {
    reference: 'machine://agents/research%2Farxiv',
    name: 'arxiv',
    description: 'Search research papers',
    source: 'agents' as const,
    sourceLabel: 'Agents',
    relativePath: 'research/arxiv/SKILL.md',
    modifiedAt: '2026-07-23T00:00:00.000Z'
  }
];

function TestPanel({ initialSkills = [] }: { initialSkills?: string[] }) {
  const [selectedSkills, setSelectedSkills] = useState(initialSkills);
  return (
    <AgentSkillsPanel
      workspaceSkills={['room://skills/api-design.md']}
      machineSkills={machineSkills}
      selectedSkills={selectedSkills}
      setSelectedSkills={setSelectedSkills}
      setSkillPreview={vi.fn()}
      skillPreview={null}
      handlePreviewAgentSkills={vi.fn()}
      editingSkillFile=""
      setEditingSkillFile={vi.fn()}
      loadRoomFilePreview={vi.fn()}
      editingSkillContent=""
      setEditingSkillContent={vi.fn()}
      editingSkillSource="skills"
      setEditingSkillSource={vi.fn()}
      handleSaveEditingSkill={vi.fn()}
      customSkillName=""
      setCustomSkillName={vi.fn()}
      customSkillDesc=""
      setCustomSkillDesc={vi.fn()}
      handleAddCustomSkill={vi.fn()}
      loading={false}
    />
  );
}

describe('AgentSkillsPanel machine skill selection', () => {
  it('keeps installed skills off until the user toggles one', () => {
    render(<TestPanel />);

    const playwright = screen.getByRole('checkbox', { name: /playwright/i });
    const arxiv = screen.getByRole('checkbox', { name: /arxiv/i });
    const workspaceSkill = screen.getByRole('checkbox', { name: /api design/i });
    expect((playwright as HTMLInputElement).checked).toBe(false);
    expect((arxiv as HTMLInputElement).checked).toBe(false);
    expect((workspaceSkill as HTMLInputElement).checked).toBe(false);

    fireEvent.click(playwright);

    expect((playwright as HTMLInputElement).checked).toBe(true);
    expect((arxiv as HTMLInputElement).checked).toBe(false);
    expect((workspaceSkill as HTMLInputElement).checked).toBe(false);
  });

  it('filters the installed catalog without selecting matching skills', () => {
    render(<TestPanel />);

    fireEvent.change(screen.getByRole('searchbox', { name: /search skills on this mac/i }), {
      target: { value: 'research' }
    });

    expect(screen.queryByRole('checkbox', { name: /playwright/i })).toBeNull();
    expect((screen.getByRole('checkbox', { name: /arxiv/i }) as HTMLInputElement).checked).toBe(false);
  });

  it('keeps a missing saved reference removable', () => {
    render(<TestPanel initialSkills={['machine://codex/missing']} />);

    const missing = screen.getByRole('checkbox', { name: /missing installed skill/i });
    expect((missing as HTMLInputElement).checked).toBe(true);
    fireEvent.click(missing);
    expect(screen.queryByRole('checkbox', { name: /missing installed skill/i })).toBeNull();
  });
});
