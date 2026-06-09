import { Provider, ProviderConfig, ProviderExecuteOptions } from './provider.js';

export class CodexProvider implements Provider {
  name = 'Codex';
  private apiKey: string;
  private modelName: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.modelName = config.modelName || 'gpt-4o'; // Use standard OpenAI model for Codex tasks
    if (!this.apiKey) {
      console.warn('Warning: OpenAI API Key (used by Codex) is missing.');
    }
  }

  async execute(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key (used by Codex) is required to execute this provider.');
    }

    const url = 'https://api.openai.com/v1/chat/completions';
    
    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({
        role: 'system',
        content: systemInstruction
      });
    }
    messages.push({
      role: 'user',
      content: prompt
    });

    const payload = {
      model: this.modelName,
      messages: messages,
      temperature: 0.2
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API call failed with status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    try {
      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('Empty response from OpenAI API.');
      }
      options?.onChunk?.(text);
      return text;
    } catch (err: any) {
      throw new Error(`Failed to parse OpenAI API response: ${err.message}. Raw: ${JSON.stringify(data)}`);
    }
  }
}
