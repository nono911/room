import { Provider, ProviderConfig, ProviderExecuteOptions } from './provider.js';

export class ClaudeProvider implements Provider {
  name = 'Claude';
  private apiKey: string;
  private modelName: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.modelName = config.modelName || 'claude-3-5-sonnet-20241022';
    if (!this.apiKey) {
      console.warn('Warning: Anthropic (Claude) API Key is missing.');
    }
  }

  async execute(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Claude API key is required to execute this provider.');
    }

    const url = 'https://api.anthropic.com/v1/messages';
    
    const payload: any = {
      model: this.modelName,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    };

    if (systemInstruction) {
      payload.system = systemInstruction;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API call failed with status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    try {
      const text = data.content?.[0]?.text;
      if (!text) {
        throw new Error('Empty response from Claude API.');
      }
      options?.onChunk?.(text);
      return text;
    } catch (err: any) {
      throw new Error(`Failed to parse Claude API response: ${err.message}. Raw: ${JSON.stringify(data)}`);
    }
  }
}
