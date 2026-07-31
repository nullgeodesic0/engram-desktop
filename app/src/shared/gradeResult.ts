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

// Literal port of engram.py's GRADE_OF_RATING table. Exported for Verdict
// Anatomy's `RatingEchoRow` (components/ritual/VerdictRows.tsx), which needs
// to resolve a verdict's own echoed `rating` word to the same `grade` key
// ritual/GradeChip's exported `GRADE_INK` is keyed by — reusing this table
// rather than a second local copy keeps both readings of "which grade does
// this rating mean" from ever drifting apart.
export const GRADE_OF_RATING: Record<string, GradeResult['grade']> = {
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

/** Extracts the first balanced JSON value opening with `open` from mixed shell
 * output. The skill sometimes chains commands in one Bash call (e.g.
 * `receipt --file … ; echo ---clear--- ; clear-stash`), so a tool_result can be
 * the receipt JSON followed by arbitrary text — a whole-string JSON.parse then
 * fails on "Extra data" and the UI silently loses the entire grade batch
 * (observed live 2026-07-24). Walks from the first `open` char tracking
 * string/escape state and bracket depth; returns the balanced slice, or null. */
function extractFirstJson(text: string, open: '[' | '{'): string | null {
  const close = open === '[' ? ']' : '}'
  const start = text.indexOf(open)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open || ch === (open === '[' ? '{' : '[')) depth++
    else if (ch === close || ch === (open === '[' ? '}' : ']')) {
      depth--
      if (depth === 0 && text[i] === close) return text.slice(start, i + 1)
    }
  }
  return null
}

function parseLoose(text: string, open: '[' | '{'): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const slice = extractFirstJson(text, open)
    if (slice == null) return null
    try {
      return JSON.parse(slice)
    } catch {
      return null
    }
  }
}

/** Parses a single `rate` call's tool_result content (Review's per-item grading
 * path). Tolerant — a parse failure or unrecognized shape returns null rather
 * than throwing, so a card simply doesn't render instead of crashing the view;
 * same best-effort discipline as `beatLabelParser.ts`. */
export function parseGradeResult(content: unknown): GradeResult | null {
  const text = contentToText(content)
  if (!text) return null
  return toGradeResult(parseLoose(text, '{'))
}

/** Extracts every balanced top-level `{...}` object from arbitrary mixed
 * text, in order. A single pretest Bash call can rate several nodes in one
 * invocation (SKILL.md §2 rates up to 3 frontier nodes back to back), and the
 * skill sometimes echoes a `--- node N ---` marker between them rather than
 * returning a JSON array — so `extractFirstJson`'s single-slice approach
 * would silently drop every node after the first. This walks the whole text
 * left to right, respecting string/escape state, and collects each balanced
 * object it finds. */
function extractAllJsonObjects(text: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const start = text.indexOf('{', i)
    if (start === -1) break
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (let j = start; j < text.length; j++) {
      const ch = text[j]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          end = j
          break
        }
      }
    }
    if (end === -1) break
    out.push(text.slice(start, end + 1))
    i = end + 1
  }
  return out
}

/** Parses a pretest `rate --kind pretest` call's tool_result content (Learn's
 * §2 diagnostic — see ritualFromTranscript.ts's diagnostic-plate derivation
 * and LearnSessionView's live pretest wiring). Unlike `parseGradeResult`
 * (single item) and `parseGradeResults` (one JSON array), a batched pretest
 * call's result is N standalone JSON objects concatenated with plain-text
 * `--- node N ---` separators — so this scans for every balanced object
 * rather than assuming one shape. Malformed/unrecognized objects are skipped,
 * never thrown; an unparseable result yields an empty array. */
export function parsePretestGradeResults(content: unknown): GradeResult[] {
  const text = contentToText(content)
  if (!text) return []
  const out: GradeResult[] = []
  for (const slice of extractAllJsonObjects(text)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(slice)
    } catch {
      continue
    }
    const result = toGradeResult(parsed)
    if (result) out.push(result)
  }
  return out
}

/** Maps a `GradeResult.grade` to the diagnostic plate's coarser verdict
 * vocabulary (RitualMark's `diagnostic` kind) — recalled reads as "held",
 * partial stays "partial", and lapsed (or anything unrecognized) reads as
 * "unknown" rather than "lapsed": a pretest miss just means the node hasn't
 * been taught yet, not that ground was lost. */
export function verdictFromGrade(grade: GradeResult['grade']): 'held' | 'partial' | 'unknown' {
  if (grade === 'recalled') return 'held'
  if (grade === 'partial') return 'partial'
  return 'unknown'
}

/** Parses a `receipt` call's tool_result content (Learn's batch-grading path —
 * `cmd_receipt` in engram.py emits an array of the same per-item shape
 * `apply_item` returns for a single `rate`). Non-array or unparseable content
 * yields an empty array, never a throw. */
