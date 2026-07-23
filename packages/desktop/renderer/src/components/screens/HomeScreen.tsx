import type { ProjectData } from '../../types/domain.js';
import { renderMarkdownContent } from '../../shared/lib/markdown/MarkdownContent.js';

interface HomeScreenProps {
  projectPath: string | null;
  projectData: ProjectData | null;
  activeDiscussionRunId: string | null;
  activeTaskRunId: string | null;
  setActiveTab: (tab: string) => void;
}

function countArtifacts(projectData: ProjectData | null): number {
  if (!projectData) return 0;
  return (
    projectData.documents.length +
    projectData.reviews.length +
    projectData.discussions.length +
    projectData.tasks.length +
    (projectData.taskRuns?.length || 0) +
    projectData.decisions.length
  );
}

export function HomeScreen({
  projectPath,
  projectData,
  activeDiscussionRunId,
  activeTaskRunId,
  setActiveTab
}: HomeScreenProps) {
  const members = (projectData?.agents || []).filter(agent => !agent.isVirtual);
  const hasContext = !!projectData?.projectMd?.trim() || !!projectData?.archMd?.trim();
  const activeRun = activeTaskRunId
    ? { label: 'Execution in progress', route: 'Run:Execute' }
    : activeDiscussionRunId
      ? { label: 'Discussion in progress', route: 'Run:Think' }
      : null;
  const sourceName = projectPath?.split(/[/\\]/).pop() || 'No source attached';

  return (
    <div className="workspace-home">
      <header className="home-hero">
        <div>
          <span className="workspace-page-eyebrow">ROOM Home</span>
          <h1>What should this workspace move forward?</h1>
          <p>{sourceName} is attached as source. Runs, memory, agents, and artifacts stay in ROOM Home.</p>
        </div>
        <button type="button" className="home-primary-action" onClick={() => setActiveTab('Run:Think')}>
          <span>✦</span>
          Start a run
        </button>
      </header>

      {activeRun && (
        <button type="button" className="home-continue-run" onClick={() => setActiveTab(activeRun.route)}>
          <span className="home-live-dot" />
          <span>
            <strong>{activeRun.label}</strong>
            <small>Return to the live run without losing your place.</small>
          </span>
          <span>Continue →</span>
        </button>
      )}

      <section className="home-metrics" aria-label="Workspace health">
        <button type="button" onClick={() => setActiveTab('Context')}>
          <span className={hasContext ? 'healthy' : 'attention'}>{hasContext ? 'Ready' : 'Needs context'}</span>
          <strong>Shared memory</strong>
          <small>Overview and structure</small>
        </button>
        <button type="button" onClick={() => setActiveTab('AI Members')}>
          <span>{members.length}</span>
          <strong>AI members</strong>
          <small>{members.length ? 'Available for runs' : 'Create your first teammate'}</small>
        </button>
        <button type="button" onClick={() => setActiveTab('Skills')}>
          <span>{(projectData?.skills.length || 0) + (projectData?.machineSkills?.length || 0)}</span>
          <strong>Skills available</strong>
          <small>Workspace + this Mac</small>
        </button>
        <button type="button" onClick={() => setActiveTab('Artifacts')}>
          <span>{countArtifacts(projectData)}</span>
          <strong>Traceable outputs</strong>
          <small>Runs, docs, and decisions</small>
        </button>
      </section>

      <div className="home-grid">
        <section className="home-launch-card">
          <div className="home-section-heading">
            <div>
              <span className="workspace-page-eyebrow">Quick start</span>
              <h2>Choose the shape of the work</h2>
            </div>
          </div>
          <div className="home-run-modes">
            {[
              ['Run:Think', 'Think', 'Explore a problem with multiple perspectives.', '↗'],
              ['Run:Decide', 'Decide', 'Compare options and produce a clear recommendation.', '◆'],
              ['Run:Execute', 'Execute', 'Give one member ownership and reviewers.', '→'],
              ['Run:Review', 'Review', 'Inspect an existing result against explicit criteria.', '✓']
            ].map(([route, label, description, icon]) => (
              <button type="button" key={route} onClick={() => setActiveTab(route)}>
                <span>{icon}</span>
                <strong>{label}</strong>
                <small>{description}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="home-overview-card">
          <div className="home-section-heading">
            <div>
              <span className="workspace-page-eyebrow">Workspace brief</span>
              <h2>Shared context</h2>
            </div>
            <button type="button" onClick={() => setActiveTab('Context')}>Edit</button>
          </div>
          <div className="home-overview-markdown">
            {renderMarkdownContent(
              projectData?.projectMd?.trim() || 'No workspace overview yet. Add the goals, constraints, and source material every run should know.',
              false,
              'message-markdown'
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
