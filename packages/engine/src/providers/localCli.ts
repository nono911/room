import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Provider, ProviderConfig, ProviderExecuteOptions } from './provider.js';
import { applyReadOnlyToolArgs, resolveToolAccess } from './toolAccess.js';
import { resolveOnPath, resolvePathDirs } from '../agents/detection.js';
import { normalizeLocalCliModelName } from '../agents/localCliPolicy.js';
import { parseShellArgs } from '../shellArgs.js';
import { runAcpCli } from './acpClient.js';

type LocalCliPermissionMode = 'safe' | 'dangerous';
const DEFAULT_LOCAL_CLI_TIMEOUT_MS = 10 * 60 * 1000;

export interface LocalCliConfig extends ProviderConfig {
  command?: string;
  cliPreset?: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'kiro' | 'none';
  stdinFormat?: 'text' | 'json';
  permissionMode?: LocalCliPermissionMode;
  cwd?: string;
  roomRoot?: string;
  timeoutMs?: number;
}

export class LocalCliProvider implements Provider {
  name = 'Local CLI';
  private command: string;
  private cliPreset: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'kiro' | 'none';
  private stdinFormat: 'text' | 'json';
  private cwd: string;
  private roomRoot: string;
  private modelName: string;
  private permissionMode: LocalCliPermissionMode;
  private timeoutMs: number;

  constructor(config: LocalCliConfig) {
    this.command = config.command || '';
    this.cliPreset = config.cliPreset || 'none';
    this.stdinFormat = config.stdinFormat || 'text';
    this.cwd = config.cwd || process.cwd();
    this.roomRoot = config.roomRoot || path.join(this.cwd, '.room');
    this.modelName = normalizeLocalCliModelName(config.modelName) || '';
    this.permissionMode = config.permissionMode || 'safe';
    this.timeoutMs = config.timeoutMs || DEFAULT_LOCAL_CLI_TIMEOUT_MS;
  }

