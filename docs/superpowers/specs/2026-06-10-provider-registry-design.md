# Provider Registry — Design

Date: 2026-06-10
Status: Approved (pending implementation)

## Context

ROOM currently supports exactly three cloud AI providers, hardcoded at every layer:

- `AgentConfig.provider` is the union `'Gemini' | 'Claude' | 'Codex' | 'Local CLI'` (`packages/engine/src/agents/registry.ts:144`).
- API keys are three fixed fields in `api-keys.json` under Electron `userData`, applied to `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars at startup (`packages/desktop/main/main.ts`).
- Each provider class hardcodes its endpoint URL (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`).
- The Settings page renders three fixed API key inputs.

Users cannot add other providers (Groq, OpenRouter, Mistral, DeepSeek, xAI, Together, Azure OpenAI) or local LLM servers (Ollama, LM Studio), even though nearly all of them expose OpenAI-compatible APIs.

## Goals

- Any OpenAI-compatible provider can be added from Settings: pick a preset (paste key) or enter a custom name + base URL + optional key.
- Existing Gemini / Claude (Anthropic) / OpenAI native support keeps working unchanged.
- Existing saved AI member files (`provider: 'Gemini' | 'Claude' | 'Codex'`) keep working without modification.
- Existing `api-keys.json` is migrated automatically; no user action needed.
- API keys never leave the Electron main process (renderer sees status/masked values only, same invariant as today).

## Non-Goals

- No fully pluggable request/response templating. Custom providers are OpenAI-compatible only (user decision).
- No per-workspace provider storage. Keys stay app-global in `userData`; `.room/` must never contain keys.
- No changes to Local CLI members.

## Data Model

New file `providers.json` in `userData` (written with `chmod 600`, same as `api-keys.json` today):

```ts
interface ProviderEntry {
  id: string;          // slug: 'gemini' | 'anthropic' | 'openai' (built-in), or custom e.g. 'groq', 'my-proxy'
  label: string;       // display name used in Settings and the AI Members provider dropdown
  kind: 'gemini' | 'anthropic' | 'openai-compatible';
  baseUrl?: string;    // required when kind === 'openai-compatible'; built-ins have fixed defaults
  apiKey?: string;     // optional — keyless endpoints (Ollama, LM Studio) are valid
  builtIn?: boolean;   // built-ins cannot be deleted; only their key can be edited
}
```

Rules:

