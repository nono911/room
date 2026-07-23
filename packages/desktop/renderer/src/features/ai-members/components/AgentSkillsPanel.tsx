import React, { useMemo, useState } from 'react';
import type { MachineSkillSummary, SkillPreviewResult } from '../../../types/domain.js';

interface AgentSkillsPanelProps {
  workspaceSkills: string[];
  machineSkills: MachineSkillSummary[];
  selectedSkills: string[];
  setSelectedSkills: React.Dispatch<React.SetStateAction<string[]>>;
  setSkillPreview: (value: SkillPreviewResult | null) => void;
  skillPreview: SkillPreviewResult | null;
  handlePreviewAgentSkills: () => void;
  editingSkillFile: string;
  setEditingSkillFile: (value: string) => void;
  loadRoomFilePreview: (section: 'skills', file: string) => void;
  editingSkillContent: string;
  setEditingSkillContent: (value: string) => void;
  editingSkillSource: 'skills' | 'roles';
  setEditingSkillSource: (value: 'skills' | 'roles') => void;
  handleSaveEditingSkill: () => void;
  customSkillName: string;
  setCustomSkillName: (value: string) => void;
  customSkillDesc: string;
  setCustomSkillDesc: (value: string) => void;
  handleAddCustomSkill: () => void;
  loading: boolean;
}

