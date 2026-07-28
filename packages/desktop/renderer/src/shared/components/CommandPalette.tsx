import { useEffect, useMemo, useState } from 'react';

interface CommandPaletteProps {
  enabled: boolean;
  setActiveTab: (tab: string) => void;
}

const COMMANDS = [
  ['Home', 'Go to Home'],
  ['Run:Think', 'New Think run'],
  ['Run:Decide', 'New Decide run'],
  ['Run:Execute', 'New Execute run'],
  ['Run:Review', 'New Review run'],
  ['Activity', 'Open Activity'],
  ['Files', 'Browse Files'],
  ['Artifacts', 'Browse ROOM Artifacts'],
  ['AI Members', 'Manage AI Members'],
  ['Skills', 'Browse Skills'],
  ['Settings', 'Configure Providers'],
  ['MCP Servers', 'Configure MCP & Tools']
] as const;

export function CommandPalette({ enabled, setActiveTab }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(current => !current);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? COMMANDS.filter(([, label]) => label.toLowerCase().includes(normalized))
      : COMMANDS;
  }, [query]);

  if (!open) return null;
  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <div className="command-palette" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Go somewhere or start a run…"
        />
        <div>
          {visibleCommands.map(([route, label]) => (
            <button
              type="button"
              key={route}
              onClick={() => {
                setActiveTab(route);
                setOpen(false);
                setQuery('');
              }}
            >
              <span>{label}</span>
              <small>↵</small>
            </button>
          ))}
          {visibleCommands.length === 0 && <p>No matching command.</p>}
        </div>
        <footer><span>⌘K to toggle</span><span>Esc to close</span></footer>
      </div>
    </div>
  );
}
