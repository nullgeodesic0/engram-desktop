import { useEffect, useState } from 'react'
import type { GraderAuditFile, GraderCaseTypeStats, GraderHealthResult } from '../../../shared/types'
import { SkeletonBar } from './Skeleton'
import { friendlyErrorText } from '../shared/friendlyError'

/** `ts` is a local YYYY-MM-DD string (engram.py's own `date.today()`) — same
 * parsing discipline as MisconceptionLedger's formatTs / TopicMapView's
 * formatProvenanceDate: no `Z` suffix, so it reads as local midnight. */
function formatTs(ts: string): string {
  return new Date(`${ts}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmt(v: number | null, digits = 2): string {
  return v == null ? '—' : v.toFixed(digits)
}

function fmtSigned(v: number | null, digits = 2): string {
  if (v == null) return '—'
  const s = v.toFixed(digits)
  return v > 0 ? `+${s}` : s
}

function fmtPct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

// "partial-credit-boundary" -> "Partial Credit Boundary" — the case-type ids
// are trap categories from the adversarial gold set, not node ids, so
// humanizeId's colon-aware rules don't apply; this is a plain hyphen split.
function humanizeCaseType(id: string): string {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const VERDICT_LABEL: Record<string, string> = {
  pass: 'Passed',
  warn: 'Passed, under target',
  fail: 'Failed',
  incomplete: 'Incomplete',
  'insufficient-runs': 'Insufficient runs',
  'insufficient-data': 'Insufficient data',
}

function verdictTone(verdict: string): string {
  if (verdict === 'pass') return 'text-[var(--color-ink-warm)]'
  if (verdict === 'warn') return 'text-[var(--color-ink-cool)]'
  return 'text-[var(--color-ink-danger)]'
}

/** A stat with the engine's own bar next to it — `qwk` against
 * `qwk_floor`/`qwk_target`, or `leniency_bias` against `bias_max` — so
 * neither number is ever shown without the threshold it's judged by. Both
 * the value and the bound trace to named fields; nothing here is computed
 * that the engine didn't already write down. */
function ThresholdStat({
  label,
  value,
  displayValue,
  tone,
  bound,
}: {
  label: string
  value: number | null
  displayValue: string
  tone: 'warm' | 'cool' | 'danger' | 'dim'
  bound: string
}) {
  const color =
    tone === 'warm'
      ? 'text-[var(--color-ink-warm)]'
      : tone === 'cool'
        ? 'text-[var(--color-ink-cool)]'
        : tone === 'danger'
          ? 'text-[var(--color-ink-danger)]'
          : 'text-[var(--color-text-dim)]'
  return (
    <div className="panel px-4 py-3 flex flex-col gap-1 min-w-0">
      <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wide">{label}</div>
      <div className={`label-data text-2xl font-medium ${value == null ? 'text-[var(--color-text-faint)]' : color}`}>
        {displayValue}
      </div>
      <div className="label-data text-[10px] text-[var(--color-text-faint)]">{bound}</div>
    </div>
  )
}

function CaseTypeTable({ byCaseType }: { byCaseType: Record<string, GraderCaseTypeStats> }) {
  const rows = Object.entries(byCaseType).sort((a, b) => a[1].agreement - b[1].agreement)
  if (rows.length === 0) return null
  return (
    <div className="panel px-4 py-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] text-[var(--color-text-faint)] uppercase tracking-wide">
            <th className="font-medium pb-2 pr-3">Case type</th>
            <th className="label-data font-medium pb-2 pr-3 text-right">Items</th>
            <th className="label-data font-medium pb-2 pr-3 text-right">Judgments</th>
            <th className="label-data font-medium pb-2 pr-3 text-right">Agreement</th>
            <th className="label-data font-medium pb-2 text-right">Leniency</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, row]) => (
            <tr key={id} className="border-t border-[var(--color-hairline)]">
              <td className="py-2 pr-3 text-[var(--color-text-primary)]">{humanizeCaseType(id)}</td>
              <td className="label-data py-2 pr-3 text-right text-[var(--color-text-dim)]">{row.items}</td>
              <td className="label-data py-2 pr-3 text-right text-[var(--color-text-dim)]">{row.judgments}</td>
              <td
                className={`label-data py-2 pr-3 text-right ${
                  row.agreement >= 0.95
                    ? 'text-[var(--color-text-primary)]'
                    : row.agreement >= 0.85
                      ? 'text-[var(--color-ink-cool)]'
                      : 'text-[var(--color-ink-danger)]'
                }`}
              >
                {fmtPct(row.agreement)}
              </td>
              <td className="label-data py-2 text-right text-[var(--color-text-dim)]">
                {fmtSigned(row.leniency_bias)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The grader's audit record — what `/coach audit` found the last time it
 * measured `engram-assessor` against the gold set, read from structured
 * JSON (`grader-health` plus the audits directory for the two fields that
 * subcommand omits), never from the coach's free-form narration. See
 * docs/design-history/specs/2026-07-26-coach-artifacts-design.md §2's
 * "Evidence gathered" section for why: the coach's prose has no stable
 * shape across sittings, so no number here is ever parsed from it.
 *
 * Self-fetching (no props) — cheap reads (one subprocess call, one small
 * directory), same as MisconceptionLedger's own-effect pattern, just
 * unconditional instead of gated on a modal's `open`. */
export function GraderAudit() {
  const [health, setHealth] = useState<GraderHealthResult | null>(null)
  const [history, setHistory] = useState<GraderAuditFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([window.engram.graderHealth(), window.engram.graderAuditHistory()])
      .then(([h, hist]) => {
        setHealth(h)
        setHistory(hist)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  if (error) {
    const fe = friendlyErrorText(error)
    return (
      <div className="panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)]">
        <div>Couldn’t read the audit record: {fe.headline}</div>
        {fe.detail && (
          <details className="mt-1 text-xs text-[var(--color-text-faint)]">
            <summary className="cursor-pointer">raw error</summary>
            <div className="mt-1">{fe.detail}</div>
          </details>
        )}
      </div>
    )
  }

  if (health === null) {
    return (
      <div className="flex flex-col gap-3">
        <SkeletonBar height={54} />
        <SkeletonBar height={90} />
      </div>
    )
  }

  // No audit has ever run, or the newest one on disk is corrupt — say so
  // plainly, and stop there. This implies nothing about the grader's
  // quality either way, so no verdict badge, no numbers, nothing else.
  if (!health.audited) {
    return (
      <div className="panel px-4 py-3 flex items-start gap-3">
        <span className="text-[var(--color-text-faint)]">?</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--color-text-primary)]">{health.stamp}</div>
          <p className="text-xs text-[var(--color-text-dim)] mt-1 leading-snug">{health.read}</p>
        </div>
      </div>
    )
  }

  // `grader-health` doesn't carry thresholds/bias_note — the newest file on
  // disk does (main/engramCli/graderAuditHistory.ts). It's the same audit
  // (history is sorted newest-first), so this is the one place those two
  // fields come from. If the directory read failed independently of
  // grader-health's own read (history === null, or came back empty), the
  // threshold bars have nothing honest to show against — so they're left
  // out rather than rendering a number with no bar.
  const latestFile = history && history.length > 0 ? history[0] : null
  const thresholds = latestFile?.thresholds ?? null
  const biasNote = latestFile?.bias_note ?? null

  const qwkTone: 'warm' | 'cool' | 'danger' | 'dim' =
    health.qwk == null || thresholds == null
      ? 'dim'
      : health.qwk >= thresholds.qwk_target
        ? 'warm'
        : health.qwk >= thresholds.qwk_floor
          ? 'cool'
          : 'danger'
  const biasTone: 'warm' | 'cool' | 'danger' | 'dim' =
    health.leniency_bias == null || thresholds == null
      ? 'dim'
      : Math.abs(health.leniency_bias) <= thresholds.bias_max
        ? 'cool'
        : 'danger'

  const showCaveat = health.gold_adjudication !== 'human'
  const olderRuns = history ? history.slice(1) : []

  return (
    <div className="flex flex-col gap-4">
      <div className={`panel px-4 py-3 flex items-start gap-3 ${health.grader_unvalidated ? 'border-[var(--color-ink-danger-dim)]' : ''}`}>
        <span className={verdictTone(health.verdict)}>{health.verdict === 'pass' ? '✓' : health.verdict === 'warn' ? '~' : '✕'}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-sm ${verdictTone(health.verdict)}`}>
            {VERDICT_LABEL[health.verdict] ?? health.verdict}
            {health.grader ? ` — ${health.grader}` : null}
          </div>
          <div className="label-data text-xs text-[var(--color-text-faint)] mt-1">
            {health.ts ? formatTs(health.ts) : 'date unknown'} · {health.n ?? '—'} items ·{' '}
            {health.runs ?? '—'} run{health.runs === 1 ? '' : 's'}
          </div>
          {health.stamp && <div className="text-xs text-[var(--color-text-dim)] mt-1.5">{health.stamp}</div>}
        </div>
      </div>

      {thresholds && (
        <div className="grid grid-cols-2 gap-3">
          <ThresholdStat
            label="QWK"
            value={health.qwk}
            displayValue={fmt(health.qwk)}
            tone={qwkTone}
            bound={`floor ${fmt(thresholds.qwk_floor)} · target ${fmt(thresholds.qwk_target)}`}
          />
          <ThresholdStat
            label="Leniency bias"
            value={health.leniency_bias}
            displayValue={fmtSigned(health.leniency_bias)}
            tone={biasTone}
            bound={`±${fmt(thresholds.bias_max)} max`}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="panel px-4 py-3 flex flex-col gap-1">
          <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wide">Exact agreement</div>
          <div className="label-data text-lg text-[var(--color-text-primary)]">{fmtPct(health.exact_agreement)}</div>
        </div>
        <div className="panel px-4 py-3 flex flex-col gap-1">
          <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wide">Test-retest</div>
          <div className="label-data text-lg text-[var(--color-text-primary)]">{fmtPct(health.test_retest)}</div>
        </div>
      </div>

      {showCaveat && (
        <div className="panel border-[var(--color-ink-cool-dim)] px-4 py-3 flex flex-col gap-2">
          <div className="text-xs text-[var(--color-ink-cool)] uppercase tracking-wide">
            Gold set: {health.gold_adjudication}, not independently adjudicated
          </div>
          {health.reasons.map((r, i) => (
            <p key={i} className="text-sm text-[var(--color-text-primary)] leading-snug">
              {r}
            </p>
          ))}
          {biasNote && <p className="text-xs text-[var(--color-text-dim)] leading-snug">{biasNote}</p>}
        </div>
      )}

      {health.direction && (
        <div className="panel px-4 py-3 flex flex-col gap-2">
          <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wide">Direction, of {health.direction.judgments} judgments</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-0.5">
              <div className="label-data text-xl text-[var(--color-ink-warm)]">{health.direction.graded_up}</div>
              <div className="text-xs text-[var(--color-text-faint)]">graded up</div>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="label-data text-xl text-[var(--color-text-primary)]">{health.direction.graded_down}</div>
              <div className="text-xs text-[var(--color-text-faint)]">graded down</div>
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="label-data text-xl text-[var(--color-text-dim)]">{health.direction.exact}</div>
              <div className="text-xs text-[var(--color-text-faint)]">exact</div>
            </div>
          </div>
          <p className="fig-caption">{health.direction.note}</p>
        </div>
      )}

      <CaseTypeTable byCaseType={health.by_case_type} />

      {olderRuns.length > 0 && (
        <details className="fig-caption">
          <summary className="cursor-pointer">
            {olderRuns.length} earlier audit{olderRuns.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 flex flex-col gap-1.5 not-italic">
            {olderRuns.map((a, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="label-data text-[var(--color-text-faint)] w-24 shrink-0">{formatTs(a.ts)}</span>
                <span className={verdictTone(a.verdict)}>{VERDICT_LABEL[a.verdict] ?? a.verdict}</span>
                <span className="label-data text-[var(--color-text-dim)]">QWK {fmt(a.qwk)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
