import React, { useState, useEffect } from 'react';
import { api } from '../../../shared/ipc/client.js';
import { parseShellArgs } from '@room/engine/shellArgs';

interface McpServersScreenProps {
  projectPath: string | null;
  setErrorMsg: (value: string | null) => void;
}

interface McpServerConfig {
  command: string;
  args?: string[];
}

export const McpServersScreen: React.FC<McpServersScreenProps> = ({
  projectPath,
  setErrorMsg
}) => {
  const [mcpConfig, setMcpConfig] = useState<{ mcpServers: Record<string, McpServerConfig> }>({ mcpServers: {} });
  const [selectedMcpServer, setSelectedMcpServer] = useState<string | null>(null);
  const [mcpServerName, setMcpServerName] = useState<string>('');
  const [mcpServerCommand, setMcpServerCommand] = useState<string>('');
  const [mcpServerArgs, setMcpServerArgs] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const loadConfig = async (pathStr: string) => {
    try {
      const mcpRes = await api.loadMcpConfig(pathStr);
      if (mcpRes.success && mcpRes.config) {
        setMcpConfig(mcpRes.config);
      }
    } catch (err) {
      console.error('Error loading MCP configuration:', err);
    }
  };

  useEffect(() => {
    if (projectPath) {
      loadConfig(projectPath);
    } else {
      setMcpConfig({ mcpServers: {} });
      setSelectedMcpServer(null);
      resetMcpForm();
    }
  }, [projectPath]);

  const resetMcpForm = () => {
    setMcpServerName('');
    setMcpServerCommand('');
    setMcpServerArgs('');
  };

  const handleSelectMcpServer = (key: string) => {
    setSelectedMcpServer(key);
    if (key === 'New') {
      resetMcpForm();
    } else {
      const srv = mcpConfig.mcpServers[key];
      if (srv) {
        setMcpServerName(key);
        setMcpServerCommand(srv.command || '');
        setMcpServerArgs(srv.args ? srv.args.join(' ') : '');
      }
    }
  };

  const handleSaveMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectPath) return;

    const name = mcpServerName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!name) {
      setErrorMsg('Server name is required.');
      return;
    }

    if (!mcpServerCommand.trim()) {
      setErrorMsg('Command is required.');
      return;
    }

    setLoading(true);
    try {
      let argsArray: string[] = [];
      if (mcpServerArgs.trim()) {
        argsArray = parseShellArgs(mcpServerArgs.trim());
      }

      const updatedServers = { ...mcpConfig.mcpServers };

      if (selectedMcpServer && selectedMcpServer !== 'New' && selectedMcpServer !== name) {
        delete updatedServers[selectedMcpServer];
      }

      updatedServers[name] = {
        command: mcpServerCommand.trim(),
        args: argsArray
      };

      const newConfig = { mcpServers: updatedServers };
      const res = await api.saveMcpConfig(projectPath, newConfig);
      if (res.success) {
        setMcpConfig(newConfig);
        setSelectedMcpServer(name);
        setMcpServerName(name);
        setErrorMsg(null);
      } else {
        setErrorMsg(res.error || 'Failed to save MCP server.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while saving MCP server.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMcpServer = async (serverKey: string) => {
    if (!projectPath || !confirm(`Are you sure you want to delete MCP server "${serverKey}"?`)) return;

    setLoading(true);
    try {
      const updatedServers = { ...mcpConfig.mcpServers };
      delete updatedServers[serverKey];

      const newConfig = { mcpServers: updatedServers };
      const res = await api.saveMcpConfig(projectPath, newConfig);
      if (res.success) {
        setMcpConfig(newConfig);
        setSelectedMcpServer(null);
        resetMcpForm();
        setErrorMsg(null);
      } else {
        setErrorMsg(res.error || 'Failed to delete MCP server.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred while deleting MCP server.');
    } finally {
      setLoading(false);
    }
  };

  const serverKeys = Object.keys(mcpConfig.mcpServers || {});

  return (
    <div style={{ display: 'flex', gap: '24px', height: '100%', minHeight: '500px' }}>
      {/* Left panel: list of servers */}
      <div style={{
        width: '260px',
        background: 'hsl(var(--bg-card))',
        border: '1px solid hsl(var(--border-dim))',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '16px',
          borderBottom: '1px solid hsl(var(--border-dim))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>MCP Servers</span>
          <button
            className="btn-primary"
            onClick={() => handleSelectMcpServer('New')}
            style={{ padding: '4px 10px', fontSize: '0.75rem', height: 'auto', borderRadius: '4px' }}
          >
            + Add
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {serverKeys.length === 0 ? (
            <div style={{ padding: '20px 10px', textAlign: 'center', color: 'hsl(var(--text-muted))', fontSize: '0.8rem' }}>
              No servers configured. Read-only discussion tools allow built-in file and web inspection only; MCP servers are not automatically allowed because their tools may change state.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {serverKeys.map((key) => {
                const isSelected = selectedMcpServer === key;
                return (
                  <div
                    key={key}
                    onClick={() => handleSelectMcpServer(key)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      background: isSelected ? 'hsl(var(--accent-purple-dim))' : 'transparent',
                      border: isSelected ? '1px solid hsl(var(--accent-purple))' : '1px solid transparent',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.15s ease'
                    }}
                    className={isSelected ? '' : 'submenu-item'}
                  >
                    <span style={{ fontSize: '0.85rem', fontWeight: isSelected ? 600 : 500, color: isSelected ? 'hsl(var(--text-primary))' : 'hsl(var(--text-secondary))' }}>
                      {key}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteMcpServer(key);
                      }}
                      className="btn-delete-agent"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'hsl(var(--text-muted))',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title="Delete MCP Server"
                    >
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: editor form */}
      <div style={{ flex: 1, background: 'hsl(var(--bg-card))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '24px' }}>
        {selectedMcpServer === null ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--text-muted))' }}>
            <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ marginBottom: '16px', color: 'hsl(var(--text-muted) / 0.6)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span style={{ fontSize: '0.9rem' }}>Select an MCP server from the list or add a new one.</span>
          </div>
        ) : (
          <form onSubmit={handleSaveMcpServer} style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}>
            <div style={{ borderBottom: '1px solid hsl(var(--border-dim))', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'white', margin: 0 }}>
                {selectedMcpServer === 'New' ? 'Add New MCP Server' : `Edit Server: ${selectedMcpServer}`}
              </h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>Server Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. filesystem-mcp"
                value={mcpServerName}
                onChange={(e) => setMcpServerName(e.target.value)}
                disabled={loading}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>Lowercase, alphanumeric, dashes and underscores only.</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>Command / Executable</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. node or npx or python"
                value={mcpServerCommand}
                onChange={(e) => setMcpServerCommand(e.target.value)}
                disabled={loading}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.78rem', color: 'hsl(var(--text-secondary))', fontWeight: 600 }}>Arguments</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path/to/share"
                value={mcpServerArgs}
                onChange={(e) => setMcpServerArgs(e.target.value)}
                disabled={loading}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
              <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', lineHeight: 1.5 }}>
                ROOM does not store or pass inline MCP environment variables. Keep credentials out of this configuration.
              </span>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid hsl(var(--border-dim))', paddingTop: '16px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleSelectMcpServer(selectedMcpServer)}
                disabled={loading}
              >
                Reset
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
