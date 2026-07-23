import { describe, expect, it } from 'vitest';
import { AcpProtocolSession } from './acpClient.js';

describe('AcpProtocolSession', () => {
  it('runs the Kiro handshake, selects a model, and streams the answer', () => {
    const writes: Array<Record<string, unknown>> = [];
    const chunks: string[] = [];
    let output = '';
    const session = new AcpProtocolSession({
      cwd: '/workspace',
      prompt: 'Inspect the project.',
      model: 'claude-sonnet-5',
      permissionMode: 'safe',
      onWrite: message => writes.push(message),
      onChunk: chunk => chunks.push(chunk),
      onComplete: result => {
        output = result;
      },
      onError: error => {
        throw error;
      }
    });

    session.start();
    session.feed('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}\n');
    session.feed('{"jsonrpc":"2.0","id":2,"result":{"sessionId":"session-1","models":{"currentModelId":"auto"}}}\n');
    session.feed('{"jsonrpc":"2.0","id":3,"result":{"models":{"currentModelId":"claude-sonnet-5"}}}\n');
    session.feed('{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"ROOM "}}}}\n');
    session.feed('{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"works."}}}}\n');
    session.feed('{"jsonrpc":"2.0","id":4,"result":{"stopReason":"end_turn"}}\n');

    expect(writes.map(message => message.method)).toEqual([
      'initialize',
      'session/new',
      'session/set_model',
      'session/prompt'
    ]);
    expect(writes[3]?.params).toEqual({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'Inspect the project.' }]
    });
    expect(chunks).toEqual(['ROOM ', 'works.']);
    expect(output).toBe('ROOM works.');
  });

  it('rejects permission requests in safe mode', () => {
    const writes: Array<Record<string, unknown>> = [];
    const session = new AcpProtocolSession({
      cwd: '/workspace',
      prompt: 'Do not write.',
      permissionMode: 'safe',
      onWrite: message => writes.push(message),
      onComplete: () => {},
      onError: error => {
        throw error;
      }
    });

    session.start();
    session.feed('{"jsonrpc":"2.0","id":99,"method":"session/request_permission","params":{"options":[{"optionId":"allow","kind":"allow_once"},{"optionId":"reject","kind":"reject_once"}]}}\n');

    expect(writes.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 99,
      result: { outcome: { outcome: 'selected', optionId: 'reject' } }
    });
  });

  it('approves permission requests only in dangerous mode', () => {
    const writes: Array<Record<string, unknown>> = [];
    const session = new AcpProtocolSession({
      cwd: '/workspace',
      prompt: 'Make the requested change.',
      permissionMode: 'dangerous',
      onWrite: message => writes.push(message),
      onComplete: () => {},
      onError: error => {
        throw error;
      }
    });

    session.start();
    session.feed('{"jsonrpc":"2.0","id":"permission-1","method":"session/request_permission","params":{"options":[{"optionId":"once","kind":"allow_once"},{"optionId":"reject","kind":"reject_once"}]}}\n');

    expect(writes.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 'permission-1',
      result: { outcome: { outcome: 'selected', optionId: 'once' } }
    });
  });
});
