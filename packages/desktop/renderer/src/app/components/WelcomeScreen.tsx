import type { KeyboardEvent } from 'react';

interface WelcomeScreenProps {
  newWorkspaceName: string;
  setNewWorkspaceName: (value: string) => void;
  loading: boolean;
  handleCreateWorkspace: () => void;
  handleOpenProject: () => void;
  errorMsg: string | null;
  recentProjects: string[];
  handleSelectRecentProject: (pathStr: string) => void;
}

export function WelcomeScreen({
  newWorkspaceName,
  setNewWorkspaceName,
  loading,
  handleCreateWorkspace,
  handleOpenProject,
  errorMsg,
  recentProjects,
  handleSelectRecentProject
}: WelcomeScreenProps) {
  const handleWorkspaceNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleCreateWorkspace();
    }
  };

  return (
    <div className="welcome-container" style={{ maxWidth: '640px', margin: '0 auto' }}>
      <div className="welcome-card" style={{ width: '100%' }}>
        <img className="welcome-app-icon" src="./room-icon.png" alt="ROOM" />
        <h1 className="welcome-logo">ROOM</h1>
        <p className="welcome-desc">
          ROOM keeps collaboration memory in ~/.room and connects it to source folders without adding ROOM data to your projects.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="text"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              onKeyDown={handleWorkspaceNameKeyDown}
              disabled={loading}
              placeholder="Workspace name"
              style={{
                flex: 1,
                minWidth: 0,
                backgroundColor: 'hsl(var(--bg-input))',
                border: '1px solid hsl(var(--border-dim))',
                borderRadius: '8px',
                padding: '12px 14px',
                color: 'white',
                fontFamily: 'inherit',
                outline: 'none'
              }}
            />
            <button className="btn-primary" onClick={handleCreateWorkspace} disabled={loading || !newWorkspaceName.trim()} style={{ whiteSpace: 'nowrap' }}>
              {loading ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
          <button className="btn-secondary" onClick={handleOpenProject} disabled={loading}>
            {loading ? 'Opening...' : 'Open Existing Workspace'}
          </button>
        </div>
        {errorMsg && <p style={{ color: 'hsl(var(--accent-orange))', marginTop: '16px', fontSize: '0.9rem' }}>{errorMsg}</p>}

        {recentProjects.length > 0 && (
          <div style={{ marginTop: '32px', textAlign: 'left', borderTop: '1px solid hsl(var(--border-dim))', paddingTop: '24px' }}>
            <h4 style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', marginBottom: '16px', fontWeight: 600, letterSpacing: '0.05em' }}>Recent Workspaces</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recentProjects.map((pathStr) => (
                <button
                  key={pathStr}
                  onClick={() => handleSelectRecentProject(pathStr)}
                  disabled={loading}
                  className="btn-recent-project"
                  style={{
                    background: 'hsl(var(--bg-input))',
                    border: '1px solid hsl(var(--border-dim))',
                    color: 'hsl(var(--text-secondary))',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    outline: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden', marginRight: '16px' }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0, color: 'hsl(var(--accent-purple))' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span style={{ fontWeight: 600, color: 'white', flexShrink: 0 }}>{pathStr.split(/[/\\]/).pop()}</span>
                    <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{pathStr}</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'hsl(var(--accent-purple))', fontWeight: 600, flexShrink: 0 }}>Open -&gt;</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
