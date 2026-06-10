# Provider Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure any OpenAI-compatible AI provider (plus the existing Gemini/Anthropic natives) from Settings, including presets (Groq, OpenRouter, Ollama, …) and fully custom endpoints.

**Architecture:** A provider registry (`providers.json` in Electron userData) replaces the three fixed API key fields. The engine gains a generic `OpenAICompatibleProvider` and resolves `AgentConfig.provider` (now a string id) through the registry with env-var fallback. Legacy provider names (`Gemini`/`Claude`/`Codex`) are normalized at validation time so existing member files keep working.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import extensions in engine), Electron IPC, React (single-file `App.tsx`, inline styles), Vitest (engine only).

**Spec:** `docs/superpowers/specs/2026-06-10-provider-registry-design.md`

**Conventions for this repo:** 2-space indent, single quotes, semicolons. Engine tests live next to source as `*.test.ts`. Run engine tests with `npm test -w packages/engine`. Desktop has no test runner — validate with `cd packages/desktop && npx tsc --noEmit` (NOTE: two pre-existing errors in `renderer/src/App.tsx` lines ~2123 and ~4917 are NOT yours; any other error is). Commit after every task.

## File Structure

```text
packages/engine/src/providers/
  openaiCompatible.ts        (create)  Generic OpenAI-compatible provider
  openaiCompatible.test.ts   (create)
  codex.ts                   (rewrite) Thin subclass pinned to api.openai.com
  registry.ts                (create)  ProviderEntry type, built-ins, presets, normalization, resolveApiProvider
  registry.test.ts           (create)
  index.ts                   (modify)  Export new modules
packages/engine/src/agents/
  registry.ts                (modify)  AgentConfig.provider: string + normalization
  registry.test.ts           (create)
packages/engine/src/discussion/
  engine.ts                  (modify)  Constructor option + getProvider delegation
packages/desktop/main/
  main.ts                    (modify)  providers.json store, migration, IPC, engine wiring
  preload.js                 (modify)  New bridge methods
packages/desktop/renderer/src/
  App.tsx                    (modify)  "AI Providers" settings section, dynamic member dropdown
```

---

### Task 1: Engine — `OpenAICompatibleProvider`

**Files:**
- Create: `packages/engine/src/providers/openaiCompatible.ts`
- Create: `packages/engine/src/providers/openaiCompatible.test.ts`
- Rewrite: `packages/engine/src/providers/codex.ts`
- Modify: `packages/engine/src/providers/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/providers/openaiCompatible.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleProvider, joinBaseUrl } from './openaiCompatible.js';

const okResponse = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] })
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(okResponse('hello'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('joinBaseUrl', () => {
  it('joins paths and tolerates trailing slashes', () => {
    expect(joinBaseUrl('https://api.groq.com/openai/v1', '/chat/completions'))
      .toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(joinBaseUrl('https://api.groq.com/openai/v1/', '/chat/completions'))
      .toBe('https://api.groq.com/openai/v1/chat/completions');
  });
});

describe('OpenAICompatibleProvider', () => {
  it('requires a baseUrl', () => {
    expect(() => new OpenAICompatibleProvider({ baseUrl: '', providerLabel: 'Groq' }))
      .toThrow('Groq: baseUrl is required.');
  });

  it('sends Authorization header only when a key is present', async () => {
    const keyed = new OpenAICompatibleProvider({
      baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'sk-test', modelName: 'llama-3.3-70b', providerLabel: 'Groq'
    });
    await keyed.execute('hi');
    const [, keyedInit] = fetchMock.mock.calls[0];
    expect(keyedInit.headers['Authorization']).toBe('Bearer sk-test');

    const keyless = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1', modelName: 'llama3', providerLabel: 'Ollama'
    });
    await keyless.execute('hi');
    const [, keylessInit] = fetchMock.mock.calls[1];
    expect(keylessInit.headers['Authorization']).toBeUndefined();
  });

  it('calls {baseUrl}/chat/completions with model and messages', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1/', modelName: 'llama3', providerLabel: 'Ollama'
    });
    const result = await provider.execute('prompt text', 'system text');
    expect(result).toBe('hello');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    const payload = JSON.parse(init.body);
    expect(payload.model).toBe('llama3');
    expect(payload.messages).toEqual([
      { role: 'system', content: 'system text' },
      { role: 'user', content: 'prompt text' }
    ]);
  });

  it('prefixes errors with the provider label', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' });
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'sk-bad', modelName: 'llama-3.3-70b', providerLabel: 'Groq'
    });
    await expect(provider.execute('hi')).rejects.toThrow('Groq API call failed with status 401: bad key');
  });

  it('treats modelName "default" as unset and falls back to gpt-4o', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', modelName: 'Default'
    });
    await provider.execute('hi');
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.model).toBe('gpt-4o');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w packages/engine -- openaiCompatible`
Expected: FAIL — cannot resolve `./openaiCompatible.js`.

- [ ] **Step 3: Implement the provider**

Create `packages/engine/src/providers/openaiCompatible.ts`:

```ts
import { Provider, ProviderExecuteOptions } from './provider.js';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  modelName?: string;
  providerLabel?: string;
}

export function joinBaseUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

function normalizeModelName(modelName?: string): string | undefined {
  const normalized = (modelName || '').trim();
  return normalized.toLowerCase() === 'default' ? undefined : normalized || undefined;
}

export class OpenAICompatibleProvider implements Provider {
  name: string;
  private baseUrl: string;
  private apiKey?: string;
  private modelName: string;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.providerLabel || 'OpenAI';
    const baseUrl = (config.baseUrl || '').trim();
    if (!baseUrl) {
      throw new Error(`${this.name}: baseUrl is required.`);
    }
    this.baseUrl = baseUrl;
    this.apiKey = (config.apiKey || '').trim() || undefined;
    this.modelName = normalizeModelName(config.modelName) || 'gpt-4o';
  }

  async execute(prompt: string, systemInstruction?: string, options?: ProviderExecuteOptions): Promise<string> {
    const url = joinBaseUrl(this.baseUrl, '/chat/completions');

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.modelName, messages, temperature: 0.2 })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${this.name} API call failed with status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    try {
      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error(`Empty response from ${this.name} API.`);
      }
      options?.onChunk?.(text);
      return text;
    } catch (err: any) {
      throw new Error(`Failed to parse ${this.name} API response: ${err.message}. Raw: ${JSON.stringify(data)}`);
    }
  }
}
```

