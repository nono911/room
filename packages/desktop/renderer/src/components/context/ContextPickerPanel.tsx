import React from 'react';
import type { ContextPickerItem, ContextSet } from '../../types/domain.js';
import { ContextSetControls } from './ContextSetControls.js';

interface ContextPickerPanelProps {
  contextPickerTarget: 'discussion' | 'task' | null;
  selectedRefs: string[];
  filteredItems: ContextPickerItem[];
  contextPickerTab: 'Suggested' | 'Tasks' | 'Docs' | 'Files';
  setContextPickerTab: (tab: 'Suggested' | 'Tasks' | 'Docs' | 'Files') => void;
  contextPickerQuery: string;
  setContextPickerQuery: (query: string) => void;
  contextPickerLoading: boolean;
  closeContextPicker: () => void;
  toggleContextSelection: (target: 'discussion' | 'task', ref: string) => void;
  getContextLabel: (ref: string) => string;
  estimateContextTokens: (target: 'discussion' | 'task') => number;
  setContextSelection: (target: 'discussion' | 'task', selection: string[]) => void;
  contextSets: ContextSet[];
  contextSetsLoading: boolean;
  contextSetsMutating: boolean;
  saveContextSet: (name: string, refs: string[]) => Promise<boolean>;
  deleteContextSet: (id: string) => Promise<boolean>;
}

export const ContextPickerPanel: React.FC<ContextPickerPanelProps> = ({
  contextPickerTarget,
  selectedRefs,
  filteredItems,
  contextPickerTab,
  setContextPickerTab,
  contextPickerQuery,
  setContextPickerQuery,
  contextPickerLoading,
  closeContextPicker,
  toggleContextSelection,
  getContextLabel,
  estimateContextTokens,
  setContextSelection,
  contextSets,
  contextSetsLoading,
  contextSetsMutating,
  saveContextSet,
  deleteContextSet
}) => {
  if (!contextPickerTarget) return null;
  const tabs: Array<'Suggested' | 'Tasks' | 'Docs' | 'Files'> = ['Suggested', 'Tasks', 'Docs', 'Files'];

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(3, 5, 12, 0.84)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '28px'
      }}
    >
      <div style={{
        width: 'min(1080px, 100%)',
        height: 'min(720px, calc(100vh - 56px))',
        background: 'hsl(var(--bg-main))',
        border: '1px solid hsl(var(--border-dim))',
        borderRadius: '8px',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 300px',
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
        isolation: 'isolate'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid hsl(var(--border-dim))', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>Add Context</div>
              <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', marginTop: '3px' }}>
                Search project tasks, docs, and files without loading the whole workspace into the picker.
              </div>
            </div>
            <button type="button" className="btn-secondary" onClick={closeContextPicker} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
              Close
            </button>
          </div>

          <div style={{ padding: '14px 18px', borderBottom: '1px solid hsl(var(--border-dim))', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="search"
              autoFocus
              value={contextPickerQuery}
              onChange={(e) => setContextPickerQuery(e.target.value)}
              placeholder="Search tasks, docs, paths, filenames..."
              style={{
                width: '100%',
                height: '40px',
                backgroundColor: 'hsl(var(--bg-input))',
                border: '1px solid hsl(var(--border-dim))',
                borderRadius: '8px',
                padding: '0 12px',
                color: 'white',
                fontFamily: 'inherit',
                outline: 'none'
              }}
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {tabs.map(tab => (
                <button
                  key={tab}
                  type="button"
                  className={contextPickerTab === tab ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => setContextPickerTab(tab)}
                  style={{ padding: '7px 12px', fontSize: '0.78rem' }}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {contextPickerLoading ? (
              <div style={{ color: 'hsl(var(--text-muted))', padding: '24px 4px', fontSize: '0.86rem' }}>Searching context...</div>
            ) : filteredItems.length === 0 ? (
              <div style={{ color: 'hsl(var(--text-muted))', padding: '24px 4px', fontSize: '0.86rem' }}>No matching context found.</div>
            ) : filteredItems.map(item => {
              const selected = selectedRefs.includes(item.ref);
              return (
                <button
                  key={`${item.ref}-${item.path || item.label}`}
                  type="button"
                  onClick={() => toggleContextSelection(contextPickerTarget, item.ref)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '22px minmax(0, 1fr) auto',
                    gap: '10px',
                    alignItems: 'center',
                    width: '100%',
                    minHeight: '58px',
                    background: selected ? 'hsl(var(--accent-purple) / 0.14)' : 'hsl(var(--bg-card))',
                    border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'inherit',
                    textAlign: 'left',
                    font: 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '4px',
                    border: selected ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                    background: selected ? 'hsl(var(--accent-purple))' : 'transparent',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.72rem'
                  }}>
                    {selected ? '✓' : ''}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.86rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.label}
                    </span>
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'hsl(var(--text-muted))', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.detail}
                    </span>
                  </span>
                  <span style={{ fontSize: '0.68rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 700 }}>
                    {item.type}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ borderLeft: '1px solid hsl(var(--border-dim))', background: 'hsl(var(--bg-sidebar))', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '16px', borderBottom: '1px solid hsl(var(--border-dim))' }}>
            <div style={{ fontSize: '0.82rem', color: 'hsl(var(--text-muted))', fontWeight: 700, textTransform: 'uppercase' }}>Selected Context</div>
            <div style={{ fontSize: '0.76rem', color: 'hsl(var(--text-secondary))', marginTop: '4px' }}>
              {selectedRefs.length} items · ~{estimateContextTokens(contextPickerTarget).toLocaleString()} tokens
            </div>
          </div>
          <ContextSetControls
            contextSets={contextSets}
            selectedRefs={selectedRefs}
            loading={contextSetsLoading}
            mutating={contextSetsMutating}
            onApply={(refs) => setContextSelection(contextPickerTarget, refs)}
            onSave={saveContextSet}
            onDelete={deleteContextSet}
          />
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedRefs.length === 0 ? (
              <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.82rem', lineHeight: 1.45 }}>Selected items will appear here before they are attached.</div>
            ) : selectedRefs.map(ref => (
              <button
                key={ref}
                type="button"
                onClick={() => toggleContextSelection(contextPickerTarget, ref)}
                title={getContextLabel(ref)}
                style={{
                  border: '1px solid hsl(var(--border-dim))',
                  background: 'hsl(var(--bg-card))',
                  color: 'inherit',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  textAlign: 'left',
                  font: 'inherit',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getContextLabel(ref)}</div>
                <div style={{ fontSize: '0.68rem', color: 'hsl(var(--text-muted))', marginTop: '3px' }}>Click to remove</div>
              </button>
            ))}
          </div>
          <div style={{ padding: '14px', borderTop: '1px solid hsl(var(--border-dim))', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-secondary" onClick={() => setContextSelection(contextPickerTarget, [])} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
              Clear
            </button>
            <button type="button" className="btn-primary" onClick={closeContextPicker} style={{ padding: '8px 12px', fontSize: '0.78rem' }}>
              Attach
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
