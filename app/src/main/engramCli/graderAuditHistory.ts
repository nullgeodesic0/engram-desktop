import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { engramLearningHome } from './readOnly'

export interface GraderAuditDirection {
  graded_up: number
  graded_down: number
  exact: number
  judgments: number
  note: string
}

export interface GraderAuditCaseType {
  items: number
  judgments: number
  agreement: number
  leniency_bias: number
}

export interface GraderAuditThresholds {
  qwk_floor: number
  qwk_target: number
  bias_max: number
  min_n: number
  min_runs: number
  paradox_retest: number
}

/**
 * One `~/.claude/learning/audits/YYYY-MM-DD-NN.json` file, sanitized field by
 * field — hand-editable state, same discipline as readHandlers.ts's
 * isMisconception/isActiveExperiment: don't trust the file's shape, drop
 * anything that doesn't match the expected type rather than let a malformed
 * value reach the renderer.
 *
 * Only the fields `grader-health` does NOT already return are carried here
 * (`thresholds`, `bias_note`) plus enough to identify/sort a history row
 * (`ts`, `verdict`, `qwk`, `n`, `runs`) — GraderAudit.tsx's headline numbers,
 * by_case_type table, and direction split all come from `graderHealth()`
 * instead (compute_grader_health in engram.py), which is the field-checked,
 * verdict-derived read. This module exists because `compute_grader_health`'s
 * return value — verified live, 2026-07-27 — omits `thresholds` and
 * `bias_note` entirely, even though both are written to every audit file on
 * disk (confirmed against 2026-07-19-01.json and 2026-07-23-01.json).
 */
export interface GraderAuditFile {
  ts: string
  verdict: string
  qwk: number | null
  n: number | null
  runs: number | null
  thresholds: GraderAuditThresholds | null
  bias_note: string | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function parseThresholds(v: unknown): GraderAuditThresholds | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const qwk_floor = num(r.qwk_floor)
  const qwk_target = num(r.qwk_target)
  const bias_max = num(r.bias_max)
  // qwk_floor/qwk_target/bias_max are the three this component actually
  // plots numbers against — without all three the bar can't be drawn
  // honestly, so treat the whole block as absent rather than partial.
  if (qwk_floor === null || qwk_target === null || bias_max === null) return null
  return {
    qwk_floor,
    qwk_target,
    bias_max,
    min_n: num(r.min_n) ?? 0,
    min_runs: num(r.min_runs) ?? 0,
    paradox_retest: num(r.paradox_retest) ?? 0,
  }
}

function parseAuditFile(raw: unknown): GraderAuditFile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const ts = str(r.ts)
  const verdict = str(r.verdict)
  if (ts === null || verdict === null) return null
  return {
    ts,
    verdict,
    qwk: num(r.qwk),
    n: num(r.n),
    runs: num(r.runs),
    thresholds: parseThresholds(r.thresholds),
    bias_note: str(r.bias_note),
  }
}

/**
 * `<date>-<seq>.json` → `[date, seq]`, numeric on the sequence — mirrors
 * engram.py's own `_audit_sort_key` (see compute_grader_health's docstring
 * there): a plain string sort would put `...-10.json` before `...-2.json`,
 * so the 10th audit of a day could shadow the 2nd under lexicographic order.
 * An unrecognized name sorts before every real audit, same as the Python.
 */
function auditSortKey(filename: string): [string, number] {
  const stem = filename.endsWith('.json') ? filename.slice(0, -5) : filename
  const i = stem.lastIndexOf('-')
  if (i < 0) return [stem, -1]
  const head = stem.slice(0, i)
  const tail = stem.slice(i + 1)
  const seq = Number(tail)
  return Number.isInteger(seq) ? [head, seq] : [stem, -1]
}

/**
 * Every audit on disk, newest first — same discipline as readTopicGraph
 * reading graphs/<topic>.json directly: `~/.claude/learning/audits/` is a
 * documented, stable, engine-owned, append-only directory (engram.py's
 * `cmd_grader_audit` never overwrites a same-day file, only appends a new
 * `-NN` suffix), safe to read and never write outside a live session.
 *
 * `grader-health` (see readOnly.ts) already returns the *latest* audit's
 * full body, field-checked and verdict-derived. This supplies the fields
 * that read omits (see GraderAuditFile's doc comment) plus the earlier
 * runs, for a component that wants to say "N audits on record" rather than
 * just "the latest one passed".
 */
export async function readGraderAuditHistory(): Promise<GraderAuditFile[]> {
  const home = await engramLearningHome()
  const dir = join(home, 'audits')
  let names: string[]
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  names.sort((a, b) => {
    const [aHead, aSeq] = auditSortKey(a)
    const [bHead, bSeq] = auditSortKey(b)
    if (aHead !== bHead) return aHead < bHead ? -1 : 1
    return aSeq - bSeq
  })
  const parsed = await Promise.all(
    names.map(async (name) => {
      try {
        const raw = JSON.parse(await readFile(join(dir, name), 'utf-8'))
        return parseAuditFile(raw)
      } catch {
        return null
      }
    }),
  )
  return parsed.filter((f): f is GraderAuditFile => f !== null).reverse()
}
