import type { GradeResult } from '../../../../shared/gradeResult'
import { humanizeNodeId } from '../../../../shared/humanizeId'

// Same grade→ink mapping as GradeResultCard's GRADE_STYLE (color only — this
// figure has no badge/background to carry).
const GRADE_COLOR: Record<GradeResult['grade'], string> = {
  recalled: 'var(--color-ink-warm)',
  partial: 'var(--color-ink-cool)',
  lapsed: 'var(--color-ink-danger)',
}

interface MovementRow {
  node: string
  before: number
  after: number
  grade: GradeResult['grade']
}

/** Paired before/after stability bars, one row per node — the sitting's `s`
 * movement (FSRS "s" is memory durability in days) as a small dumbbell
 * figure rather than plain text. Sorted by movement magnitude (the sitting's
 * biggest swings read first), node name in the gutter, cool ink for the
 * prior value and grade-toned ink for the new one. Rows missing either
 * `sBefore` or `sAfter` are omitted outright — never zero-filled — same
 * discipline as ScheduleDelta. Replaces SessionCeremony's old `s 2.1 → 4.5`
 * text rows; shared by both Learn's and Review's end-of-walk ceremony. */
export function StabilityMovement({ results }: { results: GradeResult[] }) {
  const rows: MovementRow[] = results
    .filter((r) => r.sBefore !== null && r.sAfter !== null)
    .map((r) => ({ node: r.node, before: r.sBefore as number, after: r.sAfter as number, grade: r.grade }))
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))

  if (rows.length === 0) return null

  const max = Math.max(1, ...rows.flatMap((r) => [r.before, r.after]))
  const total = rows.reduce((sum, r) => sum + (r.after - r.before), 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5" role="img" aria-label={`stability movement across ${rows.length} node${rows.length === 1 ? '' : 's'}`}>
        {rows.map((r, i) => {
          const beforePct = Math.min(100, (r.before / max) * 100)
          const afterPct = Math.min(100, (r.after / max) * 100)
          return (
            <div
              // Index-suffixed: a node can be graded twice in one sitting
              // (Learn re-teaches a repeatedly-lapsing node), and rows are
              // sorted by movement — a bare node key would reconcile the two
              // rows into each other's values.
              key={`${r.node}-${i}`}
              className="tick-fade-in flex items-center gap-2"
              style={{ ['--tick-delay' as string]: `${Math.min(i, 8) * 25}ms` }}
            >
              <span className="text-[10px] text-[var(--color-text-dim)] truncate w-20 shrink-0" title={humanizeNodeId(r.node)}>
                {humanizeNodeId(r.node)}
              </span>
              <div className="flex-1 flex flex-col gap-[2px] min-w-0">
                <div className="h-[3px] bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-ink-cool-dim)]"
                    style={{ width: `${beforePct}%` }}
                  />
                </div>
                <div className="h-[3px] bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] overflow-hidden">
                  <div
                    className="h-full"
                    style={{ width: `${afterPct}%`, background: GRADE_COLOR[r.grade] }}
                  />
                </div>
              </div>
              <span className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0">
                {r.before.toFixed(1)} → <span style={{ color: GRADE_COLOR[r.grade] }}>{r.after.toFixed(1)}</span>
              </span>
            </div>
          )
        })}
      </div>
      <div className="fig-caption">
        Fig. — total durability {total >= 0 ? 'gained' : 'lost'} this walk:{' '}
        <span className="label-data not-italic">
          {total >= 0 ? '+' : ''}
          {total.toFixed(1)}d
        </span>
      </div>
    </div>
  )
}
