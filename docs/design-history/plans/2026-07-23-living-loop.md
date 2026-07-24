# Living Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the MCP bridge with beat telemetry + four tutor-driven UI tools, consume them in the renderer (beat trail, spotlight, figures, action chips, phases, progress notes), and add three interaction features (recall chamber, calibration mirror, why-chain), per `docs/superpowers/specs/2026-07-23-living-loop-design.md`.

**Architecture:** Tasks 1-3 build the bridge surface (protocol/server/preload → worker tools → system prompt). Tasks 4-6 consume it (beat trail; Learn `bridge:ui` dispatch + figure/chips; spotlight plumbing). Tasks 7-9 are the interaction features (chamber, calibration, why-chain). Fire-and-forget contract throughout: signals are advisory, UI degrades gracefully, old sessions on the old worker keep working.

**Tech Stack:** Node ESM MCP worker (zod), Electron IPC, React 19, Night Atlas primitives.

## Global Constraints

- Philosophy is binding: no grade softening, no auto-sent messages from chips (`prefill` only fills the composer), recall chamber is invited with no peek logging, all new signals advisory.
- No engram.py/skill-file changes. `/ask` + `/beat` routes and their behavior unchanged.
- Model payloads are untrusted data: zod at the worker, shape-guards in the renderer, markdown only (through the existing MarkdownPreview path), never raw HTML, whitelisted action kinds, `open_explorable` args validated against known artifact paths.
- Verification per task: `npm run typecheck && npm run build` clean in `app`. `noUnusedLocals: true`. No interactive verification during implementation.
- Commit per task with the given message, on `master`.

---

### Task 1: Bridge protocol + server route + preload

**Files:**
- Modify: `app/src/shared/bridgeProtocol.ts`
- Modify: `app/src/main/bridge/bridgeServer.ts`
- Modify: `app/src/preload/index.ts`

**Interfaces (produced):**
- `BridgeBeatRequest` gains `node?: string; position?: string`.
- `export interface BridgeUiRequest { sessionId: string; tool: string; payload: Record<string, unknown> }`
- Preload: `onBridgeUi: (cb: (req: BridgeUiRequest) => void) => () => void` (channel `bridge:ui`).

- [ ] **Step 1:** `bridgeProtocol.ts`: add the two optional fields to `BridgeBeatRequest` with a comment ("extended beat telemetry — the worker may attach the node id and a 'n/of' session position") and append the `BridgeUiRequest` interface with a comment ("generic fire-and-forget tutor-driven UI signal; `tool` names which MCP tool fired, `payload` is that tool's zod-validated input — renderer must still shape-guard before use").
- [ ] **Step 2:** `bridgeServer.ts` `handleRequest`: add after `beatMatch`:

```ts
    const uiMatch = url.match(/^\/bridge\/([^/]+)\/ui$/)
```

and after the beat block:

```ts
    if (uiMatch) {
      const sessionId = decodeURIComponent(uiMatch[1])
      const payload = JSON.parse(body) as Omit<BridgeUiRequest, 'sessionId'>
      this.window?.webContents.send('bridge:ui', { ...payload, sessionId } as BridgeUiRequest)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
```

Import `BridgeUiRequest` in the type import line.
- [ ] **Step 3:** preload: add next to `onBridgeBeat` (import `BridgeUiRequest` from bridgeProtocol):

```ts
  onBridgeUi: (cb: (req: BridgeUiRequest) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, req: BridgeUiRequest) => cb(req)
    ipcRenderer.on('bridge:ui', handler)
    return () => ipcRenderer.removeListener('bridge:ui', handler)
  },
```

- [ ] **Step 4:** `npm run typecheck && npm run build` clean.
- [ ] **Step 5:** Commit: `feat(loop): bridge:ui generic relay route and protocol types`

---

### Task 2: Worker tools

**Files:**
- Modify: `app/src/main/bridge/mcpBridgeWorker.mjs`

