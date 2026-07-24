# Architecture

Engram Desktop is a thin, process-isolated shell around the `claude` CLI. It never
calls a model API directly: every learn, review, and coach turn is produced by a
`claude -p` child process running the installed engram plugin's skills, and the app's
own code is limited to spawning that process, streaming its output into the UI, and
standing in for the interactive prompts headless mode can't show on its own.

This document is the long-form version of the [README's architecture
diagram](../README.md#architecture-at-a-glance) — the two must agree; if something
here looks inconsistent with the README, the README's diagram is the summary and this
page is where the detail lives.

## Process model

Like any Electron app, Engram Desktop runs three separated contexts:

- **Main** (`app/src/main/`) — the Node process. Owns the `claude` child processes,
  the MCP bridge's loopback HTTP server, and all filesystem/IPC access.
- **Preload** (`app/src/preload/index.ts`) — the only bridge between renderer and
  main. It builds a single `engramApi` object and exposes it via
  `contextBridge.exposeInMainWorld('engram', engramApi)`, so renderer code calls
  `window.engram.startSession(...)`, `window.engram.due(...)`, etc. — never
  `ipcRenderer` or Node APIs directly.
- **Renderer** (`app/src/renderer/`) — the React UI. It only ever sees the typed
  `window.engram` surface: request/response calls like `startSession`,
  `sendMessage`, `getTranscript`, `getTopicSettings`, plus five subscription
  methods (`onSessionEvent`, `onBridgeAsk`, `onBridgeBeat`, `onBridgeUi`,
  `onNavigate`) that each return an unsubscribe function.

Every `window.engram` method is a thin wrapper around one `ipcMain.handle(...)`
registered in main — session lifecycle handlers live in
`app/src/main/ipc/sessionHandlers.ts`, and read-only engram-plugin queries
(`topics`, `stats`, `due`, `decay`, `next`, `doctor`, `model`, plus the settings
mutators `visuals`/`focus`/`modelSet`/`modelAddInterest`/`commit`) live in
`app/src/main/ipc/readHandlers.ts`.

## Session engine

`app/src/main/session/SessionManager.ts` owns one `claude` child process per live
session (`learn`, `review`, or `coach`). `app/src/main/ipc/sessionHandlers.ts` creates
a `SessionManager` on `session:start` (fresh) or `session:resume` (continues the last
session recorded for that key, falling back to fresh if none exists), tracks it in an
in-memory `Map<sessionId, SessionManager>`, and forwards every event it emits to the
renderer over `session:event` IPC messages.

### The exact CLI invocation

`SessionManager.start()` spawns `claude` with this argument list (from
`app/src/main/session/SessionManager.ts`):

```
-p
--input-format stream-json
--output-format stream-json
--include-partial-messages
--verbose
--tools <MINIMAL_TOOLS>
--disallowedTools <DISALLOWED_BASH_PATTERNS>
--allowedTools <bridge tool allowlist>
--permission-mode bypassPermissions
--mcp-config <per-session mcp-config.json path>
--strict-mcp-config
--append-system-prompt <APPEND_SYSTEM_PROMPT>
--session-id <sessionId>        # fresh session
--resume <sessionId>            # resumed session, in place of --session-id
```

`cwd` is always `homedir()`, and stdio is three plain pipes (`['pipe', 'pipe',
'pipe']`) — the process talks NDJSON over stdin/stdout, not a pty.

The tool surface comes from `app/src/main/session/permissionConfig.ts`:

- `--tools 'Bash,Write,Read,Task'` (`MINIMAL_TOOLS`) — exactly what the `/learn`,
  `/review`, and `/coach` skills are documented to use: `engram.py` via Bash,
  tmpfiles via Write, subagent spawns via Task, and Read (both `/learn` and
  `/review`'s `SKILL.md` open by instructing "Read dialogue-grammar.md now").
- `--disallowedTools` is a fine-grained denylist within Bash: `Bash(rm -rf *)`,
  `Bash(sudo *)`, `Bash(curl *)`, `Bash(wget *)`, `Bash(> /dev/sd*)`. A code comment
  in `permissionConfig.ts` records that this denylist is still enforced even under
  `bypassPermissions` (confirmed by direct repro — `rm -rf` was denied with bypass
  active), which is what keeps a "scoped allowlist" intent alive despite the
  blunter `--permission-mode` flag.
- `--allowedTools` names the eight MCP bridge tools individually (see below),
  namespaced `mcp__engram-ui-bridge__<tool>`.
- `--permission-mode bypassPermissions` is required for `--input-format
  stream-json` to run any tool at all — without it every Bash call is denied with
  a generic "requires approval" gate, per a comment in `SessionManager.ts`
  documenting a direct repro (`-p "text"` mode without stream-json input does not
  have this requirement).
- `--append-system-prompt` carries `APPEND_SYSTEM_PROMPT` from
  `permissionConfig.ts`, which explains to the model that it's running headless
  under Engram Desktop, that the native `AskUserQuestion` tool doesn't exist here
  and `ask_user_question` replaces it, and documents the other eight advisory
  bridge tools. When a topic has per-topic extra instructions or context files
  (see Data locations below), `sessionHandlers.ts`'s `buildExtraInstructions()`
  appends them to this same string — never a separate prompt, so the addition is
  always additive on top of the base instructions and the installed skill files
  are never forked.

Resuming a session (`--resume` instead of `--session-id`) does not accept a new
`--append-system-prompt` — the prior turn's system prompt already governs the
conversation — so `extraInstructions` is only applied on a fresh start;
`SessionManager.start()` skips it when `resumeSessionId` is set. For the same
reason, resume also skips re-sending the kickoff message: a resumed session already
has full prior context, so sending it again would land as a spurious extra turn.

### stdin/stdout protocol

Once spawned, the app and the CLI child exchange NDJSON:

- **App → CLI**: `sendUserMessage(text)` writes one line of
  `{"type":"user","message":{"role":"user","content":text}}` to the child's stdin.
  This is how `session:send` (and the initial kickoff message on a fresh session)
  reach the model.
- **CLI → App**: `handleStdout()` runs each line through an `NdjsonLineSplitter`
  and dispatches on the parsed `type` field:
  - `assistant` — content blocks become `SessionTextEvent` (`type: 'text'`) or
    `SessionToolUseEvent` (`type: 'tool_use'`).
  - `user` — `tool_result` blocks (tool call outputs) become
    `SessionToolResultEvent`.
  - `rate_limit_event` — becomes `SessionRateLimitEvent`.
  - `result` — end of the current conversational turn. Emits a `SessionUsageEvent`
    (from `usage`/`modelUsage` token accounting) followed by a
    `SessionTurnEndedEvent`; the child process itself stays alive for the next
    stdin message.

All of these event shapes are defined in `app/src/shared/sessionEvents.ts` and
forwarded to the renderer unchanged by `sessionHandlers.ts`'s `session:event` IPC
channel.

### Crash detection and resume

The child's `'close'` event (process actually exited, not just a turn ending) becomes
a `SessionClosedEvent` (`{ type: 'closed', exitCode }`). The renderer distinguishes a
deliberate stop from a real crash with a ref set right before an intentional abort
(`intentionalStopRef` in `LearnSessionView.tsx`): if the stop was intentional, the UI
just clears its busy state; otherwise it shows an inline "session process ended
unexpectedly — your progress is stashed on disk, safe to reopen" banner with a Resume
button that re-opens the topic.

Reopening replays history from Claude Code's own on-disk transcript rather than any
state this app kept: `ipcMain.handle('session:transcript', ...)` in
`sessionHandlers.ts` calls `readTranscript(sessionId)`
(`app/src/main/session/transcriptReader.ts`), which reads
`~/.claude/projects/<flattened-cwd>/<sessionId>.jsonl` — the same NDJSON file Claude
Code itself persists every session to, since `SessionManager` always spawns with `cwd:
homedir()`. A missing file (brand-new session id) just replays as empty, not an error.

## MCP bridge

Headless `-p` mode has no native way to prompt a human, so the app plugs the gap with
its own MCP server. `--mcp-config` points at a small per-session config
(`permissionConfig.ts`'s `prepareSessionPermissions()`) that tells `claude` to spawn
`app/src/main/bridge/mcpBridgeWorker.mjs` as a stdio MCP server named
`engram-ui-bridge`, with `ENGRAM_BRIDGE_PORT` and `ENGRAM_BRIDGE_SESSION_ID`
environment variables and `ELECTRON_RUN_AS_NODE: '1'` (needed because in a packaged
build `process.execPath` is the branded app binary itself, not plain Node — without
this flag, spawning it just launches a second full app instance that hits the app's
own single-instance lock and quits).

`mcpBridgeWorker.mjs` is deliberately plain, unbundled Node ESM — not run through
electron-vite — so `claude` can spawn it directly with `node <file>`. For a packaged
build it's still shipped as a compiled artifact: esbuild bundles it at build time and
electron-builder ships the bundle via `extraResources`, read back at runtime from
`process.resourcesPath` (`permissionConfig.ts`'s `resolveBridgeWorkerPath()`); in
dev/`build`+`start` it resolves straight from the source tree instead.

### The nine bridge tools

All registered in `mcpBridgeWorker.mjs`, namespaced `mcp__engram-ui-bridge__<name>`:

| Tool | Purpose |
|---|---|
| `ask_user_question` | Blocking single/multi-pick question, standing in for the native `AskUserQuestion` tool that doesn't exist headless. |
| `render_beat` | Advisory: announce which dialogue-grammar beat (open_gap, predict, struggle, resolve, self_explain, connect) is starting, with node/position, so the app renders a purpose-built card instead of plain text. |
| `session_phase` | Advisory: signal a coarse phase transition (intake, pretest, walk, grading, closing) so the app stages its chrome. |
| `beat_outcome` | Advisory: report how a previously announced beat resolved (confirmed, partial, missed) so the beat trail inks honestly. |
| `spotlight_node` | Advisory: point the learner at a node on the Topic Map, e.g. during a CONNECT beat. |
| `show_figure` | Advisory: push a small markdown figure card (table, list, callout) into the transcript, set apart from prose. |
| `suggest_action` | Advisory: offer up to 3 one-click action chips (open_explorable, show_on_map, go_review, prefill — prefill never auto-sends). |
| `progress_note` | Advisory: a one-line session-plan status shown under the header. |
| `annotate_node` | Advisory: LaTeX display overrides for a Topic Map node (`latex_label` for the plate caption, `latex_claim` for the drawer/modal claim) — persisted app-side in `map-annotations.json`, never engram's own graph files. |

Only `ask_user_question` genuinely blocks — its handler awaits the HTTP relay's
response before returning. Every other tool is fire-and-forget: `render_beat` posts
inline to its own `/beat` endpoint, while the remaining seven advisory tools funnel
through a shared `fireUi()` helper that POSTs to `/ui`. Both paths immediately return
`{ content: [{ type: 'text', text: 'ok' }] }` without waiting, and the POST itself is
`.catch(() => {})`'d — a relay failure never blocks or breaks the dialogue. The system prompt built in `permissionConfig.ts` reiterates this:
these tools are optional, "the app degrades gracefully" if the model skips them, and
they exist to serve orientation, never to replace the dialogue itself.

### Loopback HTTP relay

The worker talks MCP to `claude` on stdio and plain HTTP to the main process on the
other side. `app/src/main/bridge/bridgeServer.ts`'s `BridgeServer` listens on an
OS-assigned loopback port (`127.0.0.1`, port `0`) and routes three URL shapes, each
scoped by session id:

- `POST /bridge/:sessionId/ask` — parses the body into a `BridgeAskRequest`, sends it
  to the renderer as a `bridge:ask` IPC event, and holds the HTTP response open in a
  `pendingAsks` map until `bridgeServer.answer(requestId, response)` is called — which
  happens when the renderer calls `window.engram.answerBridgeQuestion(...)`, wired to
  the `bridge:answer` IPC handler in `sessionHandlers.ts`. This is what makes the MCP
  `ask_user_question` tool_use call genuinely block on a real human click.
- `POST /bridge/:sessionId/beat` — forwards the body plus `sessionId` to the renderer
  as a `bridge:beat` event and replies `{ ok: true }` immediately (no blocking).
- `POST /bridge/:sessionId/ui` — the generic fire-and-forget channel for the other seven
  advisory tools; forwards `{ tool, payload, sessionId }` to the renderer as a
  `bridge:ui` event and replies `{ ok: true }` immediately. `annotate_node` is the one
  exception that also persists server-side: the handler shape-guards the payload
  (string types, length caps, topic/node id charset) and, if it passes, writes it to
  `map-annotations.json` before forwarding the event on.

The wire shapes are the shared contract in `app/src/shared/bridgeProtocol.ts`
(`BridgeAskRequest`, `BridgeAskResponse`, `BridgeBeatRequest`, `BridgeUiRequest`).

### Advisory-only contract and shape-guarding

Everything except `ask_user_question` is explicitly advisory: none of the eight
one-way UI tools can block or fail the session, and their payloads are typed only
as `Record<string, unknown>` at the protocol boundary. `bridgeProtocol.ts` notes
directly on `BridgeUiRequest` that `payload` is "that tool's zod-validated input"
on the way out of the worker, but the renderer "must still shape-guard before use"
— the MCP worker validates its own tool inputs against zod schemas before it ever
POSTs, but nothing re-validates the JSON on the Electron side of the HTTP hop, so
renderer code that consumes `bridge:ui` payloads treats every field as untrusted
and checks types before use rather than assuming the zod-validated shape survived
the round trip.

## Transcript hydration

Reopening a session does not replay the live IPC events that built the original UI
state — those only ever existed in that earlier renderer instance's memory. Instead,
`app/src/shared/bannerFromTranscript.ts` reconstructs UI state directly from the JSONL
transcript fetched via `session:transcript`:

- `extractBannerFromTranscript()` walks `assistant` lines' `tool_use` blocks, looking
  for `mcp__engram-ui-bridge__render_beat` and `mcp__engram-ui-bridge__beat_outcome`
  calls — the same signals that drove the live banner the first time — and replays
  them in order to rebuild the current beat, node, position, and the beat trail (a
  `Map<string, BeatOutcome>`). A `render_beat` call that names a new node resets the
  trail, matching the live-session reset behavior.
- `extractLastWalkFromTranscript()` scans `user` lines' `tool_result` blocks for the
  last batch of parseable grade results (via `parseGradeResults()`), producing a
  `{ graded, shaky }` summary that feeds the reopened session's "last walk: N graded,
  one shaky" recap line. Returns `null` when the transcript carries no grade batches
  (e.g. a topic's first sitting).

Because both are derived straight from the durable JSONL record rather than any
UI-side cache, the banner and last-walk recap populate correctly on reopen even
though the render_beat/beat_outcome calls that produced them happened in a Session
that is no longer running.

## Data locations

Engram Desktop keeps a small set of files in Electron's per-app `userData`
directory — on macOS, `~/Library/Application Support/Engram Desktop`. These are UI
conveniences only:

- `topic-settings.json` — per-topic app-local customization
  (`app/src/main/session/topicSettings.ts`): free-text appended to a topic's
  system prompt (`systemPromptExtra`) and a list of absolute paths the model is
  told to Read at the start of every fresh session for that topic
  (`contextFiles`). Deliberately not part of the engram plugin's own schema —
  the plugin's files are never forked, only extended via
  `--append-system-prompt`, same principle as the MCP bridge's system-prompt
  addition.
- `map-annotations.json` — `{ topicId -> { nodeId -> { latexLabel?, latexClaim? } } }`
  (`app/src/main/session/mapAnnotations.ts`): LaTeX display overrides for Topic Map
  nodes, set by the advisory `annotate_node` bridge tool. Same not-part-of-the-plugin's-
  schema principle as `topic-settings.json` above — never written into engram's own
  `graphs/*.json`.
- `session-index.json` — `{ key -> SessionIndexEntry[] }`
  (`app/src/main/session/sessionIndex.ts`), an append-only history of session ids
  per key (a topic id for `learn`, or the literal kind for `review`/`coach`), used
  to resume the last session for a key and to browse past session history.
- `achievements.json`, `notifier-state.json`, and Electron's own window-state file
  — further UI-only conveniences (unlocked-achievement tracking, review-notifier
  state, remembered window bounds/position).

None of these files are the source of truth for any learning state. The engram
plugin's own files (topic graphs, receipts, the learner model, FSRS scheduling data)
remain authoritative regardless of what this app's `userData` directory contains —
losing `session-index.json`, for instance, only means resume/history forgets past
session ids; it has no effect on what has actually been taught, graded, or scheduled.
