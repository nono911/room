export interface ProviderConfig {
  apiKey?: string;
  modelName?: string;
}

export interface ProviderExecuteOptions {
  onChunk?: (chunk: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Provider {
  name: string;
  execute(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string>;
}
