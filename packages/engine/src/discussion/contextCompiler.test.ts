import { describe, expect, it } from 'vitest';
import { compileDiscussionContext } from './contextCompiler.js';

function message(index: number, type: 'user' | 'agent' = 'agent') {
  return {
    type,
    agentName: type === 'user' ? `User ${index}` : `Agent ${index}`,
    providerName: type === 'user' ? 'User' : 'Local CLI',
    content: `message ${index}`,
    timestamp: `10:${String(index).padStart(2, '0')}`
  };
}

describe('compileDiscussionContext', () => {
  it('caps history to recent messages while retaining first and latest user messages', () => {
    const messages = [
      message(1, 'user'),
      message(2),
      message(3),
      message(4, 'user'),
      message(5),
      message(6),
      message(7),
      message(8, 'user')
    ];

    const context = compileDiscussionContext(messages, 'Project context', {
      maxRecentMessages: 3
    });

    expect(context.includedMessages.map(item => item.agentName)).toEqual([
      'User 1',
      'Agent 6',
      'Agent 7',
      'User 8'
    ]);
    expect(context.omittedMessageCount).toBe(4);
    expect(context.totalLogMessages).toBe(8);
    expect(context.historyBlock).toContain('4 older message(s) are omitted');
    expect(context.historyBlock).toContain('--- User 1 ---');
    expect(context.historyBlock).toContain('--- User 8 ---');
  });

  it('can retain the latest user message even when the first user anchor is disabled', () => {
    const messages = [
      message(1, 'user'),
      message(2),
      message(3, 'user'),
      message(4),
      message(5)
    ];

    const context = compileDiscussionContext(messages, 'Project context', {
      maxRecentMessages: 1,
      keepFirstUserMessage: false
    });

    expect(context.includedMessages.map(item => item.agentName)).toEqual([
      'User 3',
      'Agent 5'
    ]);
    expect(context.omittedMessageCount).toBe(3);
  });

  it('reports included metadata truthfully when nothing is omitted', () => {
    const messages = [message(1, 'user'), message(2)];

    const context = compileDiscussionContext(messages, 'Project context', {
      maxRecentMessages: 10
    });

    expect(context.includedMessages).toHaveLength(2);
    expect(context.omittedMessageCount).toBe(0);
    expect(context.historyBlock).toContain('All messages are included');
    expect(context.priorMessageInstruction).toContain('2 previous chat message(s) included');
  });

  it('deduplicates exact repeated project context blocks only', () => {
    const context = compileDiscussionContext(
      [message(1, 'user')],
      ['Overview', 'Structure', 'Overview', 'Structure with extra detail'].join('\n\n')
    );

    expect(context.projectContextBlock).toBe(
      '=== Project Context ===\nOverview\n\nStructure\n\nStructure with extra detail'
    );
  });

  it('uses an explicit empty project context placeholder', () => {
    const context = compileDiscussionContext([message(1, 'user')], '');

    expect(context.projectContextBlock).toBe('=== Project Context ===\n(No workspace context provided.)');
  });
});
