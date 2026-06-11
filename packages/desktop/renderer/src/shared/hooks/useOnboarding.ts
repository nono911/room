import { useEffect, useState } from 'react';
import type { ProjectData } from '../../types/domain.js';

interface UseOnboardingDeps {
  projectPath: string | null;
  isRoomProject: boolean;
  projectData: ProjectData | null;
}

export function useOnboarding({ projectPath, isRoomProject, projectData }: UseOnboardingDeps) {
  const [showOnboardingTour, setShowOnboardingTour] = useState<boolean>(false);
  const [onboardingStep, setOnboardingStep] = useState<number>(0);
  const [dismissedOnboarding, setDismissedOnboarding] = useState<boolean>(false);
  const [onboardingSessionDismissed, setOnboardingSessionDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (!projectPath || !isRoomProject || !projectData || onboardingSessionDismissed) return;
    const key = `room_onboarding_seen:${projectPath}`;
    const seen = localStorage.getItem(key) === 'true';
    setDismissedOnboarding(seen);
    if (!seen) {
      setOnboardingStep(0);
      setShowOnboardingTour(true);
    }
  }, [projectPath, isRoomProject, projectData, onboardingSessionDismissed]);

  const markOnboardingSeen = () => {
    if (projectPath) {
      localStorage.setItem(`room_onboarding_seen:${projectPath}`, 'true');
    }
    setDismissedOnboarding(true);
    setOnboardingSessionDismissed(true);
    setShowOnboardingTour(false);
  };

  const resetOnboarding = () => {
    setShowOnboardingTour(false);
    setDismissedOnboarding(false);
    setOnboardingSessionDismissed(false);
  };

  const startOnboardingTour = () => {
    setOnboardingStep(0);
    setShowOnboardingTour(true);
  };

  return {
    showOnboardingTour, setShowOnboardingTour,
    onboardingStep, setOnboardingStep,
    dismissedOnboarding,
    markOnboardingSeen,
    resetOnboarding,
    startOnboardingTour
  };
}
