import { ProviderConfig } from './provider.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';

export class CodexProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfig) {
    super({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || '',
      modelName: config.modelName,
      providerLabel: 'Codex'
    });
    if (!(config.apiKey || process.env.OPENAI_API_KEY)) {
      console.warn('Warning: OpenAI API Key (used by Codex) is missing.');
    }
  }
}
