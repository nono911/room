import React from 'react';
import type { TemplateSkill } from '../../../types/domain.js';
import {
  buildGeneratedDrafts,
  buildProviderOptions,
  buildSkillDraftContent,
  buildSystemPrompt,
  buildTemplateOptions,
  createRowId,
  DEFAULT_TEMPLATE_NAME,
  mergeDraftEdits,
  type TemplateRowDraft,
  type TeamWizardMemberDraft
} from '../lib/teamWizard.js';

interface CreateTeamWizardProps {
  existingNames: string[];
  existingSkillFiles: string[];
  onCancel: () => void;
  onCreate: (
    team: { name: string; description?: string },
    members: Array<{
      name: string;
      role: string;
      provider: string;
      modelName?: string;
      systemPrompt: string;
      skills: string[];
    }>,
    skillDrafts: Array<{ name: string; content: string }>
  ) => Promise<void>;
  mode?: 'create-team' | 'add-members';
  initialTeamName?: string;
  initialDescription?: string;
  initialTemplateRows?: TemplateRowDraft[];
  submitLabel?: string;
}

export const CreateTeamWizard: React.FC<CreateTeamWizardProps> = ({
  existingNames,
  existingSkillFiles,
  onCancel,
  onCreate,
  mode = 'create-team',
  initialTeamName = '',
  initialDescription = '',
  initialTemplateRows,
  submitLabel
}) => {
  const [teamName, setTeamName] = React.useState(initialTeamName);
  const [description, setDescription] = React.useState(initialDescription);
  const [templateRows, setTemplateRows] = React.useState<TemplateRowDraft[]>(
    initialTemplateRows?.length
      ? initialTemplateRows
      : [{ id: createRowId(), templateName: DEFAULT_TEMPLATE_NAME, count: 1 }]
  );
  const [memberDrafts, setMemberDrafts] = React.useState<TeamWizardMemberDraft[]>(() =>
    buildGeneratedDrafts(
      initialTemplateRows?.length
        ? initialTemplateRows
        : [{ id: createRowId(), templateName: DEFAULT_TEMPLATE_NAME, count: 1 }],
      existingNames
    )
  );
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setTeamName(initialTeamName);
  }, [initialTeamName]);

  React.useEffect(() => {
    setDescription(initialDescription);
  }, [initialDescription]);

  React.useEffect(() => {
    if (!initialTemplateRows?.length) return;
    setTemplateRows(initialTemplateRows);
  }, [initialTemplateRows]);

  React.useEffect(() => {
    const nextDrafts = buildGeneratedDrafts(templateRows, existingNames);
    setMemberDrafts(previous => mergeDraftEdits(previous, nextDrafts));
  }, [existingNames, templateRows]);

  const providerOptions = React.useMemo(() => buildProviderOptions(), []);
  const templateOptions = React.useMemo(() => buildTemplateOptions(), []);

  const updateDraft = (draftId: string, patch: Partial<TeamWizardMemberDraft>) => {
    setMemberDrafts(previous =>
      previous.map(draft => (draft.draftId === draftId ? { ...draft, ...patch } : draft))
    );
  };

  const canSubmit = mode === 'add-members'
    ? memberDrafts.length > 0
    : Boolean(teamName.trim()) && memberDrafts.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const normalizedSkillFiles = new Set(existingSkillFiles.map(skill => skill.toLowerCase()));
    const templateSkillsByName = new Map<string, TemplateSkill>();

    memberDrafts.forEach(member => {
      member.templateSkills.forEach(skill => {
        templateSkillsByName.set(skill.filename.toLowerCase(), skill);
      });
    });

    const skillDraftMap = new Map<string, { name: string; content: string }>();
    const members = memberDrafts.map(member => ({
      name: member.name.trim(),
      role: member.role.trim(),
      provider: member.provider,
      modelName: member.modelName?.trim() || undefined,
      systemPrompt: buildSystemPrompt(member.basePrompt, member.personaAngle),
      skills: member.skills.map(skill => skill.trim()).filter(Boolean)
    }));

    for (const member of memberDrafts) {
      for (const rawSkillName of member.skills) {
        const skillName = rawSkillName.trim();
        if (!skillName) continue;

        const normalizedName = skillName.toLowerCase();
        if (normalizedSkillFiles.has(normalizedName) || skillDraftMap.has(normalizedName)) {
          continue;
        }

        skillDraftMap.set(normalizedName, {
          name: skillName,
          content: buildSkillDraftContent(skillName, templateSkillsByName.get(normalizedName))
        });
      }
    }

    setSaving(true);
    try {
      await onCreate(
        {
          name: (mode === 'add-members' ? initialTeamName : teamName).trim(),
          description: (mode === 'add-members' ? initialDescription : description).trim() || undefined
        },
        members,
        Array.from(skillDraftMap.values()).sort((left, right) => left.name.localeCompare(right.name))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        padding: '18px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '8px',
        background: 'rgba(15, 23, 42, 0.68)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        boxShadow: '0 18px 40px rgba(2, 6, 23, 0.25)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h4 style={{ fontSize: '1rem', margin: 0, color: 'white' }}>
            {mode === 'add-members' ? `Add members to ${initialTeamName}` : 'Create a team'}
          </h4>
          <p style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', margin: '6px 0 0 0' }}>
            Mix templates, adjust counts, then edit each member draft before saving.
          </p>
        </div>
      </div>

      {mode === 'create-team' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor="team-name-input">
              Team name
            </label>
            <input
              id="team-name-input"
              aria-label="Team name"
              className="form-input"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              placeholder="e.g. Product Design"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor="team-description-input">
              Team description
            </label>
            <input
              id="team-description-input"
              aria-label="Team description"
              className="form-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this team covers"
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {templateRows.map((row, index) => (
          <div
            key={row.id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 92px auto',
              gap: '8px',
              alignItems: 'end'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor={`template-row-${row.id}`}>
                Template
              </label>
              <select
                id={`template-row-${row.id}`}
                aria-label="Template"
                className="form-select"
                value={row.templateName}
                onChange={(event) =>
                  setTemplateRows(previous =>
                    previous.map(item => (item.id === row.id ? { ...item, templateName: event.target.value } : item))
                  )
                }
              >
                {templateOptions.map(templateName => (
                  <option key={templateName} value={templateName}>
                    {templateName}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor={`template-count-${row.id}`}>
                Count
              </label>
              <select
                id={`template-count-${row.id}`}
                aria-label="Count"
                className="form-select"
                value={row.count}
                onChange={(event) =>
                  setTemplateRows(previous =>
                    previous.map(item => (item.id === row.id ? { ...item, count: Number(event.target.value) } : item))
                  )
                }
              >
                {[1, 2, 3, 4, 5, 6].map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-secondary"
              aria-label={`Remove template row ${index + 1}`}
              onClick={() =>
                setTemplateRows(previous =>
                  previous.length === 1 ? previous : previous.filter(item => item.id !== row.id)
                )
              }
              disabled={templateRows.length === 1}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setTemplateRows(previous => [
                ...previous,
                { id: createRowId(), templateName: DEFAULT_TEMPLATE_NAME, count: 1 }
              ])
            }
          >
            Add template row
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <h5 style={{ fontSize: '0.88rem', margin: 0, color: 'white' }}>Member drafts</h5>
          <p style={{ fontSize: '0.76rem', color: 'hsl(var(--text-muted))', margin: '6px 0 0 0' }}>
            Provider, model, skills, and persona angle can all be adjusted before the members are created.
          </p>
        </div>
        {memberDrafts.map((member, index) => (
          <div
            key={member.draftId}
            style={{
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              background: 'rgba(15, 23, 42, 0.58)',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor={`member-name-${member.draftId}`}>
                  Member {index + 1} name
                </label>
                <input
                  id={`member-name-${member.draftId}`}
                  aria-label={`Member ${index + 1} name`}
                  className="form-input"
                  value={member.name}
                  onChange={(event) => updateDraft(member.draftId, { name: event.target.value })}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor={`member-role-${member.draftId}`}>
                  Member {index + 1} role
                </label>
                <input
                  id={`member-role-${member.draftId}`}
                  aria-label={`Member ${index + 1} role`}
                  className="form-input"
                  value={member.role}
                  onChange={(event) => updateDraft(member.draftId, { role: event.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 0.9fr) minmax(0, 1fr)', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor={`member-angle-${member.draftId}`}>
                  Member {index + 1} persona angle
                </label>
                <input
                  id={`member-angle-${member.draftId}`}
                  aria-label={`Member ${index + 1} persona angle`}
                  className="form-input"
                  value={member.personaAngle}
                  onChange={(event) => updateDraft(member.draftId, { personaAngle: event.target.value })}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor={`member-provider-${member.draftId}`}>
                  Member {index + 1} provider
                </label>
                <select
                  id={`member-provider-${member.draftId}`}
                  aria-label={`Member ${index + 1} provider`}
                  className="form-select"
                  value={member.provider}
                  onChange={(event) => updateDraft(member.draftId, { provider: event.target.value })}
                >
                  {providerOptions.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor={`member-model-${member.draftId}`}>
                  Member {index + 1} model
                </label>
                <input
                  id={`member-model-${member.draftId}`}
                  aria-label={`Member ${index + 1} model`}
                  className="form-input"
                  value={member.modelName || ''}
                  onChange={(event) => updateDraft(member.draftId, { modelName: event.target.value || undefined })}
                  placeholder="Optional model override"
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.74rem', color: 'hsl(var(--text-secondary))' }} htmlFor={`member-skills-${member.draftId}`}>
                Member {index + 1} skills
              </label>
              <input
                id={`member-skills-${member.draftId}`}
                aria-label={`Member ${index + 1} skills`}
                className="form-input"
                value={member.skills.join(', ')}
                onChange={(event) =>
                  updateDraft(member.draftId, {
                    skills: event.target.value
                      .split(',')
                      .map(value => value.trim())
                      .filter(Boolean)
                  })
                }
                placeholder="Comma-separated .md skill files"
              />
            </div>

            <div
              style={{
                fontSize: '0.74rem',
                color: 'hsl(var(--text-muted))',
                lineHeight: 1.5,
                background: 'rgba(2, 6, 23, 0.45)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '8px',
                padding: '10px 12px',
                whiteSpace: 'pre-wrap'
              }}
            >
              {buildSystemPrompt(member.basePrompt, member.personaAngle)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || saving}
        >
          {saving
            ? mode === 'add-members'
              ? 'Adding members...'
              : 'Creating team...'
            : submitLabel || (mode === 'add-members' ? 'Add members' : 'Create team')}
        </button>
      </div>
    </div>
  );
};
