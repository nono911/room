import { Provider } from './provider.js';
import { GeminiProvider } from './gemini.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { LocalCliProvider } from './localCli.js';

export * from './provider.js';
export * from './gemini.js';
export * from './claude.js';
export * from './codex.js';
export * from './openaiCompatible.js';
export * from './registry.js';
export * from './localCli.js';

export function detectProviders(): Provider[] {
  const providers: Provider[] = [];

  if (process.env.GEMINI_API_KEY) {
    providers.push(new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY }));
  }
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push(new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY }));
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push(new CodexProvider({ apiKey: process.env.OPENAI_API_KEY }));
  }

  return providers;
}
