import React from 'react';
import type { TeamRoster } from '../lib/teamRoster.js';

interface TeamCardProps {
  team: TeamRoster;
  onOpen: () => void;
}

export const TeamCard: React.FC<TeamCardProps> = ({ team, onOpen }) => (
  <button
    type="button"
    className="team-card"
    onClick={onOpen}
    style={{
      textAlign: 'left',
      padding: '16px',
      borderRadius: '8px',
      border: '1px solid hsl(var(--border-dim))',
      background: 'linear-gradient(180deg, rgba(31, 41, 55, 0.72), rgba(17, 24, 39, 0.82))',
      color: 'inherit',
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      minHeight: '152px',
      transition: 'transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.18s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
      boxShadow: '0 14px 36px rgba(2, 6, 23, 0.22)'
    }}
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <strong style={{ color: 'white', fontSize: '0.96rem', lineHeight: 1.3 }}>{team.name}</strong>
        {team.virtual && (
          <span
            style={{
              width: 'fit-content',
              fontSize: '0.68rem',
              color: 'hsl(var(--text-secondary))',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              background: 'rgba(255, 255, 255, 0.04)',
              borderRadius: '999px',
              padding: '3px 8px'
            }}
          >
            Shared pool
          </span>
        )}
      </div>
      <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
        {team.members.length} member{team.members.length === 1 ? '' : 's'}
      </span>
    </div>

    <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.78rem', lineHeight: 1.5, minHeight: '2.4em' }}>
      {team.description || (team.virtual ? 'Saved AI members that are not assigned to a team yet.' : 'Open this team to reorder members and manage membership.')}
    </div>

    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: 'auto' }}>
      {team.members.slice(0, 5).map(member => (
        <span
          key={member.id || member.name}
          style={{
            fontSize: '0.68rem',
            padding: '4px 8px',
            borderRadius: '999px',
            background: 'rgba(15, 23, 42, 0.72)',
            color: 'hsl(var(--text-secondary))',
            border: '1px solid rgba(255, 255, 255, 0.09)'
          }}
        >
          {member.name}
        </span>
      ))}
      {team.members.length > 5 && (
        <span
          style={{
            fontSize: '0.68rem',
            padding: '4px 8px',
            borderRadius: '999px',
            background: 'rgba(99, 102, 241, 0.14)',
            color: 'rgb(196, 181, 253)',
            border: '1px solid rgba(129, 140, 248, 0.25)'
          }}
        >
          +{team.members.length - 5} more
        </span>
      )}
      {team.members.length === 0 && (
        <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.72rem' }}>No members yet</span>
      )}
    </div>
  </button>
);
