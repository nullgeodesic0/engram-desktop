# Chat Ritual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the learning loop's recurring, topic-independent moments dedicated premium UI per `docs/superpowers/specs/2026-07-23-chat-ritual-design.md`: beat cards from `render_beat` content (A), session bookends (B), living waits (C), serif voice (D), NeuralField atmosphere (E), sender ink glyphs (F).

**Architecture:** New presentational components in `components/ritual/` (marks, bookends). LearnSessionView gains a `marks` overlay array interleaved into the transcript by message index (live-session-only, like grade cards/JobsRail — not reconstructed on replay). ChatMessageView gets the serif voice + sender glyphs (shared by Learn/Review/Coach). `neuralFieldBus` gains two pulse kinds + an ambient level.

**Tech Stack:** React 19, Night Atlas tokens (`--font-serif`, `.fig-caption`), existing parsers/signals only (onBridgeBeat, parseNextNodeId, parseGradeResults, pendingReceiptToolUseId, Bash tool_use/tool_result events). No engine/IPC/bridge changes.

## Global Constraints

- Loop semantics sacred: no changes to free-recall flow, grading language, confidence picker, or beat interaction behavior.
- Ephemeral overlays only: beat cards, dividers, stamps, shimmer never persist or replay; history rendering unchanged.
- Verification per task: `npm run typecheck && npm run build` clean in `app`. `noUnusedLocals: true`. No interactive verification during implementation.
- Colors/fonts via CSS variables only. Commit per task with the given message, on `master`.

---

### Task 1: `components/ritual/Marks.tsx` — beat cards, divider, stamp, shimmer

**Files:**
- Create: `app/src/renderer/src/components/ritual/Marks.tsx`
- Modify: `app/src/renderer/src/index.css` (keyframes)

**Interfaces:**
- Produces (consumed by Task 3):
  - `type RitualMark = { id: string; atIndex: number } & ({ kind: 'beat'; beat: string; content: string } | { kind: 'crossing'; nodeId: string } | { kind: 'stamp' })`
  - `MarkView({ mark }: { mark: RitualMark })` — dispatches to the three renderers.
  - `GradingShimmer()` — standalone (not a RitualMark; rendered at the transcript foot while grading is pending).

- [ ] **Step 1: Write the component file**

