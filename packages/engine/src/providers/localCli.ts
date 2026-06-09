import { spawn } from 'child_process';
import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Provider, ProviderConfig, ProviderExecuteOptions } from './provider.js';
import { resolveOnPath, resolvePathDirs } from '../agents/detection.js';
import { normalizeLocalCliModelName } from '../agents/localCliPolicy.js';
import { parseShellArgs } from '../shellArgs.js';

type LocalCliPermissionMode = 'safe' | 'dangerous';
const DEFAULT_LOCAL_CLI_TIMEOUT_MS = 10 * 60 * 1000;

export interface LocalCliConfig extends ProviderConfig {
  command?: string;
  cliPreset?: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none';
  stdinFormat?: 'text' | 'json';
  permissionMode?: LocalCliPermissionMode;
  cwd?: string;
  timeoutMs?: number;
}

export class LocalCliProvider implements Provider {
  private static claudeMcpLocks = new Map<string, Promise<void>>();

  name = 'Local CLI';
  private command: string;
  private cliPreset: 'claude' | 'gemini' | 'codex' | 'copilot' | 'codewhale' | 'agy' | 'none';
  private stdinFormat: 'text' | 'json';
  private cwd: string;
  private modelName: string;
  private permissionMode: LocalCliPermissionMode;
  private timeoutMs: number;

  constructor(config: LocalCliConfig) {
    this.command = config.command || '';
    this.cliPreset = config.cliPreset || 'none';
    this.stdinFormat = config.stdinFormat || 'text';
    this.cwd = config.cwd || process.cwd();
    this.modelName = normalizeLocalCliModelName(config.modelName) || '';
    this.permissionMode = config.permissionMode || 'safe';
    this.timeoutMs = config.timeoutMs || DEFAULT_LOCAL_CLI_TIMEOUT_MS;
  }