- [ ] **Step 4: Rewrite `codex.ts` as a thin subclass (back-compat)**

Replace the entire contents of `packages/engine/src/providers/codex.ts` with:

```ts
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
```

Note: the old `CodexProvider` threw `'OpenAI API key ... is required'` at execute-time when keyless. The subclass now sends a keyless request that fails with the HTTP error instead. This is acceptable — `detectProviders()` only constructs it when the env key exists.

- [ ] **Step 5: Export the new module**

In `packages/engine/src/providers/index.ts`, after the line `export * from './codex.js';` add:

```ts
export * from './openaiCompatible.js';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w packages/engine -- openaiCompatible` → PASS (all 5 tests).
Run: `cd packages/engine && npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/providers/openaiCompatible.ts packages/engine/src/providers/openaiCompatible.test.ts packages/engine/src/providers/codex.ts packages/engine/src/providers/index.ts
git commit -m "feat(engine): add generic OpenAI-compatible provider"
```

---

### Task 2: Engine — provider registry module

**Files:**
- Create: `packages/engine/src/providers/registry.ts`
- Create: `packages/engine/src/providers/registry.test.ts`
- Modify: `packages/engine/src/providers/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/providers/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizeProviderId,
  isValidProviderId,
  builtInProviderEntries,
  PROVIDER_PRESETS,
  resolveApiProvider
} from './registry.js';
import { GeminiProvider } from './gemini.js';
import { ClaudeProvider } from './claude.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';

describe('normalizeProviderId', () => {
  it('maps legacy display names to registry ids', () => {
    expect(normalizeProviderId('Gemini')).toBe('gemini');
    expect(normalizeProviderId('Claude')).toBe('anthropic');
    expect(normalizeProviderId('Codex')).toBe('openai');
    expect(normalizeProviderId('groq')).toBe('groq');
  });
});

describe('isValidProviderId', () => {
  it('accepts lowercase slugs and rejects everything else', () => {
    expect(isValidProviderId('groq')).toBe(true);
    expect(isValidProviderId('my-proxy-2')).toBe(true);
    expect(isValidProviderId('My Proxy')).toBe(false);
    expect(isValidProviderId('-bad')).toBe(false);
    expect(isValidProviderId('')).toBe(false);
  });
});

describe('builtInProviderEntries', () => {
  it('creates gemini, anthropic and openai entries with optional keys', () => {
    const entries = builtInProviderEntries({ anthropicApiKey: 'sk-ant' });
    expect(entries.map(e => e.id)).toEqual(['gemini', 'anthropic', 'openai']);
    expect(entries.every(e => e.builtIn)).toBe(true);
    expect(entries.find(e => e.id === 'anthropic')?.apiKey).toBe('sk-ant');
    expect(entries.find(e => e.id === 'openai')?.baseUrl).toBe('https://api.openai.com/v1');
  });
});

describe('PROVIDER_PRESETS', () => {
  it('includes the agreed presets with openai-compatible base URLs', () => {
    const ids = PROVIDER_PRESETS.map(p => p.id);
    for (const id of ['groq', 'openrouter', 'mistral', 'deepseek', 'xai', 'together', 'ollama', 'lmstudio']) {
      expect(ids).toContain(id);
    }
    expect(PROVIDER_PRESETS.every(p => p.kind === 'openai-compatible' && p.baseUrl.startsWith('http'))).toBe(true);
  });
});

describe('resolveApiProvider', () => {
  const registry = [
    ...builtInProviderEntries({}),
    { id: 'groq', label: 'Groq', kind: 'openai-compatible' as const, baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'gsk-x' }
  ];

  it('resolves registry entries by id and by legacy name', () => {
    expect(resolveApiProvider(registry, 'groq', 'llama-3.3-70b')).toBeInstanceOf(OpenAICompatibleProvider);
    expect(resolveApiProvider(registry, 'Claude')).toBeInstanceOf(ClaudeProvider);
    expect(resolveApiProvider(registry, 'gemini')).toBeInstanceOf(GeminiProvider);
  });

  it('labels openai-compatible providers with the entry label', () => {
    const provider = resolveApiProvider(registry, 'groq');
    expect(provider.name).toBe('Groq');
  });

  it('falls back to env-style providers without a registry', () => {
    expect(resolveApiProvider(undefined, 'Claude')).toBeInstanceOf(ClaudeProvider);
    expect(resolveApiProvider(undefined, 'Codex').name).toBe('Codex');
    expect(resolveApiProvider(undefined, 'unknown-id')).toBeInstanceOf(GeminiProvider);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w packages/engine -- src/providers/registry`
Expected: FAIL — cannot resolve `./registry.js`.

- [ ] **Step 3: Implement the registry module**

Create `packages/engine/src/providers/registry.ts`:

```ts
import { Provider } from './provider.js';
import { GeminiProvider } from './gemini.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';

export type ProviderKind = 'gemini' | 'anthropic' | 'openai-compatible';

export interface ProviderEntry {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  builtIn?: boolean;
}

export interface ProviderPreset {
  id: string;
  label: string;
  kind: 'openai-compatible';
  baseUrl: string;
  keyless?: boolean;
}

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const LEGACY_PROVIDER_IDS: Record<string, string> = {
  Gemini: 'gemini',
  Claude: 'anthropic',
  Codex: 'openai'
};

export function normalizeProviderId(value: string): string {
  return LEGACY_PROVIDER_IDS[value] || value;
}

export function isValidProviderId(value: string): boolean {
  return PROVIDER_ID_PATTERN.test(value);
}

export function builtInProviderEntries(keys: {
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
} = {}): ProviderEntry[] {
  return [
    { id: 'gemini', label: 'Gemini (Google)', kind: 'gemini', builtIn: true, ...(keys.geminiApiKey ? { apiKey: keys.geminiApiKey } : {}) },
    { id: 'anthropic', label: 'Claude (Anthropic)', kind: 'anthropic', builtIn: true, ...(keys.anthropicApiKey ? { apiKey: keys.anthropicApiKey } : {}) },
    { id: 'openai', label: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', builtIn: true, ...(keys.openaiApiKey ? { apiKey: keys.openaiApiKey } : {}) }
  ];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'groq', label: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'mistral', label: 'Mistral', kind: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai-compatible', baseUrl: 'https://api.x.ai/v1' },
  { id: 'together', label: 'Together AI', kind: 'openai-compatible', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'ollama', label: 'Ollama (local)', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', keyless: true },
  { id: 'lmstudio', label: 'LM Studio (local)', kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', keyless: true }
];

export function createApiProvider(entry: ProviderEntry, modelName?: string): Provider {
  switch (entry.kind) {
    case 'gemini':
      return new GeminiProvider({ apiKey: entry.apiKey, modelName });
    case 'anthropic':
      return new ClaudeProvider({ apiKey: entry.apiKey, modelName });
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        baseUrl: entry.baseUrl || '',
        apiKey: entry.apiKey,
        modelName,
        providerLabel: entry.label
      });
  }
}

export function resolveApiProvider(
  registry: ProviderEntry[] | undefined,
  providerName: string,
  modelName?: string
): Provider {
  const id = normalizeProviderId(providerName);
  const entry = registry?.find(candidate => candidate.id === id);
  if (entry) {
    return createApiProvider(entry, modelName);
  }
  if (id === 'anthropic') {
    return new ClaudeProvider({ modelName });
  }
  if (id === 'openai') {
    return new CodexProvider({ modelName });
  }
  return new GeminiProvider({ modelName });
}
```

