import { describe, expect, it } from 'vitest';
import { compileDiscussionContext } from './contextCompiler.js';

function message(index: number, type: 'user' | 'agent' = 'agent') {
  return {
    id: `scope:message-${String(index).padStart(4, '0')}`,
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
    expect(context.includedIndexes).toEqual([0, 5, 6, 7]);
    expect(context.includedMessages.map(item => item.promptNumber)).toEqual([1, 2, 3, 4]);
    expect(context.includedMessages.map(item => item.logIndex)).toEqual([0, 5, 6, 7]);
    expect(context.includedMessages.map(item => item.id)).toEqual([
      'scope:message-0001',
      'scope:message-0006',
      'scope:message-0007',
      'scope:message-0008'
    ]);
    expect(context.omittedIndexes).toEqual([1, 2, 3, 4]);
    expect(context.summaryCandidateIndexes).toEqual([1, 2, 3, 4]);
    expect(context.totalLogMessages).toBe(8);
    expect(context.historyBlock).toContain('4 older message(s) are omitted');
    expect(context.historyBlock).toContain('--- Message 1 [m0001]: User 1 ---');
    expect(context.historyBlock).toContain('--- Message 4 [m0008]: User 8 ---');
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

  it('uses a token budget instead of a fixed 12-message window by default', () => {
    const messages = Array.from({ length: 18 }, (_, index) => message(index + 1, index === 0 ? 'user' : 'agent'));

    const context = compileDiscussionContext(messages, 'Project context');

    expect(context.includedMessages).toHaveLength(18);
    expect(context.omittedMessageCount).toBe(0);
    expect(context.historyBlock).toContain('All messages are included');
  });

  it('omits older long messages that do not fit the history token budget', () => {
    const messages = [
      message(1, 'user'),
      { ...message(2), content: 'old log '.repeat(1200) },
      message(3),
      message(4, 'user'),
      message(5)
    ];

    const context = compileDiscussionContext(messages, 'Project context', {
      maxHistoryTokens: 120,
      maxMessageTokens: 80,
      keepFirstUserMessage: true
    });

    expect(context.includedIndexes).toContain(3);
    expect(context.includedIndexes).toContain(4);
    expect(context.includedIndexes).not.toContain(1);
    expect(context.omittedIndexes).toContain(1);
    expect(context.metrics.estimatedHistoryTokens).toBeLessThanOrEqual(160);
  });

  it('trims a huge latest message at a readable boundary when it must be included', () => {
    const messages = [
      message(1, 'user'),
      {
        ...message(2, 'user'),
        content: `First paragraph stays useful.\n\n${'Second paragraph grows. '.repeat(500)}`
      }
    ];

    const context = compileDiscussionContext(messages, 'Project context', {
      maxHistoryTokens: 80,
      maxMessageTokens: 40,
      keepFirstUserMessage: false
    });

    expect(context.includedIndexes).toEqual([0, 1]);
    expect(context.historyBlock).toContain('First paragraph stays useful.');
    expect(context.historyBlock).toContain('[Message trimmed to fit the context budget.]');
  });

  it('trims project context independently from history budget', () => {
    const context = compileDiscussionContext(
      [message(1, 'user'), message(2)],
      `Overview stays visible.\n\n${'Large selected context. '.repeat(1000)}`,
      {
        maxProjectContextTokens: 20,
        maxHistoryTokens: 200,
        maxMessageTokens: 100
      }
    );

    expect(context.projectContextBlock).toContain('Overview stays visible.');
    expect(context.projectContextBlock).toContain('[Project context trimmed to fit the prompt budget.]');
    expect(context.historyBlock).toContain('message 2');
    expect(context.metrics.projectContextTrimmed).toBe(true);
    expect(context.metrics.maxProjectContextTokens).toBe(20);
    expect(context.metrics.maxHistoryTokens).toBe(200);
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

  it('inserts an omitted-message summary without changing included metadata', () => {
    const messages = [
      message(1, 'user'),
      message(2),
      message(3),
      message(4)
    ];

    const context = compileDiscussionContext(messages, 'Project context', {
      maxRecentMessages: 1,
      summary: 'Earlier decision: keep the compiler pure.'
    });

    expect(context.summaryUsed).toBe(true);
    expect(context.includedIndexes).toEqual([0, 3]);
    expect(context.historyBlock).toContain('=== Summary of Omitted Messages ===');
    expect(context.historyBlock).toContain('Earlier decision: keep the compiler pure.');
    expect(context.historyBlock).toContain('=== Included Messages ===');
  });

  it('excludes omission-only notes from summary candidates', () => {
    const messages = [
      message(1, 'user'),
      {
        ...message(2),
        content: '[Tool/action narration omitted: 2 lines.]'
      },
      message(3),
      message(4)
    ];

    const context = compileDiscussionContext(messages, 'Project context', {
      maxRecentMessages: 1
    });

    expect(context.omittedIndexes).toEqual([1, 2]);
    expect(context.summaryCandidateIndexes).toEqual([2]);
  });

  it('preserves tool narration lines when they reside inside code blocks', () => {
    const messages = [
      {
        id: 'msg-1',
        type: 'agent' as const,
        agentName: 'Agent 1',
        providerName: 'Local CLI',
        content: [
          'Normal narration should be stripped:',
          "Let's check the database.",
          '```javascript',
          "// Inside code block: Let's check the database.",
          'console.log("I am running a test");',
          '```',
          'And outside again:',
          'I am running a check.'
        ].join('\n'),
        timestamp: '10:00'
      }
    ];

    const context = compileDiscussionContext(messages, 'Project context');
    expect(context.historyBlock).toContain('Normal narration should be stripped:');
    expect(context.historyBlock).not.toContain("Let's check the database.\n```javascript");
    expect(context.historyBlock).toContain("// Inside code block: Let's check the database.");
    expect(context.historyBlock).toContain('console.log("I am running a test");');
    expect(context.historyBlock).toContain('And outside again:');
    expect(context.historyBlock).not.toContain('I am running a check.');
  });

  it('shows the stable short id in each history header', () => {
    const compiled = compileDiscussionContext([
      message(1, 'user'),
      message(2)
    ], '');
    expect(compiled.historyBlock).toContain('--- Message 1 [m0001]: User 1 ---');
    expect(compiled.historyBlock).toContain('--- Message 2 [m0002]: Agent 2 (Local CLI) ---');
  });
});
