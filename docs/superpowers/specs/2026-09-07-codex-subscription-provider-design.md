# Codex Subscription Provider Design

## Goal

Let a learner choose either Claude Code or OpenAI Codex as the subscription that drives an Engram sitting. Provider choice must not change Engram's learning home, topic graphs, receipts, review scheduling, interactive cards, blind grading, session history, mobile settling, or handwriting confirmation flow.

## User experience

Settings → Authentication adds **OpenAI Codex subscription** beside the existing Claude choices. Selecting it reveals a model picker populated by Codex's own `model/list` response; an empty saved model means “Codex default.” Engram verifies that the Codex CLI is logged into a ChatGPT account and refuses API-key authentication in this mode, preventing an accidental switch to usage-based API billing.

The Home menu's Learn, Review, and Coach entry cards carry a small bottom-corner annotation such as `CODEX · GPT-5.6-TERRA` or `CLAUDE · SONNET 5`. The annotation uses the existing label-data, border, and ink tokens. Historical sittings retain provider and model metadata, so later changes to Settings do not relabel earlier conversations.

## Runtime architecture

`CodexAppServerClient` owns one `codex app-server --listen stdio://` child and the line-delimited JSON-RPC lifecycle. It initializes the connection, checks `account/read`, requests `model/list`, starts or resumes threads, starts and interrupts turns, and exposes notifications without leaking reasoning text into the learner UI.

`CodexSessionManager` implements the same driven-session contract as the Claude manager. Each Engram sitting gets an app session ID and a persisted Codex thread ID. A fresh turn explicitly includes the selected Engram skill (`learn`, `review`, or `coach`) from the resolved installed plugin. The thread config registers the existing Engram UI bridge as a required stdio MCP server, registers Engram's Codex subagent definitions, pins the OpenAI provider and ChatGPT login method, and adds the same provider-neutral desktop instructions used by Claude.

Codex runs with `approvalPolicy: never` and a workspace-write policy whose writable root includes the learner's actual Engram home. Full filesystem reads remain available for learner-selected context files, while network access is disabled for shell commands; model traffic remains Codex's own authenticated connection. The existing bridge and Engram engine remain the only paths for asks, UI cards, receipts, and learning-state writes.

## Session identity and history

The session index gains `provider`, `model`, and `providerSessionId`. Legacy entries migrate in memory as Claude entries whose provider session ID equals their existing session ID. Resume lookup is filtered to the currently selected provider, so Engram never sends a Claude transcript ID to Codex or a Codex thread ID to Claude.

Codex events are normalized to the transcript shape already consumed by replay, ritual marks, verdict segments, exports, and provenance. User text, assistant text, bridge MCP tool uses, and bridge MCP results are appended to an app-owned Codex transcript. Native Codex reasoning, shell chatter, and subagent internals are omitted. Codex thread resume provides model context; the normalized transcript provides stable UI replay.

## Handwriting

When Codex is selected, handwriting transcription runs in an isolated ephemeral Codex thread with the selected model. It receives only the transcription instruction and local-image inputs, has read-only filesystem access, has no Engram bridge or skill, and returns only the agent message. The learner confirmation gate remains unchanged.

## Environment and failures

Environment checks report Claude and Codex independently and gate only the selected provider plus the Engram plugin. Missing CLI, missing ChatGPT login, API-key Codex login, unavailable model, required bridge startup failure, malformed protocol output, and failed turns become actionable session errors. There is no silent provider fallback.

## Testing

Unit tests cover JSON-RPC request correlation, Codex notification mapping, transcript normalization, provider-specific resume lookup and legacy migration, settings persistence/model discovery, provider annotation copy, environment gating, and isolated handwriting inputs. Existing typecheck, test, doctrine, production build, and packaging preparation checks must remain green.