The keyless fallbacks at the bottom reproduce today's `getProvider` switch exactly (env-keyed Claude/Codex, Gemini as the default), so the CLI engine without a registry behaves unchanged.

- [ ] **Step 4: Export from the barrel**

In `packages/engine/src/providers/index.ts`, after the `export * from './openaiCompatible.js';` line add:

```ts
export * from './registry.js';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w packages/engine -- src/providers/registry` → PASS.
Run: `cd packages/engine && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/providers/registry.ts packages/engine/src/providers/registry.test.ts packages/engine/src/providers/index.ts
git commit -m "feat(engine): add provider registry with presets and legacy name mapping"
```

---

### Task 3: Engine — `AgentConfig.provider` becomes a string id

**Files:**
- Modify: `packages/engine/src/agents/registry.ts`
- Create: `packages/engine/src/agents/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/agents/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateAgentConfig } from './registry.js';

const base = { name: 'Architect', role: 'Architecture', systemPrompt: 'You design systems.' };

describe('validateAgentConfig provider handling', () => {
  it('normalizes legacy provider names to registry ids', () => {
    for (const [legacy, id] of [['Gemini', 'gemini'], ['Claude', 'anthropic'], ['Codex', 'openai']] as const) {
      const result = validateAgentConfig({ ...base, provider: legacy });
      expect(result.success).toBe(true);
      if (result.success) expect(result.agent.provider).toBe(id);
    }
  });

  it('accepts custom provider slugs', () => {
    const result = validateAgentConfig({ ...base, provider: 'groq' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.agent.provider).toBe('groq');
  });

  it('keeps Local CLI unchanged', () => {
    const result = validateAgentConfig({ ...base, provider: 'Local CLI', cliPreset: 'claude' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.agent.provider).toBe('Local CLI');
  });

  it('rejects invalid provider strings', () => {
    for (const bad of ['', 'My Proxy', '-bad', 'UPPER']) {
      const result = validateAgentConfig({ ...base, provider: bad });
      expect(result.success).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w packages/engine -- src/agents/registry`
Expected: FAIL — `'Gemini'` currently validates but stays `'Gemini'`; `'groq'` is rejected with `Invalid provider.`.

- [ ] **Step 3: Update `AgentConfig` and validation**

In `packages/engine/src/agents/registry.ts`:

1. Add to the imports at the top:

```ts
import { normalizeProviderId, isValidProviderId } from '../providers/registry.js';
```

2. Change the `provider` field of `AgentConfig` (line ~9) from the union to:

```ts
  provider: string;
```

3. Delete the line `const ALLOWED_PROVIDER_NAMES = ['Gemini', 'Claude', 'Codex', 'Local CLI'] as const;`

4. Replace the provider check inside `validateAgentConfig`:

```ts
  if (!isAllowed(provider, ALLOWED_PROVIDER_NAMES)) {
    return { success: false, error: 'Invalid provider.' };
  }
```

with:

```ts
  const normalizedProvider = provider === 'Local CLI' ? provider : normalizeProviderId(provider);
  if (normalizedProvider !== 'Local CLI' && !isValidProviderId(normalizedProvider)) {
    return { success: false, error: 'Invalid provider.' };
  }
```

5. In the returned agent object, change `provider,` to `provider: normalizedProvider,` and change the `modelName` line's condition from `provider === 'Local CLI'` to `normalizedProvider === 'Local CLI'`. Also update the `if (provider === 'Local CLI') {` block guard to use `normalizedProvider` for consistency (the value is identical for Local CLI, so behavior is unchanged).

Persona templates (`personaTemplates.ts`) and `createDefaultAgents` keep writing legacy names — they are normalized on every load, so no change is needed there.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w packages/engine` → ALL PASS (the new file plus the existing suite; existing tests must not regress).
Run: `cd packages/engine && npx tsc --noEmit` → no errors. If `engine.ts` now has a non-exhaustive `switch (agent.provider)` complaint, that is fixed in Task 4 — if it blocks compilation, do Task 4's engine.ts edit in the same commit.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/agents/registry.ts packages/engine/src/agents/registry.test.ts
git commit -m "feat(engine): accept any provider id on agents with legacy name normalization"
```

---

### Task 4: Engine — registry-aware `DiscussionEngine`

**Files:**
- Modify: `packages/engine/src/discussion/engine.ts` (constructor ~line 415-420, `getProvider` ~line 493-513, imports ~line 1-25)

- [ ] **Step 1: Update imports**

In `packages/engine/src/discussion/engine.ts`, the providers import currently pulls `GeminiProvider`, `ClaudeProvider`, `CodexProvider`, `LocalCliProvider`, `Provider` from `../providers/index.js` (exact specifier list is at the top of the file). Add `resolveApiProvider` and `ProviderEntry` to that import.

- [ ] **Step 2: Accept a provider registry in the constructor**

Replace:

```ts
export class DiscussionEngine {
  private dirPath: string;

  constructor(dirPath: string) {
    this.dirPath = dirPath;
  }
```

