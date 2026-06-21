---
name: room-agent-extension
description: Guidelines for adding new AI agent personas, provider engines, and discussion pipelines to the ROOM engine.
---

# ROOM Agent & Engine Extension Guideline

Use this skill when adding or editing AI personas, LLM provider clients, or custom multi-agent workflows inside `packages/engine/`.

## 1. Adding a New Agent Persona
All AI agent definitions are central to `packages/engine/src/agents/personaTemplates.ts`.

### Steps:
1. Add a new object to the `PERSONA_TEMPLATES` array:
   ```typescript
   {
     name: 'TechnicalWriter',
     role: 'Technical Documentation Writer',
     provider: 'Gemini',
     prompt: `You are the Technical Documentation Writer for this workspace.
   Your job is to translate complex code layouts and ADR decisions into readable documentation...`
   }
   ```
2. **Rules for Prompts**:
   - **NO Language Policy**: Do NOT specify the language (e.g. "respond in English"). The engine runtime automatically appends the `LANGUAGE_POLICY`.
   - **NO Collaboration Protocols**: Do NOT define how they talk to other agents or request approvals. That is handled dynamically by the discussion engine.
   - **Reviewer Status**: If writing a reviewer-style persona, ensure it includes instructions to output `APPROVAL_STATUS: APPROVED` when satisfied.

3. **Scaffolding**:
   - If the new agent should be included in the default workspace team setup, add its name to `DEFAULT_MEMBER_NAMES` in `personaTemplates.ts`.

---

## 2. Implementing a New LLM Provider
Providers live in `packages/engine/src/providers/`.

- Every provider client must implement the base `Provider` interface (e.g., standardizing `generateText` or `chat`).
- **Credential Handling**:
  - Read keys from environment variables or `process.env`.
  - Validate credentials at initialization and throw informative errors if missing.
  - Never commit mock credentials or real API keys to the repository.