- `id` is a lowercase slug (`/^[a-z][a-z0-9-]*$/`), unique. Built-in ids are reserved: `gemini`, `anthropic`, `openai`.
- Built-in entries always exist (created on first load): `gemini` (kind `gemini`), `anthropic` (kind `anthropic`), `openai` (kind `openai-compatible`, baseUrl `https://api.openai.com/v1`).
- Presets are templates for creating custom entries (id, label, baseUrl pre-filled): Groq, OpenRouter, Mistral, DeepSeek, xAI, Together, Ollama (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`). Presets live in one shared constant so adding a provider later is a one-line change.
- `baseUrl` must parse as an `http(s)` URL. Non-localhost `http://` is allowed but flagged with a warning in the UI.

### Migration

On main-process startup, when `providers.json` does not exist:

1. Read legacy `api-keys.json` (may be absent).
2. Create `providers.json` with the three built-in entries, copying any legacy keys into them.
3. Leave `api-keys.json` on disk (rollback safety) but stop reading/writing it afterwards.

Env-var compatibility is preserved: keys for the three built-ins are still applied to `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` at startup, so the CLI engine and any env-based fallback keep working.

## Engine Changes (`packages/engine`)

### `OpenAICompatibleProvider`

`CodexProvider` is generalized into `OpenAICompatibleProvider`:

```ts
interface OpenAICompatibleConfig {
  baseUrl: string;        // e.g. https://api.groq.com/openai/v1
  apiKey?: string;        // omitted for keyless local endpoints
  modelName?: string;
  providerLabel?: string; // used in error messages, defaults to 'OpenAI'
}
```

- Calls `POST {baseUrl}/chat/completions` with `Authorization: Bearer` only when a key is present.
- URL joining tolerates trailing slashes on `baseUrl`.
- Errors are prefixed with `providerLabel` (e.g. `Groq: 401 ...`).
- `CodexProvider` remains as a thin subclass/alias pinned to the OpenAI base URL so existing imports and `detectProviders()` keep compiling; engine-internal call sites move to `OpenAICompatibleProvider`.

### `AgentConfig.provider` becomes a string id

- Type changes from the union to `string`.
- Validation in `registry.ts` accepts: `'Local CLI'`, legacy names (`'Gemini'`, `'Claude'`, `'Codex'` — case preserved on disk, normalized at load), and slugs matching `/^[a-z][a-z0-9-]*$/`.
- Legacy normalization map (applied in `loadAgents` and `validateAgentConfig`): `Gemini → gemini`, `Claude → anthropic`, `Codex → openai`. Saved member files are not rewritten; normalization happens in memory.

### Provider resolution in `DiscussionEngine`

- `DiscussionEngine` gains an optional constructor argument `providerRegistry?: ProviderEntry[]` (type exported from the engine).
- `getProvider(agent)`:
  1. `'Local CLI'` → unchanged.
  2. Normalize legacy name → id, look up the registry entry, instantiate by `kind` (`gemini` → `GeminiProvider`, `anthropic` → `ClaudeProvider`, `openai-compatible` → `OpenAICompatibleProvider` with the entry's `baseUrl`/`apiKey`/`label`).
  3. Registry missing or id not found → current env-var behavior (`gemini`/`anthropic`/`openai` fall back to their env-keyed providers; unknown ids fall back to `GeminiProvider`, the current default), so the CLI engine without a registry behaves exactly as today.
- The scanner/summarizer paths that construct providers go through the same resolution.

## Main Process / IPC (`packages/desktop/main`)

Replace the three api-key IPC channels with provider-registry channels (old channels removed; renderer is updated in the same change):

- `load-providers` → `{ providers: MaskedProviderEntry[] }` where `MaskedProviderEntry` omits `apiKey` and adds `hasKey: boolean`. Full keys are never sent to the renderer.
- `save-provider` (upsert one entry) → validates slug, kind, baseUrl; rejects re-kinding built-ins. Key semantics: `apiKey` omitted or empty string = keep the existing key; `apiKey: null` = clear the key; non-empty string = replace.
- `delete-provider` (custom entries only).
- `test-provider(providerId)` → tries `GET {baseUrl}/models` first; if that returns 404/405 (endpoint without a models route), falls back to a minimal 1-token chat completion. Returns `{ success, message }`.
- `detect-api-models(providerId)` — generalized from the current per-provider logic: `gemini`/`anthropic` keep their native model-list calls; `openai-compatible` calls `GET {baseUrl}/models` with the entry's key. On failure returns the existing fallback catalog for built-ins and `[]` for custom entries (UI then offers free-text model input). The OpenAI `isOpenAiModelAllowed` prefix filter applies only to the built-in `openai` entry; custom endpoints return their list unfiltered.

`DiscussionEngine` instantiations in `main.ts` pass the loaded registry.

## Renderer / Settings UI (`packages/desktop/renderer`)

The Settings "API Keys" section becomes **"AI Providers"**:

- One row per provider: label, kind/baseUrl summary, `Configured` / `No key` badge, actions: `Test`, `Edit key` (built-in + custom), `Remove` (custom only).
- `Add Provider` opens a modal: preset grid (one click pre-fills id/label/baseUrl, user pastes key) + `Custom` form (name, base URL, optional key) with inline validation and a `Test` button before save.
- Key inputs stay write-only: placeholder shows `Configured. Enter a new key to replace.` exactly like today.
- AI Members screen: the provider dropdown is built from `load-providers` + `Local CLI`; the model dropdown calls `detect-api-models(providerId)` and falls back to free-text model entry when discovery returns nothing.
- Removing a provider that saved members reference shows a confirmation listing affected members and noting they will fall back to Gemini until reassigned.

## Error Handling

- Provider call failures surface as `<label>: <status> <message>` in the existing error toast/inline patterns.
- `test-provider` distinguishes: unreachable host, 401/403 (bad key), non-OpenAI-compatible response shape.
- Malformed `providers.json` → recreate built-ins from scratch (plus legacy migration if applicable) and log a warning; never crash startup.

## Testing

Engine (Vitest):

- `OpenAICompatibleProvider`: URL joining with/without trailing slash, keyless request has no `Authorization` header, error message includes `providerLabel`, missing-baseUrl rejection.
- `registry.ts` validation: legacy names accepted and normalized; valid slugs accepted; invalid strings rejected; Local CLI path unchanged.
- `getProvider` resolution: registry lookup by id, legacy-name mapping, env fallback when no registry is supplied.

Desktop: `npm run build:desktop` type-level validation (no test runner there yet).

Manual verification:

1. Fresh start with an existing `api-keys.json` → three built-ins appear configured.
2. Add Groq via preset; `Test` passes; assign to a member; run a discussion.
3. Add Ollama (keyless); model list loads from `/models`; run a discussion.
4. Legacy member file with `provider: "Claude"` runs unchanged.
5. Delete a custom provider referenced by a member → warning shown, member falls back.
