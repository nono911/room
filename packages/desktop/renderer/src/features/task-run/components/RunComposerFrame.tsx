import type { ReactNode } from 'react';

export type RunMode = 'Think' | 'Decide' | 'Execute' | 'Review';

interface PreflightItem {
  label: string;
  value: string;
  ready: boolean;
}

interface RunComposerFrameProps {
  mode: RunMode;
  preflight: PreflightItem[];
  onModeChange: (mode: RunMode) => void;
  children: ReactNode;
}

const MODE_COPY: Record<RunMode, { eyebrow: string; description: string }> = {
  Think: {
    eyebrow: 'Explore',
    description: 'Bring multiple perspectives together to understand the problem.'
  },
  Decide: {
    eyebrow: 'Converge',
    description: 'Compare options, challenge assumptions, and produce a recommendation.'
  },
  Execute: {
    eyebrow: 'Deliver',
    description: 'Give one member ownership, then review the result in cycles.'
  },
  Review: {
    eyebrow: 'Inspect',
    description: 'Evaluate existing work against explicit context and quality criteria.'
  }
};

export function RunComposerFrame({ mode, preflight, onModeChange, children }: RunComposerFrameProps) {
  const readyCount = preflight.filter(item => item.ready).length;
  return (
    <div className="run-composer-frame">
      <header className="run-composer-header">
        <div>
          <span className="workspace-page-eyebrow">{MODE_COPY[mode].eyebrow}</span>
          <h1>{mode} run</h1>
          <p>{MODE_COPY[mode].description}</p>
        </div>
        <div className="run-mode-switcher" role="tablist" aria-label="Run mode">
          {(Object.keys(MODE_COPY) as RunMode[]).map(item => (
            <button
              type="button"
              key={item}
              className={mode === item ? 'active' : ''}
              onClick={() => onModeChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </header>
      <section className="run-preflight" aria-label="Run preflight">
        <div className="run-preflight-heading">
          <span>Preflight</span>
          <strong>{readyCount}/{preflight.length} ready</strong>
        </div>
        <div className="run-preflight-items">
          {preflight.map(item => (
            <div className={item.ready ? 'ready' : 'attention'} key={item.label}>
              <span>{item.ready ? '✓' : '!'}</span>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>
      <div className="run-composer-content">{children}</div>
    </div>
  );
}
