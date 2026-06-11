import React from 'react';

interface OnboardingStep {
  title: string;
  body: string;
  action: string;
  run: () => void;
}

interface OnboardingTourProps {
  showOnboardingTour: boolean;
  onboardingStep: number;
  onboardingSteps: OnboardingStep[];
  markOnboardingSeen: () => void;
  setOnboardingStep: (step: number | ((prev: number) => number)) => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({
  showOnboardingTour,
  onboardingStep,
  onboardingSteps,
  markOnboardingSeen,
  setOnboardingStep
}) => {
  if (!showOnboardingTour) return null;
  const step = onboardingSteps[onboardingStep] || onboardingSteps[0];
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(3, 5, 12, 0.84)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '28px'
      }}
    >
      <div style={{
        width: 'min(560px, 100%)',
        background: 'hsl(var(--bg-main))',
        border: '1px solid hsl(var(--border-dim))',
        borderRadius: '8px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
        padding: '22px',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        isolation: 'isolate'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', fontWeight: 800 }}>
              Quick tour {onboardingStep + 1}/{onboardingSteps.length}
            </div>
            <h3 style={{ margin: '6px 0 0', fontSize: '1.15rem', color: 'white' }}>{step.title}</h3>
          </div>
          <button type="button" className="btn-secondary" onClick={markOnboardingSeen} style={{ padding: '6px 10px', fontSize: '0.74rem' }}>
            Skip
          </button>
        </div>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'hsl(var(--text-secondary))', lineHeight: 1.55 }}>
          {step.body}
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onboardingSteps.map((_, index) => (
            <span
              key={index}
              style={{
                height: '4px',
                flex: 1,
                borderRadius: '999px',
                background: index <= onboardingStep ? 'hsl(var(--accent-purple))' : 'hsl(var(--border-dim))'
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={onboardingStep === 0}
            onClick={() => setOnboardingStep(stepIndex => Math.max(0, (stepIndex as number) - 1))}
            style={{ padding: '8px 12px', fontSize: '0.78rem' }}
          >
            Back
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                markOnboardingSeen();
                step.run();
              }}
              style={{ padding: '8px 12px', fontSize: '0.78rem' }}
            >
              {step.action}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                if (onboardingStep >= onboardingSteps.length - 1) {
                  markOnboardingSeen();
                } else {
                  setOnboardingStep(stepIndex => (stepIndex as number) + 1);
                }
              }}
              style={{ padding: '8px 12px', fontSize: '0.78rem' }}
            >
              {onboardingStep >= onboardingSteps.length - 1 ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
