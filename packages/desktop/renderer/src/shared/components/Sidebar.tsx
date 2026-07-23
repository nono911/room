import React from 'react';
import type { ProjectData } from '../../types/domain.js';

interface SidebarProps {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  projectPath: string | null;
  handleCloseProjectWorkspace: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  aiMembersSidebarExpanded: boolean;
  setAiMembersSidebarExpanded: (expanded: boolean | ((prev: boolean) => boolean)) => void;
  projectData: ProjectData | null;
  startEditAgent: (agent: any) => void;
  resetAgentForm: () => void;
}

type NavItem = {
  route: string;
  label: string;
  icon: string;
  isActive?: (activeTab: string) => boolean;
};

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Workspace',
    items: [
      { route: 'Home', label: 'Home', icon: '⌂', isActive: tab => tab === 'Home' || tab === 'Overview' },
      {
        route: 'Run:Think',
        label: 'New Run',
        icon: '✦',
        isActive: tab => tab.startsWith('Run:') || tab === 'Discussions' || tab === 'Task Run'
      },
      { route: 'Activity', label: 'Activity', icon: '◷' }
    ]
  },
  {
    label: 'Knowledge',
    items: [
      { route: 'Files', label: 'Files', icon: '⌘' },
      { route: 'Artifacts', label: 'Artifacts', icon: '◇' },
      { route: 'Decisions', label: 'Decisions', icon: '◆' },
      { route: 'Context', label: 'Context', icon: '◎' }
    ]
  },
  {
    label: 'Team',
    items: [
      {
        route: 'AI Members',
        label: 'AI Members',
        icon: '◉',
        isActive: tab => tab === 'AI Members' || tab === 'Agents' || tab.startsWith('Agent:')
      },
      { route: 'Skills', label: 'Skills', icon: '⌁' }
    ]
  },
  {
    label: 'Settings',
    items: [
      { route: 'Settings', label: 'Providers', icon: '◌' },
      { route: 'MCP Servers', label: 'MCP & Tools', icon: '⌗' }
    ]
  }
];

export const Sidebar: React.FC<SidebarProps> = ({
  sidebarExpanded,
  setSidebarExpanded,
  projectPath,
  handleCloseProjectWorkspace,
  activeTab,
  setActiveTab,
  aiMembersSidebarExpanded,
  setAiMembersSidebarExpanded,
  projectData,
  startEditAgent,
  resetAgentForm
}) => {
  const registeredAgents = (projectData?.agents || []).filter((agent: any) => !agent.isVirtual);
  const workspaceName = projectPath?.split(/[/\\]/).pop() || 'Workspace';

  const toggleMembers = (event: React.MouseEvent) => {
    event.stopPropagation();
    setAiMembersSidebarExpanded(current => {
      localStorage.setItem('room_ai_members_sidebar_expanded', String(!current));
      return !current;
    });
  };

  return (
    <aside className={`sidebar workflow-sidebar ${sidebarExpanded ? '' : 'collapsed'}`}>
      <div className="sidebar-brand">
        <img className="sidebar-brand-icon" src="./room-icon.png" alt="ROOM" />
        <span>ROOM</span>
      </div>

      {projectPath && (
        <div className="sidebar-project-selector workspace-source-card">
          <div className="workspace-source-label">
            <span>Workspace</span>
            <button type="button" onClick={handleCloseProjectWorkspace}>Close</button>
          </div>
          <div className="workspace-source-name" title={projectPath}>
            <span className="workspace-source-mark">R</span>
            <span>{workspaceName}</span>
          </div>
          <div className="workspace-source-path" title={projectPath}>Attached source · {projectPath}</div>
        </div>
      )}

      <div className="sidebar-scroll">
        <nav className="workflow-nav" aria-label="Workspace navigation">
          {NAV_GROUPS.map(group => (
            <section className="workflow-nav-group" key={group.label}>
              {sidebarExpanded && <h2>{group.label}</h2>}
              {group.items.map(item => {
                const active = item.isActive ? item.isActive(activeTab) : activeTab === item.route;
                const isMembers = item.route === 'AI Members';
                return (
                  <React.Fragment key={item.route}>
                    <button
                      type="button"
                      className={`workflow-nav-item sidebar-nav-item${active ? ' active' : ''}`}
                      onClick={() => setActiveTab(item.route)}
                      title={sidebarExpanded ? undefined : item.label}
                    >
                      <span className="workflow-nav-icon">{item.icon}</span>
                      <span className="sidebar-nav-label">{item.label}</span>
                      {isMembers && sidebarExpanded && (
                        <span
                          role="button"
                          tabIndex={0}
                          className="workflow-nav-disclosure"
                          onClick={toggleMembers}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') toggleMembers(event as unknown as React.MouseEvent);
                          }}
                        >
                          {aiMembersSidebarExpanded ? '−' : '+'}
                        </span>
                      )}
                    </button>
                    {isMembers && sidebarExpanded && aiMembersSidebarExpanded && (
                      <div className="workflow-member-list">
                        {registeredAgents.map((agent: any) => {
                          const agentRoute = `Agent:${agent.id || agent.name}`;
                          const focused = activeTab === agentRoute || activeTab === `Agent:${agent.name}`;
                          return (
                            <button
                              type="button"
                              key={agent.id || agent.name}
                              className={focused ? 'active' : ''}
                              onClick={() => startEditAgent(agent)}
                            >
                              <span />
                              <span>{agent.name}</span>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className={activeTab === 'Agent:New' ? 'active create' : 'create'}
                          onClick={() => {
                            resetAgentForm();
                            setActiveTab('Agent:New');
                          }}
                        >
                          <span>+</span>
                          <span>New member</span>
                        </button>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </section>
          ))}
        </nav>
      </div>

      <button
        type="button"
        className="sidebar-toggle-btn"
        onClick={() => setSidebarExpanded(!sidebarExpanded)}
        title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <span className="workflow-collapse-icon">{sidebarExpanded ? '‹' : '›'}</span>
        {sidebarExpanded && <span>Collapse sidebar</span>}
      </button>
      <div className="sidebar-footer">
        <span className="status-dot" />
        {sidebarExpanded && <span>ROOM Engine ready</span>}
      </div>
    </aside>
  );
};