export function parseGradeResults(content: unknown): GradeResult[] {
  const text = contentToText(content)
  if (!text) return []
  const parsed = parseLoose(text, '[')
  if (!Array.isArray(parsed)) return []
  return parsed.map(toGradeResult).filter((r): r is GradeResult => r !== null)
}

/** The lapse rite's "returns <date>" — `anchor`'s local calendar date plus
 * the result's own `intervalDays`, computed with getFullYear/Month/Date
 * (never toISOString, the codebase's local-date discipline — see HomeView's
 * due forecast for the same pattern) so the shown day never drifts a
 * timezone off from what the user's own calendar would say. Returns null
 * when `intervalDays` is absent (an unusual `rate` result) rather than
 * guessing a date.
 *
 * `anchor` defaults to "now" for the LIVE push (ReviewSessionView) — the
 * lapse just happened, so today is correct. The DERIVED path
 * (ritualFromTranscript.ts) must NOT use this default: replaying a sitting
 * from months ago with wall-clock "now" as the anchor fabricates a future
 * date that has nothing to do with when the lapse actually occurred. It
 * instead passes the transcript entry's own timestamp as `anchor`, or skips
 * calling this function entirely (leaving `returnDate: null`) when that
 * timestamp is missing or unparseable — never fabricating a date either way. */
export function lapseReturnDate(intervalDays: number | null, anchor: Date = new Date()): string | null {
  if (intervalDays == null) return null
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + Math.round(intervalDays))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The scale of stability a `rate`/`receipt` result just crossed for the first
 * time — 'month' takes priority over 'week' when a single result's jump
 * crosses both at once (the tutor's own prose narrates growth this way: "that
 * went from ~4 days to ~17" reads as one story, not two). */
export type StabilityMilestoneScale = 'week' | 'month'

// Absolute day-thresholds, not a multiplicative jump — a ratio ("2x growth")
// is noisy on the small bases FSRS starts every node at (s_before often sits
// under 2 days right after first encode, where even a routine `good` rating
// can double it), which would make the mark fire on ordinary early reviews
// instead of a genuine milestone. week/month instead mirror the two scales
// the tutor's own prose already narrates growth in ("that went from ~4 days
// to ~17", "holding for weeks now") — crossing INTO calendar-week-scale
// retention, then INTO calendar-month-scale retention, are the two moments
// worth a card. Checked chronologically first, largest first, against
// ~/.claude/learning/receipts/*.jsonl (81 real grade events across 4 topics,
// 46 of them carrying both s_before/s_after — the rest are first encodes with
// no prior stability to grow FROM, correctly excluded below): 18/81 events
// (22%) cross one of these two thresholds, landing in 13/27 real session
// batches (48%) — frequent enough to not be dead code, but well under "every
// session" (worth noting per-session can still show it more than once if
// several nodes cross in the same batch — that's real, not manufactured:
// e.g. `tsarist-autocracy-context` and `second-international-orthodoxy-
// kautsky` both crossed month-scale in the same lenin-what-is-to-be-done
// receipt batch on 2026-07-xx because both nodes happened to get an `easy`
// rating in the same sitting). A narrower multiplicative-jump-only rule was
// tried first and rejected: it fired on some of the SAME small `hard`-rated
// partial jumps (e.g. 0.4872->0.9269, nearly 2x) that never once crossed
// either calendar threshold in the real data — exactly the "noisy on small
// bases" failure mode the task brief warned about.
const MILESTONE_THRESHOLDS: Array<{ scale: StabilityMilestoneScale; days: number }> = [
  { scale: 'month', days: 30 },
  { scale: 'week', days: 7 },
]

/** True iff `result` is the FIRST time this node's stability crossed into
 * week-scale or month-scale retention — a pure function of this one result's
 * own `sBefore`/`sAfter` (no external history needed: `sBefore` IS the node's
 * prior stability, so "crossed for the first time" falls straight out of
 * "was below the threshold, is now at or above it"). Never fires on a lapse
 * (stability only drops there, so sBefore<th<=sAfter can't hold anyway — the
 * explicit grade check just makes the invariant readable) or on a fresh
 * encode (`sBefore` is null — nothing to grow FROM yet, not a milestone,
 * just a starting point). The ONE definition — both session views' live
 * handlers and `ritualFromTranscript.ts`'s replay call this verbatim, so a
 * resumed sitting can never disagree with the live sitting about which
 * results were milestones. */
export function isStabilityMilestone(result: GradeResult): StabilityMilestoneScale | null {
  if (result.sBefore == null || result.sAfter == null) return null
  if (result.grade === 'lapsed') return null
  for (const { scale, days } of MILESTONE_THRESHOLDS) {
    if (result.sBefore < days && result.sAfter >= days) return scale
  }
  return null
}

/** Trailing consecutive `recalled` count — the sitting's current "flow"
 * (FlowChain renders it from 2 up). Walks backward until the streak breaks. */
export function trailingRecalled(results: GradeResult[]): number {
  let n = 0
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].grade !== 'recalled') break
    n++
  }
  return n
}
