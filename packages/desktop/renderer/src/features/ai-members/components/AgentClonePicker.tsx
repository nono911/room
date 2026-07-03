import React from 'react';
import { agentPersonaTemplates } from '../../../shared/data/staticData.js';
import type { AgentLifecycle } from '../lib/agentInstances.js';

interface AgentClonePickerProps {
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  onAdd: (templateName: string, count: number, lifecycle: AgentLifecycle) => void;
}

export const AgentClonePicker: React.FC<AgentClonePickerProps> = ({
  disabled = false,
  busy = false,
  compact = false,
  onAdd
}) => {
  const [open, setOpen] = React.useState<boolean>(false);
  const [templateName, setTemplateName] = React.useState<string>('');
  const [count, setCount] = React.useState<number>(1);
  const [lifecycle, setLifecycle] = React.useState<AgentLifecycle>('temporary');
  const templates = agentPersonaTemplates;

  if (!open) {
    return (
      <button
        type="button"
        className={compact ? 'btn-secondary' : undefined}
        disabled={disabled}
        onClick={() => {
          setTemplateName(templates[0]?.name || '');
          setOpen(true);
        }}
        style={compact
          ? { height: '28px', padding: '0 10px', fontSize: '0.72rem' }
          : {
              fontSize: '0.72rem',
              padding: '4px 10px',
              borderRadius: '16px',
              border: '1px dotted hsl(var(--accent-purple) / 0.5)',
              background: 'hsl(var(--accent-purple) / 0.08)',
              color: 'hsl(var(--text-secondary))',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.15s ease',
              userSelect: 'none'
            }}
        title="Add cloned AI experts"
      >
        + Expert
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: compact ? 'flex-end' : 'flex-start' }}>
      <select
        value={templateName}
        disabled={disabled || busy}
        onChange={(e) => setTemplateName(e.target.value)}
        className="form-select"
        style={{ fontSize: '0.75rem', height: '28px', padding: '0 8px', borderRadius: '6px', maxWidth: compact ? '150px' : undefined }}
      >
        <option value="">Expert</option>
        {templates.map(template => (
          <option key={template.name} value={template.name}>
            {compact ? template.name : `${template.name} (${template.role})`}
          </option>
        ))}
      </select>
      <select
        value={String(count)}
        disabled={disabled || busy}
        onChange={(e) => setCount(Number(e.target.value))}
        className="form-select"
        style={{ fontSize: '0.75rem', height: '28px', padding: '0 8px', borderRadius: '6px', width: '58px' }}
      >
        {[1, 2, 3, 4, 5, 6].map(value => (
          <option key={value} value={value}>{value}</option>
        ))}
      </select>
      <select
        value={lifecycle}
        disabled={disabled || busy}
        onChange={(e) => setLifecycle(e.target.value as AgentLifecycle)}
        className="form-select"
        style={{ fontSize: '0.75rem', height: '28px', padding: '0 8px', borderRadius: '6px', maxWidth: '116px' }}
      >
        <option value="temporary">Temporary</option>
        <option value="persistent">Save</option>
      </select>
      <button
        type="button"
        className="btn-primary"
        disabled={!templateName || disabled || busy}
        onClick={() => onAdd(templateName, count, lifecycle)}
        style={{ height: '28px', padding: '0 10px', fontSize: '0.72rem', borderRadius: '6px' }}
      >
        {busy ? 'Adding...' : 'Add'}
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={() => setOpen(false)}
        style={{ height: '28px', padding: '0 8px', fontSize: '0.72rem', borderRadius: '6px' }}
      >
        Cancel
      </button>
    </div>
  );
};
