# Codex Subscription Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI Codex subscription sessions, dynamic model selection, provider-safe history, and provider/model annotations without changing Engram learning data or behavior.

**Architecture:** A small JSON-RPC client drives `codex app-server`; a Codex session adapter implements Engram's existing session contract and normalizes Codex events into existing UI/transcript events. Provider metadata is persisted in the session index, while Settings and Home consume shared runtime descriptors.

**Tech Stack:** Electron 36, TypeScript 5.8, React 19, Vitest, Codex app-server JSON-RPC, MCP stdio bridge.

**Spec:** `docs/superpowers/specs/2026-09-07-codex-subscription-provider-design.md`

## Global Constraints

- Codex mode must use ChatGPT subscription authentication and reject API-key accounts.
- `~/.claude/learning` or the configured `ENGRAM_HOME` remains the only learning-state source of truth.
- The existing required Engram MCP bridge drives all interactive cards and questions.
- Blind assessor contexts must never receive tutor conversation history.
- Claude and Codex session identifiers must never be resumed by the other provider.
- No provider fallback is allowed after the learner makes a selection.

---

### Task 1: Provider settings and model catalog

**Files:**
- Create: `app/src/main/session/codexResolver.ts`
- Create: `app/src/main/session/codexAppServerClient.ts`
- Create: `app/src/main/session/codexModels.ts`
- Modify: `app/src/shared/types.ts`
- Modify: `app/src/main/session/authSettings.ts`
- Modify: `app/src/main/index.ts`
- Modify: `app/src/preload/index.ts`
- Modify: `app/src/renderer/src/app/SettingsView.tsx`
- Test: `app/src/main/session/codexAppServerClient.test.ts`
- Test: `app/src/main/session/authSettings.test.ts`

**Interfaces:**
- Produces: `resolveCodexBinary(): Promise<string>`.
- Produces: `CodexAppServerClient.request<T>(method: string, params?: unknown): Promise<T>`.
- Produces: `listCodexModels(): Promise<CodexModelOption[]>`.
- Produces: `AuthMode` member `codexSubscription` and `AuthSettings.codexModel`.

- [ ] **Step 1: Write failing tests** for response correlation, ChatGPT-account rejection, model response normalization, and persisted `codexModel`.
- [ ] **Step 2: Run `npm test -- codexAppServerClient.test.ts authSettings.test.ts`** and verify failures name the missing APIs.
- [ ] **Step 3: Implement the resolver, client, model catalog, settings field, IPC methods, and Codex picker.** The picker must include `{ value: '', label: 'Codex default' }` followed by visible server models.
- [ ] **Step 4: Re-run the focused tests** and verify they pass.

### Task 2: Provider-aware session identity and normalized history

**Files:**
- Create: `app/src/main/session/codexTranscript.ts`
- Modify: `app/src/main/session/sessionIndex.ts`
- Modify: `app/src/main/session/transcriptReader.ts`
- Modify: `app/src/shared/types.ts`
- Test: `app/src/main/session/sessionIndex.test.ts`
- Test: `app/src/main/session/codexTranscript.test.ts`

**Interfaces:**
- Produces: `SessionProvider = 'claude' | 'codex'`.
- Produces: `SessionIndexEntry.provider`, `.model`, and `.providerSessionId`.
- Produces: `appendCodexTranscript(sessionId: string, line: unknown): Promise<void>` and `readCodexTranscript(sessionId: string): Promise<unknown[]>`.
- Produces: `lastSessionEntryFor(key: string, provider: SessionProvider): Promise<SessionIndexEntry | null>`.

- [ ] **Step 1: Write failing tests** for legacy-Claude migration, provider-filtered lookup, metadata retention, and Claude-shaped Codex transcript rows.
- [ ] **Step 2: Run `npm test -- sessionIndex.test.ts codexTranscript.test.ts`** and verify expected failures.
- [ ] **Step 3: Implement metadata migration, provider lookup, app-owned transcript persistence, and transcript-reader routing.**
- [ ] **Step 4: Re-run the focused tests** and verify they pass.

### Task 3: Codex sitting driver and Engram bridge parity

