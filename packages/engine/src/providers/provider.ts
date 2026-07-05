export interface ProviderConfig {
  apiKey?: string;
  modelName?: string;
}

export type ToolAccess = 'none' | 'read-only';

export interface ProviderExecuteOptions {
  onChunk?: (chunk: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
  toolAccess?: ToolAccess;
}

export interface Provider {
  name: string;
  execute(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string>;
}
