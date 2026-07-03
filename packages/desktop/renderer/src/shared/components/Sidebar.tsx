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
  const menuItems = [
    { name: 'Overview', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
    )},
    { name: 'Files', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 13h8M8 16h5" /></svg>
    )},
    { name: 'AI Members', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
    )},
    { name: 'Discussions', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
    )},
    { name: 'Task Run', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 8l-4 4 4 4" /></svg>
    )},
    { name: 'Documents', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    )},
    { name: 'Tasks', label: 'Task Archive', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
    )},
    { name: 'Context', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
    )},
    { name: 'MCP Servers', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h10.5M6.75 16.5h10.5M9 7.5v9m6-9v9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 4.5h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 013.75 9V6a1.5 1.5 0 011.5-1.5zM15.75 4.5h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5V6a1.5 1.5 0 011.5-1.5zM5.25 13.5h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5V15a1.5 1.5 0 011.5-1.5zM15.75 13.5h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5V15a1.5 1.5 0 011.5-1.5z" />
      </svg>
    )},
    { name: 'Settings', icon: (
      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    )}
  ];

  return (
    <aside className={`sidebar ${sidebarExpanded ? '' : 'collapsed'}`}>
      <div className="sidebar-brand">
        <img className="sidebar-brand-icon" src="./room-icon.png" alt="ROOM" />
        <span>ROOM</span>
      </div>
      
      {projectPath && (
        <div className="sidebar-project-selector" style={{ padding: '0 24px 16px 24px', borderBottom: '1px solid hsl(var(--border-dim))', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project Folder</span>
            <button 
              onClick={handleCloseProjectWorkspace}
              className="btn-close-workspace"
              style={{ 
                background: 'none', 
                border: 'none', 
                color: 'hsl(var(--accent-orange))', 
                fontSize: '0.7rem', 
                fontWeight: 600, 
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: '4px',
                outline: 'none'
              }}
            >
              Close
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }} title={projectPath}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0, color: 'hsl(var(--accent-purple))' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', fontWeight: 500 }}>
              {projectPath.split(/[/\\]/).pop()}
            </span>
          </div>
        </div>
      )}
      
      <div className="sidebar-scroll">
        <ul className="sidebar-menu">
          {menuItems.map((item) => {
            const isAgents = item.name === 'AI Members';
            const isItemActive = activeTab === item.name || (isAgents && activeTab.startsWith('Agent:'));
            const itemLabel = item.label || item.name;
            return (
              <React.Fragment key={item.name}>
                <li
                  className={`menu-item sidebar-nav-item ${isItemActive ? 'active' : ''}`}
                  onClick={() => {
                    if (isAgents) {
                      setActiveTab('AI Members');
                    } else {
                      setActiveTab(item.name);
                    }
                  }}
                  title={sidebarExpanded ? undefined : itemLabel}
                >
                  <span className="sidebar-nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <span className="sidebar-nav-label">{itemLabel}</span>
                  {isAgents && sidebarExpanded && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAiMembersSidebarExpanded(current => {
                          localStorage.setItem('room_ai_members_sidebar_expanded', String(!current));
                          return !current;
                        });
                      }}
                      title={aiMembersSidebarExpanded ? 'Collapse AI Members' : 'Expand AI Members'}
                      style={{
                        marginLeft: 'auto',
                        width: '22px',
                        height: '22px',
                        border: 0,
                        borderRadius: '6px',
                        background: 'transparent',
                        color: 'hsl(var(--text-muted))',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                    >
                      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={aiMembersSidebarExpanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                      </svg>
                    </button>
                  )}
                </li>
                {isAgents && sidebarExpanded && aiMembersSidebarExpanded && (
                  <ul className="sidebar-submenu">
                    {registeredAgents.map((agent: any) => {
                      const isFocused = activeTab === `Agent:${agent.name}`;
                      return (
                        <li
                          key={agent.name}
                          className={`submenu-item ${isFocused ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditAgent(agent);
                          }}
                        >
                          <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: isFocused ? 'hsl(var(--accent-purple))' : 'hsl(var(--border-dim))',
                            display: 'inline-block'
                          }}></span>
                          <span style={{
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap'
                          }}>{agent.name}</span>
                        </li>
                      );
                    })}
                    {registeredAgents.length === 0 && (
                      <li
                        className="submenu-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTab('AI Members');
                        }}
                        style={{ color: 'hsl(var(--text-muted))' }}
                      >
                        <span style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: 'hsl(var(--border-dim))',
                          display: 'inline-block'
                        }}></span>
                        <span>No registered members</span>
                      </li>
                    )}
                    <li
                      className={`submenu-item ${activeTab === 'Agent:New' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        resetAgentForm();
                        setActiveTab('Agent:New');
                      }}
                      style={{ fontStyle: 'italic' }}
                    >
                      <span style={{ fontWeight: 'bold' }}>+</span>
                      <span>Register AI Member...</span>
                    </li>
                  </ul>
                )}
              </React.Fragment>
            );
          })}
        </ul>
      </div>

      <button 
        className="sidebar-toggle-btn" 
        onClick={() => setSidebarExpanded(!sidebarExpanded)}
        title={sidebarExpanded ? "Collapse Sidebar" : "Expand Sidebar"}
      >
        {sidebarExpanded ? (
          <>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span>Collapse Sidebar</span>
          </>
        ) : (
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>

      <div className="sidebar-footer" style={sidebarExpanded ? {} : { justifyContent: 'center', padding: '16px 0' }}>
        <span className="status-dot" style={{ flexShrink: 0 }}></span>
        {sidebarExpanded && <span>ROOM Engine Active</span>}
      </div>
    </aside>
  );
};
