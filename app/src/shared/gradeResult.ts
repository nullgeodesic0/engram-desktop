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