  async execute(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string> {
    if (this.cliPreset === 'claude') {
      return LocalCliProvider.withClaudeMcpLock(this.cwd, () => this.executeInternal(prompt, systemInstruction, options));
    }

    return this.executeInternal(prompt, systemInstruction, options);
  }

  private static async withClaudeMcpLock<T>(cwd: string, run: () => Promise<T>): Promise<T> {
    const key = path.resolve(cwd);
    const previous = LocalCliProvider.claudeMcpLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    LocalCliProvider.claudeMcpLocks.set(key, queued);

    await previous;
    try {
      return await run();
    } finally {
      release();
      if (LocalCliProvider.claudeMcpLocks.get(key) === queued) {
        LocalCliProvider.claudeMcpLocks.delete(key);
      }
    }
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private async readRoomMcpOwner(ownerPath: string): Promise<{ ownerId?: string; contentHash?: string } | null> {
    try {
      return JSON.parse(await fs.readFile(ownerPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private async executeInternal(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
      let bin = '';
      let args: string[] = [];
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: resolvePathDirs().join(path.delimiter)
      };

      let wroteMcp = false;
      let publishedTargetMcp = false;
      let mcpOwnerId = '';
      let mcpContentHash = '';
      let previousMcpContent: string | null = null;
      const mcpConfigPath = path.join(this.cwd, '.room', 'mcp.json');
      const targetMcpPath = path.join(this.cwd, '.mcp.json');
      const ownerMcpPath = path.join(this.cwd, '.mcp.json.room-owner');

      const restorePublishedMcp = async () => {
        if (!publishedTargetMcp) {
          return;
        }
        try {
          const currentContent = await fs.readFile(targetMcpPath, 'utf-8');
          if (this.hashContent(currentContent) !== mcpContentHash) {
            console.warn(`[Local CLI Provider] Skipped partial .mcp.json cleanup because target content changed at ${targetMcpPath}`);
            return;
          }
          if (previousMcpContent !== null) {
            await fs.writeFile(targetMcpPath, previousMcpContent, 'utf-8');
          } else {
            await fs.unlink(targetMcpPath);
          }
        } catch {
          // Ignore partial cleanup error
        } finally {
          await fs.unlink(ownerMcpPath).catch(() => {});
        }
      };

      if (this.cliPreset === 'claude') {
        let tempMcpPath = '';
        let tempOwnerPath = '';
        try {
          const content = await fs.readFile(mcpConfigPath, 'utf-8');
          const parsed = JSON.parse(content);
          if (parsed && parsed.mcpServers && Object.keys(parsed.mcpServers).length > 0) {
            try {
              const existing = await fs.readFile(targetMcpPath, 'utf-8');
              const existingOwner = await this.readRoomMcpOwner(ownerMcpPath);
              const existingHash = this.hashContent(existing);
              previousMcpContent = existingOwner?.contentHash === existingHash ? null : existing;
            } catch {
              previousMcpContent = null;
            }
            mcpOwnerId = `room-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const managedContent = JSON.stringify(parsed, null, 2);
            mcpContentHash = this.hashContent(managedContent);
            tempMcpPath = path.join(this.cwd, `.mcp.room-${mcpOwnerId}.json`);
            tempOwnerPath = path.join(this.cwd, `.mcp.room-${mcpOwnerId}.owner`);
            await fs.writeFile(tempMcpPath, managedContent, 'utf-8');
            await fs.writeFile(tempOwnerPath, JSON.stringify({
              ownerId: mcpOwnerId,
              contentHash: mcpContentHash,
              createdAt: new Date().toISOString()
            }, null, 2), 'utf-8');
            await fs.rename(tempMcpPath, targetMcpPath);
            publishedTargetMcp = true;
            await fs.rename(tempOwnerPath, ownerMcpPath);
            wroteMcp = true;
            console.log(`[Local CLI Provider] Dynamically wrote .mcp.json at ${targetMcpPath}`);
          }
        } catch (err) {
          await fs.unlink(tempMcpPath).catch(() => {});
          await fs.unlink(tempOwnerPath).catch(() => {});
          await restorePublishedMcp();
        }
      }

      const cleanup = async () => {
        if (wroteMcp) {
          try {
            const currentContent = await fs.readFile(targetMcpPath, 'utf-8');
            const currentOwner = await this.readRoomMcpOwner(ownerMcpPath);
            if (
              currentOwner?.ownerId !== mcpOwnerId ||
              currentOwner?.contentHash !== mcpContentHash ||
              this.hashContent(currentContent) !== mcpContentHash
            ) {
              console.warn(`[Local CLI Provider] Skipped .mcp.json cleanup because ownership marker changed at ${targetMcpPath}`);
              return;
            }
            await restorePublishedMcp();
            if (previousMcpContent !== null) {
              console.log(`[Local CLI Provider] Restored existing .mcp.json at ${targetMcpPath}`);
            } else {
              console.log(`[Local CLI Provider] Cleaned up dynamic .mcp.json at ${targetMcpPath}`);
            }
          } catch (err) {
            // Ignore clean up error
          }
        }
      };

      // Configure presets
      if (this.cliPreset && this.cliPreset !== 'none') {
        const resolvedPath = resolveOnPath(this.cliPreset);
        bin = resolvedPath || this.cliPreset;

        if (this.cliPreset === 'claude') {
          args = ['-p', '--output-format', 'stream-json'];
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
          await cleanup();
          reject(new Error('Local CLI command or preset is not configured.'));
          return;
        }
        let parts: string[];
        try {
          parts = parseShellArgs(this.command.trim());
        } catch (err: any) {
          await cleanup();
          reject(new Error(`Invalid Local CLI command: ${err.message}`));
          return;
        }
        if (parts.length === 0) {
          await cleanup();
          reject(new Error('Local CLI command is empty.'));
          return;
        }
        bin = parts[0];
        args = parts.slice(1);
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
      const shouldParseJsonStream = !!this.cliPreset && this.cliPreset !== 'none' && ['claude', 'gemini', 'codex', 'copilot', 'codewhale'].includes(this.cliPreset);

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
        await cleanup();
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
        const text = chunk.toString();
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
      });

      cp.stderr.on('data', (chunk) => {
        stderrData += chunk;
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
        await cleanup();
        if (code !== 0 && code !== null) {
          const stderr = stderrData.trim();
          const stdout = stdoutData.trim();
          const details = [
            stderr ? `Error: ${stderr}` : '',
            stdout ? `Stdout: ${stdout}` : ''
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
        await cleanup();
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
      } else if (parsed.type === 'thinking_delta' && typeof parsed.text === 'string') {
        return '';
      }
      
      // Gemini / Qwen CLI / CodeWhale JSON events
      else if (parsed.text_delta && typeof parsed.text_delta === 'string') {
        return parsed.text_delta;
      } else if (parsed.content && typeof parsed.content === 'string' && parsed.type !== 'session_capture') {
        return parsed.content;
      }

      // Copilot JSON events
      else if (parsed.message_delta && typeof parsed.message_delta === 'string') {
        return parsed.message_delta;
      }
      else if (parsed.type === 'assistant' && parsed.content && typeof parsed.content === 'string') {
        return parsed.content;
      }
    } catch {
      // Line is not valid JSON, ignore
    }

    return '';
  }
}
