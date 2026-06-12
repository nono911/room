const THAI_OR_CJK_RE = /[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/u;
const ASCII_WORD_RE = /[A-Za-z0-9_]/u;
const ASCII_PUNCT_RE = /[.,;:!?()[\]{}'"`~@#$%^&*+=|\\/<>-]/u;

export function estimateTokenCount(text: string): number {
  const normalized = text || '';
  if (!normalized) return 0;

  let weightedChars = 0;
  for (const char of normalized) {
    if (/\s/u.test(char)) {
      weightedChars += 0.25;
    } else if (ASCII_WORD_RE.test(char)) {
      weightedChars += 1;
    } else if (ASCII_PUNCT_RE.test(char)) {
      weightedChars += 0.75;
    } else if (THAI_OR_CJK_RE.test(char)) {
      weightedChars += 2.2;
    } else {
      weightedChars += 1.5;
    }
  }

  return Math.max(1, Math.ceil(weightedChars / 4));
}

export function trimTextToTokenBudget(text: string, maxTokens: number): { text: string; truncated: boolean } {
  const safeBudget = Math.max(1, Math.floor(maxTokens));
  if (estimateTokenCount(text) <= safeBudget) {
    return { text, truncated: false };
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokenCount(text.slice(0, mid)) <= safeBudget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return {
    text: trimTextToBoundary(text.slice(0, low)).trimEnd(),
    truncated: true
  };
}

export function trimTextToCharBoundary(text: string, maxChars: number): { text: string; truncated: boolean } {
  const safeMaxChars = Math.max(1, Math.floor(maxChars));
  if (text.length <= safeMaxChars) {
    return { text, truncated: false };
  }

  return {
    text: trimTextToBoundary(text.slice(0, safeMaxChars)).trimEnd(),
    truncated: true
  };
}

function trimTextToBoundary(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) return '';

  const minimumUsefulLength = Math.floor(trimmed.length * 0.55);

  const paragraphBoundary = trimmed.lastIndexOf('\n\n');
  if (paragraphBoundary >= 24 && (paragraphBoundary >= minimumUsefulLength || trimmed.length - paragraphBoundary <= 150)) {
    return trimmed.slice(0, paragraphBoundary).trimEnd();
  }

  const headingBoundary = trimmed.search(/\n#{1,6}\s[^\n]*$/u);
  if (headingBoundary >= 24) {
    return trimmed.slice(0, headingBoundary).trimEnd();
  }

  const boundaryPatterns = [
    /\n[^\n]*$/u,
    /[.!?。！？]\s[^.!?。！？]*$/u,
    /[.!?。！？][^.!?。！？]*$/u,
    /\s[^\s]*$/u
  ];

  for (const pattern of boundaryPatterns) {
    const match = trimmed.match(pattern);
    if (!match || match.index === undefined || match.index < minimumUsefulLength) {
      continue;
    }
    const endIndex = pattern.source.includes('[.!?') ? match.index + 1 : match.index;
    if (endIndex > 0) {
      return trimmed.slice(0, endIndex).trimEnd();
    }
  }

  return trimmed;
}