with:

```ts
export interface DiscussionEngineOptions {
  providerRegistry?: ProviderEntry[];
}

export class DiscussionEngine {
  private dirPath: string;
  private providerRegistry?: ProviderEntry[];

  constructor(dirPath: string, options: DiscussionEngineOptions = {}) {
    this.dirPath = dirPath;
    this.providerRegistry = options.providerRegistry;
  }
```

- [ ] **Step 3: Delegate `getProvider` to the registry resolver**

Replace the body of `getProvider`:

```ts
  private getProvider(agent: AgentConfig): Provider {
    if (agent.provider === 'Local CLI') {
      return new LocalCliProvider({
        command: agent.command,
        cliPreset: agent.cliPreset,
        stdinFormat: agent.stdinFormat,
        cwd: this.dirPath,
        modelName: agent.modelName,
        permissionMode: agent.permissionMode || 'safe'
      });
    }
    return resolveApiProvider(this.providerRegistry, agent.provider, agent.modelName);
  }
```

Remove the now-unused `GeminiProvider` / `ClaudeProvider` / `CodexProvider` import specifiers from this file if nothing else references them (TypeScript will tell you via `noUnusedLocals` if enabled; otherwise check with grep).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w packages/engine` → ALL PASS.
Run: `cd packages/engine && npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/discussion/engine.ts
git commit -m "feat(engine): resolve agent providers through the provider registry"
```

---

### Task 5: Main process — provider store, migration, env application

**Files:**
- Modify: `packages/desktop/main/main.ts` (the api-key block around lines 114-125 and 819-870)

- [ ] **Step 1: Add the store module code**

In `main.ts`, directly below the existing `ApiKeyConfig` interface (~line 114), add the import at the top of the file with the other engine imports:

```ts
import { builtInProviderEntries, isValidProviderId, normalizeProviderId, type ProviderEntry } from '@room/engine';
```

(main.ts line 7 already has one big import from `'@room/engine'` — add these names to that existing statement; note the `type` keyword matching the existing `type AgentConfig` style. The engine barrel `src/index.ts` re-exports `./providers/index.js`, so the Task 2 exports are reachable with no barrel change.)

Below `getApiKeysPath()` (~line 821) add:

```ts
function getProvidersPath(): string {
  return path.join(app.getPath('userData'), 'providers.json');
}

function sanitizeProviderEntry(raw: unknown): ProviderEntry | null {
  if (!isPlainObject(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const kind = raw.kind === 'gemini' || raw.kind === 'anthropic' || raw.kind === 'openai-compatible' ? raw.kind : null;
  if (!isValidProviderId(id) || !label || !kind) return null;
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
  if (kind === 'openai-compatible' && !/^https?:\/\//.test(baseUrl)) return null;
  return {
    id,
    label,
    kind,
    ...(baseUrl ? { baseUrl } : {}),
    ...(typeof raw.apiKey === 'string' && raw.apiKey ? { apiKey: raw.apiKey } : {}),
    ...(raw.builtIn === true ? { builtIn: true } : {})
  };
}

function withBuiltInProviders(entries: ProviderEntry[]): ProviderEntry[] {
  const builtIns = builtInProviderEntries();
  const result: ProviderEntry[] = [];
  for (const builtIn of builtIns) {
    const existing = entries.find(entry => entry.id === builtIn.id);
    result.push(existing ? { ...builtIn, ...existing, builtIn: true, kind: builtIn.kind, baseUrl: builtIn.baseUrl } : builtIn);
  }
  for (const entry of entries) {
    if (!builtIns.some(builtIn => builtIn.id === entry.id)) {
      result.push({ ...entry, builtIn: false });
    }
  }
  return result;
}

async function readProvidersFromDisk(): Promise<ProviderEntry[]> {
  try {
    const content = await fs.readFile(getProvidersPath(), 'utf-8');
    const parsed = JSON.parse(content);
    const rawEntries = isPlainObject(parsed) && Array.isArray(parsed.providers) ? parsed.providers : [];
    const entries = rawEntries
      .map(sanitizeProviderEntry)
      .filter((entry): entry is ProviderEntry => entry !== null);
    return withBuiltInProviders(entries);
  } catch {
    const legacyKeys = await readApiKeysFromDisk();
    const seeded = builtInProviderEntries(legacyKeys);
    await writeProvidersToDisk(seeded);
    return seeded;
  }
}

async function writeProvidersToDisk(providers: ProviderEntry[]): Promise<void> {
  const filePath = getProvidersPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ providers }, null, 2), 'utf-8');
  try {
    await fs.chmod(filePath, 0o600);
  } catch {}
}
```

- [ ] **Step 2: Re-route env application through the registry**

Replace the body of `applyApiKeysToEnvironment()`:

```ts
async function applyApiKeysToEnvironment(): Promise<ApiKeyConfig> {
  const providers = await readProvidersFromDisk();
  const keys: ApiKeyConfig = {
    geminiApiKey: providers.find(p => p.id === 'gemini')?.apiKey,
    anthropicApiKey: providers.find(p => p.id === 'anthropic')?.apiKey,
    openaiApiKey: providers.find(p => p.id === 'openai')?.apiKey
  };
  if (keys.geminiApiKey) process.env.GEMINI_API_KEY = keys.geminiApiKey;
  if (keys.anthropicApiKey) process.env.ANTHROPIC_API_KEY = keys.anthropicApiKey;
  if (keys.openaiApiKey) process.env.OPENAI_API_KEY = keys.openaiApiKey;
  return keys;
}
```

`readApiKeysFromDisk` / `writeApiKeysToDisk` stay (migration source + `clear-api-keys` rollback path); `writeApiKeysToDisk` keeps compiling because `save-api-keys` is removed in Task 6 — if TypeScript flags it as unused after Task 6, delete it then.

- [ ] **Step 3: Typecheck**

Run: `cd packages/desktop && npx tsc --noEmit` → only the two pre-existing App.tsx errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/main/main.ts
git commit -m "feat(desktop): add provider registry store with legacy api-key migration"
```

---

### Task 6: Main process — IPC channels and engine wiring

**Files:**
- Modify: `packages/desktop/main/main.ts` (IPC block ~lines 1518-1556, `detect-api-models` ~line 1716, the four `new DiscussionEngine(projectRoot)` sites at ~lines 1211/1279/1351/1375)
- Modify: `packages/desktop/main/preload.js` (~lines 31-35)