  async execute(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string> {
    return this.executeInternal(prompt, systemInstruction, options);
  }

  private async executeInternal(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      let bin = '';
      let args: string[] = [];
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: resolvePathDirs().join(path.delimiter)
      };

      if (this.cliPreset === 'kiro') {
        const composedPrompt = [
          systemInstruction ? `# Instructions\n${systemInstruction}\n\n---\n` : '',
          `# Request\n${prompt}`
        ].join('').trim();
        const kiroBin = resolveOnPath('kiro-cli') || 'kiro-cli';
        runAcpCli({
          bin: kiroBin,
          cwd: this.cwd,
          env,
          prompt: composedPrompt,
          model: this.modelName,
          permissionMode: this.permissionMode,
          timeoutMs: options?.timeoutMs ?? this.timeoutMs,
          executeOptions: options
        }).then(resolve, reject);
        return;
      }

      const toolAccess = resolveToolAccess(options?.toolAccess, this.permissionMode);
      const mcpConfigPath = path.join(this.roomRoot, 'mcp.json');
      let hasRoomMcpConfig = false;

      if (this.cliPreset === 'claude') {
        try {
          const content = await fs.readFile(mcpConfigPath, 'utf-8');
          const parsed = JSON.parse(content) as { mcpServers?: Record<string, unknown> };
          hasRoomMcpConfig = Object.keys(parsed.mcpServers || {}).length > 0;
        } catch {
          hasRoomMcpConfig = false;
        }
      }

      // Configure presets
      if (this.cliPreset && this.cliPreset !== 'none') {
        const resolvedPath = resolveOnPath(this.cliPreset);
        bin = resolvedPath || this.cliPreset;

        if (this.cliPreset === 'claude') {
          args = ['-p', '--output-format', 'stream-json', '--verbose'];
          if (hasRoomMcpConfig) {
            args.push('--mcp-config', mcpConfigPath);
          }
          if (this.permissionMode === 'dangerous') {
            args.push('--permission-mode', 'bypassPermissions');
          }
          if (this.modelName) args.push('--model', this.modelName);
        } else if (this.cliPreset === 'gemini') {
          args = ['--output-format', 'stream-json'];
          if (this.permissionMode === 'dangerous') {
            args.push('--yolo');
          }
          if (this.modelName) args.push('--model', this.modelName);
          if (this.permissionMode === 'dangerous') {
            env.GEMINI_CLI_TRUST_WORKSPACE = 'true';
          }
        } else if (this.cliPreset === 'codex') {
          args = [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '--sandbox',
            'workspace-write'
          ];
          if (this.permissionMode === 'dangerous') {
            args.push('-c', 'sandbox_workspace_write.network_access=true');
          }
          if (this.modelName) args.push('--model', this.modelName);
        } else if (this.cliPreset === 'copilot') {
          args = ['--output-format', 'json'];
          if (this.permissionMode === 'dangerous') {
            args.unshift('--allow-all-tools');
          }
          if (this.modelName) args.push('--model', this.modelName);
        } else if (this.cliPreset === 'codewhale') {
          args = ['exec', '--output-format', 'stream-json'];
          if (this.permissionMode === 'dangerous') {
            args.push('--auto');
          }
          if (this.modelName) args.push('--model', this.modelName);
          const composedPrompt = [
            systemInstruction ? `# Instructions\n${systemInstruction}\n\n---\n` : '',
            `# Request\n${prompt}`
          ].join('').trim();
          args.push(composedPrompt);
        } else if (this.cliPreset === 'agy') {
          args = ['--print'];
          if (this.permissionMode === 'dangerous') {
            args.unshift('--dangerously-skip-permissions');
          }
          if (this.modelName) args.push('--model', this.modelName);
          const composedPrompt = [
            systemInstruction ? `# Instructions\n${systemInstruction}\n\n---\n` : '',
            `# Request\n${prompt}`
          ].join('').trim();
          args.push(composedPrompt);
        }
      } else {
        // Fallback to custom command parsing
        if (!this.command) {
          reject(new Error('Local CLI command or preset is not configured.'));
          return;
        }
        let parts: string[];
        try {
          parts = parseShellArgs(this.command.trim());
        } catch (err: any) {
          reject(new Error(`Invalid Local CLI command: ${err.message}`));
          return;
        }
        if (parts.length === 0) {
          reject(new Error('Local CLI command is empty.'));
          return;
        }
        bin = parts[0];
        args = parts.slice(1);
      }

      if (toolAccess === 'read-only' && this.cliPreset !== 'none') {
        args = applyReadOnlyToolArgs(this.cliPreset, args, []);
      }

      console.log(`[Local CLI Provider] Spawning binary: ${bin} with args: ${args.join(' ')}`);

      const cp = spawn(bin, args, {
        cwd: this.cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let settled = false;
      let timeout: NodeJS.Timeout | null = null;
      let stdoutData = '';
      let stderrData = '';
      let stdoutLineBuffer = '';
      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      const shouldParseJsonStream = !!this.cliPreset && this.cliPreset !== 'none' && ['claude', 'gemini', 'codex', 'copilot', 'codewhale'].includes(this.cliPreset);

      const handleStdoutText = (text: string) => {
        if (!text) return;
        stdoutData += text;

        if (!options?.onChunk) {
          return;
        }

        if (!shouldParseJsonStream) {
          options.onChunk(text);
          return;
        }

        stdoutLineBuffer += text;
        const lines = stdoutLineBuffer.split('\n');
        stdoutLineBuffer = lines.pop() || '';

        for (const line of lines) {
          const parsedText = this.parseJsonLine(line);
          if (parsedText) {
            options.onChunk(parsedText);
          }
        }
      };

      const stopProcess = () => {
        if (cp.exitCode === null && cp.signalCode === null) {
          cp.kill('SIGTERM');
          setTimeout(() => {
            if (cp.exitCode === null && cp.signalCode === null) {
              cp.kill('SIGKILL');
            }
          }, 5000).unref();
        }
      };

      const fail = async (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        options?.signal?.removeEventListener('abort', onAbort);
        stopProcess();
        reject(error);
      };

      const onAbort = () => {
        void fail(new Error('Local CLI process was cancelled.'));
      };

      const effectiveTimeoutMs = options?.timeoutMs ?? this.timeoutMs;
      if (effectiveTimeoutMs > 0) {
        timeout = setTimeout(() => {
          void fail(new Error(`Local CLI process timed out after ${Math.round(effectiveTimeoutMs / 1000)} seconds.`));
        }, effectiveTimeoutMs);
      }

      if (options?.signal?.aborted) {
        void fail(new Error('Local CLI process was cancelled.'));
        return;
      }
      options?.signal?.addEventListener('abort', onAbort, { once: true });
      
      cp.stdout.on('data', (chunk) => {
        handleStdoutText(stdoutDecoder.write(chunk));
      });

      cp.stderr.on('data', (chunk) => {
        stderrData += stderrDecoder.write(chunk);
      });

      cp.on('error', (err) => {
        void fail(new Error(`Failed to spawn CLI process: ${err.message}`));
      });

      cp.on('close', async (code) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        options?.signal?.removeEventListener('abort', onAbort);
        console.log(`[Local CLI Provider] Process exited with code ${code}`);
        handleStdoutText(stdoutDecoder.end());
        stderrData += stderrDecoder.end();
        if (code !== 0 && code !== null) {
          const stderr = stderrData.trim();
          const stdout = stdoutData.trim();
          const readableStdout = shouldParseJsonStream ? this.parseJsonStream(stdout) : stdout;
          const details = [
            stderr ? `Error: ${stderr}` : '',
            readableStdout ? `Agent output:\n${readableStdout}` : ''
          ].filter(Boolean).join('\n');
          reject(new Error(`Local CLI exited with code ${code}.${details ? `\n${details}` : ''}`));
          return;
        }

        // Process outputs
        const output = stdoutData.trim();
        if (this.cliPreset && this.cliPreset !== 'none') {
          if (shouldParseJsonStream) {
            if (options?.onChunk && stdoutLineBuffer.trim()) {
              const parsedRemainder = this.parseJsonLine(stdoutLineBuffer);
              if (parsedRemainder) {
                options.onChunk(parsedRemainder);
              }
            }
            const parsedText = this.parseJsonStream(output);
            resolve(parsedText || output);
          } else {
            resolve(output);
          }
        } else {
          resolve(output);
        }
      });

      // Write payload to stdin
      if (cp.stdin) {
        if (this.cliPreset === 'codewhale' || this.cliPreset === 'agy') {
          cp.stdin.end();
        } else {
          let payload = '';
          if (this.cliPreset && this.cliPreset !== 'none' || this.stdinFormat === 'text') {
            // Plain text format: instructions first, then the prompt
            payload = [
              systemInstruction ? `# Instructions\n${systemInstruction}\n\n---\n` : '',
              `# Request\n${prompt}`
            ].join('').trim();
          } else {
            // JSON payload format
            payload = JSON.stringify({
              prompt,
              systemInstruction: systemInstruction || ''
            });
          }

          cp.stdin.write(payload);
          cp.stdin.end();
        }
      } else {
        reject(new Error('Failed to open stdin for the Local CLI process.'));
      }
    });
  }

  private parseJsonStream(stdout: string): string {
    const lines = stdout.split('\n');
    let accumulatedText = '';

    for (const line of lines) {
      accumulatedText += this.parseJsonLine(line);
    }

    return accumulatedText.trim();
  }

  private parseJsonLine(line: string): string {
    const trimmed = line.trim();
    if (!trimmed) return '';

    const startIdx = trimmed.indexOf('{');
    const endIdx = trimmed.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      return '';
    }

    const jsonStr = trimmed.slice(startIdx, endIdx + 1);

    try {
      const parsed = JSON.parse(jsonStr);
      
      // Claude Code JSON events
      if (parsed.type === 'text_delta' && typeof parsed.text === 'string') {
        return parsed.text;
      }
      if (parsed.type === 'thinking_delta' && typeof parsed.text === 'string') {
        return '';
      }

      // Codex / structured CLI error events
      if (parsed.type === 'error') {
        return this.formatJsonError(parsed.message || parsed.error);
      }
      if (parsed.type === 'turn.failed') {
        return this.formatJsonError(parsed.error);
      }
      if (parsed.type === 'content' && typeof parsed.content === 'string') {
        return parsed.content;
      }

      const assistantText = this.extractAssistantText(parsed)
        || (parsed.message && typeof parsed.message === 'object'
          ? this.extractAssistantText(parsed.message as Record<string, unknown>)
          : '');
      if (assistantText) {
        return assistantText;
      }
      
      // Gemini / Qwen CLI / CodeWhale JSON events
      if (parsed.text_delta && typeof parsed.text_delta === 'string') {
        return parsed.text_delta;
      }

      // Copilot JSON events
      if (parsed.message_delta && typeof parsed.message_delta === 'string') {
        return parsed.message_delta;
      }
    } catch {
      // Line is not valid JSON, ignore
    }

    return '';
  }

  private formatJsonError(rawError: unknown): string {
    if (!rawError) return '';

    if (typeof rawError === 'string') {
      const trimmed = rawError.trim();
      if (!trimmed) return '';
      try {
        const parsed = JSON.parse(trimmed);
        return this.formatJsonError(parsed) || trimmed;
      } catch {
        return trimmed;
      }
    }

    if (typeof rawError !== 'object') {
      return String(rawError);
    }

    const errorRecord = rawError as Record<string, unknown>;
    const nestedError = errorRecord.error;
    if (nestedError && typeof nestedError === 'object') {
      const nestedRecord = nestedError as Record<string, unknown>;
      if (typeof nestedRecord.message === 'string') {
        return nestedRecord.message.trim();
      }
      const nestedFormatted = this.formatJsonError(nestedError);
      if (nestedFormatted) return nestedFormatted;
    }

    if (typeof errorRecord.message === 'string') {
      return errorRecord.message.trim();
    }

    return '';
  }

  private extractAssistantText(parsed: Record<string, unknown>): string {
    const item = parsed.item && typeof parsed.item === 'object'
      ? parsed.item as Record<string, unknown>
      : parsed;
    const role = typeof item.role === 'string' ? item.role : typeof parsed.role === 'string' ? parsed.role : '';
    const type = typeof item.type === 'string' ? item.type : typeof parsed.type === 'string' ? parsed.type : '';
    const isAssistantMessage = role === 'assistant'
      || type === 'assistant'
      || type === 'message'
      || type === 'message_delta'
      || type === 'agent_message';
    if (!isAssistantMessage) return '';

    const content = item.content ?? parsed.content;
    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      const text = item.text ?? parsed.text;
      return typeof text === 'string' ? text : '';
    }

    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const partRecord = part as Record<string, unknown>;
        if (typeof partRecord.text === 'string') return partRecord.text;
        if (typeof partRecord.content === 'string') return partRecord.content;
        return '';
      })
      .join('');
  }
}