const isMachineReference = (value: string) => value.startsWith('machine://');

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const AgentSkillsPanel: React.FC<AgentSkillsPanelProps> = ({
  workspaceSkills,
  machineSkills,
  selectedSkills,
  setSelectedSkills,
  setSkillPreview,
  skillPreview,
  handlePreviewAgentSkills,
  editingSkillFile,
  setEditingSkillFile,
  loadRoomFilePreview,
  editingSkillContent,
  setEditingSkillContent,
  editingSkillSource,
  setEditingSkillSource,
  handleSaveEditingSkill,
  customSkillName,
  setCustomSkillName,
  customSkillDesc,
  setCustomSkillDesc,
  handleAddCustomSkill,
  loading
}) => {
  const [machineQuery, setMachineQuery] = useState('');
  const visibleMachineSkills = useMemo(() => {
    const query = machineQuery.trim().toLowerCase();
    if (!query) return machineSkills;
    return machineSkills.filter(skill =>
      `${skill.name} ${skill.description || ''} ${skill.sourceLabel} ${skill.relativePath}`
        .toLowerCase()
        .includes(query)
    );
  }, [machineQuery, machineSkills]);
  const knownMachineReferences = new Set(machineSkills.map(skill => skill.reference));
  const unavailableMachineReferences = selectedSkills.filter(
    skill => isMachineReference(skill) && !knownMachineReferences.has(skill)
  );

  const toggleSkill = (skill: string) => {
    setSkillPreview(null);
    setSelectedSkills(previous =>
      previous.includes(skill)
        ? previous.filter(item => item !== skill)
        : [...previous, skill]
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-secondary))', textTransform: 'uppercase' }}>
          Assign Skills
        </label>
        <button
          type="button"
          className="btn-secondary"
          disabled={loading || selectedSkills.length === 0}
          onClick={handlePreviewAgentSkills}
          style={{ fontSize: '0.72rem', padding: '6px 10px', height: 'auto' }}
        >
          Check Skills
        </button>
      </div>

      <SkillSectionTitle title="Workspace Skills" detail="Stored in ROOM Home" />
      {workspaceSkills.length === 0 ? (
        <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
          No workspace skills found. Create one below or save the agent without workspace skills.
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '190px', overflowY: 'auto', paddingRight: '4px' }}>
          {workspaceSkills.map(skill => {
            const isSelected = selectedSkills.includes(skill);
            return (
              <div
                key={skill}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: '8px',
                  alignItems: 'center',
                  background: editingSkillFile === skill ? 'hsl(var(--accent-purple) / 0.12)' : 'hsl(var(--bg-input))',
                  border: editingSkillFile === skill ? '1px solid hsl(var(--accent-purple))' : '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '8px 10px'
                }}
              >
                <SkillToggle
                  checked={isSelected}
                  label={skill.replace('.md', '').replace(/-/g, ' ')}
                  onChange={() => toggleSkill(skill)}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loading}
                  onClick={() => loadRoomFilePreview('skills', skill)}
                  style={{ fontSize: '0.72rem', padding: '5px 9px', height: 'auto' }}
                >
                  Edit
                </button>
              </div>
            );
          })}
        </div>
      )}

      <SkillSectionTitle title="Skills on This Mac" detail="Manual selection · read-only" />
      <input
        type="search"
        className="custom-skill-input"
        value={machineQuery}
        onChange={event => setMachineQuery(event.target.value)}
        placeholder="Search installed skills..."
        aria-label="Search skills on this Mac"
      />
      {machineSkills.length === 0 ? (
        <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
          No installed skills were found in Codex, Agents, or plugin skill directories.
        </span>
      ) : visibleMachineSkills.length === 0 ? (
        <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
          No installed skills match this search.
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto', paddingRight: '4px' }}>
          {visibleMachineSkills.map(skill => {
            const isSelected = selectedSkills.includes(skill.reference);
            return (
              <label
                key={skill.reference}
                className={`skill-checkbox-chip ${isSelected ? 'selected' : ''}`}
                style={{
                  alignItems: 'flex-start',
                  background: 'hsl(var(--bg-input))',
                  border: '1px solid hsl(var(--border-dim))',
                  borderRadius: '8px',
                  padding: '9px 10px'
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSkill(skill.reference)}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', color: 'hsl(var(--text-secondary))', fontWeight: 650 }}>
                    {isSelected ? '✓ ' : '+ '}{skill.name}
                  </span>
                  <span style={{ display: 'block', color: 'hsl(var(--text-muted))', fontSize: '0.68rem', marginTop: '3px' }}>
                    {skill.sourceLabel}{skill.description ? ` · ${skill.description}` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {unavailableMachineReferences.map(reference => (
        <label
          key={reference}
          className="skill-checkbox-chip selected"
          style={{ border: '1px solid rgba(239, 68, 68, 0.35)', borderRadius: '8px', padding: '9px 10px' }}
        >
          <input type="checkbox" checked onChange={() => toggleSkill(reference)} />
          <span style={{ minWidth: 0, color: '#ef4444' }}>
            Missing installed skill · toggle off to remove
          </span>
        </label>
      ))}

      {skillPreview && <SkillPreviewCard preview={skillPreview} />}

      {editingSkillFile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
                Edit Workspace Skill
              </div>
              <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {editingSkillFile}
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary"
              disabled={loading}
              onClick={() => {
                setEditingSkillFile('');
                setEditingSkillContent('');
                setEditingSkillSource('skills');
              }}
              style={{ fontSize: '0.72rem', padding: '5px 9px', height: 'auto' }}
            >
              Close
            </button>
          </div>
          <textarea
            value={editingSkillContent}
            onChange={event => setEditingSkillContent(event.target.value)}
            rows={10}
            disabled={loading}
            style={{ width: '100%', resize: 'vertical', minHeight: '180px', backgroundColor: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '10px 12px', color: 'white', fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.5, outline: 'none' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))' }}>
              {editingSkillSource === 'roles'
                ? 'Saving this imported legacy role moves it into workspace skills.'
                : 'Saved edits stay in this ROOM Home workspace.'}
            </span>
            <button type="button" className="btn-primary" disabled={loading} onClick={handleSaveEditingSkill} style={{ fontSize: '0.78rem', padding: '8px 12px', whiteSpace: 'nowrap' }}>
              Save Skill
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px', paddingTop: '12px', borderTop: '1px dashed hsl(var(--border-dim))' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>
          Create Workspace Skill
        </span>
        <input
          type="text"
          placeholder="Role or Skill Name"
          value={customSkillName}
          onChange={event => setCustomSkillName(event.target.value)}
          className="custom-skill-input"
        />
        <textarea
          rows={3}
          placeholder="Skill Description / Instructions"
          value={customSkillDesc}
          onChange={event => setCustomSkillDesc(event.target.value)}
          className="custom-skill-input"
          style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: '0.8rem' }}
        />
        <button type="button" className="btn-secondary" disabled={loading} onClick={handleAddCustomSkill} style={{ fontSize: '0.8rem', padding: '8px 12px', alignSelf: 'flex-end' }}>
          + Save Skill
        </button>
      </div>
    </div>
  );
};

const SkillSectionTitle = ({ title, detail }: { title: string; detail: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'hsl(var(--text-secondary))' }}>{title}</span>
    <span style={{ fontSize: '0.66rem', color: 'hsl(var(--text-muted))' }}>{detail}</span>
  </div>
);

const SkillToggle = ({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) => (
  <label className={`skill-checkbox-chip ${checked ? 'selected' : ''}`} style={{ minWidth: 0, width: '100%', justifyContent: 'flex-start' }}>
    <input type="checkbox" checked={checked} onChange={onChange} />
    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {checked ? '✓ ' : '+ '}{label}
    </span>
  </label>
);

const SkillPreviewCard = ({ preview }: { preview: SkillPreviewResult }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: preview.readableCount === preview.totalCount ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)', border: preview.readableCount === preview.totalCount ? '1px solid rgba(16, 185, 129, 0.28)' : '1px solid rgba(239, 68, 68, 0.28)', borderRadius: '8px', padding: '10px 12px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'hsl(var(--text-secondary))' }}>
        {preview.readableCount}/{preview.totalCount} skills readable
      </span>
      <span style={{ fontSize: '0.7rem', color: preview.readableCount === preview.totalCount ? '#10b981' : '#ef4444', fontWeight: 700 }}>
        {preview.readableCount === preview.totalCount ? 'READY' : 'CHECK NEEDED'}
      </span>
    </div>
    <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', lineHeight: 1.45 }}>{preview.delivery}</div>
    {preview.items.map(item => (
      <div key={item.reference || item.filename} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: '8px', alignItems: 'start', fontSize: '0.72rem', color: item.readable ? 'hsl(var(--text-secondary))' : '#ef4444' }}>
        <span>{item.readable ? '✓' : '!'}</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.filename} · {item.source === 'machine' ? item.sourceLabel || 'This Mac' : `ROOM Home/${item.source || 'skills'}`}
          </span>
          <span style={{ display: 'block', color: 'hsl(var(--text-muted))', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.readable ? `${item.heading || 'No heading'} · ${formatFileSize(item.bytes || 0)}` : item.error}
          </span>
        </span>
      </div>
    ))}
  </div>
);
