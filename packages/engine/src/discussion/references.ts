export interface MessageReference {
  author: string;
  reason?: string;
}

const REFS_BLOCK_PATTERN = /```room-refs\s*\n([\s\S]*?)```/g;

export function parseMessageReferences(content: string): { references: MessageReference[]; cleaned: string } {
  const references: MessageReference[] = [];
  for (const match of content.matchAll(REFS_BLOCK_PATTERN)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as any)?.references;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const author = typeof entry?.author === 'string' ? entry.author.trim() : '';
      if (!author) continue;
      references.push({
        author,
        reason: typeof entry?.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : undefined
      });
    }
  }
  const cleaned = content.replace(REFS_BLOCK_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
  return { references, cleaned };
}
