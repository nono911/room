import { describe, expect, it } from 'vitest';
import { createAgentInstancesFromTemplate } from './agentInstances.js';

describe('temporary Local CLI agent instances', () => {
  it('carries the configured safe Local CLI preset and model', () => {
    const [agent] = createAgentInstancesFromTemplate({
      template: {
        name: 'Reviewer',
        role: 'Review',
        prompt: 'Review the work.'
      },
      defaults: {
        provider: 'Local CLI',
        cliPreset: 'codex',
        modelName: 'gpt-5.6-terra'
      },
      skillFiles: [],
      existingNames: [],
      count: 1
    });

    expect(agent).toMatchObject({
      provider: 'Local CLI',
      cliPreset: 'codex',
      modelName: 'gpt-5.6-terra',
      stdinFormat: 'text',
      permissionMode: 'safe'
    });
  });
});
