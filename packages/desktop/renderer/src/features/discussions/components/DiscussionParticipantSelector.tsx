import React from 'react';
import type { TeamRoster } from '../../ai-members/lib/teamRoster.js';
import { AgentClonePicker } from '../../ai-members/components/AgentClonePicker.js';
import type { AgentLifecycle } from '../../ai-members/lib/agentInstances.js';
import { DiscussionTeamSelector } from './DiscussionTeamSelector.js';

interface DiscussionSelectableAgent {
  id?: string;
  name: string;
}

interface DiscussionParticipantSelectorProps {
  teams: TeamRoster[];
  loading: boolean;
  localRegistering: boolean;
  savedDiscussionAgents: DiscussionSelectableAgent[];
  legacyDiscussionAgents: DiscussionSelectableAgent[];
  temporaryDiscussionAgents: Array<DiscussionSelectableAgent & { id: string }>;
  selectedDiscussionMemberIds: string[];
  selectedLegacyDiscussionAgentNames: string[];
  selectedTemporaryDiscussionAgentIds: string[];
  onSetSelectedDiscussionMemberIds: React.Dispatch<React.SetStateAction<string[]>>;
  onToggleSelectedDiscussionMemberId: (memberId: string) => void;
  onToggleSelectedLegacyDiscussionAgentName: (agentName: string) => void;
  onToggleSelectedTemporaryDiscussionAgentId: (temporaryId: string) => void;
  onReorderSelectedDiscussionMemberIds: (sourceIndex: number, targetIndex: number) => void;
  onClearSelectedDiscussionAgents: () => void;
  onAddTemplateAgents: (templateName: string, count: number, lifecycle: AgentLifecycle) => void;
}

