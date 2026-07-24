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
