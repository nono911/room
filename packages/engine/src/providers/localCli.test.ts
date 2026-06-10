import { describe, expect, it } from 'vitest';
import { LocalCliProvider } from './localCli.js';

describe('LocalCliProvider JSON stream parsing', () => {
  const parseOutput = (
    cliPreset: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale',
    lines: string[]
  ) => {
    const provider = new LocalCliProvider({ name: 'Local CLI', cliPreset });
    const parseJsonStream = (provider as any).parseJsonStream.bind(provider) as (stdout: string) => string;
    return parseJsonStream(lines.join('\n'));
  };

  it('extracts Codex agent messages from item.completed events', () => {
    expect(parseOutput('codex', [
      '{"type":"thread.started","thread_id":"019eb21b-7764-7f61-843d-2e1c27025a17"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Final answer only."}}',
      '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"sed -n 1,20p file","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"sed -n 1,20p file","aggregated_output":"noisy command output","exit_code":0,"status":"completed"}}'
    ])).toBe('Final answer only.');
  });

  it('extracts Claude assistant messages from nested message payloads', () => {
    expect(parseOutput('claude', [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Claude answer."}]}}',
      '{"type":"tool_use","name":"Read","input":{"file_path":"README.md"}}'
    ])).toBe('Claude answer.');
  });

  it('extracts Gemini and CodeWhale text deltas without raw event JSON', () => {
    expect(parseOutput('gemini', [
      '{"type":"start"}',
      '{"text_delta":"Gemini "}',
      '{"text_delta":"answer."}',
      '{"type":"tool_call","name":"read_file"}'
    ])).toBe('Gemini answer.');

    expect(parseOutput('codewhale', [
      '{"type":"message_delta","role":"assistant","content":[{"text":"CodeWhale answer."}]}',
      '{"type":"command_execution","aggregated_output":"noise"}'
    ])).toBe('CodeWhale answer.');
  });

  it('extracts Copilot message deltas', () => {
    expect(parseOutput('copilot', [
      '{"type":"metadata","id":"run-1"}',
      '{"message_delta":"Copilot "}',
      '{"message_delta":"answer."}'
    ])).toBe('Copilot answer.');
  });
});