- [ ] **Step 1: Replace the api-key IPC handlers**

Delete the `load-api-keys`, `save-api-keys`, and `clear-api-keys` handlers and add in their place:

```ts
function maskProvider(entry: ProviderEntry) {
  return {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    baseUrl: entry.baseUrl,
    builtIn: !!entry.builtIn,
    hasKey: !!entry.apiKey
  };
}

ipcMain.handle('load-providers', async () => {
  try {
    const providers = await readProvidersFromDisk();
    return { success: true, providers: providers.map(maskProvider) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-provider', async (_, payload: { id: string; label?: string; baseUrl?: string; apiKey?: string | null }) => {
  try {
    const providers = await readProvidersFromDisk();
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!isValidProviderId(id)) {
      return { success: false, error: 'Provider id must be a lowercase slug (a-z, 0-9, dashes).' };
    }
    const existing = providers.find(entry => entry.id === id);
    const label = (payload.label || existing?.label || '').trim();
    const baseUrl = (payload.baseUrl ?? existing?.baseUrl ?? '').trim();
    if (!label) return { success: false, error: 'Provider name is required.' };
    if (existing?.builtIn) {
      // Built-ins: only the key may change.
      if (payload.apiKey === null) delete existing.apiKey;
      else if (typeof payload.apiKey === 'string' && payload.apiKey.trim()) existing.apiKey = payload.apiKey.trim();
    } else {
      if (!/^https?:\/\//.test(baseUrl)) {
        return { success: false, error: 'Base URL must start with http:// or https://.' };
      }
      const entry: ProviderEntry = {
        id,
        label,
        kind: 'openai-compatible',
        baseUrl,
        ...(existing?.apiKey ? { apiKey: existing.apiKey } : {})
      };
      if (payload.apiKey === null) delete entry.apiKey;
      else if (typeof payload.apiKey === 'string' && payload.apiKey.trim()) entry.apiKey = payload.apiKey.trim();
      const index = providers.findIndex(candidate => candidate.id === id);
      if (index >= 0) providers[index] = entry;
      else providers.push(entry);
    }
    await writeProvidersToDisk(providers);
    await applyApiKeysToEnvironment();
    const updated = await readProvidersFromDisk();
    return { success: true, providers: updated.map(maskProvider) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-provider', async (_, providerId: string) => {
  try {
    const providers = await readProvidersFromDisk();
    const entry = providers.find(candidate => candidate.id === providerId);
    if (!entry) return { success: false, error: 'Provider not found.' };
    if (entry.builtIn) return { success: false, error: 'Built-in providers cannot be removed.' };
    const remaining = providers.filter(candidate => candidate.id !== providerId);
    await writeProvidersToDisk(remaining);
    return { success: true, providers: remaining.map(maskProvider) };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-provider', async (_, providerId: string) => {
  try {
    const providers = await readProvidersFromDisk();
    const entry = providers.find(candidate => candidate.id === providerId);
    if (!entry) return { success: false, error: 'Provider not found.' };
    const result = await fetchProviderModels(entry);
    if (result.ok) return { success: true, message: `OK — ${result.models.length} model(s) visible.` };
    if (result.status === 404 || result.status === 405) {
      const probe = await probeChatCompletion(entry);
      return probe.ok
        ? { success: true, message: 'OK — chat completions endpoint reachable.' }
        : { success: false, error: probe.error };
    }
    return { success: false, error: result.error };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
```

- [ ] **Step 2: Add the shared model-fetch helpers**

Above the new handlers add:

```ts
async function fetchProviderModels(entry: ProviderEntry): Promise<
  { ok: true; models: { value: string; label: string }[] } | { ok: false; status?: number; error: string }
> {
  try {
    if (entry.kind === 'gemini') {
      if (!entry.apiKey) return { ok: false, error: 'Gemini API key is not configured.' };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${entry.apiKey}`);
      if (!res.ok) return { ok: false, status: res.status, error: `${entry.label}: status ${res.status}: ${await res.text()}` };
      const data: any = await res.json();
      return {
        ok: true,
        models: (data.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => ({ value: m.name.replace('models/', ''), label: m.displayName || m.name }))
      };
    }
    if (entry.kind === 'anthropic') {
      if (!entry.apiKey) return { ok: false, error: 'Anthropic API key is not configured.' };
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': entry.apiKey, 'anthropic-version': '2023-06-01' }
      });
      if (!res.ok) return { ok: false, status: res.status, error: `${entry.label}: status ${res.status}: ${await res.text()}` };
      const data: any = await res.json();
      return { ok: true, models: (data.data || []).map((m: any) => ({ value: m.id, label: m.display_name || m.id })) };
    }
    const headers: Record<string, string> = {};
    if (entry.apiKey) headers['Authorization'] = `Bearer ${entry.apiKey}`;
    const base = (entry.baseUrl || '').replace(/\/+$/, '');
    const res = await fetch(`${base}/models`, { headers });
    if (!res.ok) return { ok: false, status: res.status, error: `${entry.label}: status ${res.status}: ${await res.text()}` };
    const data: any = await res.json();
    const models = (data.data || [])
      .filter((m: any) => m.id && (entry.id !== 'openai' || isOpenAiModelAllowed(m.id)))
      .map((m: any) => ({ value: m.id, label: m.id }));
    return { ok: true, models };
  } catch (error: any) {
    return { ok: false, error: `${entry.label}: ${error.message}` };
  }
}

