import React from 'react';

interface SetupItem {
  label: string;
  done: boolean;
  action: string;
  run: () => void;
}

interface SetupChecklistProps {
  dismissedOnboarding: boolean;
  scanStatus: string;
  scanStartedAt: number | null;
  loading: boolean;
  setupItems: SetupItem[];
  markOnboardingSeen: () => void;
  setOnboardingStep: (step: number) => void;
  setShowOnboardingTour: (show: boolean) => void;
}

export const SetupChecklist: React.FC<SetupChecklistProps> = ({
  dismissedOnboarding,
  scanStatus,
  scanStartedAt,
  loading,
  setupItems,
  markOnboardingSeen,
  setOnboardingStep,
  setShowOnboardingTour
}) => {
  if (dismissedOnboarding) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      gap: '16px',
      alignItems: 'start',
      background: 'hsl(var(--bg-card))',
      border: '1px solid hsl(var(--border-dim))',
      borderRadius: '8px',
      padding: '14px 16px',
      marginBottom: '20px'
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'white' }}>Workspace setup</div>
        <div style={{ fontSize: '0.74rem', color: 'hsl(var(--text-muted))', marginTop: '3px' }}>
          Use this as a quick path from empty workspace to useful runs with source context and references preserved.
        </div>
        {scanStatus && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '10px',
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid hsl(var(--accent-purple) / 0.28)',
            background: 'hsl(var(--accent-purple) / 0.08)',
            color: 'hsl(var(--text-secondary))',
            fontSize: '0.76rem'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              background: scanStartedAt ? 'hsl(var(--accent-purple))' : '#10b981',
              boxShadow: scanStartedAt ? '0 0 0 4px hsl(var(--accent-purple) / 0.12)' : 'none',
              flexShrink: 0
            }} />
            <span>{scanStatus}</span>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginTop: '12px' }}>
          {setupItems.map(item => (
            <button
              key={item.label}
              type="button"
              disabled={loading}
              onClick={item.run}
              style={{
                display: 'grid',
                gridTemplateColumns: '18px minmax(0, 1fr) auto',
                gap: '8px',
                alignItems: 'center',
                background: item.done ? 'rgba(16, 185, 129, 0.08)' : 'hsl(var(--bg-input))',
                border: item.done ? '1px solid rgba(16, 185, 129, 0.28)' : '1px solid hsl(var(--border-dim))',
                color: 'inherit',
                borderRadius: '8px',
                padding: '8px 10px',
                textAlign: 'left',
                font: 'inherit',
                cursor: loading ? 'default' : 'pointer'
              }}
            >
              <span style={{ color: item.done ? '#10b981' : 'hsl(var(--text-muted))' }}>{item.done ? '✓' : '○'}</span>
              <span style={{ fontSize: '0.76rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
              <span style={{ fontSize: '0.68rem', color: 'hsl(var(--accent-purple))', fontWeight: 700 }}>{item.action}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button type="button" className="btn-secondary" onClick={() => { setOnboardingStep(0); setShowOnboardingTour(true); }} style={{ padding: '7px 11px', fontSize: '0.76rem' }}>
          Tour
        </button>
        <button type="button" className="btn-secondary" onClick={markOnboardingSeen} style={{ padding: '7px 11px', fontSize: '0.76rem' }}>
          Hide
        </button>
      </div>
    </div>
  );
};
