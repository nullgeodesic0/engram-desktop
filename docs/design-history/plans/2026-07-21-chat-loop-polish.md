# Chat Loop Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface real Engram loop state (current node, loop position, grade outcome, session tally) as UI in the `/learn` and `/review` chat views, using data the app already receives but currently discards.

**Architecture:** A new shared parser (`shared/gradeResult.ts`) turns the JSON that `engram.py`'s `rate`/`receipt`/`next` commands already print to stdout (and which already arrives in `SessionToolResultEvent.content`) into typed `GradeResult`s. A new `GradeResultCard` component renders one. `ReviewSessionView.tsx` and `LearnSessionView.tsx` each get additive state + rendering for loop-position display, grade cards, a header transition, and a session summary. `AskDialog.tsx`'s confidence branch gets its own layout.

**Tech Stack:** React 19 + TypeScript, existing Tailwind-style utility classes and CSS custom properties (`--color-ink-warm`, `--color-ink-cool`, `--color-ink-danger-dim`, etc. — see `src/renderer/src/index.css`).

## Global Constraints

- No test framework exists in this project (confirmed: no vitest/jest in `package.json`). Every task's verification is `npm run typecheck` && `npm run build` from `app`, plus direct code reading — do not add a test framework as part of this plan.
- Do not use interactive `npm run dev`/computer-use verification during implementation (standing user instruction, token conservation) — static verification only. A real interactive pass happens after all tasks land.
- No new IPC handlers, no new `engram.py` calls, no changes to session-driving/grading logic.
- Follow existing code conventions: state colocated at the top of each view component, small pure helpers as local functions (matching `looksLikeNextNodeCall` etc.) unless shared across files, Tailwind-style utility classes with CSS var colors (never hardcoded hex in JSX).

---

### Task 1: `shared/gradeResult.ts` — grade result type + parsers

**Files:**
- Create: `app/src/shared/gradeResult.ts`

**Interfaces:**
- Produces: `GradeResult` type, `parseGradeResult(content: unknown): GradeResult | null`, `parseGradeResults(content: unknown): GradeResult[]` — used by Task 2 (component), Task 4 (Review wiring), Task 7 (Learn wiring).

- [ ] **Step 1: Write the file**

```ts
// src/shared/gradeResult.ts

/** One graded node, parsed from the JSON `engram.py rate`/`receipt` print to
 * stdout (via their shared `emit()` helper) — the exact same payload that
 * lands in a Bash tool's `tool_result.content` for those calls. Never
 * recomputed or estimated client-side; every field here is the engine's own
 * answer, just carried into the UI. */
export interface GradeResult {
  node: string
  rating: 'again' | 'hard' | 'good' | 'easy'
  /** Derived from `rating` via the same table `engram.py` itself uses
   * (`GRADE_OF_RATING`) — kept as a literal port so the UI's language can
   * never drift from the engine's. */
  grade: 'lapsed' | 'partial' | 'recalled'
  state: string | null
  sBefore: number | null
  sAfter: number | null
  intervalDays: number | null
  daysSinceEncode: number | null
}

// Literal port of engram.py's GRADE_OF_RATING table.
const GRADE_OF_RATING: Record<string, GradeResult['grade']> = {
  again: 'lapsed',
  hard: 'partial',
  good: 'recalled',
  easy: 'recalled',
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** A Bash tool_result's `content` can be a plain string (the common case) or,
 * in some SDK shapes, an array of `{type:'text', text:string}` blocks — this
 * normalizes both to a string, or null if neither shape matches. */
function contentToText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const first = content.find((b) => b && typeof b === 'object' && 'text' in b) as { text?: unknown } | undefined
    if (first && typeof first.text === 'string') return first.text
  }
  return null
}

function toGradeResult(raw: unknown): GradeResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const rating = r.rating
  if (rating !== 'again' && rating !== 'hard' && rating !== 'good' && rating !== 'easy') return null
  if (typeof r.node !== 'string') return null
  return {
    node: r.node,
    rating,
    grade: GRADE_OF_RATING[rating],
    state: typeof r.state === 'string' ? r.state : null,
    sBefore: asNumberOrNull(r.s_before),
    sAfter: asNumberOrNull(r.s_after),
    intervalDays: asNumberOrNull(r.interval_days),
    daysSinceEncode: asNumberOrNull(r.days_since_encode),
  }
}

/** Parses a single `rate` call's tool_result content (Review's per-item grading
 * path). Tolerant — a parse failure or unrecognized shape returns null rather
 * than throwing, so a card simply doesn't render instead of crashing the view;
 * same best-effort discipline as `beatLabelParser.ts`. */
export function parseGradeResult(content: unknown): GradeResult | null {
  const text = contentToText(content)
  if (!text) return null
  try {
    return toGradeResult(JSON.parse(text))
  } catch {
    return null
  }
}

/** Parses a `receipt` call's tool_result content (Learn's batch-grading path —
 * `cmd_receipt` in engram.py emits an array of the same per-item shape
 * `apply_item` returns for a single `rate`). Non-array or unparseable content
 * yields an empty array, never a throw. */
export function parseGradeResults(content: unknown): GradeResult[] {
  const text = contentToText(content)
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.map(toGradeResult).filter((r): r is GradeResult => r !== null)
  } catch {
    return []
  }
}
```

