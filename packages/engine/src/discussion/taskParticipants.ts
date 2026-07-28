import type { AgentConfig } from '../agents/registry.js';
import { isReviewerAgent } from './contextBuilder.js';
import { isDeveloperAgent } from './utils.js';

export interface CodingTaskParticipants {
  developer: AgentConfig;
  reviewers: AgentConfig[];
}

export function resolveCodingTaskParticipants(
  agents: AgentConfig[],
  developerName: string,
  reviewerNames: string[]
): CodingTaskParticipants {
  const requestedDeveloper = developerName.trim();
  const developer = requestedDeveloper
    ? agents.find(agent => agent.name.toLowerCase() === requestedDeveloper.toLowerCase())
    : agents.find(isDeveloperAgent);
  if (!developer) {
    throw new Error(
      requestedDeveloper
        ? `Selected Doer AI member "${requestedDeveloper}" is unavailable.`
        : 'No Doer AI member is available for this task.'
    );
  }

  const requestedReviewers = Array.from(new Map(
    reviewerNames
      .map(name => name.trim())
      .filter(Boolean)
      .map(name => [name.toLowerCase(), name])
  ).values());
  const reviewers = requestedReviewers.map(name => {
    const reviewer = agents.find(agent => agent.name.toLowerCase() === name.toLowerCase());
    if (!reviewer) throw new Error(`Selected Reviewer AI member "${name}" is unavailable.`);
    return reviewer;
  });
  if (requestedReviewers.length === 0) {
    const fallbackReviewer = agents.find(isReviewerAgent);
    if (fallbackReviewer) reviewers.push(fallbackReviewer);
  }
  if (reviewers.length === 0) {
    throw new Error('No Reviewer or Lead AI member is available for this task.');
  }
  return { developer, reviewers };
}
