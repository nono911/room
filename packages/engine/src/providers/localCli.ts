import { spawn } from 'child_process';
import * as path from 'path';
import { resolveOnPath, resolvePathDirs } from '../agents/detection.js';
import { normalizeLocalCliModelName } from '../agents/localCliPolicy.js';
import type { Provider, ProviderConfig, ProviderExecuteOptions } from './provider.js';
import { runAcpCli } from './acpClient.js';

type VerifiedLocalCliPreset = 'claude' | 'gemini' | 'codex' | 'codewhale' | 'agy' | 'kiro';

export interface LocalCliConfig extends ProviderConfig {
  command?: string;
  cliPreset?: VerifiedLocalCliPreset | 'gemini' | 'copilot' | 'codewhale' | 'agy' | 'kiro' | 'none';
  stdinFormat?: 'text' | 'json';
  permissionMode?: 'safe' | 'dangerous';
  cwd?: string;
  roomRoot: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const PRESET_BINS: Record<VerifiedLocalCliPreset, string> = {
  claude: 'claude',
  gemini: 'gemini',
  codex: 'codex',
  codewhale: 'codewhale',
  agy: 'agy',
  kiro: 'kiro-cli'
};

function isVerifiedPreset(value: LocalCliConfig['cliPreset']): value is VerifiedLocalCliPreset {
  return !!value && Object.prototype.hasOwnProperty.call(PRESET_BINS, value);
}

export class LocalCliProvider implements Provider {
  readonly name = 'Local CLI';
  private readonly preset: VerifiedLocalCliPreset;
  private readonly cwd: string;
  private readonly modelName?: string;
  private readonly timeoutMs: number;

  constructor(config: LocalCliConfig) {
    if (
      config.permissionMode === 'dangerous'
      || !isVerifiedPreset(config.cliPreset)
    ) {
      throw new Error('Local CLI execution requires a verified preset in safe mode.');
    }
    this.preset = config.cliPreset;
    this.cwd = config.cwd || process.cwd();
    this.modelName = normalizeLocalCliModelName(config.modelName);
    this.timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  async execute(
    prompt: string,
    systemInstruction?: string,
    options?: ProviderExecuteOptions
  ): Promise<string> {
    const binaryName = PRESET_BINS[this.preset];
    const binary = resolveOnPath(binaryName);
    if (!binary) throw new Error(`${binaryName} is not available on PATH.`);
    const request = [
      systemInstruction ? `# Instructions\n${systemInstruction}\n\n---\n` : '',
      `# Request\n${prompt}`
    ].join('').trim();
    const environment = {
      ...process.env,
      PATH: resolvePathDirs().join(path.delimiter)
    };

    if (this.preset === 'kiro') {
      return runAcpCli({
        bin: binary,
        cwd: this.cwd,
        env: environment,
        prompt: request,
        model: this.modelName,
        permissionMode: 'safe',
        timeoutMs: options?.timeoutMs ?? this.timeoutMs,
        executeOptions: options
      });
    }

    return new Promise<string>((resolve, reject) => {
      const parsesJsonStream = ['gemini', 'codewhale'].includes(this.preset);
      const child = spawn(binary, this.buildArgs(request), {
        cwd: this.cwd,
        env: environment,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      let streamBuffer = '';
      let settled = false;
      let timeout: NodeJS.Timeout;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        options?.signal?.removeEventListener('abort', onAbort);
        callback();
      };
      const stop = () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      };
      const onAbort = () => {
        stop();
        finish(() => reject(new Error('Local CLI process was cancelled.')));
      };

      timeout = setTimeout(() => {
        stop();
        finish(() => reject(new Error('Local CLI process timed out.')));
      }, options?.timeoutMs ?? this.timeoutMs);
      child.stdout.setEncoding('utf-8');
      child.stderr.setEncoding('utf-8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (!options?.onChunk) return;
        if (!parsesJsonStream) {
          options.onChunk(chunk);
          return;
        }
        streamBuffer += chunk;
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';
        for (const line of lines) {
          const text = this.parseJsonLine(line);
          if (text) options.onChunk(text);
        }
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', error => {
        finish(() => reject(new Error(`Failed to start ${binaryName}: ${error.message}`)));
      });
      child.on('close', code => {
        finish(() => {
          if (code !== 0) {
            reject(new Error(`${binaryName} exited with code ${code}: ${stderr.trim()}`));
          } else if (!stdout.trim()) {
            reject(new Error(`${binaryName} returned no output.`));
          } else {
            resolve(parsesJsonStream ? this.parseJsonStream(stdout) || stdout.trim() : stdout.trim());
          }
        });
      });

      if (options?.signal?.aborted) {
        onAbort();
        return;
      }
      options?.signal?.addEventListener('abort', onAbort, { once: true });
      child.stdin.end(this.preset === 'codewhale' || this.preset === 'agy' ? '' : request);
    });
  }

  private buildArgs(request: string): string[] {
    if (this.preset === 'claude') {
      return [
        '-p',
        '--output-format',
        'text',
        '--permission-mode',
        'plan',
        '--tools',
        'Read,Grep,Glob,LS,WebSearch,WebFetch',
        ...(this.modelName ? ['--model', this.modelName] : [])
      ];
    }
    if (this.preset === 'gemini') {
      return [
        '--output-format',
        'stream-json',
        '--approval-mode',
        'plan',
        ...(this.modelName ? ['--model', this.modelName] : [])
      ];
    }
    if (this.preset === 'codex') {
      return [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        ...(this.modelName ? ['--model', this.modelName] : [])
      ];
    }
    if (this.preset === 'codewhale') {
      return [
        'exec',
        '--output-format',
        'stream-json',
        ...(this.modelName ? ['--model', this.modelName] : []),
        request
      ];
    }
    return [
      '--print',
      '--sandbox',
      ...(this.modelName ? ['--model', this.modelName] : []),
      request
    ];
  }

  private parseJsonStream(output: string): string {
    return output
      .split('\n')
      .map(line => this.parseJsonLine(line))
      .join('')
      .trim();
  }

  private parseJsonLine(line: string): string {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      for (const key of ['text_delta', 'message_delta', 'text', 'content']) {
        if (typeof parsed[key] === 'string') return parsed[key];
      }
      const message = parsed.message;
      if (message && typeof message === 'object') {
        const record = message as Record<string, unknown>;
        if (typeof record.content === 'string') return record.content;
        if (typeof record.text === 'string') return record.text;
      }
    } catch {}
    return '';
  }
}
