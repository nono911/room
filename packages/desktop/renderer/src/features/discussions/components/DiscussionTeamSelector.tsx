import React from 'react';
import type { TeamRoster } from '../../ai-members/lib/teamRoster.js';

interface DiscussionTeamSelectorProps {
  teams: TeamRoster[];
  selectedMemberIds: string[];
  setSelectedMemberIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export const DiscussionTeamSelector: React.FC<DiscussionTeamSelectorProps> = ({
  teams,
  selectedMemberIds,
  setSelectedMemberIds
}) => {
  const [expandedTeamIds, setExpandedTeamIds] = React.useState<Record<string, boolean>>({});

  const addTeam = (team: TeamRoster) => {
    setSelectedMemberIds((prev) => {
      const next = [...prev];
      for (const member of team.members) {
        if (!member.id || next.includes(member.id)) continue;
        next.push(member.id);
      }
      return next;
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        width: '100%',
        padding: '12px 16px',
        background: 'hsl(var(--bg-sidebar))',
        border: '1px solid hsl(var(--border-dim))',
        borderRadius: '12px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase' }}>
          Teams
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              className="btn-secondary"
              onClick={() => addTeam(team)}
              disabled={team.members.length === 0}
              style={{ padding: '5px 10px', fontSize: '0.74rem' }}
            >
              + {team.name}
            </button>
          ))}
        </div>
      </div>

      {teams.map((team) => (
        <div key={team.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setExpandedTeamIds((prev) => ({ ...prev, [team.id]: !prev[team.id] }))}
            style={{
              padding: '7px 10px',
              fontSize: '0.74rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%'
            }}
          >
            <span>{expandedTeamIds[team.id] ? 'Hide' : 'Show'} {team.name} members</span>
            <span style={{ color: 'hsl(var(--text-muted))' }}>{team.members.length}</span>
          </button>

          {expandedTeamIds[team.id] && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {team.members.map((member) => {
                const selected = typeof member.id === 'string' && selectedMemberIds.includes(member.id);
                return (
                  <button
                    key={member.id || member.name}
                    type="button"
                    className={`skill-checkbox-chip ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      if (!member.id) return;
                      setSelectedMemberIds((prev) => (
                        selected
                          ? prev.filter((memberId) => memberId !== member.id)
                          : [...prev, member.id]
                      ));
                    }}
                  >
                    {selected ? '✓ ' : '+ '}
                    {member.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
