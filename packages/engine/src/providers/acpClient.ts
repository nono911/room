import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import type { ProviderExecuteOptions } from './provider.js';

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number;
type PermissionMode = 'safe' | 'dangerous';

export interface AcpModelOption {
  value: string;
  label: string;
}

interface AcpProtocolSessionOptions {
  cwd: string;
  prompt: string;
  model?: string;
  permissionMode: PermissionMode;
  onWrite: (message: JsonObject) => void;
  onChunk?: (text: string) => void;
  onComplete: (output: string) => void;
  onError: (error: Error) => void;
}

interface RunAcpCliOptions {
  bin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  model?: string;
  permissionMode: PermissionMode;
  timeoutMs: number;
  executeOptions?: ProviderExecuteOptions;
}

interface DetectAcpModelsOptions {
  bin: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function rpcError(raw: JsonObject): Error | null {
  const error = asObject(raw.error);
  if (!error) return null;
  const message = typeof error.message === 'string' ? error.message : 'Unknown ACP error.';
  const code = typeof error.code === 'number' || typeof error.code === 'string'
    ? ` (${error.code})`
    : '';
  return new Error(`ACP request failed${code}: ${message}`);
}

function findModelConfigId(result: JsonObject): string | null {
  const options = Array.isArray(result.configOptions) ? result.configOptions : [];
  for (const rawOption of options) {
    const option = asObject(rawOption);
    if (!option) continue;
    const id = typeof option.id === 'string' ? option.id.trim() : '';
    const category = typeof option.category === 'string' ? option.category.toLowerCase() : '';
    const name = typeof option.name === 'string' ? option.name.toLowerCase() : '';
    if (id && (category === 'model' || name === 'model' || /^models?$/i.test(id))) {
      return id;
    }
  }
  return null;
}

function choosePermissionOption(rawOptions: unknown, permissionMode: PermissionMode): string | null {
  const options = Array.isArray(rawOptions) ? rawOptions : [];
  const desiredKinds = permissionMode === 'dangerous'
    ? ['allow_always', 'allow_once']
    : ['reject_once', 'reject_always'];

  for (const kind of desiredKinds) {
    const option = options
      .map(asObject)
      .find(candidate => candidate?.kind === kind || candidate?.optionId === kind);
    if (option && typeof option.optionId === 'string') {
      return option.optionId;
    }
  }

  if (permissionMode === 'dangerous') {
    const sessionApproval = options
      .map(asObject)
      .find(option => option?.optionId === 'approve_for_session');
    return typeof sessionApproval?.optionId === 'string' ? sessionApproval.optionId : null;
  }

  return null;
}

export class AcpProtocolSession {
  private readonly options: AcpProtocolSessionOptions;
  private nextId = 2;
  private sessionId: string | null = null;
  private setModelRequestId: JsonRpcId | null = null;
  private promptRequestId: JsonRpcId | null = null;
  private stdoutBuffer = '';
  private output = '';
  private finished = false;

  constructor(options: AcpProtocolSessionOptions) {
    this.options = options;
  }

  start(): void {
    this.send(1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { terminal: false },
      clientInfo: { name: 'room', version: 'local-cli-provider' }
    });
  }