```tsx
import { memo } from 'react'
import { humanizeNodeId } from '../../../shared/humanizeId'

/** Ephemeral transcript overlays for the loop's recurring moments — pinned to
 * a message index at creation time (atIndex = messages.length when the signal
 * arrived), rendered interleaved by LearnSessionView. Never persisted, never
 * reconstructed on history replay — same pattern as grade cards and JobsRail. */
export type RitualMark = { id: string; atIndex: number } & (
  | { kind: 'beat'; beat: string; content: string }
  | { kind: 'crossing'; nodeId: string }
  | { kind: 'stamp' }
)

/** Small hand-drawn glyphs, one per dialogue-grammar beat. 16x16 viewBox,
 * stroke-only, currentColor — the ink language at icon scale. */
const BEAT_GLYPHS: Record<string, { path: string; label: string }> = {
  open_gap: { path: 'M8 2.5 A5.5 5.5 0 1 0 13.5 8', label: 'OPEN A GAP' },
  predict: { path: 'M2.5 8 H12 M9 4.5 12 8 9 11.5', label: 'PREDICT' },
  struggle: { path: 'M2.5 8 C5 3.5 7 12 9.5 6.5 S13 10 13.5 5.5', label: 'STRUGGLE' },
  resolve: { path: 'M3 11 C5 11 5.5 5 8 5 S11 11 13 5', label: 'RESOLVE' },
  self_explain: { path: 'M8 2.5 V13.5 M3.5 5 C5.5 7 5.5 9 3.5 11 M12.5 5 C10.5 7 10.5 9 12.5 11', label: 'SELF-EXPLAIN' },
  connect: { path: 'M2.5 10 C5 5 11 5 13.5 10 M4.5 10 A1.4 1.4 0 1 0 4.5 10.01 M11.5 10 A1.4 1.4 0 1 0 11.5 10.01', label: 'CONNECT' },
  verify: { path: 'M8 2.5 12.5 5 V9 C12.5 12 8 13.5 8 13.5 S3.5 12 3.5 9 V5 Z M6 8 7.5 9.5 10.5 6.5', label: 'VERIFY' },
}

export const BeatMarkCard = memo(function BeatMarkCard({ beat, content }: { beat: string; content: string }) {
  const glyph = BEAT_GLYPHS[beat]
  if (!glyph) return null
  const excerpt = content.length > 140 ? `${content.slice(0, 140).trimEnd()}…` : content
  return (
    <div className="flex items-center gap-3 my-1.5 pl-1">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-[var(--color-ink-warm)]">
        <path d={glyph.path} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-warm)] shrink-0">{glyph.label}</span>
      {excerpt && (
        <span className="font-[var(--font-serif)] italic text-xs text-[var(--color-text-dim)] truncate">{excerpt}</span>
      )}
      <span className="h-px flex-1 bg-[var(--color-hairline)] min-w-6" />
    </div>
  )
})

/** The border-crossing between nodes — a dendrite line that grows across the
 * transcript with the new territory's name. */
export const NodeCrossingDivider = memo(function NodeCrossingDivider({ nodeId }: { nodeId: string }) {
  return (
    <div className="flex items-center gap-3 my-3 ritual-crossing">
      <span className="h-px flex-1 bg-[var(--color-ink-warm-dim)] origin-left ritual-crossing-line" />
      <span className="fig-caption shrink-0 text-[var(--color-ink-warm)]">entering {humanizeNodeId(nodeId)}</span>
      <span className="h-px flex-1 bg-[var(--color-ink-warm-dim)] origin-right ritual-crossing-line" />
    </div>
  )
})

/** Ink seal confirming a production was stashed for later batch grading. */
export const StashStamp = memo(function StashStamp() {
  return (
    <div className="flex justify-end my-1 pr-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-ink-warm-dim)] px-2.5 py-0.5 text-[10px] label-data text-[var(--color-ink-warm)] ritual-stamp">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1" />
          <path d="M3.2 5 4.5 6.3 7 3.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        production filed
      </span>
    </div>
  )
})

export function MarkView({ mark }: { mark: RitualMark }) {
  if (mark.kind === 'beat') return <BeatMarkCard beat={mark.beat} content={mark.content} />
  if (mark.kind === 'crossing') return <NodeCrossingDivider nodeId={mark.nodeId} />
  return <StashStamp />
}

/** Shown at the transcript foot while the assessor examines the stash. */
export function GradingShimmer() {
  return (
    <div className="panel px-4 py-3 max-w-[70%] flex items-center gap-3">
      <div className="skeleton h-2 w-2 rounded-full shrink-0" />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="fig-caption">specimen under examination</span>
        <div className="skeleton h-1.5 w-40 rounded" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add keyframes to `index.css`** (after the `.plate-trail` block):

```css
@keyframes crossing-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
.ritual-crossing-line {
  animation: crossing-grow 0.9s ease-out;
}
@keyframes stamp-press {
  0% { transform: scale(1.25); opacity: 0; }
  60% { transform: scale(0.96); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.ritual-stamp {
  animation: stamp-press 0.4s ease-out;
}
```

- [ ] **Step 3: Verify** — `npm run typecheck && npm run build` clean.
- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/src/components/ritual/Marks.tsx app/src/renderer/src/index.css
git commit -m "feat(ritual): beat cards, crossing divider, stash stamp, grading shimmer"
```

---

### Task 2: `components/ritual/Bookends.tsx` — opening plate + ceremony

**Files:**
- Create: `app/src/renderer/src/components/ritual/Bookends.tsx`

**Interfaces:**
- Consumes: `GradeTally` (`../GradeTally`), `GradeResult` type (`../../../shared/gradeResult`), `humanizeNodeId`.
- Produces (consumed by Tasks 3-5):
  - `SessionOpenPlate({ topicTitle, walkNumber, nodeId, date }: { topicTitle: string; walkNumber: number | null; nodeId: string | null; date: Date })`
  - `SessionCeremony({ results, streakDays, commitment, heading, label }: { results: GradeResult[]; streakDays: number | null; commitment: string | null; heading: string; label: string })`

- [ ] **Step 1: Write the component file**

```tsx
import { memo } from 'react'
import { GradeTally } from '../GradeTally'
import type { GradeResult } from '../../../shared/gradeResult'
import { humanizeNodeId } from '../../../shared/humanizeId'

/** Ceremonial first element of a Learn session's transcript. */
export const SessionOpenPlate = memo(function SessionOpenPlate({
  topicTitle,
  walkNumber,
  nodeId,
  date,
}: {
  topicTitle: string
  walkNumber: number | null
  nodeId: string | null
  date: Date
}) {
  const dateText = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <div className="border-b border-[var(--color-hairline)] pb-4 mb-2">
      <div className="fig-caption">
        {walkNumber != null ? `Walk ${walkNumber} — ` : ''}
        {dateText}
      </div>
      <div className="font-[var(--font-serif)] text-[length:var(--text-display)] text-[var(--color-text-primary)] leading-tight mt-1">
        {topicTitle}
      </div>
      {nodeId && (
        <div className="text-xs text-[var(--color-text-dim)] mt-1.5">
          the frontier today: <span className="text-[var(--color-ink-warm)]">{humanizeNodeId(nodeId)}</span>
        </div>
      )}
    </div>
  )
})

/** End-of-walk ceremony — tally, stability movements, next-due, and the
 * return commitment framed as a signed ledger entry. Shared by Learn (fires
 * when a receipt batch lands) and Review (done phase). */
export const SessionCeremony = memo(function SessionCeremony({
  results,
  streakDays,
  commitment,
  heading,
  label,
}: {
  results: GradeResult[]
  streakDays: number | null
  commitment: string | null
  heading: string
  label: string
}) {
  const nextDue = results.length > 0 ? Math.min(...results.map((r) => r.intervalDays)) : null
  return (
    <div className="panel-raised p-4 flex flex-col gap-3 max-w-md">
      <div className="font-[var(--font-serif)] text-[length:var(--text-heading)] text-[var(--color-text-primary)]">
        {heading}
      </div>
      <GradeTally results={results} streakDays={streakDays} label={label} />
      <div className="flex flex-col gap-1">
        {results.map((r) => (
          <div key={r.node} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-[var(--color-text-dim)] truncate">{humanizeNodeId(r.node)}</span>
            <span className="label-data shrink-0 text-[var(--color-text-faint)]">
              s {r.sBefore.toFixed(1)} → <span className="text-[var(--color-ink-warm)]">{r.sAfter.toFixed(1)}</span>
            </span>
          </div>
        ))}
      </div>
      {nextDue != null && (
        <div className="fig-caption">
          Fig. — earliest return in {nextDue} {nextDue === 1 ? 'day' : 'days'}
        </div>
      )}
      {commitment && (
        <div className="border-t border-[var(--color-hairline)] pt-2.5 font-[var(--font-serif)] italic text-xs text-[var(--color-text-dim)]">
          “{commitment}” <span className="not-italic label-data text-[10px] text-[var(--color-text-faint)]">— signed</span>
        </div>
      )}
    </div>
  )
})
```

- [ ] **Step 2: Verify** — `npm run typecheck && npm run build` clean. (Check `GradeResult`'s real field names in `shared/gradeResult.ts` — `sBefore`/`sAfter`/`intervalDays`/`node` — and adjust only if the actual names differ.)
- [ ] **Step 3: Commit**

```bash
git add app/src/renderer/src/components/ritual/Bookends.tsx
git commit -m "feat(ritual): session opening plate and closing ceremony components"
```

---

### Task 3: Learn wiring — marks overlay + shimmer

**Files:**
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

**Interfaces:**
- Consumes Task 1's `RitualMark`, `MarkView`, `GradingShimmer`.

- [ ] **Step 1: Marks state + signal wiring** (read the file fully first)

1. State: `const [marks, setMarks] = useState<RitualMark[]>([])` plus `const markSeq = useRef(0)`; helper `function pushMark(m: Omit<RitualMark, 'id' | 'atIndex'> ...)` — implement as: `setMarks((prev) => [...prev, { ...data, id: `mark-${markSeq.current++}`, atIndex: messagesRef.current.length }])`. LearnSessionView has no `messagesRef` — add one (`const messagesRef = useRef<ChatMessage[]>([])`, kept in sync where `setMessages` is called, or simpler: `messagesRef.current = messages` right in the component body each render).
2. In the existing `onBridgeBeat` subscription (which calls `setCurrentBeat(req.beat)`): also `pushMark({ kind: 'beat', beat: req.beat, content: req.content })`.
3. In the `tool_result` handler where `parseNextNodeId` sets `currentNodeId`: when the parsed id differs from the previous non-null `currentNodeId`, `pushMark({ kind: 'crossing', nodeId })`. (First node of the session — previous null — gets NO crossing; the opening plate covers arrival.)
4. Stash stamp: add a `looksLikeStashCall(input)` helper next to the existing `looksLikeNextNodeCall` (same pattern: Bash input whose `command` includes `engram.py' stash` — match `/\bstash\b/` on the command string and require it NOT to match the `rate`/`receipt`/`next` detectors). Track pending stash toolUseIds in a ref set on `tool_use`; on its successful `tool_result` (`!event.isError`), `pushMark({ kind: 'stamp' })` and remove from the set.
5. Reset `marks` (and the pending-stash ref) in `backToTopics()` and in `startFreshForTopic`/`startNewTopic`.

- [ ] **Step 2: Render interleaved**

In the transcript `messages.map((m) => <ChatMessageView .../>)` block, change to render, after each message at index `i`, all marks with `atIndex === i + 1`; marks with `atIndex === 0` render before the first message; marks with `atIndex > messages.length - 1 + 1` (i.e. beyond) render after the last message. Concretely:

```tsx
{marks.filter((k) => k.atIndex === 0).map((k) => <MarkView key={k.id} mark={k} />)}
{messages.map((m, i) => (
  <Fragment key={m.id}>
    <ChatMessageView message={m} onEditResend={...same as today...} />
    {marks.filter((k) => k.atIndex === i + 1 || (i === messages.length - 1 && k.atIndex > messages.length)).map((k) => (
      <MarkView key={k.id} mark={k} />
    ))}
  </Fragment>
))}
```

(Both `messages.map` call sites in the file — history-viewing mode does NOT get marks, only the live transcript block.)

- [ ] **Step 3: Grading shimmer**

Where the transcript foot renders the typing indicator: when `pendingReceiptToolUseId.current != null` render `<GradingShimmer />` (in place of, not in addition to, TypingIndicator for that duration). `pendingReceiptToolUseId` is a ref — mirror it into state (`const [gradingPending, setGradingPending] = useState(false)`, set true where the ref is set, false where cleared) so the render reacts.

- [ ] **Step 4: Verify** — `npm run typecheck && npm run build` clean.
- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/src/app/LearnSessionView.tsx
git commit -m "feat(ritual): beat/crossing/stamp marks and grading shimmer in Learn transcript"
```

---

### Task 4: Learn bookends wiring

**Files:**
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

**Interfaces:**
- Consumes Task 2's `SessionOpenPlate`, `SessionCeremony`.

- [ ] **Step 1: Opening plate**

1. State `const [walkNumber, setWalkNumber] = useState<number | null>(null)`. In `openTopic` (and `startFreshForTopic`), after the topic is set: `window.engram.sessionHistoryFor('learn', topic.topic).then((h) => setWalkNumber(h.length + 1)).catch(() => setWalkNumber(null))`. Reset to null in `backToTopics`. `startNewTopic` (intake, no topic yet) leaves it null and renders no plate.
2. Render `<SessionOpenPlate topicTitle={activeTopic.title} walkNumber={walkNumber} nodeId={currentNodeId} date={new Date()} />` as the first element inside the live transcript scroll region, only when `activeTopic != null` (the live block, not history viewing).

- [ ] **Step 2: Ceremony on receipt**

Where the receipt `tool_result` currently appends `sessionGrades` and fetches streak: the existing tally + card-stack block next to JobsRail is REPLACED by `<SessionCeremony results={sessionGrades} streakDays={streakDays} commitment={commitment} heading="The walk, recorded" label={`${sessionGrades.length} graded`} />` rendered in the same rail position when `sessionGrades.length > 0`. Commitment: state fetched once on session open via `window.engram.model().then((m) => ...)` — read the learner model's commitment cue/action if present (inspect `LearnerModel` in `shared/types.ts`; the settings commitment fields set via `engram:commit` — compose as `"<cue> → <action>"`; if the model shape has no such fields, pass `null` and note it in the report).

- [ ] **Step 3: Verify** — `npm run typecheck && npm run build` clean.
- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/src/app/LearnSessionView.tsx
git commit -m "feat(ritual): Learn opening plate and end-of-walk ceremony"
```

---

### Task 5: Review ceremony upgrade

**Files:**
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx`

**Interfaces:**
- Consumes Task 2's `SessionCeremony`.

- [ ] **Step 1:** Read the file; the done-phase summary panel (GradeTally + streak + "Queue clear" area) is replaced by `<SessionCeremony results={sessionGrades} streakDays={streakDays} commitment={null} heading="Queue clear" label={`${sessionGrades.length} items`} />`. Keep any surrounding done-phase chrome (session log toggle, back button) unchanged.
- [ ] **Step 2: Verify** — `npm run typecheck && npm run build` clean.
- [ ] **Step 3: Commit**

```bash
git add app/src/renderer/src/app/ReviewSessionView.tsx
git commit -m "feat(ritual): Review end-of-queue ceremony"
```

---

### Task 6: Voice identity + sender glyphs

**Files:**
- Modify: `app/src/renderer/src/components/ChatMessageView.tsx`
- Modify: `app/src/renderer/src/components/BeatCard.tsx` (PlainDialogueBlock only)
- Modify: `app/src/renderer/src/index.css`

- [ ] **Step 1: Serif voice CSS** — add to `@layer components` in index.css:

```css
  /* The tutor's voice — assistant prose reads in serif, like a set page. */
  .voice-serif {
    font-family: var(--font-serif);
    font-size: 0.9375rem;
    line-height: 1.65;
  }
  .voice-serif h1, .voice-serif h2, .voice-serif h3 {
    font-family: var(--font-display);
  }
```

- [ ] **Step 2: Apply to assistant prose** — in `BeatCard.tsx`'s `PlainDialogueBlock` (and the BeatCard body text element if it renders prose), add `voice-serif` to the text container's className. In `ChatMessageView.tsx`, user messages stay as-is.

- [ ] **Step 3: Sender glyphs** — in `ChatMessageView.tsx`: assistant turns render a small leading glyph column: a 12px seeded ink blob (inline SVG — reuse the `InkNode` component from `./ui/InkNode` with `id="voice-tutor"`, `variant="filled"`, `size={12}`) top-aligned beside the message column; user turns get `<InkNode id="voice-learner" variant="outlined" color="var(--color-ink-cool)" size={12} />` beside the bubble (before the edit button). Fixed ids → stable shapes.

- [ ] **Step 4: Verify** — `npm run typecheck && npm run build` clean. Confirm Coach (CoachSessionPanel) uses ChatMessageView and inherits automatically; if it has its own message rendering, apply the same classes there (check first, note in report).
- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/src/components/ChatMessageView.tsx app/src/renderer/src/components/BeatCard.tsx app/src/renderer/src/index.css
git commit -m "feat(ritual): serif tutor voice and sender ink glyphs"
```

---

### Task 7: NeuralField atmosphere

**Files:**
- Modify: `app/src/shared/neuralFieldBus.ts`
- Modify: `app/src/renderer/src/components/NeuralField.tsx`
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

- [ ] **Step 1: Bus** — extend `PulseKind` to `'recalled' | 'streak' | 'capstone' | 'resolve' | 'synthesis'`. Add ambient level:

```ts
let ambientLevel = 0
const ambientListeners = new Set<(level: number) => void>()
export function setAmbientLevel(level: number): void {
  ambientLevel = Math.max(0, Math.min(1, level))
  for (const cb of ambientListeners) cb(ambientLevel)
}
export function onAmbientLevel(cb: (level: number) => void): () => void {
  ambientListeners.add(cb)
  cb(ambientLevel)
  return () => { ambientListeners.delete(cb) }
}
```

- [ ] **Step 2: NeuralField** — in the pulse subscription: `resolve` sets `pulseIntensity = 0.7` with a warm tint boost, `synthesis` sets `pulseIntensity = 0.8` with a violet tint boost — implement tint as a short-lived variable mixed into the existing per-frame color math (read the file's tick loop; the existing `pulseIntensity = 1` behavior for the original three kinds stays byte-identical). Subscribe `onAmbientLevel` into a local `ambient` variable that scales base particle opacity by `1 + 0.25 * ambient`.
- [ ] **Step 3: Learn emitters** — in `onBridgeBeat`: if `req.beat === 'resolve'`, `emitPulse('resolve')`. Where a job flips to `done` in the jobs `tool_result` handling: `emitPulse('synthesis')`. After `sessionGrades` updates from a receipt: `setAmbientLevel(Math.min(1, recalledCount / 6))` where recalledCount counts `grade === 'recalled'`; reset `setAmbientLevel(0)` in `backToTopics`.
- [ ] **Step 4: Verify** — `npm run typecheck && npm run build` clean.
- [ ] **Step 5: Commit**

```bash
git add app/src/shared/neuralFieldBus.ts app/src/renderer/src/components/NeuralField.tsx app/src/renderer/src/app/LearnSessionView.tsx
git commit -m "feat(ritual): NeuralField responds to resolve beats, syntheses, and session momentum"
```

---

## Final verification (after all tasks + whole-branch review)

1. `npm run typecheck && npm run build` clean.
2. Interactive pass per the spec's Verification section (real Learn session end-to-end; Review queue-clear ceremony; serif voice everywhere; pulses).
3. Packaged rebuild/reinstall via the standard sequence (live-session check first).