- [ ] **Step 1:** Extend `render_beat`'s inputSchema with `node: z.string().optional(), position: z.string().optional()`, pass both through in the `/beat` POST body, and append to its description: `" Include node (the node id you're teaching) and position (like '2/3' — node n of the session's planned m) whenever you know them."`
- [ ] **Step 2:** Add a small helper under `postJson`:

```js
function fireUi(tool, payload) {
  postJson(`/bridge/${encodeURIComponent(SESSION_ID)}/ui`, { tool, payload }).catch(() => {})
  return { content: [{ type: 'text', text: 'ok' }] }
}
```

- [ ] **Step 3:** Register the six new tools, all `async (args) => fireUi('<name>', args)`:

```js
const BEATS = ['open_gap', 'predict', 'struggle', 'resolve', 'self_explain', 'connect']

server.registerTool('session_phase', {
  title: 'Session Phase',
  description: 'Advisory, best-effort: signal the coarse session phase so the app can stage its chrome (opening plate, grading shimmer, closing ceremony). Call at each transition: intake (new-topic interview), pretest, walk (teaching nodes), grading (assessor running), closing (wrap-up).',
  inputSchema: { phase: z.enum(['intake', 'pretest', 'walk', 'grading', 'closing']), note: z.string().optional() },
}, async (args) => fireUi('session_phase', args))

server.registerTool('beat_outcome', {
  title: 'Beat Outcome',
  description: "Advisory, best-effort: when a beat you announced via render_beat resolves, report how it went — confirmed (the learner's prediction/production held), partial, or missed. The app inks the beat trail accordingly.",
  inputSchema: { beat: z.enum(BEATS), outcome: z.enum(['confirmed', 'partial', 'missed']), note: z.string().optional() },
}, async (args) => fireUi('beat_outcome', args))

server.registerTool('spotlight_node', {
  title: 'Spotlight Node',
  description: "Advisory, best-effort: point the learner at a node on their Topic Map — e.g. during CONNECT, spotlight the related node you're linking to. Pans/highlights the map (or badges the map tab if they're elsewhere). Never blocks.",
  inputSchema: { topic: z.string(), node: z.string(), reason: z.string().optional() },
}, async (args) => fireUi('spotlight_node', args))

server.registerTool('show_figure', {
  title: 'Show Figure',
  description: 'Advisory, best-effort: push a small figure card into the transcript — a markdown table, list, or callout that deserves framing beyond plain prose. Markdown only. Use sparingly, for content that genuinely benefits from being set apart.',
  inputSchema: { title: z.string().optional(), body: z.string() },
}, async (args) => fireUi('show_figure', args))

server.registerTool('suggest_action', {
  title: 'Suggest Action',
  description: "Advisory, best-effort: offer the learner up to 3 one-click action chips instead of describing what they could do. Kinds: open_explorable (arg = artifact path you were given), show_on_map (spotlight the current node), go_review (jump to the review queue), prefill (arg = text placed in their composer — never auto-sent). Chips are replaced by your next call and cleared when the learner sends a message.",
  inputSchema: {
    actions: z.array(z.object({
      label: z.string(),
      kind: z.enum(['open_explorable', 'show_on_map', 'go_review', 'prefill']),
      arg: z.string().optional(),
    })).max(3),
  },
}, async (args) => fireUi('suggest_action', args))

server.registerTool('progress_note', {
  title: 'Progress Note',
  description: "Advisory, best-effort: a one-line session-plan status the app shows under the header (e.g. 'node 2 of 3 — one struggle beat to go'). Replaces the previous note.",
  inputSchema: { text: z.string() },
}, async (args) => fireUi('progress_note', args))
```

(Reuse `BEATS` in render_beat's enum too.)
- [ ] **Step 4:** typecheck + build clean (the .mjs isn't typechecked — build confirms nothing else broke; also run `node --check app/src/main/bridge/mcpBridgeWorker.mjs` and include its output in the report).
- [ ] **Step 5:** Commit: `feat(loop): six advisory bridge tools + beat telemetry payload`

---

### Task 3: System prompt + allowedTools

**Files:**
- Modify: `app/src/main/session/permissionConfig.ts`

- [ ] **Step 1:** In `APPEND_SYSTEM_PROMPT`: change the intro to "Three things differ"; extend point 2's render_beat sentence with "Include node and position ('n/of') when you know them."; add point 3:

```
3. A set of additional optional MCP tools lets you drive the app's UI as you teach. All are advisory and never block — skip any of them freely; the app degrades gracefully. Available: mcp__${BRIDGE_SERVER_NAME}__session_phase (call at each coarse phase transition: intake, pretest, walk, grading, closing); mcp__${BRIDGE_SERVER_NAME}__beat_outcome (when a beat resolves, report confirmed/partial/missed so the learner's beat trail inks honestly); mcp__${BRIDGE_SERVER_NAME}__spotlight_node (point at a node on the learner's Topic Map — especially during CONNECT beats); mcp__${BRIDGE_SERVER_NAME}__show_figure (a small markdown figure card set apart from prose — use sparingly); mcp__${BRIDGE_SERVER_NAME}__suggest_action (up to 3 one-click chips: open_explorable, show_on_map, go_review, prefill — prefill never auto-sends); mcp__${BRIDGE_SERVER_NAME}__progress_note (one-line session-plan status). These serve the learner's orientation — never let them replace the dialogue itself.
```

- [ ] **Step 2:** Find where `allowedTools` is assembled (grep `allowedTools` in the file, around the `mcpServers` config ~line 76+) and add the six new `mcp__engram-ui-bridge__<tool>` names alongside the existing two, matching the existing format exactly.
- [ ] **Step 3:** typecheck + build clean.
- [ ] **Step 4:** Commit: `feat(loop): system prompt + allowlist for the advisory tool surface`

---

### Task 4: Beat trail + position (BeatStepper + Learn wiring)

**Files:**
- Modify: `app/src/renderer/src/components/BeatStepper.tsx`
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

- [ ] **Step 1:** BeatStepper (read it first): add optional prop `trail?: Map<string, 'visited' | 'confirmed' | 'partial' | 'missed'>`. Rendering per step: current beat keeps today's active treatment (+ gentle pulse via the existing consolidate-ping-style class if one applies cleanly); non-current beats present in `trail` render inked by outcome — `confirmed` → `text-[var(--color-ink-warm)]`, `partial`/`visited` → `text-[var(--color-ink-warm-dim)]`, `missed` → `text-[var(--color-ink-danger)]`; absent beats keep the dim default.
- [ ] **Step 2:** Learn wiring: `const [beatTrail, setBeatTrail] = useState<Map<string, 'visited' | 'confirmed' | 'partial' | 'missed'>>(new Map())` and `const [nodePosition, setNodePosition] = useState<string | null>(null)`. In `onBridgeBeat`: mark the PREVIOUS `currentBeat` (if any, and not already outcome-tinted) as `'visited'` in the trail, then set the new beat; if `req.node`/`req.position` present, set `currentNodeId`/`nodePosition` from them (the render_beat signal is at least as reliable as the Bash inference). Reset trail + position at node crossings (the `lastNodeIdRef` change point) and in `resetSessionEphemera`.
- [ ] **Step 3:** Pass `trail={beatTrail}` to `<BeatStepper>`; render `nodePosition` beside the node title as `label-data` dim text (`node {nodePosition}` — e.g. "node 2/3") when non-null.
- [ ] **Step 4:** typecheck + build clean.
- [ ] **Step 5:** Commit: `feat(loop): beat trail with outcome inking and session position`

---

### Task 5: Figure card + action chips (presentational) and Learn bridge:ui dispatch

**Files:**
- Modify: `app/src/renderer/src/components/ritual/Marks.tsx` (figure kind)
- Create: `app/src/renderer/src/components/ritual/ActionChips.tsx`
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

**Interfaces:**
- `RitualMark` union gains `| { kind: 'figure'; title: string | null; body: string }`; `MarkView` dispatches it to a new `FigureCard`.
- `ActionChips({ actions, onAct }: { actions: SuggestedAction[]; onAct: (a: SuggestedAction) => void })` with `export type SuggestedAction = { label: string; kind: 'open_explorable' | 'show_on_map' | 'go_review' | 'prefill'; arg?: string }`.

- [ ] **Step 1:** Marks.tsx: add the `figure` member; `FigureCard`: a `panel` card (max-w-[85%]) with serif title (when non-null) and `<MarkdownPreview source={body} />` (import from `../MarkdownPreview` — check the component's real prop name first and use it).
- [ ] **Step 2:** ActionChips.tsx: a `flex flex-wrap gap-2` row of ghost-styled chip buttons (`focus-ring rounded-full border border-[var(--color-hairline)] px-3 py-1 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-ink-warm)] hover:border-[var(--color-ink-warm-dim)]`), each `onClick={() => onAct(a)}`, with a leading `fig-caption` "the tutor suggests —" label.
- [ ] **Step 3:** Learn dispatch — add ONE `onBridgeUi` subscription next to `onBridgeBeat` (same sessionId gate, unsubscribed in the same cleanup). Shape-guard every payload (typeof checks) before use; unknown tools ignored:
  - `session_phase`: `const [sessionPhase, setSessionPhase] = useState<string | null>(null)` — `intake` hides the opening plate (`activeTopic != null && sessionPhase !== 'intake'` gate); `grading` also sets `gradingPending` true (clear on results as today); `closing` is accepted but ceremony still keys off receipt results (fallback unchanged). Reset in `resetSessionEphemera`.
  - `beat_outcome`: set `beatTrail.set(payload.beat, payload.outcome)` (new Map copy).
  - `show_figure`: `pushMark({ kind: 'figure', title: payload.title ?? null, body: String(payload.body) })`.
  - `suggest_action`: validate: array, ≤3, each with string label + whitelisted kind; store `const [suggestedActions, setSuggestedActions] = useState<SuggestedAction[]>([])` (replace wholesale). Cleared in `submitProduction` (user send), `resetSessionEphemera`.
  - `progress_note`: `const [progressNote, setProgressNote] = useState<string | null>(null)`; rendered as a `fig-caption` line under the header row; reset in `resetSessionEphemera`.
  - `spotlight_node`: forward to the `onSpotlight` prop (Task 6 adds it; in THIS task add the optional prop `onSpotlight?: (s: { topicId: string; nodeId: string }) => void` to LearnSessionView and call it — App wiring lands in Task 6).
- [ ] **Step 4:** Render `<ActionChips actions={suggestedActions} onAct={handleSuggestedAction} />` above the composer when non-empty. `handleSuggestedAction`: `prefill` → `setProduction(a.arg ?? '')` (the composer's state setter — find its real name); `open_explorable` → only if `a.arg` matches a known artifact path (check against `jobs` artifactPath values and/or `window.engram.artifactList()` result cached in state) then `window.engram.openArtifact(arg)`; `show_on_map` → `onSpotlight?.({ topicId: activeTopic.topic, nodeId: currentNodeId ?? '' })` when currentNodeId non-null; `go_review` → new optional prop `onGoReview?: () => void` (App wires to `setView('review')` in Task 6). Chips clear after any act.
- [ ] **Step 5:** typecheck + build clean.
- [ ] **Step 6:** Commit: `feat(loop): figure cards, action chips, and the bridge:ui dispatch`

---

### Task 6: Spotlight plumbing (App + TopicMapView + nav badge)

**Files:**
- Modify: `app/src/renderer/src/App.tsx`
- Modify: `app/src/renderer/src/app/TopicMapView.tsx`

- [ ] **Step 1:** App: `const [pendingSpotlight, setPendingSpotlight] = useState<{ topicId: string; nodeId: string } | null>(null)`. Pass to LearnSessionView: `onSpotlight={(s) => setPendingSpotlight(s)}` and `onGoReview={() => setView('review')}`. Nav rail: the `topics` item shows the same warm dot treatment as the learn/review activity dots when `pendingSpotlight != null && view !== 'topics'` (static dot, no ping).
- [ ] **Step 2:** TopicMapView: new props `spotlightNode?: { topicId: string; nodeId: string } | null; onSpotlightConsumed?: () => void`. Mirror the deepLinkNode flow exactly (topic-select effect + graph-wait effect) but the final effect sets ONLY `setSelectedNode(nodeId)` — no `setOpenNode` — then consumes. App passes `spotlightNode={pendingSpotlight}` `onSpotlightConsumed={() => setPendingSpotlight(null)}` on the topics view.
- [ ] **Step 3:** typecheck + build clean.
- [ ] **Step 4:** Commit: `feat(loop): tutor spotlight pans the map or badges the nav`

---

### Task 7: Recall chamber

**Files:**
- Modify: `app/src/renderer/src/components/MessageComposer.tsx`
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx`
- Modify: `app/src/renderer/src/index.css`

- [ ] **Step 1:** index.css: add to components layer:

```css
  .chamber-blur {
    filter: blur(7px);
    pointer-events: none;
    user-select: none;
    transition: filter 0.35s ease-out;
  }
  @keyframes chamber-invite { 0%,100% { opacity: 0.55 } 50% { opacity: 1 } }
  .chamber-invite { animation: chamber-invite 2.2s ease-in-out infinite; }
```

- [ ] **Step 2:** MessageComposer: new optional props `chamber?: boolean; onChamberChange?: (on: boolean) => void; inviteChamber?: boolean`. In the bottom-left controls row: when `onChamberChange` provided, a ghost button — label "Begin recall" (with `chamber-invite` class when `inviteChamber && !chamber`) toggling to "Leave chamber" when active. When `chamber`, textarea `rows={12}` and a `fig-caption` line above the textarea: "recall chamber — nothing to look back at". Submit path additionally calls `onChamberChange?.(false)`.
- [ ] **Step 3:** Learn: `const [chamber, setChamber] = useState(false)`; wrap the transcript scroll region's container with `className={chamber ? 'chamber-blur …existing' : '…existing'}`; pass `chamber={chamber} onChamberChange={setChamber} inviteChamber={currentBeat === 'verify'}` to the composer; reset `chamber` in `resetSessionEphemera`. Review: same wiring, `inviteChamber={false}` (always-available subtle button), blur its message list region, reset on session end/start.
- [ ] **Step 4:** typecheck + build clean.
- [ ] **Step 5:** Commit: `feat(loop): invited recall chamber — blur the past, face the page`

---

### Task 8: Calibration mirror

**Files:**
- Create: `app/src/renderer/src/shared/calibrationStore.ts`
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx`
- Modify: `app/src/renderer/src/components/GradeResultCard.tsx`
- Modify: `app/src/renderer/src/app/DashboardView.tsx`

- [ ] **Step 1:** calibrationStore.ts:

```ts
/** Local-only record of confidence picks, paired later against assessor
 * grades for the calibration mirror. Ring buffer in localStorage — the
 * engine knows nothing about this; grades are never affected. */
export interface ConfidencePick {
  topic: string
  node: string
  label: string
  ts: number
}

const KEY = 'engram-confidence-picks'
const MAX = 200

function load(): ConfidencePick[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as ConfidencePick[]) : []
  } catch {
    return []
  }
}

export function recordConfidence(topic: string, node: string, label: string): void {
  const picks = load()
  picks.push({ topic, node, label, ts: Date.now() })
  try {
    localStorage.setItem(KEY, JSON.stringify(picks.slice(-MAX)))
  } catch {
    // Full/blocked storage just means no mirror — never let it break the loop.
  }
}

/** Most recent pick for a node within the last 6 hours — the same sitting. */
export function latestPickFor(node: string): ConfidencePick | null {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000
  const picks = load()
  for (let i = picks.length - 1; i >= 0; i--) {
    if (picks[i].node === node && picks[i].ts >= cutoff) return picks[i]
  }
  return null
}

export function allPicks(): ConfidencePick[] {
  return load()
}
```

- [ ] **Step 2:** Both session views' `answerAsk`: before forwarding, if `askRequest.header === 'Confidence' && chosen && chosen[0]`, call `recordConfidence(topicId, nodeId, chosen[0])` — Learn uses `activeTopic?.topic` + `currentNodeId` (skip when either is null); Review uses `current.topic` + `current.id` (check the real field names on its current item).
- [ ] **Step 3:** GradeResultCard: optional `confidenceLabel?: string | null` prop; when non-null render a fig-caption mirror line: `felt "{confidenceLabel}" → {result.grade}`. Call sites: Review's `lastGrade` card passes `latestPickFor(lastGrade.node)?.label ?? null`; Learn's ceremony per-node rows may skip it (keep scope tight — mirror on Review's live card only; note this in the report).
- [ ] **Step 4:** DashboardView: a "Calibration" Section (existing Section pattern + DendriteDivider): join `allPicks()` with `receiptsHistory.days[].items` by topic+node where the pick's date (`new Date(ts)` → YYYY-MM-DD) equals the day's `date`; classify: confident labels (the two high-confidence bands — inspect the real confidence labels used by the skill's picker via `AskDialog`'s CONFIDENCE_STYLE or the transcript convention; treat the top two as "felt sure") vs grade `recalled` or not → counts of overconfident (felt sure, not recalled), underconfident (felt shaky, recalled), calibrated (the rest). Render three StatBlocks + a fig-caption line ("Fig. — how your felt-sense tracks the assessor"). Empty state: fig-caption "no paired picks yet".
- [ ] **Step 5:** typecheck + build clean.
- [ ] **Step 6:** Commit: `feat(loop): calibration mirror — confidence picks meet their grades`

---

### Task 9: Why-chain unfolding

**Files:**
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

- [ ] **Step 1:** State: `const [whyChainOpen, setWhyChainOpen] = useState(false)` + `const [topicGraphCache, setTopicGraphCache] = useState<TopicGraph | null>(null)` (typed via `shared/types`' TopicGraph; fetch `window.engram.topicGraph(activeTopic.topic)` once when a session opens — reuse the openTopic entry points; reset cache+open in `resetSessionEphemera`).
- [ ] **Step 2:** Header: next to the node title (the `humanizeNodeId(currentNodeId)` span), when `currentNodeId` and the cached graph has that node with a non-empty `why_chain`, render a ghost "why?" button toggling `whyChainOpen`.
- [ ] **Step 3:** Panel: when open, an ink panel directly under the header row: fig-caption "Fig. — why this is true", then each `why_chain` string as a row with `<InkNode id={`why-${i}`} variant="outlined" color="var(--color-ink-cool)" size={10} />` and the step text (text-xs, serif). Closes on node crossing (reset alongside the trail).
- [ ] **Step 4:** typecheck + build clean.
- [ ] **Step 5:** Commit: `feat(loop): why-chain unfolds beneath the node title`

---

## Final verification (after all tasks + whole-branch review)

1. `npm run typecheck && npm run build` clean; `node --check` on the worker.
2. Interactive pass per the spec (fresh session required for the new worker): new tools called (transcript check), trail inks, spotlight pans/badges, figures + chips render and act safely, progress note updates, chamber enters/exits on VERIFY, confidence→grade mirror line, Coach calibration section, why-chain unfolds.
3. Packaged rebuild/reinstall (live-session check first; live sessions keep the old worker until restarted).
