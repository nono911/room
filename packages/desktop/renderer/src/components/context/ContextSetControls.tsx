import { useState } from 'react';
import type { ContextSet } from '../../types/domain.js';

interface ContextSetControlsProps {
  contextSets: ContextSet[];
  selectedRefs: string[];
  loading: boolean;
  onApply: (refs: string[]) => void;
  onSave: (name: string, refs: string[]) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

export function ContextSetControls({
  contextSets,
  selectedRefs,
  loading,
  onApply,
  onSave,
  onDelete
}: ContextSetControlsProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || selectedRefs.length === 0) return;
    setSaving(true);
    const saved = await onSave(name, selectedRefs);
    if (saved) setName('');
    setSaving(false);
  };

  return (
    <div className="context-set-controls">
      <div className="context-set-heading">
        <span>Saved sets</span>
        <span>{contextSets.length}</span>
      </div>
      <div className="context-set-list">
        {loading ? (
          <span className="context-set-empty">Loading sets…</span>
        ) : contextSets.length === 0 ? (
          <span className="context-set-empty">Save a selection to reuse it in later runs.</span>
        ) : contextSets.map(set => (
          <div className="context-set-row" key={set.id}>
            <button type="button" onClick={() => onApply(set.refs)} title={`Apply ${set.refs.length} context items`}>
              <strong>{set.name}</strong>
              <span>{set.refs.length} items</span>
            </button>
            <button
              type="button"
              className="context-set-delete"
              aria-label={`Delete ${set.name}`}
              onClick={() => void onDelete(set.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="context-set-save">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name this selection"
          maxLength={80}
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !name.trim() || selectedRefs.length === 0}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