async function probeChatCompletion(entry: ProviderEntry): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (entry.apiKey) headers['Authorization'] = `Bearer ${entry.apiKey}`;
    const base = (entry.baseUrl || '').replace(/\/+$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'test', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
    });
    // 400 (unknown model) still proves the endpoint speaks OpenAI-compatible; 401/403/404 do not.
    if (res.ok || res.status === 400) return { ok: true };
    return { ok: false, error: `${entry.label}: status ${res.status}: ${await res.text()}` };
  } catch (error: any) {
    return { ok: false, error: `${entry.label}: ${error.message}` };
  }
}
```

- [ ] **Step 3: Generalize `detect-api-models`**

Replace the entire `detect-api-models` handler (the `if provider === 'Gemini' / 'Codex' / 'Claude'` chain) with:

```ts
ipcMain.handle('detect-api-models', async (_, payload: { providerId: string }) => {
  try {
    const providers = await readProvidersFromDisk();
    const id = normalizeProviderId(typeof payload?.providerId === 'string' ? payload.providerId : '');
    const entry = providers.find(candidate => candidate.id === id);
    if (!entry) return { success: false, error: 'Unknown provider.' };
    const result = await fetchProviderModels(entry);
    if (result.ok && result.models.length > 0) return { success: true, models: result.models };
    if (result.ok) return { success: true, models: [] };
    return { success: false, error: result.error };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});
```

- [ ] **Step 4: Pass the registry into every `DiscussionEngine`**

At each of the four sites (~lines 1211, 1279, 1351, 1375) change:

```ts
const engine = new DiscussionEngine(projectRoot);
```

to:

```ts
const engine = new DiscussionEngine(projectRoot, { providerRegistry: await readProvidersFromDisk() });
```

- [ ] **Step 5: Update `preload.js`**

Replace lines 31-35 (`loadApiKeys` / `saveApiKeys` / `clearApiKeys` / `detectApiModels`) with:

```js
  loadProviders: () => ipcRenderer.invoke('load-providers'),
  saveProvider: (provider) => ipcRenderer.invoke('save-provider', provider),
  deleteProvider: (providerId) => ipcRenderer.invoke('delete-provider', providerId),
  testProvider: (providerId) => ipcRenderer.invoke('test-provider', providerId),
  detectApiModels: (providerId) => ipcRenderer.invoke('detect-api-models', { providerId }),
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/desktop && npx tsc --noEmit` → expect NEW errors only in `renderer/src/App.tsx` referencing `loadApiKeys`/`saveApiKeys`/`clearApiKeys`/`apiKeyStatus` — those are fixed in Task 7. No errors in `main/main.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/main/main.ts packages/desktop/main/preload.js
git commit -m "feat(desktop): provider registry IPC and engine wiring"
```

---

### Task 7: Renderer — "AI Providers" settings section

**Files:**
- Modify: `packages/desktop/renderer/src/App.tsx`
  - electronAPI interface (~line 167)
  - state + handlers (~lines 1321-1325 and 2160-2205)
  - settings JSX block starting at the marker `{/* Section 0: Local API Keys */}` (~line 5715)

- [ ] **Step 1: Update the electronAPI typing**

In the `electronAPI` interface, replace the `loadApiKeys` / `saveApiKeys` / `clearApiKeys` / `detectApiModels` members with:

```ts
  loadProviders: () => Promise<{ success: boolean; providers?: MaskedProvider[]; error?: string }>;
  saveProvider: (provider: { id: string; label?: string; baseUrl?: string; apiKey?: string | null }) => Promise<{ success: boolean; providers?: MaskedProvider[]; error?: string }>;
  deleteProvider: (providerId: string) => Promise<{ success: boolean; providers?: MaskedProvider[]; error?: string }>;
  testProvider: (providerId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  detectApiModels: (providerId: string) => Promise<{ success: boolean; models?: { value: string; label: string }[]; error?: string }>;
```

and add near the other top-level types:

```ts
interface MaskedProvider {
  id: string;
  label: string;
  kind: 'gemini' | 'anthropic' | 'openai-compatible';
  baseUrl?: string;
  builtIn: boolean;
  hasKey: boolean;
}

const PROVIDER_PRESETS: { id: string; label: string; baseUrl: string; keyless?: boolean }[] = [
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', keyless: true },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', keyless: true }
];
```

(The renderer cannot import from the engine package; this constant mirrors `PROVIDER_PRESETS` in `packages/engine/src/providers/registry.ts` — keep the two lists in sync.)

- [ ] **Step 2: Replace api-key state with provider state**

Replace (~lines 1321-1325):

```ts
const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({ gemini: false, ... });
const [apiKeyDrafts, setApiKeyDrafts] = useState<{ geminiApiKey: string; anthropicApiKey: string; openaiApiKey: string }>({
  geminiApiKey: '',
  anthropicApiKey: '',
  openaiApiKey: ''
});
```

with:

```ts
const [providers, setProviders] = useState<MaskedProvider[]>([]);
const [providerKeyDrafts, setProviderKeyDrafts] = useState<Record<string, string>>({});
const [providerTestResults, setProviderTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
const [addProviderOpen, setAddProviderOpen] = useState(false);
const [addProviderDraft, setAddProviderDraft] = useState<{ id: string; label: string; baseUrl: string; apiKey: string }>({ id: '', label: '', baseUrl: '', apiKey: '' });
```

Delete the `ApiKeyStatus` interface and every remaining reference to `apiKeyStatus` / `apiKeyDrafts` (TypeScript errors are the worklist).

- [ ] **Step 3: Replace the handlers**

Replace `handleSaveApiKeys` / `handleClearApiKeys` (~lines 2160-2205) and the initial `loadApiKeys` effect with:

```ts
const refreshProviders = async () => {
  const res = await window.electronAPI.loadProviders();
  if (res.success && res.providers) setProviders(res.providers);
};

useEffect(() => { refreshProviders(); }, []);

const handleSaveProviderKey = async (providerId: string) => {
  const draft = (providerKeyDrafts[providerId] || '').trim();
  if (!draft) return;
  const res = await window.electronAPI.saveProvider({ id: providerId, apiKey: draft });
  if (res.success && res.providers) {
    setProviders(res.providers);
    setProviderKeyDrafts(prev => ({ ...prev, [providerId]: '' }));
  } else if (res.error) {
    alert(res.error);
  }
};

const handleAddProvider = async () => {
  const id = addProviderDraft.id.trim().toLowerCase();
  const res = await window.electronAPI.saveProvider({
    id,
    label: addProviderDraft.label.trim() || id,
    baseUrl: addProviderDraft.baseUrl.trim(),
    apiKey: addProviderDraft.apiKey.trim() || undefined
  });
  if (res.success && res.providers) {
    setProviders(res.providers);
    setAddProviderOpen(false);
    setAddProviderDraft({ id: '', label: '', baseUrl: '', apiKey: '' });
  } else if (res.error) {
    alert(res.error);
  }
};

const handleDeleteProvider = async (providerId: string) => {
  const usedBy = agents.filter(agent => agent.provider === providerId).map(agent => agent.name);
  const detail = usedBy.length > 0
    ? `\n\nUsed by: ${usedBy.join(', ')}. These members will fall back to Gemini until reassigned.`
    : '';
  if (!window.confirm(`Remove this provider?${detail}`)) return;
  const res = await window.electronAPI.deleteProvider(providerId);
  if (res.success && res.providers) setProviders(res.providers);
  else if (res.error) alert(res.error);
};

const handleTestProvider = async (providerId: string) => {
  setProviderTestResults(prev => ({ ...prev, [providerId]: { ok: true, message: 'Testing...' } }));
  const res = await window.electronAPI.testProvider(providerId);
  setProviderTestResults(prev => ({
    ...prev,
    [providerId]: res.success ? { ok: true, message: res.message || 'OK' } : { ok: false, message: res.error || 'Failed' }
  }));
};
```

If the existing code loads key status with a different effect/handler names, match the surrounding patterns (e.g. existing `useEffect` blocks near workspace load) — the behavior above is what matters. `agents` is the existing AI-members state variable in App.tsx; if its name differs (e.g. `aiMembers`), use that.

- [ ] **Step 4: Replace the settings JSX section**

Replace the whole `{/* Section 0: Local API Keys */}` card (from the marker through its closing `</div>` right before `{/* Section 1: Workspace Agent Settings */}`) with:

```tsx
          {/* Section 0: AI Providers */}
          <div className="focus-editor-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'hsl(var(--accent-green))', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H3v-4l6.257-6.257A6 6 0 1121 9z" />
                </svg>
                AI Providers
              </h4>
              <button type="button" className="btn-secondary" onClick={() => setAddProviderOpen(true)} disabled={loading} style={{ height: '32px', padding: '0 14px', fontSize: '0.78rem' }}>
                + Add Provider
              </button>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'hsl(var(--text-muted))', lineHeight: 1.5 }}>
              Keys are stored locally on this machine, outside <code>.room/</code>. Any OpenAI-compatible endpoint can be added. Leave a key field blank to keep the existing key.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {providers.map(provider => (
                <div key={provider.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid hsl(var(--border-dim))', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                      <label style={{ fontSize: '0.84rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>{provider.label}</label>
                      {provider.baseUrl && (
                        <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{provider.baseUrl}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                      <span style={{
                        fontSize: '0.68rem',
                        color: provider.hasKey ? '#10b981' : 'hsl(var(--text-muted))',
                        background: provider.hasKey ? 'rgba(16, 185, 129, 0.1)' : 'hsl(var(--bg-input))',
                        border: provider.hasKey ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid hsl(var(--border-dim))',
                        borderRadius: '10px',
                        padding: '2px 7px',
                        whiteSpace: 'nowrap'
                      }}>
                        {provider.hasKey ? 'Configured' : 'No key'}
                      </span>
                      <button type="button" className="btn-secondary" onClick={() => handleTestProvider(provider.id)} disabled={loading} style={{ height: '28px', padding: '0 10px', fontSize: '0.72rem' }}>
                        Test
                      </button>
                      {!provider.builtIn && (
                        <button type="button" className="btn-secondary" onClick={() => handleDeleteProvider(provider.id)} disabled={loading} style={{ height: '28px', padding: '0 10px', fontSize: '0.72rem' }}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="password"
                      value={providerKeyDrafts[provider.id] || ''}
                      disabled={loading}
                      onChange={(e) => setProviderKeyDrafts(prev => ({ ...prev, [provider.id]: e.target.value }))}
                      placeholder={provider.hasKey ? 'Configured. Enter a new key to replace.' : 'Paste API key (optional for local endpoints)'}
                      style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontFamily: 'inherit', fontSize: '0.84rem', outline: 'none', flex: 1 }}
                    />
                    <button type="button" className="btn-primary" onClick={() => handleSaveProviderKey(provider.id)} disabled={loading || !(providerKeyDrafts[provider.id] || '').trim()} style={{ height: '34px', padding: '0 14px', fontSize: '0.76rem' }}>
                      Save Key
                    </button>
                  </div>
                  {providerTestResults[provider.id] && (
                    <span style={{ fontSize: '0.72rem', color: providerTestResults[provider.id].ok ? '#10b981' : '#f87171' }}>
                      {providerTestResults[provider.id].message}
                    </span>
                  )}
                  {provider.baseUrl?.startsWith('http://') && !provider.baseUrl.includes('localhost') && !provider.baseUrl.includes('127.0.0.1') && (
                    <span style={{ fontSize: '0.72rem', color: '#fbbf24' }}>Warning: unencrypted http:// endpoint.</span>
                  )}
                </div>
              ))}
            </div>
            {addProviderOpen && (
              <div style={{ border: '1px solid hsl(var(--border-dim))', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--text-secondary))' }}>Add Provider</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {PROVIDER_PRESETS.filter(preset => !providers.some(provider => provider.id === preset.id)).map(preset => (
                    <button key={preset.id} type="button" className="btn-secondary" style={{ height: '30px', padding: '0 12px', fontSize: '0.74rem' }}
                      onClick={() => setAddProviderDraft({ id: preset.id, label: preset.label, baseUrl: preset.baseUrl, apiKey: '' })}>
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <input type="text" placeholder="id (e.g. groq)" value={addProviderDraft.id} disabled={loading}
                    onChange={(e) => setAddProviderDraft(prev => ({ ...prev, id: e.target.value }))}
                    style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none' }} />
                  <input type="text" placeholder="Display name" value={addProviderDraft.label} disabled={loading}
                    onChange={(e) => setAddProviderDraft(prev => ({ ...prev, label: e.target.value }))}
                    style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none' }} />
                  <input type="text" placeholder="Base URL (https://.../v1)" value={addProviderDraft.baseUrl} disabled={loading}
                    onChange={(e) => setAddProviderDraft(prev => ({ ...prev, baseUrl: e.target.value }))}
                    style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none', gridColumn: '1 / -1' }} />
                  <input type="password" placeholder="API key (optional)" value={addProviderDraft.apiKey} disabled={loading}
                    onChange={(e) => setAddProviderDraft(prev => ({ ...prev, apiKey: e.target.value }))}
                    style={{ backgroundColor: 'hsl(var(--bg-input))', border: '1px solid hsl(var(--border-dim))', borderRadius: '8px', padding: '8px 12px', color: 'white', fontSize: '0.84rem', outline: 'none', gridColumn: '1 / -1' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button type="button" className="btn-secondary" onClick={() => { setAddProviderOpen(false); setAddProviderDraft({ id: '', label: '', baseUrl: '', apiKey: '' }); }} style={{ height: '34px', padding: '0 14px', fontSize: '0.76rem' }}>
                    Cancel
                  </button>
                  <button type="button" className="btn-primary" onClick={handleAddProvider}
                    disabled={loading || !addProviderDraft.id.trim() || !addProviderDraft.baseUrl.trim()}
                    style={{ height: '34px', padding: '0 16px', fontSize: '0.76rem' }}>
                    Add Provider
                  </button>
                </div>
              </div>
            )}
          </div>
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/desktop && npx tsc --noEmit`
Expected: remaining NEW errors only at the AI-members call sites (`detectApiModels(newAgentProvider)`, `getModelOptions`, provider option values) — fixed in Task 8. Settings-section references must be clean.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/renderer/src/App.tsx
git commit -m "feat(desktop): provider registry settings UI"
```

---

### Task 8: Renderer — dynamic provider dropdown for AI Members

**Files:**
- Modify: `packages/desktop/renderer/src/App.tsx`
  - `detectApiModels` call (~line 1040)
  - `getModelOptions` (~line 1226-1245)
  - template provider cast (~line 1382-1383)
  - member-form provider `<select>` (~lines 4735-4757)

- [ ] **Step 1: Make the provider select dynamic**

Replace the fixed cloud optgroup:

```tsx
                    <optgroup label="Cloud Providers">
                      <option value="Gemini">Gemini (Google)</option>
                      <option value="Claude">Claude (Anthropic)</option>
                      <option value="Codex">Codex (OpenAI)</option>
                    </optgroup>
```

with:

```tsx
                    <optgroup label="API Providers">
                      {providers.map(provider => (
                        <option key={provider.id} value={provider.id}>{provider.label}</option>
                      ))}
                    </optgroup>
```

The Local CLI optgroups below it stay unchanged.

- [ ] **Step 2: Normalize legacy provider values in member state**

Saved members may still carry `Gemini`/`Claude`/`Codex` (engine normalizes on load, but the renderer also reads raw values from templates). Add near `MaskedProvider`:

```ts
const LEGACY_PROVIDER_IDS: Record<string, string> = { Gemini: 'gemini', Claude: 'anthropic', Codex: 'openai' };
const normalizeProviderId = (value: string) => LEGACY_PROVIDER_IDS[value] || value;
const providerLabel = (providers: MaskedProvider[], id: string) => providers.find(provider => provider.id === normalizeProviderId(id))?.label || id;
```

At the template-apply site (~line 1382), replace:

```ts
const provider = template.provider as 'Gemini' | 'Claude' | 'Codex';
```

with:

```ts
const provider = normalizeProviderId(template.provider);
```

Then grep App.tsx for remaining `'Gemini'`/`'Claude'`/`'Codex'` literals used as provider *values* (not display strings) and route each through `normalizeProviderId`. Anywhere a member's provider is displayed, use `providerLabel(providers, agent.provider)`.

- [ ] **Step 3: Update model option lookups**

In `getModelOptions` (~line 1226), replace the cloud branch:

```ts
if (provider === 'Claude' || provider === 'Gemini' || provider === 'Codex') {
  return getFallbackModels(provider as 'Claude' | 'Gemini' | 'Codex') as ModelOption[];
}
```

with:

```ts
const id = normalizeProviderId(provider);
const fallbackKey = ({ gemini: 'Gemini', anthropic: 'Claude', openai: 'Codex' } as Record<string, string>)[id];
if (fallbackKey) {
  return getFallbackModels(fallbackKey as 'Claude' | 'Gemini' | 'Codex') as ModelOption[];
}
if (providers.some(candidate => candidate.id === id)) {
  return []; // custom providers: discovered via detectApiModels or typed manually
}
```

At ~line 1040 change `window.electronAPI.detectApiModels(newAgentProvider)` to `window.electronAPI.detectApiModels(normalizeProviderId(newAgentProvider))`. When the result is `{ success: true, models: [] }`, the existing `Custom Model...` path provides free-text entry — verify that path renders for empty model lists (if the select renders zero options plus `Custom Model...`, that is sufficient).

- [ ] **Step 4: Typecheck and build**

Run: `cd packages/desktop && npx tsc --noEmit` → only the two pre-existing App.tsx errors remain.
Run: `npm run build:desktop` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/renderer/src/App.tsx
git commit -m "feat(desktop): dynamic provider selection for AI members"
```

---

### Task 9: Verification and docs

**Files:**
- Modify: `README.md` (Features bullet ~line 100, Quick Start note ~line 47)

- [ ] **Step 1: Full automated verification**

```bash
npm test -w packages/engine        # ALL PASS
npm run build:engine               # OK
npm run build:desktop              # OK
```

- [ ] **Step 2: Manual verification (run `npm run dev:desktop`)**

1. With an existing `api-keys.json`: Settings shows Gemini/Claude/OpenAI rows with `Configured` badges (migration worked).
2. Add Provider → preset `Groq` → paste key → Test shows `OK — N model(s) visible.` → create a member with provider Groq → run a one-round discussion.
3. Add Provider → preset `Ollama` (no key) → Test passes against a running Ollama → models list populates in the member form.
4. A member file containing `"provider": "Claude"` still runs (legacy normalization).
5. Remove the Groq provider → confirmation lists the member; the member falls back to Gemini on next run.

- [ ] **Step 3: Update README**

Replace the Features bullet `API key settings for Gemini, Claude/Anthropic, and OpenAI-compatible model discovery.` with:

```markdown
- Provider registry: built-in Gemini / Claude (Anthropic) / OpenAI plus any OpenAI-compatible endpoint (Groq, OpenRouter, Mistral, DeepSeek, xAI, Together, Ollama, LM Studio, or custom base URLs) with per-provider keys, model discovery, and connection tests.
```

In Quick Start, replace `API keys (Gemini, Claude/Anthropic, OpenAI-compatible) are configured in `Settings`;` with `AI providers (built-in Gemini/Claude/OpenAI plus any OpenAI-compatible endpoint) are configured in `Settings`;`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document provider registry in README"
```