- [ ] **Step 2: Verify**

Run: `cd app && npm run typecheck`
Expected: no errors mentioning `gradeResult.ts` (the file isn't imported anywhere yet, so this just confirms it's syntactically/type valid on its own).

- [ ] **Step 3: Commit**

```bash
cd .
git add app/src/shared/gradeResult.ts
git commit -m "feat: parse Engram rate/receipt results into typed GradeResult"
```

---

### Task 2: `components/GradeResultCard.tsx` — grade result card component

**Files:**
- Create: `app/src/renderer/src/components/GradeResultCard.tsx`

**Interfaces:**
- Consumes: `GradeResult` from `../../../shared/gradeResult` (Task 1), `humanizeNodeId` from `../../../shared/humanizeId` (existing).
- Produces: `GradeResultCard({ result: GradeResult })` — used by Task 4 (Review), Task 7 (Learn).

- [ ] **Step 1: Write the component**

```tsx
// src/renderer/src/components/GradeResultCard.tsx
import type { GradeResult } from '../../../shared/gradeResult'
import { humanizeNodeId } from '../../../shared/humanizeId'

const GRADE_STYLE: Record<GradeResult['grade'], { label: string; color: string; bg: string }> = {
  recalled: { label: 'Recalled', color: 'var(--color-ink-warm)', bg: 'var(--color-ink-warm-dim)' },
  partial: { label: 'Partial', color: 'var(--color-ink-cool)', bg: 'var(--color-ink-cool-dim)' },
  lapsed: { label: 'Lapsed', color: 'var(--color-ink-danger)', bg: 'var(--color-ink-danger-dim)' },
}

function nextReviewText(intervalDays: number | null): string {
  if (intervalDays === null) return ''
  if (intervalDays <= 0) return 'due again now'
  if (intervalDays === 1) return 'back in 1 day'
  return `back in ${Math.round(intervalDays)} days`
}

/** A small result card for one graded node — grade badge, a stability bar
 * animating from `sBefore` to `sAfter` (FSRS "s" is memory durability in
 * days; a wider bar after grading means the memory got sturdier), and a
 * plain-language next-review line. All three numbers are the engine's own
 * answer (see shared/gradeResult.ts), never recomputed here. */
export function GradeResultCard({ result }: { result: GradeResult }) {
  const style = GRADE_STYLE[result.grade]
  const before = result.sBefore ?? 0
  const after = result.sAfter ?? before
  // Scaled against whichever of the two is larger so the bar always fits —
  // purely a display heuristic, the underlying numbers are exact.
  const scale = Math.max(before, after, 1)
  const beforePct = Math.min(100, (before / scale) * 100)
  const afterPct = Math.min(100, (after / scale) * 100)

  return (
    <div className="panel px-4 py-3 flex flex-col gap-2 max-w-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-[var(--color-text-primary)]">{humanizeNodeId(result.node)}</span>
        <span
          className="label-data text-[10px] px-2 py-0.5 rounded-full shrink-0"
          style={{ color: style.color, background: style.bg }}
        >
          {style.label}
        </span>
      </div>
      {result.sBefore !== null && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-ink-cool-dim)] transition-all duration-500"
              style={{ width: `${beforePct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
              style={{ width: `${afterPct}%`, background: style.color }}
            />
          </div>
          <span className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0">
            {before.toFixed(1)}d → {after.toFixed(1)}d
          </span>
        </div>
      )}
      {result.intervalDays !== null && (
        <span className="text-xs text-[var(--color-text-dim)]">{nextReviewText(result.intervalDays)}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd app && npm run typecheck && npm run build`
Expected: clean (component isn't imported anywhere yet, this confirms it stands alone type-correctly).

- [ ] **Step 3: Commit**

```bash
cd .
git add app/src/renderer/src/components/GradeResultCard.tsx
git commit -m "feat: add GradeResultCard presentational component"
```

---

### Task 3: Review — loop-position indicator ("Item N of M")

**Files:**
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `sessionTotal` state — read by Task 4/5 only incidentally (not a hard dependency); this task is fully self-contained.

- [ ] **Step 1: Add `sessionTotal` state**

Find (near the other `useState` declarations, after `const [totalDue, setTotalDue] = useState(0)`):

```ts
  const [totalDue, setTotalDue] = useState(0)
```

Replace with:

```ts
  const [totalDue, setTotalDue] = useState(0)
  // Captured once when a session starts — the denominator for "Item N of M".
  // `queue` itself shrinks as items get graded, so it can't serve as both.
  const [sessionTotal, setSessionTotal] = useState(0)
```

- [ ] **Step 2: Set it in `startSession`**

Find:

```ts
  async function startSession(resume: boolean) {
    setPhase('in-session')
```

Replace with:

```ts
  async function startSession(resume: boolean) {
    setPhase('in-session')
    setSessionTotal(queue.length)
```

- [ ] **Step 3: Render "Item N of M" in the in-session node card**

Find:

```tsx
          {current && (
            <div className="shrink-0 panel px-5 py-4 flex flex-col gap-3">
              <div>
                <div className="text-sm font-medium text-[var(--color-text-primary)]">{humanizeNodeId(current.id)}</div>
                <div className="label-data text-xs text-[var(--color-text-faint)] mt-0.5">{current.topic} · {current.id}</div>
              </div>
              <p className="text-sm text-[var(--color-text-primary)]">{current.probe}</p>
            </div>
          )}
```

Replace with:

```tsx
          {current && (
            <div className="shrink-0 panel px-5 py-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{humanizeNodeId(current.id)}</div>
                  <div className="label-data text-xs text-[var(--color-text-faint)] mt-0.5">{current.topic} · {current.id}</div>
                </div>
                {sessionTotal > 0 && (
                  <span className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0">
                    Item {sessionTotal - queue.length + 1} of {sessionTotal}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--color-text-primary)]">{current.probe}</p>
            </div>
          )}
```

- [ ] **Step 4: Verify**

Run: `cd app && npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd .
git add app/src/renderer/src/app/ReviewSessionView.tsx
git commit -m "feat(review): show loop-position indicator (Item N of M)"
```

---

### Task 4: Review — grade-card wiring + header transition

**Files:**
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx`

**Interfaces:**
- Consumes: `parseGradeResult`, `GradeResult` from `../../../shared/gradeResult` (Task 1); `GradeResultCard` from `../components/GradeResultCard` (Task 2).
- Produces: `lastGrade: GradeResult | null`, `sessionGrades: GradeResult[]` — `sessionGrades` is consumed by Task 5 (session-end summary).

- [ ] **Step 1: Import the new modules**

Find:

```ts
import { humanizeNodeId } from '../../../shared/humanizeId'
import { emitPulse } from '../../../shared/neuralFieldBus'
```

Replace with:

```ts
import { humanizeNodeId } from '../../../shared/humanizeId'
import { emitPulse } from '../../../shared/neuralFieldBus'
import { parseGradeResult, type GradeResult } from '../../../shared/gradeResult'
import { GradeResultCard } from '../components/GradeResultCard'
```

- [ ] **Step 2: Add `lastGrade`/`sessionGrades` state**

Find:

```ts
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([])
```

Replace with:

```ts
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([])
  const [lastGrade, setLastGrade] = useState<GradeResult | null>(null)
  const [sessionGrades, setSessionGrades] = useState<GradeResult[]>([])
```

- [ ] **Step 3: Parse the rate result in the existing tool_result handler**

Find:

```ts
      case 'tool_result':
        appendLog(`← ${event.isError ? 'error' : 'ok'}`)
        if (event.toolUseId === pendingRateToolUseId.current) {
          pendingRateToolUseId.current = null
          if (!event.isError) emitPulse('recalled')
          refreshQueue().then((items) => {
            setBusy(false)
            if (items.length === 0) setPhase('done')
          })
        }
        break
```

Replace with:

```ts
      case 'tool_result':
        appendLog(`← ${event.isError ? 'error' : 'ok'}`)
        if (event.toolUseId === pendingRateToolUseId.current) {
          pendingRateToolUseId.current = null
          if (!event.isError) {
            emitPulse('recalled')
            const result = parseGradeResult(event.content)
            if (result) {
              setLastGrade(result)
              setSessionGrades((prev) => [...prev, result])
            }
          }
          refreshQueue().then((items) => {
            setBusy(false)
            if (items.length === 0) setPhase('done')
          })
        }
        break
```

- [ ] **Step 4: Reset `lastGrade`/`sessionGrades` when starting a fresh (non-resume) session**

Find:

```ts
  async function startSession(resume: boolean) {
    setPhase('in-session')
    setSessionTotal(queue.length)
```

Replace with:

```ts
  async function startSession(resume: boolean) {
    setPhase('in-session')
    setSessionTotal(queue.length)
    if (!resume) {
      setLastGrade(null)
      setSessionGrades([])
    }
```

- [ ] **Step 5: Render the grade card + header transition class**

Find (the same block Task 3 edited — apply this on top of Task 3's result):

```tsx
          {current && (
            <div className="shrink-0 panel px-5 py-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{humanizeNodeId(current.id)}</div>
                  <div className="label-data text-xs text-[var(--color-text-faint)] mt-0.5">{current.topic} · {current.id}</div>
                </div>
                {sessionTotal > 0 && (
                  <span className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0">
                    Item {sessionTotal - queue.length + 1} of {sessionTotal}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--color-text-primary)]">{current.probe}</p>
            </div>
          )}
```

Replace with:

```tsx
          {current && (
            <div
              key={current.id}
              className="shrink-0 panel px-5 py-4 flex flex-col gap-3 transition-colors duration-300"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{humanizeNodeId(current.id)}</div>
                  <div className="label-data text-xs text-[var(--color-text-faint)] mt-0.5">{current.topic} · {current.id}</div>
                </div>
                {sessionTotal > 0 && (
                  <span className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0">
                    Item {sessionTotal - queue.length + 1} of {sessionTotal}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--color-text-primary)]">{current.probe}</p>
            </div>
          )}
          {lastGrade && phase !== 'done' && <GradeResultCard result={lastGrade} />}
```

(The `key={current.id}` remounts the card — and re-triggers its `transition-colors` — every time the active item changes, which is the "ambient mode-change cue" from the spec: a brief, free color transition on the one thing that actually changed, no new signal path needed.)

- [ ] **Step 6: Verify**

Run: `cd app && npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd .
git add app/src/renderer/src/app/ReviewSessionView.tsx
git commit -m "feat(review): render grade-result card on each rate call"
```

---

### Task 5: Review — session-end summary card

**Files:**
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx`

**Interfaces:**
- Consumes: `sessionGrades: GradeResult[]` (Task 4), `window.engram.stats()` (existing preload API, returns `Promise<EngramStats>` with a `streak_days: number` field — see `src/shared/types.ts`).

- [ ] **Step 1: Add `streakDays` state and fetch it on reaching `done`**

Find:

```ts
  const [lastGrade, setLastGrade] = useState<GradeResult | null>(null)
  const [sessionGrades, setSessionGrades] = useState<GradeResult[]>([])
```

Replace with:

```ts
  const [lastGrade, setLastGrade] = useState<GradeResult | null>(null)
  const [sessionGrades, setSessionGrades] = useState<GradeResult[]>([])
  const [streakDays, setStreakDays] = useState<number | null>(null)
```

Find:

```ts
          refreshQueue().then((items) => {
            setBusy(false)
            if (items.length === 0) setPhase('done')
          })
```

Replace with:

```ts
          refreshQueue().then((items) => {
            setBusy(false)
            if (items.length === 0) {
              setPhase('done')
              window.engram.stats().then((s) => setStreakDays(s.streak_days))
            }
          })
```

- [ ] **Step 2: Replace the "Queue clear" line with a summary panel**

Find:

```tsx
          {phase === 'done' && (
            <div className="shrink-0 panel px-4 py-3 text-sm text-[var(--color-ink-warm)]">Queue clear — nice work.</div>
          )}
```

Replace with:

```tsx
          {phase === 'done' && (
            <div className="shrink-0 panel px-5 py-4 flex flex-col gap-2">
              <div className="text-sm text-[var(--color-ink-warm)]">Queue clear — nice work.</div>
              <div className="flex items-center gap-4 text-xs label-data text-[var(--color-text-dim)]">
                <span>{sessionGrades.length} item{sessionGrades.length === 1 ? '' : 's'}</span>
                <span className="text-[var(--color-ink-warm)]">
                  {sessionGrades.filter((g) => g.grade === 'recalled').length} recalled
                </span>
                <span className="text-[var(--color-ink-cool)]">
                  {sessionGrades.filter((g) => g.grade === 'partial').length} partial
                </span>
                <span className="text-[var(--color-ink-danger)]">
                  {sessionGrades.filter((g) => g.grade === 'lapsed').length} lapsed
                </span>
                {streakDays !== null && streakDays > 0 && (
                  <span>{streakDays} day{streakDays === 1 ? '' : 's'} streak</span>
                )}
              </div>
            </div>
          )}
```

- [ ] **Step 3: Verify**

Run: `cd app && npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd .
git add app/src/renderer/src/app/ReviewSessionView.tsx
git commit -m "feat(review): session-end summary with grade tally and streak"
```

---

### Task 6: Learn — current node title + header transition

**Files:**
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

**Interfaces:**
- Produces: `currentNodeId: string | null` — not consumed by other tasks, but Task 7's rendering sits in the same header area so keep the two visually consistent (title above `BeatStepper`).

- [ ] **Step 1: Add a local parser for the `next` tool_result's node id**

Find (near the top, after the other `looksLike*` helpers):

```ts
function isArtifactSmithSpawn(input: Record<string, unknown>): boolean {
  const blob = JSON.stringify(input)
  return blob.includes('engram-artifact-smith')
}
```

Replace with:

```ts
function isArtifactSmithSpawn(input: Record<string, unknown>): boolean {
  const blob = JSON.stringify(input)
  return blob.includes('engram-artifact-smith')
}

/** The node id being taught isn't in the `next --topic` command itself — `next`
 * picks the node and returns it. `cmd_next` in engram.py `emit()`s
 * `{topic, id, node: {...}, ...}` (id is null only when the frontier is
 * empty), which is exactly what lands in this tool_use's tool_result content. */
function parseNextNodeId(content: unknown): string | null {
  const text = typeof content === 'string' ? content : null
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Add `currentNodeId` state**

Find:

```ts
  const [currentBeat, setCurrentBeat] = useState<string | null>(null)
```

Replace with:

```ts
  const [currentBeat, setCurrentBeat] = useState<string | null>(null)
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null)
```

- [ ] **Step 3: Set it in the `next` tool_result handler**

Find:

```ts
      case 'tool_result':
        if (event.toolUseId === pendingNextToolUseId.current) {
          pendingNextToolUseId.current = null
          nextCallsSeen.current += 1
```

Replace with:

```ts
      case 'tool_result':
        if (event.toolUseId === pendingNextToolUseId.current) {
          pendingNextToolUseId.current = null
          nextCallsSeen.current += 1
          const nodeId = parseNextNodeId(event.content)
          if (nodeId) setCurrentNodeId(nodeId)
```

- [ ] **Step 4: Reset it in `backToTopics`**

Find:

```ts
    setCurrentBeat(null)
    setAttachedFiles([])
```

Replace with:

```ts
    setCurrentBeat(null)
    setCurrentNodeId(null)
    setAttachedFiles([])
```

- [ ] **Step 5: Render the node title next to `BeatStepper`, with the transition cue**

Find:

```tsx
        {started && <BeatStepper current={currentBeat} />}
```

Replace with:

```tsx
        {started && (
          <div key={currentNodeId ?? 'none'} className="flex items-center gap-2 transition-colors duration-300">
            {currentNodeId && (
              <span className="label-data text-xs text-[var(--color-ink-warm)] shrink-0">{humanizeNodeId(currentNodeId)}</span>
            )}
            <BeatStepper current={currentBeat} />
          </div>
        )}
```

(`humanizeNodeId` is already imported in this file — no new import needed. The `key`-based remount on `currentNodeId` change is the same free ambient-cue technique used in Task 4.)

- [ ] **Step 6: Verify**

Run: `cd app && npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd .
git add app/src/renderer/src/app/LearnSessionView.tsx
git commit -m "feat(learn): show current node title next to beat stepper"
```

---

### Task 7: Learn — grade-card stack + tally/streak line

**Files:**
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

**Interfaces:**
- Consumes: `parseGradeResults`, `GradeResult` from `../../../shared/gradeResult` (Task 1); `GradeResultCard` from `../components/GradeResultCard` (Task 2); `window.engram.stats()` (existing).
- Produces: `sessionGrades: GradeResult[]`.

- [ ] **Step 1: Import the new modules**

Find:

```ts
import { humanizeNodeId } from '../../../shared/humanizeId'
import { emitPulse } from '../../../shared/neuralFieldBus'
import { SessionHistoryModal } from '../components/SessionHistoryModal'
```

Replace with:

```ts
import { humanizeNodeId } from '../../../shared/humanizeId'
import { emitPulse } from '../../../shared/neuralFieldBus'
import { SessionHistoryModal } from '../components/SessionHistoryModal'
import { parseGradeResults, type GradeResult } from '../../../shared/gradeResult'
import { GradeResultCard } from '../components/GradeResultCard'
```

- [ ] **Step 2: Add a `looksLikeReceiptCall` detector, alongside the other `looksLike*` helpers**

Find:

```ts
function looksLikeArtifactSet(input: Record<string, unknown>): string | null {
```

Replace with:

```ts
// `python3 "$ENGRAM" receipt --file <assessor-output.json>` (SKILL.md step 4) is
// the batch-grade call — the one place /learn's tool_result carries an ARRAY of
// per-node grade results (cmd_receipt in engram.py), unlike the single-item
// shape a bare `rate` call would return.
function looksLikeReceiptCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  return command.includes('receipt') && command.includes('--file')
}

function looksLikeArtifactSet(input: Record<string, unknown>): string | null {
```

- [ ] **Step 3: Add `sessionGrades` state and a `pendingReceiptToolUseId` ref**

Find:

```ts
  const [currentBeat, setCurrentBeat] = useState<string | null>(null)
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null)
```

Replace with:

```ts
  const [currentBeat, setCurrentBeat] = useState<string | null>(null)
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null)
  const [sessionGrades, setSessionGrades] = useState<GradeResult[]>([])
  const [streakDays, setStreakDays] = useState<number | null>(null)
```

Find:

```ts
  const pendingNextToolUseId = useRef<string | null>(null)
  const nextCallsSeen = useRef(0)
  const sessionIdRef = useRef<string | null>(null)
```

Replace with:

```ts
  const pendingNextToolUseId = useRef<string | null>(null)
  const pendingReceiptToolUseId = useRef<string | null>(null)
  const nextCallsSeen = useRef(0)
  const sessionIdRef = useRef<string | null>(null)
```

- [ ] **Step 4: Detect the receipt call in `tool_use`, parse it in `tool_result`**

Find:

```ts
      case 'tool_use':
        if (event.name === 'Bash' && looksLikeNextNodeCall(event.input)) {
          pendingNextToolUseId.current = event.id
        }
```

Replace with:

```ts
      case 'tool_use':
        if (event.name === 'Bash' && looksLikeNextNodeCall(event.input)) {
          pendingNextToolUseId.current = event.id
        }
        if (event.name === 'Bash' && looksLikeReceiptCall(event.input)) {
          pendingReceiptToolUseId.current = event.id
        }
```

Find:

```ts
          if (nextCallsSeen.current > 1) {
            setNodeCount((n) => n + 1) // conversation history stays intact — no reset, like a real chat
            setCurrentBeat(null) // new node, fresh walk through the stepper
          }
        }
        setJobs((prev) =>
```

Replace with:

```ts
          if (nextCallsSeen.current > 1) {
            setNodeCount((n) => n + 1) // conversation history stays intact — no reset, like a real chat
            setCurrentBeat(null) // new node, fresh walk through the stepper
          }
        }
        if (event.toolUseId === pendingReceiptToolUseId.current) {
          pendingReceiptToolUseId.current = null
          const results = parseGradeResults(event.content)
          if (results.length > 0) {
            setSessionGrades((prev) => [...prev, ...results])
            window.engram.stats().then((s) => setStreakDays(s.streak_days))
          }
        }
        setJobs((prev) =>
```

- [ ] **Step 5: Reset `sessionGrades`/`streakDays` in `backToTopics`**

Find:

```ts
    setCurrentBeat(null)
    setCurrentNodeId(null)
    setAttachedFiles([])
```

Replace with:

```ts
    setCurrentBeat(null)
    setCurrentNodeId(null)
    setSessionGrades([])
    setStreakDays(null)
    setAttachedFiles([])
```

- [ ] **Step 6: Render the tally line + card stack above `JobsRail`**

Find:

```tsx
          <div className="shrink-0">
            <JobsRail jobs={jobs} onOpenArtifact={(p) => window.engram.openArtifact(p)} />
          </div>
```

Replace with:

```tsx
          {sessionGrades.length > 0 && (
            <div className="shrink-0 flex flex-col gap-2">
              <div className="flex items-center gap-4 text-xs label-data text-[var(--color-text-dim)]">
                <span>{sessionGrades.length} graded</span>
                <span className="text-[var(--color-ink-warm)]">
                  {sessionGrades.filter((g) => g.grade === 'recalled').length} recalled
                </span>
                <span className="text-[var(--color-ink-cool)]">
                  {sessionGrades.filter((g) => g.grade === 'partial').length} partial
                </span>
                <span className="text-[var(--color-ink-danger)]">
                  {sessionGrades.filter((g) => g.grade === 'lapsed').length} lapsed
                </span>
                {streakDays !== null && streakDays > 0 && (
                  <span>{streakDays} day{streakDays === 1 ? '' : 's'} streak</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {sessionGrades.map((g, i) => (
                  <GradeResultCard key={`${g.node}-${i}`} result={g} />
                ))}
              </div>
            </div>
          )}

          <div className="shrink-0">
            <JobsRail jobs={jobs} onOpenArtifact={(p) => window.engram.openArtifact(p)} />
          </div>
```

- [ ] **Step 7: Verify**

Run: `cd app && npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
cd .
git add app/src/renderer/src/app/LearnSessionView.tsx
git commit -m "feat(learn): render grade-result cards and tally on receipt batch"
```

---

### Task 8: `AskDialog.tsx` — confidence-picker visual polish

**Files:**
- Modify: `app/src/renderer/src/components/AskDialog.tsx`

**Interfaces:**
- Consumes: nothing new. `request.options` (existing `{label, description?}[]` shape from `BridgeAskRequest`).
- Produces: nothing consumed elsewhere — purely visual, isolated to this component's `isConfidence` branch.

- [ ] **Step 1: Add a confidence-specific icon/gradient lookup and its own render branch**

Find:

```tsx
export function AskDialog({ request, onAnswer }: AskDialogProps) {
  const [otherText, setOtherText] = useState('')
  const [showOther, setShowOther] = useState(false)
  const isConfidence = request.header === 'Confidence'
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  return (
```

Replace with:

```tsx
// Positional gradient stop for the confidence picker — index 0 (least
// confident) reads cool, the last option reads warm. Purely a color cue on
// top of the dialogue-grammar's fixed option order (never reordered here).
const CONFIDENCE_STYLE = [
  { icon: '○', color: 'var(--color-ink-cool)' },
  { icon: '◔', color: 'var(--color-ink-cool)' },
  { icon: '◕', color: 'var(--color-ink-warm)' },
  { icon: '●', color: 'var(--color-ink-warm)' },
]

export function AskDialog({ request, onAnswer }: AskDialogProps) {
  const [otherText, setOtherText] = useState('')
  const [showOther, setShowOther] = useState(false)
  const isConfidence = request.header === 'Confidence'
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, true)

  return (
```

- [ ] **Step 2: Branch the option-list rendering on `isConfidence`**

Find:

```tsx
        {!showOther ? (
          <div className="flex flex-col gap-2">
            {request.options.map((opt) => (
              <button
                key={opt.label}
                onClick={() => onAnswer([opt.label])}
                className="focus-ring panel px-4 py-2.5 text-left hover:bg-[var(--color-surface-3)] transition-colors"
              >
                <div className="text-sm text-[var(--color-text-primary)]">{opt.label}</div>
                {opt.description && <div className="text-xs text-[var(--color-text-dim)] mt-0.5">{opt.description}</div>}
              </button>
            ))}
            <button
              onClick={() => setShowOther(true)}
              className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] mt-1 text-left px-4"
            >
              Other…
            </button>
          </div>
        ) : (
```

Replace with:

```tsx
        {!showOther ? (
          isConfidence ? (
            <div className="grid grid-cols-2 gap-2">
              {request.options.map((opt, i) => {
                const style = CONFIDENCE_STYLE[i] ?? CONFIDENCE_STYLE[CONFIDENCE_STYLE.length - 1]
                return (
                  <button
                    key={opt.label}
                    onClick={() => onAnswer([opt.label])}
                    className="focus-ring panel px-3 py-3 flex flex-col items-center gap-1.5 text-center hover:bg-[var(--color-surface-3)] transition-colors"
                  >
                    <span className="text-lg leading-none" style={{ color: style.color }}>
                      {style.icon}
                    </span>
                    <div className="text-sm text-[var(--color-text-primary)]">{opt.label}</div>
                    {opt.description && <div className="text-xs text-[var(--color-text-dim)]">{opt.description}</div>}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {request.options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => onAnswer([opt.label])}
                  className="focus-ring panel px-4 py-2.5 text-left hover:bg-[var(--color-surface-3)] transition-colors"
                >
                  <div className="text-sm text-[var(--color-text-primary)]">{opt.label}</div>
                  {opt.description && <div className="text-xs text-[var(--color-text-dim)] mt-0.5">{opt.description}</div>}
                </button>
              ))}
              <button
                onClick={() => setShowOther(true)}
                className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] mt-1 text-left px-4"
              >
                Other…
              </button>
            </div>
          )
        ) : (
```

(Note: the "Other…" escape hatch is intentionally dropped only from the confidence layout — the dialogue-grammar's Confidence picker is a fixed 4-band schema, never free text, matching the existing `isConfidence`-only border-color special-case this replaces.)

- [ ] **Step 3: Verify**

Run: `cd app && npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd .
git add app/src/renderer/src/components/AskDialog.tsx
git commit -m "feat: give the confidence picker its own visual layout"
```

---

## Final steps (after all 8 tasks)

- [ ] Run `npm run typecheck && npm run build` once more from a clean state to confirm the whole set composes cleanly.
- [ ] Offer the user a real interactive pass (a `/review` and a `/learn` session) per the Verification section of the design spec, since implementation itself used static verification only.
- [ ] Rebuild and reinstall the packaged app (`npm run dist:mac` + the established quit/replace/relaunch sequence), after checking for a live learning/review session first (`ps aux | grep -- "--tools Bash,Write,Read,Task" | grep -v grep`).
