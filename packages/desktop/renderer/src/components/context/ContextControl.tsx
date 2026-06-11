import React from 'react';

interface ContextControlProps {
  target: 'discussion' | 'task';
  title: string;
  loading: boolean;
  selectedRefs: string[];
  estimateContextTokens: (target: 'discussion' | 'task') => number;
  openContextPicker: (target: 'discussion' | 'task') => void;
  setContextSelection: (target: 'discussion' | 'task', selection: string[]) => void;
  toggleContextSelection: (target: 'discussion' | 'task', ref: string) => void;
  getContextLabel: (ref: string) => string;
}

export const ContextControl: React.FC<ContextControlProps> = ({
  target,
  title,
  loading,
  selectedRefs,
  estimateContextTokens,
  openContextPicker,
  setContextSelection,
  toggleContextSelection,
  getContextLabel
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 14px', background: 'hsl(var(--bg-sidebar))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>
          {title}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
          {selectedRefs.length} selected · ~{estimateContextTokens(target).toLocaleString()} tokens
        </span>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn-secondary"
          disabled={loading}
          onClick={() => openContextPicker(target)}
          style={{ padding: '8px 12px', fontSize: '0.78rem' }}
        >
          Add Context
        </button>
        {selectedRefs.length > 0 && (
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => setContextSelection(target, [])}
            style={{ padding: '8px 12px', fontSize: '0.78rem' }}
          >
            Clear
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '86px', overflowY: 'auto' }}>
        {selectedRefs.length === 0 ? (
          <span style={{ fontSize: '0.76rem', color: 'hsl(var(--text-muted))' }}>
            No additional context selected.
          </span>
        ) : selectedRefs.map(ref => (
          <button
            key={ref}
            type="button"
            disabled={loading}
            onClick={() => toggleContextSelection(target, ref)}
            title={getContextLabel(ref)}
            className="skill-checkbox-chip selected"
            style={{ fontSize: '0.72rem', padding: '4px 10px', borderRadius: '14px', maxWidth: '280px' }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ✓ {getContextLabel(ref)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
