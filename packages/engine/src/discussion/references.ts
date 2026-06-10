export interface MessageReference {
  message?: number;
  messageId?: string;
  author?: string;
  reason?: string;
}

const REFS_BLOCK_PATTERN = /```room-refs\s*\n([\s\S]*?)```/g;

export interface ReferenceResolutionContext {
  promptNumber: number;
  id?: string;
  agentName: string;
}

export function parseMessageReferences(
  content: string,
  resolutionContext: ReferenceResolutionContext[] = []
): { references: MessageReference[]; cleaned: string } {
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
      const message = Number.isInteger(entry?.message) && entry.message > 0 ? entry.message : undefined;
      const resolved = message
        ? resolutionContext.find(contextMessage => contextMessage.promptNumber === message)
        : undefined;
      if (!author && !resolved) continue;
      references.push({
        ...(message && resolved ? { message } : {}),
        ...(resolved?.id ? { messageId: resolved.id } : {}),
        author: author || resolved?.agentName,
        reason: typeof entry?.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : undefined
      });
    }
  }
  const cleaned = content.replace(REFS_BLOCK_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
  return { references, cleaned };
}