  feed(text: string): void {
    this.stdoutBuffer += text;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      this.handleLine(line);
    }
  }

  flush(): void {
    if (this.stdoutBuffer.trim()) {
      this.handleLine(this.stdoutBuffer);
    }
    this.stdoutBuffer = '';
  }

  cancel(): void {
    if (this.finished || !this.sessionId) return;
    this.send(this.nextId, 'session/cancel', { sessionId: this.sessionId });
    this.nextId += 1;
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return;
    }

    const message = asObject(raw);
    if (!message) return;
    const error = rpcError(message);
    if (error) {
      this.fail(error);
      return;
    }

    if (message.method === 'session/request_permission') {
      this.handlePermissionRequest(message);
      return;
    }

    if (message.method === 'session/update') {
      this.handleSessionUpdate(message);
      return;
    }

    const result = asObject(message.result);
    if (!result) return;
    if (message.id === 1) {
      this.send(this.nextId, 'session/new', {
        cwd: this.options.cwd,
        mcpServers: []
      });
      this.nextId += 1;
      return;
    }

    if (message.id === 2) {
      this.sessionId = typeof result.sessionId === 'string' ? result.sessionId : null;
      if (!this.sessionId) {
        this.fail(new Error('Kiro ACP returned an invalid session/new response.'));
        return;
      }
      if (this.options.model && this.options.model !== 'default') {
        const configId = findModelConfigId(result);
        this.setModelRequestId = this.nextId;
        if (configId) {
          this.send(this.nextId, 'session/set_config_option', {
            sessionId: this.sessionId,
            configId,
            value: this.options.model
          });
        } else {
          this.send(this.nextId, 'session/set_model', {
            sessionId: this.sessionId,
            modelId: this.options.model
          });
        }
        this.nextId += 1;
        return;
      }
      this.sendPrompt();
      return;
    }

    if (message.id === this.setModelRequestId) {
      this.sendPrompt();
      return;
    }

    if (message.id === this.promptRequestId) {
      this.finished = true;
      this.options.onComplete(this.output.trim());
    }
  }

  private handlePermissionRequest(message: JsonObject): void {
    const params = asObject(message.params);
    const optionId = choosePermissionOption(params?.options, this.options.permissionMode);
    if (!optionId || (typeof message.id !== 'number' && typeof message.id !== 'string')) {
      this.fail(new Error(
        this.options.permissionMode === 'safe'
          ? 'Kiro requested tool permission that cannot be safely rejected. Enable dangerous permissions only if you trust this task.'
          : 'Kiro requested tool permission without a supported approval option.'
      ));
      return;
    }
    this.options.onWrite({
      jsonrpc: '2.0',
      id: message.id,
      result: { outcome: { outcome: 'selected', optionId } }
    });
  }

  private handleSessionUpdate(message: JsonObject): void {
    const params = asObject(message.params);
    const update = asObject(params?.update);
    if (update?.sessionUpdate !== 'agent_message_chunk') return;
    const content = asObject(update.content);
    const text = typeof content?.text === 'string' ? content.text : '';
    if (!text) return;

    const delta = text.startsWith(this.output) ? text.slice(this.output.length) : text;
    if (!delta) return;
    this.output += delta;
    this.options.onChunk?.(delta);
  }

  private send(id: JsonRpcId, method: string, params: unknown): void {
    this.options.onWrite({ jsonrpc: '2.0', id, method, params });
  }

  private sendPrompt(): void {
    this.promptRequestId = this.nextId;
    this.send(this.nextId, 'session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text: this.options.prompt }]
    });
    this.nextId += 1;
  }

  private fail(error: Error): void {
    if (this.finished) return;
    this.finished = true;
    this.options.onError(error);
  }
}

function terminateProcess(child: ReturnType<typeof spawn>): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, 5000).unref();
}

