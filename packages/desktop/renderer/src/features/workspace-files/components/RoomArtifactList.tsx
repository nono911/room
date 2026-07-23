import type { ProjectData } from '../../../types/domain.js';

export type RoomArtifactSection = 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions';

export interface RoomArtifactSelection {
  section: RoomArtifactSection;
  file: string;
}

interface RoomArtifactListProps {
  projectData: ProjectData | null;
  selected: RoomArtifactSelection | null;
  onSelect: (selection: RoomArtifactSelection) => void;
  onlySection?: RoomArtifactSection;
}

const GROUPS: Array<{ section: RoomArtifactSection; label: string }> = [
  { section: 'documents', label: 'Documents' },
  { section: 'reviews', label: 'Reviews' },
  { section: 'discussions', label: 'Discussions' },
  { section: 'tasks', label: 'Tasks & runs' },
  { section: 'decisions', label: 'Decisions' }
];

function getFiles(projectData: ProjectData | null, section: RoomArtifactSection): string[] {
  if (!projectData) return [];
  if (section === 'tasks') {
    const runs = (projectData.taskRuns || []).map(run => typeof run === 'string' ? run : run.filename);
    return [...projectData.tasks, ...runs];
  }
  return projectData[section] || [];
}

export function RoomArtifactList({ projectData, selected, onSelect, onlySection }: RoomArtifactListProps) {
  const visibleGroups = onlySection ? GROUPS.filter(group => group.section === onlySection) : GROUPS;
  const total = visibleGroups.reduce((count, group) => count + getFiles(projectData, group.section).length, 0);
  return (
    <div className="room-artifact-list">
      <div className="room-artifact-summary">
        <strong>ROOM artifacts</strong>
        <span>{total} traceable outputs</span>
      </div>
      <div className="room-artifact-scroll">
        {total === 0 ? (
          <div className="file-tree-empty">No artifacts yet. Start a run to create the first one.</div>
        ) : visibleGroups.map(group => {
          const files = getFiles(projectData, group.section);
          if (files.length === 0) return null;
          return (
            <section className="room-artifact-group" key={group.section}>
              <h3>{group.label}<span>{files.length}</span></h3>
              {files.map(file => {
                const isSelected = selected?.section === group.section && selected.file === file;
                return (
                  <button
                    type="button"
                    key={`${group.section}:${file}`}
                    className={isSelected ? 'is-selected' : ''}
                    onClick={() => onSelect({ section: group.section, file })}
                  >
                    <span>{file}</span>
                    <small>{group.section}</small>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
