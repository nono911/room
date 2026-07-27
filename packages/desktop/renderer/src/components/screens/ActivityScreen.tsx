import type { ProjectData } from '../../types/domain.js';

type ArtifactSection = 'documents' | 'reviews' | 'discussions' | 'tasks' | 'decisions';

interface ActivityScreenProps {
  projectData: ProjectData | null;
  activeDiscussionRunId: string | null;
  activeTaskRunId: string | null;
  lastCodingTaskResult: any;
  setActiveTab: (tab: string) => void;
  setCodingTaskInput: (value: string) => void;
  applyTaskTypePreset: (value: string) => void;
  setInitialSelectedFile: (value: { section: ArtifactSection; file: string } | null) => void;
}

interface ActivityItem {
  id: string;
  title: string;
  meta: string;
  status: string;
  section: ArtifactSection;
  file: string;
}

function buildActivity(projectData: ProjectData | null): ActivityItem[] {
  if (!projectData) return [];
  const taskRuns: ActivityItem[] = (projectData.taskRuns || []).map(run => {
    const file = typeof run === 'string' ? run : run.filename;
    return {
      id: typeof run === 'string' ? file.replace(/\.md$/i, '') : run.id,
      title: typeof run === 'string' ? file : run.title,
      meta: 'Execution run',
      status: typeof run === 'string' ? 'saved' : run.status,
      section: 'tasks',
      file
    };
  });
  const discussions = projectData.discussions
    .filter(file => file.toLowerCase().endsWith('.md'))
    .map(file => ({
      id: file.replace(/\.md$/i, ''),
      title: file,
      meta: 'Discussion',
      status: 'saved',
      section: 'discussions' as const,
      file
    }));
  const decisions = projectData.decisions.map(file => ({
    id: file.replace(/\.md$/i, ''),
    title: file,
    meta: 'Decision record',
    status: 'accepted',
    section: 'decisions' as const,
    file
  }));
  return [...taskRuns, ...discussions, ...decisions].slice(0, 80);
}

export function ActivityScreen({
  projectData,
  activeDiscussionRunId,
  activeTaskRunId,
  lastCodingTaskResult,
  setActiveTab,
  setCodingTaskInput,
  applyTaskTypePreset,
  setInitialSelectedFile
}: ActivityScreenProps) {
  const items = buildActivity(projectData);
  const openItem = (item: ActivityItem) => {
    setInitialSelectedFile({ section: item.section, file: item.file });
    setActiveTab('Artifacts');
  };
  const runAgain = () => {
    const previousTask = String(lastCodingTaskResult?.task || '').trim();
    if (previousTask) {
      setCodingTaskInput(previousTask);
    }
    applyTaskTypePreset(String(lastCodingTaskResult?.taskType || 'general'));
    setActiveTab('Run:Execute');
  };

  return (
    <div className="activity-screen">
      <header className="workspace-page-header">
        <div>
          <span className="workspace-page-eyebrow">Work</span>
          <h1>Activity</h1>
          <p>Live work and durable outcomes from this Room, in one place.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setActiveTab('Run:Think')}>New run</button>
      </header>

      {(activeDiscussionRunId || activeTaskRunId) && (
        <section className="activity-live-grid">
          {activeDiscussionRunId && (
            <button type="button" onClick={() => setActiveTab('Run:Think')}>
              <span className="home-live-dot" />
              <strong>Discussion running</strong>
              <small>{activeDiscussionRunId}</small>
              <span>Open live run →</span>
            </button>
          )}
          {activeTaskRunId && (
            <button type="button" onClick={() => setActiveTab('Run:Execute')}>
              <span className="home-live-dot" />
              <strong>Execution running</strong>
              <small>{activeTaskRunId}</small>
              <span>Open live run →</span>
            </button>
          )}
        </section>
      )}

      {lastCodingTaskResult && (
        <section className="outcome-card">
          <div>
            <span className={`outcome-status ${lastCodingTaskResult.status || 'saved'}`}>
              {lastCodingTaskResult.status || 'completed'}
            </span>
            <h2>{lastCodingTaskResult.title || 'Latest run outcome'}</h2>
            <p>{lastCodingTaskResult.statusSummary || `${lastCodingTaskResult.cycles || 0} review cycles completed.`}</p>
          </div>
          <div className="outcome-facts">
            <span><strong>{lastCodingTaskResult.cycles || 0}</strong>cycles</span>
            <span><strong>{lastCodingTaskResult.approvedBy?.length || 0}</strong>approvals</span>
            <span><strong>{lastCodingTaskResult.artifactFilename ? 1 : 0}</strong>artifact</span>
          </div>
          <div className="outcome-actions">
            {lastCodingTaskResult.markdownFilename && (
              <button
                type="button"
                onClick={() => openItem({
                  id: lastCodingTaskResult.id,
                  title: lastCodingTaskResult.title,
                  meta: 'Execution run',
                  status: lastCodingTaskResult.status,
                  section: 'tasks',
                  file: lastCodingTaskResult.markdownFilename
                })}
              >
                Open outcome
              </button>
            )}
            <button type="button" onClick={runAgain}>Run again</button>
          </div>
        </section>
      )}

      <section className="activity-history">
        <div className="home-section-heading">
          <div>
            <span className="workspace-page-eyebrow">History</span>
            <h2>Run outcomes</h2>
          </div>
          <span>{items.length} records</span>
        </div>
        {items.length === 0 ? (
          <div className="activity-empty">
            <strong>No runs yet</strong>
            <p>Start with a question, decision, execution task, or review. ROOM will keep the outcome here.</p>
            <button type="button" onClick={() => setActiveTab('Run:Think')}>Start the first run</button>
          </div>
        ) : (
          <div className="activity-list">
            {items.map(item => (
              <button type="button" key={`${item.section}:${item.file}`} onClick={() => openItem(item)}>
                <span className="activity-kind">{item.meta.slice(0, 1)}</span>
                <span className="activity-copy">
                  <strong>{item.title}</strong>
                  <small>{item.meta} · {item.id}</small>
                </span>
                <span className={`activity-status ${item.status}`}>{item.status.replace('_', ' ')}</span>
                <span>→</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
