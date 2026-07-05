import type { ToolAccess } from './provider.js';

export const CLAUDE_READ_ONLY_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch'];

export function resolveToolAccess(
  requested: ToolAccess | undefined,
  permissionMode: 'safe' | 'dangerous'
): ToolAccess {
  return requested === 'read-only' && permissionMode === 'safe' ? 'read-only' : 'none';
}

export function parseMcpServerNames(rawJson: string | null): string[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    const servers = parsed?.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
    return Object.keys(servers).filter(name => name.trim().length > 0);
  } catch {
    return [];
  }
}

export function claudeAllowedToolsArg(mcpServerNames: string[]): string {
  void mcpServerNames;
  return CLAUDE_READ_ONLY_TOOLS.join(',');
}

export function applyReadOnlyToolArgs(preset: string, args: string[], mcpServerNames: string[]): string[] {
  if (preset === 'claude') {
    return [...args, '--allowedTools', claudeAllowedToolsArg(mcpServerNames)];
  }
  if (preset === 'codex') {
    return args.map(arg => (arg === 'workspace-write' ? 'read-only' : arg));
  }
  return [...args];
}