**Files:**
- Create: `app/src/main/session/CodexSessionManager.ts`
- Create: `app/src/main/session/codexPermissions.ts`
- Modify: `app/src/main/session/permissionConfig.ts`
- Modify: `app/src/main/ipc/sessionHandlers.ts`
- Test: `app/src/main/session/CodexSessionManager.test.ts`
- Test: `app/src/main/ipc/sessionHandlers.test.ts`

**Interfaces:**
- Produces: `CodexSessionManager` with `sessionId`, `providerSessionId`, `provider`, `model`, `start`, `sendUserMessage`, `sendUserMessageWhenReady`, `abort`, and `event` emission.
- Consumes: the existing bridge worker, bridge tool list, provider-neutral appended instructions, resolved Engram skill paths, and session-index provider metadata.

- [ ] **Step 1: Write failing tests** for fresh skill invocation, required MCP config, ChatGPT auth enforcement, tool-use/result event mapping, resume, interruption, usage, turn completion, and cleanup.
- [ ] **Step 2: Run `npm test -- CodexSessionManager.test.ts sessionHandlers.test.ts`** and verify expected failures.
- [ ] **Step 3: Implement the Codex permissions/config builder and session adapter, then dispatch by selected auth mode.**
- [ ] **Step 4: Re-run the focused tests** and verify they pass.

### Task 4: Environment and handwriting parity

**Files:**
- Modify: `app/src/main/index.ts`
- Modify: `app/src/main/session/transcribeHandwriting.ts`
- Modify: `app/src/renderer/src/components/EnvironmentGate.tsx`
- Modify: `app/src/renderer/src/components/EnvironmentSteps.tsx`
- Modify: `app/src/renderer/src/shared/friendlyError.ts`
- Test: `app/src/main/session/transcribeHandwriting.test.ts`
- Test: `app/src/renderer/src/components/EnvironmentGate.test.tsx`

**Interfaces:**
- Produces: independent `codexOk`, `codexPath`, and `codexError` environment fields.
- Consumes: `CodexAppServerClient` for an ephemeral image-only transcription thread.

- [ ] **Step 1: Write failing tests** for selected-provider gating and image-only Codex transcription with no bridge, skill, or learning context.
- [ ] **Step 2: Run the focused tests** and verify failures are caused by missing Codex behavior.
- [ ] **Step 3: Implement selected-provider environment checks and isolated Codex transcription.**
- [ ] **Step 4: Re-run the focused tests** and verify they pass.

### Task 5: Provider/model corner annotations

**Files:**
- Create: `app/src/renderer/src/components/ProviderModelBadge.tsx`
- Modify: `app/src/renderer/src/app/HomeView.tsx`
- Modify: `app/src/renderer/src/app/MainMenuView.tsx`
- Modify: `app/src/renderer/src/components/SessionHistoryDrawer.tsx`
- Test: `app/src/renderer/src/components/ProviderModelBadge.test.tsx`

**Interfaces:**
- Produces: `ProviderModelBadge({ provider, model, className? })`.
- Consumes: current `AuthSettings` for Learn/Review/Coach entry cards and persisted `SessionIndexEntry` metadata for history rows.

- [ ] **Step 1: Write a failing rendering test** asserting compact `CODEX · <MODEL>` and `CLAUDE · <MODEL>` labels with accessible titles.
- [ ] **Step 2: Run the focused test** and verify it fails because the component is absent.
- [ ] **Step 3: Implement the token-based badge and place it in the bottom corner of the three conversation entry cards plus historical rows.**
- [ ] **Step 4: Re-run the focused test** and verify it passes.

### Task 6: Full verification

**Files:**
- Modify: `app/scripts/checkDoctrine.ts`
- Modify: `app/package.json`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a distributable app whose metadata describes both subscription providers.

- [ ] **Step 1: Add doctrine pins** for the Codex process door, ChatGPT-only auth, normalized transcript path, isolated transcription prompt, required MCP bridge, and learning-home writable root.
- [ ] **Step 2: Run `npm run typecheck`, `npm test`, `npm run check:doctrine`, and `npm run build`.**
- [ ] **Step 3: Run `npm run dist:prepare`** and verify the packaged resource layout includes the bridge worker and all provider code.
- [ ] **Step 4: Inspect the final diff and confirm the pre-existing `session-ses_0017.md` remains untouched and untracked.**