export function runAcpCli(options: RunAcpCliOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const args = ['acp'];
    if (options.permissionMode === 'dangerous') {
      args.push('--trust-all-tools');
    }
    const child = spawn(options.bin, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let stderr = '';
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;

    const clear = () => {
      if (timeout) clearTimeout(timeout);
      options.executeOptions?.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clear();
      terminateProcess(child);
      reject(error);
    };
    const complete = (output: string) => {
      if (settled) return;
      settled = true;
      clear();
      child.stdin.end();
      const exitTimer = setTimeout(() => terminateProcess(child), 500);
      exitTimer.unref();
      child.once('close', () => clearTimeout(exitTimer));
      resolve(output);
    };
    const protocol = new AcpProtocolSession({
      cwd: options.cwd,
      prompt: options.prompt,
      model: options.model,
      permissionMode: options.permissionMode,
      onWrite: message => child.stdin.write(`${JSON.stringify(message)}\n`),
      onChunk: options.executeOptions?.onChunk,
      onComplete: complete,
      onError: fail
    });
    const onAbort = () => {
      protocol.cancel();
      fail(new Error('Local CLI process was cancelled.'));
    };

    child.stdout.on('data', chunk => protocol.feed(stdoutDecoder.write(chunk)));
    child.stderr.on('data', chunk => {
      stderr += stderrDecoder.write(chunk);
    });
    child.on('error', error => fail(new Error(`Failed to spawn Kiro CLI: ${error.message}`)));
    child.stdin.on('error', error => fail(new Error(`Kiro ACP stdin failed: ${error.message}`)));
    child.on('close', (code, signal) => {
      protocol.feed(stdoutDecoder.end());
      protocol.flush();
      stderr += stderrDecoder.end();
      if (!settled) {
        const detail = stderr.trim();
        fail(new Error(
          `Kiro ACP session exited before completion (code=${code ?? 'null'}, signal=${signal ?? 'none'}).${detail ? `\nError: ${detail}` : ''}`
        ));
      }
    });

    if (options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        protocol.cancel();
        fail(new Error(`Local CLI process timed out after ${Math.round(options.timeoutMs / 1000)} seconds.`));
      }, options.timeoutMs);
    }
    if (options.executeOptions?.signal?.aborted) {
      onAbort();
      return;
    }
    options.executeOptions?.signal?.addEventListener('abort', onAbort, { once: true });
    protocol.start();
  });
}

function normalizeAcpModels(result: JsonObject): AcpModelOption[] {
  const models = asObject(result.models);
  const currentModelId = typeof models?.currentModelId === 'string' ? models.currentModelId : '';
  const availableModels = Array.isArray(models?.availableModels) ? models.availableModels : [];
  const normalized: AcpModelOption[] = [
    { value: 'default', label: 'Default (CLI config)' }
  ];
  const seen = new Set(['default']);

  for (const rawModel of availableModels) {
    const model = asObject(rawModel);
    if (!model) continue;
    const value = [model.modelId, model.id, model.value]
      .find(candidate => typeof candidate === 'string' && candidate.trim()) as string | undefined;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const name = typeof model.name === 'string' && model.name.trim() ? model.name.trim() : value;
    normalized.push({
      value,
      label: `${name}${value === currentModelId ? ' • current' : ''}`
    });
  }

  return normalized;
}

export function detectAcpModels(options: DetectAcpModelsOptions): Promise<AcpModelOption[]> {
  return new Promise<AcpModelOption[]>((resolve, reject) => {
    const child = spawn(options.bin, ['acp'], {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let settled = false;
    const timeoutMs = options.timeoutMs ?? 15000;
    const timer = setTimeout(() => finish(new Error(`Kiro model detection timed out after ${timeoutMs}ms.`)), timeoutMs);

    const finish = (error: Error | null, models?: AcpModelOption[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      terminateProcess(child);
      if (error) reject(error);
      else resolve(models || []);
    };
    const write = (id: number, method: string, params: unknown) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    };
    const handleLine = (line: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      const message = asObject(parsed);
      if (!message) return;
      const error = rpcError(message);
      if (error) {
        finish(error);
      } else if (message.id === 1 && asObject(message.result)) {
        write(2, 'session/new', {
          cwd: options.cwd || process.cwd(),
          mcpServers: []
        });
      } else if (message.id === 2) {
        const result = asObject(message.result);
        if (result) finish(null, normalizeAcpModels(result));
      }
    };

    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(handleLine);
    });
    child.on('error', error => finish(new Error(`Failed to spawn Kiro CLI: ${error.message}`)));
    child.stdin.on('error', error => finish(new Error(`Kiro ACP stdin failed: ${error.message}`)));
    child.on('close', code => {
      buffer += decoder.end();
      if (buffer.trim()) handleLine(buffer);
      if (!settled) finish(new Error(`Kiro model detection exited with code ${code ?? 'null'}.`));
    });

    write(1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { terminal: false },
      clientInfo: { name: 'room', version: 'model-detection' }
    });
  });
}
