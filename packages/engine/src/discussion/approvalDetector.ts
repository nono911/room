import { type ActionExecutionResult } from './actionExecutor.js';

export interface QualityGateResult {
  status: 'PASS' | 'NEEDS_MORE_DISCUSSION';
  content: string;
  nextRoundInstructions: string;
  executed?: ActionExecutionResult;
}

export function isExplicitlyApproved(content: string): boolean {
  // Strip markdown formatting symbols like asterisks and backticks
  const cleaned = content.replace(/[*`]+/g, '');
  
  const statusMatch = cleaned.match(/APPROVAL_STATUS\s*:\s*([A-Z_ -]+)/i);
  if (!statusMatch) {
    return false;
  }
  const status = statusMatch[1].trim().toUpperCase().replace(/\s+/g, '_');
  if (status !== 'APPROVED') {
    return false;
  }

  const openFindingsMatch = cleaned.match(/(?:^|\n)\s*-?\s*OPEN_FINDINGS\s*:?\s*([\s\S]*?)(?=\n\s*-?\s*(?:RESOLVED_FINDINGS|REQUIRED_CHANGES|TEST_REQUIREMENTS|VALIDATION_NOTES|APPROVAL_STATUS)\b|\s*$)/i);
  const openFindings = openFindingsMatch?.[1]?.trim();
  if (!openFindings) {
    return true;
  }

  const normalized = openFindings
    .replace(/^[-*\s]+/gm, '')
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '') // Strip punctuation
    .replace(/\b(none|no open findings|empty|na|n\/a|null)\b/gi, '')
    .trim();
  return normalized.length === 0;
}

export function parseCodingApproval(contents: string[]): boolean {
  if (contents.length === 0) return false;
  return contents.every(content => isExplicitlyApproved(content));
}

export function extractTaskReviewSummary(contents: string[]): string {
  const summaries = contents.map((content, index) => {
    // Clean markdown symbols to make match more robust
    const cleaned = content.replace(/[*`]+/g, '');
    const reviewSummary = cleaned.match(/REVIEW_SUMMARY\s*:?\s*([\s\S]*?)(?:\n-\s*OPEN_FINDINGS|\nOPEN_FINDINGS\b|\n-\s*REQUIRED_CHANGES|\nREQUIRED_CHANGES\b|\n-\s*VALIDATION_NOTES|\nVALIDATION_NOTES\b|\n-\s*APPROVAL_STATUS|\nAPPROVAL_STATUS\b|$)/i)?.[1]?.trim();
    const statusMatch = cleaned.match(/APPROVAL_STATUS\s*:?\s*([^\n]+)/i);
    const status = statusMatch?.[1]?.trim();
    return `Reviewer ${index + 1}${status ? ` (${status})` : ''}: ${reviewSummary || cleaned.trim().split('\n').slice(0, 3).join(' ')}`;
  });
  return summaries.join('\n');
}

export function parseQualityGateResult(content: string): QualityGateResult {
  const statusLine = content
    .split('\n')
    .map(line => line.trim().toUpperCase())
    .find(line => {
      if (!line.startsWith('STATUS:')) return false;
      const hasPass = line.includes('PASS');
      const hasNeedsMoreDiscussion = line.includes('NEEDS_MORE_DISCUSSION');
      return hasPass !== hasNeedsMoreDiscussion;
    });
  const status = statusLine?.includes('PASS') ? 'PASS' : 'NEEDS_MORE_DISCUSSION';
  const nextMatch = content.match(/NEXT_ROUND_INSTRUCTIONS:\s*([\s\S]*)/i);
  return {
    status,
    content,
    nextRoundInstructions: nextMatch?.[1]?.trim() || ''
  };
}
