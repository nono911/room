import { useMemo, useState } from 'react';
import type { ProjectData } from '../../types/domain.js';

interface SkillsCatalogScreenProps {
  projectData: ProjectData | null;
  setActiveTab: (tab: string) => void;
  resetAgentForm: () => void;
}

export function SkillsCatalogScreen({ projectData, setActiveTab, resetAgentForm }: SkillsCatalogScreenProps) {
  const [query, setQuery] = useState('');
  const selectedReferences = useMemo(() => new Set(
    (projectData?.agents || []).flatMap(agent => Array.isArray(agent.skills) ? agent.skills : [])
  ), [projectData]);
  const workspaceSkills = (projectData?.skills || []).map(filename => ({
    key: filename,
    name: filename.replace(/\.md$/i, ''),
    source: 'Workspace',
    detail: 'Stored with this ROOM workspace'
  }));
  const machineSkills = (projectData?.machineSkills || []).map(skill => ({
    key: skill.reference,
    name: skill.name,
    source: skill.sourceLabel,
    detail: skill.description || skill.relativePath
  }));
  const normalizedQuery = query.trim().toLowerCase();
  const skills = [...workspaceSkills, ...machineSkills].filter(skill => (
    !normalizedQuery || `${skill.name} ${skill.source} ${skill.detail}`.toLowerCase().includes(normalizedQuery)
  ));

  return (
    <div className="skills-catalog-screen">
      <header className="workspace-page-header">
        <div>
          <span className="workspace-page-eyebrow">Team</span>
          <h1>Skills</h1>
          <p>Available instructions stay off until you explicitly toggle them for an AI member.</p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            resetAgentForm();
            setActiveTab('Agent:New');
          }}
        >
          Configure a member
        </button>
      </header>
      <div className="skills-catalog-toolbar">
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search skills on this workspace and Mac…"
        />
        <span>{workspaceSkills.length} workspace · {machineSkills.length} on this Mac</span>
      </div>
      {skills.length === 0 ? (
        <div className="activity-empty">
          <strong>No matching skills</strong>
          <p>Try another search or create a workspace skill from an AI member.</p>
        </div>
      ) : (
        <div className="skills-catalog-grid">
          {skills.map(skill => (
            <article key={skill.key}>
              <div>
                <span>{skill.source}</span>
                {selectedReferences.has(skill.key) && <span className="skill-in-use">In use</span>}
              </div>
              <h2>{skill.name}</h2>
              <p>{skill.detail}</p>
              <small>{selectedReferences.has(skill.key) ? 'Selected by at least one member' : 'Off by default'}</small>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