export const DiscussionParticipantSelector: React.FC<DiscussionParticipantSelectorProps> = ({
  teams,
  loading,
  localRegistering,
  savedDiscussionAgents,
  legacyDiscussionAgents,
  temporaryDiscussionAgents,
  selectedDiscussionMemberIds,
  selectedLegacyDiscussionAgentNames,
  selectedTemporaryDiscussionAgentIds,
  onSetSelectedDiscussionMemberIds,
  onToggleSelectedDiscussionMemberId,
  onToggleSelectedLegacyDiscussionAgentName,
  onToggleSelectedTemporaryDiscussionAgentId,
  onReorderSelectedDiscussionMemberIds,
  onClearSelectedDiscussionAgents,
  onAddTemplateAgents
}) => {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const savedDiscussionAgentsById = React.useMemo(
    () => new Map(savedDiscussionAgents
      .filter((agent): agent is DiscussionSelectableAgent & { id: string } => typeof agent.id === 'string' && agent.id.length > 0)
      .map((agent) => [agent.id, agent])),
    [savedDiscussionAgents]
  );
  const temporaryDiscussionAgentsById = React.useMemo(
    () => new Map(temporaryDiscussionAgents.map((agent) => [agent.id, agent])),
    [temporaryDiscussionAgents]
  );
  const selectedSavedDiscussionAgents = selectedDiscussionMemberIds
    .map((memberId) => savedDiscussionAgentsById.get(memberId))
    .filter((agent): agent is DiscussionSelectableAgent & { id: string } => agent !== undefined);
  const selectedTemporaryDiscussionAgents = selectedTemporaryDiscussionAgentIds
    .map((temporaryId) => temporaryDiscussionAgentsById.get(temporaryId))
    .filter((agent): agent is DiscussionSelectableAgent & { id: string } => agent !== undefined);
  const hasSelectedParticipants = (
    selectedDiscussionMemberIds.length > 0
    || selectedLegacyDiscussionAgentNames.length > 0
    || selectedTemporaryDiscussionAgentIds.length > 0
  );

  const handleDragStart = (event: React.DragEvent, index: number) => {
    event.dataTransfer.setData('text/plain', String(index));
    setDraggedIndex(index);
  };

  const handleDrop = (event: React.DragEvent, targetIndex: number) => {
    event.preventDefault();
    const sourceIndex = Number(event.dataTransfer.getData('text/plain'));
    onReorderSelectedDiscussionMemberIds(sourceIndex, targetIndex);
    setDraggedIndex(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', marginBottom: '8px' }}>
      {teams.length > 0 && (
        <DiscussionTeamSelector
          teams={teams}
          selectedMemberIds={selectedDiscussionMemberIds}
          setSelectedMemberIds={onSetSelectedDiscussionMemberIds}
        />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px 16px', background: 'hsl(var(--bg-sidebar))', borderRadius: '12px', border: '1px solid hsl(var(--border-dim))', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase', marginRight: '4px' }}>
          AI Members:
        </span>

        {savedDiscussionAgents.length === 0 && legacyDiscussionAgents.length === 0 && temporaryDiscussionAgents.length === 0 && (
          <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>No AI members registered.</span>
        )}

        {selectedSavedDiscussionAgents.map((agent, index) => (
          <div
            key={agent.id}
            draggable={true}
            onDragStart={(event) => handleDragStart(event, index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, index)}
            onDragEnd={() => setDraggedIndex(null)}
            className="skill-checkbox-chip selected"
            style={{
              fontSize: '0.75rem',
              padding: '4px 12px',
              borderRadius: '16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'grab',
              opacity: draggedIndex === index ? 0.5 : 1,
              border: '1px solid hsl(var(--accent-purple) / 0.5)',
              background: 'hsl(var(--bg-input))',
              userSelect: 'none',
              transition: 'all 0.15s ease'
            }}
            title="Drag to reorder saved members"
          >
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'hsl(var(--accent-purple))',
              color: 'white',
              borderRadius: '50%',
              width: '16px',
              height: '16px',
              fontSize: '0.62rem',
              fontWeight: 700,
              lineHeight: 1
            }}>
              {index + 1}
            </span>
            <span style={{ fontWeight: 500, color: 'white' }}>{agent.name}</span>
            <span
              onClick={(event) => {
                event.stopPropagation();
                onToggleSelectedDiscussionMemberId(agent.id);
              }}
              style={{
                cursor: 'pointer',
                marginLeft: '4px',
                color: 'hsl(var(--text-muted))',
                fontSize: '0.85rem',
                lineHeight: 1,
                fontWeight: 'bold'
              }}
              title="Deselect member"
            >
              ×
            </span>
          </div>
        ))}

        {selectedLegacyDiscussionAgentNames.map((agentName) => (
          <div
            key={`legacy:${agentName}`}
            className="skill-checkbox-chip selected"
            style={{
              fontSize: '0.75rem',
              padding: '4px 12px',
              borderRadius: '16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid hsl(var(--accent-purple) / 0.5)',
              background: 'hsl(var(--bg-input))'
            }}
          >
            <span style={{ fontWeight: 500, color: 'white' }}>{agentName}</span>
            <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.66rem' }}>legacy</span>
            <span
              onClick={() => onToggleSelectedLegacyDiscussionAgentName(agentName)}
              style={{
                cursor: 'pointer',
                marginLeft: '4px',
                color: 'hsl(var(--text-muted))',
                fontSize: '0.85rem',
                lineHeight: 1,
                fontWeight: 'bold'
              }}
              title="Deselect member"
            >
              ×
            </span>
          </div>
        ))}

        {selectedTemporaryDiscussionAgents.map((agent) => (
          <div
            key={agent.id}
            className="skill-checkbox-chip selected"
            style={{
              fontSize: '0.75rem',
              padding: '4px 12px',
              borderRadius: '16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              border: '1px solid hsl(var(--accent-purple) / 0.5)',
              background: 'hsl(var(--bg-input))'
            }}
          >
            <span style={{ fontWeight: 500, color: 'white' }}>{agent.name}</span>
            <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.66rem' }}>temp</span>
            <span
              onClick={() => onToggleSelectedTemporaryDiscussionAgentId(agent.id)}
              style={{
                cursor: 'pointer',
                marginLeft: '4px',
                color: 'hsl(var(--text-muted))',
                fontSize: '0.85rem',
                lineHeight: 1,
                fontWeight: 'bold'
              }}
              title="Deselect member"
            >
              ×
            </span>
          </div>
        ))}

        {savedDiscussionAgents
          .filter((agent): agent is DiscussionSelectableAgent & { id: string } => typeof agent.id === 'string' && !selectedDiscussionMemberIds.includes(agent.id))
          .map((agent) => (
            <div
              key={agent.id}
              className="skill-checkbox-chip"
              onClick={() => onToggleSelectedDiscussionMemberId(agent.id)}
              style={{
                fontSize: '0.75rem',
                padding: '4px 12px',
                borderRadius: '16px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                border: '1px dashed hsl(var(--border-dim))',
                background: 'transparent',
                userSelect: 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ color: 'hsl(var(--text-muted))' }}>+</span>
              <span style={{ color: 'hsl(var(--text-secondary))' }}>{agent.name}</span>
            </div>
          ))}

        {legacyDiscussionAgents
          .filter((agent) => !selectedLegacyDiscussionAgentNames.includes(agent.name))
          .map((agent) => (
            <div
              key={`legacy-option:${agent.name}`}
              className="skill-checkbox-chip"
              onClick={() => onToggleSelectedLegacyDiscussionAgentName(agent.name)}
              style={{
                fontSize: '0.75rem',
                padding: '4px 12px',
                borderRadius: '16px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                border: '1px dashed hsl(var(--border-dim))',
                background: 'transparent',
                userSelect: 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ color: 'hsl(var(--text-muted))' }}>+</span>
              <span style={{ color: 'hsl(var(--text-secondary))' }}>{agent.name}</span>
            </div>
          ))}

        {temporaryDiscussionAgents
          .filter((agent) => !selectedTemporaryDiscussionAgentIds.includes(agent.id))
          .map((agent) => (
            <div
              key={agent.id}
              className="skill-checkbox-chip"
              onClick={() => onToggleSelectedTemporaryDiscussionAgentId(agent.id)}
              style={{
                fontSize: '0.75rem',
                padding: '4px 12px',
                borderRadius: '16px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                border: '1px dashed hsl(var(--border-dim))',
                background: 'transparent',
                userSelect: 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ color: 'hsl(var(--text-muted))' }}>+</span>
              <span style={{ color: 'hsl(var(--text-secondary))' }}>{agent.name}</span>
              <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.66rem' }}>temp</span>
            </div>
          ))}

        <AgentClonePicker
          disabled={loading}
          busy={localRegistering}
          onAdd={onAddTemplateAgents}
        />

        {hasSelectedParticipants && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onClearSelectedDiscussionAgents}
            style={{
              padding: '3px 8px',
              fontSize: '0.68rem',
              height: 'auto',
              borderRadius: '4px',
              marginLeft: 'auto'
            }}
          >
            Clear Workflow
          </button>
        )}
      </div>
    </div>
  );
};
