import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'

export interface DiagnosticPlateItem {
  node: string
  verdict: 'held' | 'partial' | 'unknown'
}

const VERDICT_LABEL: Record<DiagnosticPlateItem['verdict'], string> = {
  held: 'held',
  partial: 'partial',
  unknown: 'unknown',
}

/** Small ink glyph per verdict — same 14x14 icon-at-scale vocabulary as
 * Marks.tsx's BEAT_GLYPHS, but its own shape language for the diagnostic's
 * three-way read: filled warm = held cold, half warm/cool = partial, plain
 * cool outline = unknown (a miss just means "not yet taught", not a loss —
 * see verdictFromGrade in shared/gradeResult.ts, which deliberately reads
 * lapsed as "unknown" here rather than the alarm-toned "lapsed" GradeResultCard
 * uses for an actual review lapse). */
function VerdictGlyph({ verdict }: { verdict: DiagnosticPlateItem['verdict'] }) {
  if (verdict === 'held') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
        <circle cx="7" cy="7" r="5.5" fill="var(--color-ink-warm)" stroke="var(--color-ink-warm)" strokeWidth="1" />
      </svg>
    )
  }
  if (verdict === 'partial') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
        <path d="M7 1.5 A5.5 5.5 0 0 1 7 12.5 Z" fill="var(--color-ink-cool)" />
        <circle cx="7" cy="7" r="5.5" stroke="var(--color-ink-cool)" strokeWidth="1" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="7" cy="7" r="5.5" stroke="var(--color-ink-cool-dim)" strokeWidth="1" strokeDasharray="2 1.6" />
    </svg>
  )
}

/** The pretest's results, staged as a small ink plate rather than left to
 * scroll off in the JobsRail — one row per cold-probed node, its verdict
 * glyph, and the caption naming what this sets up next. Emitted once, per
 * `DiagnosticGate` in shared/ritualFromTranscript.ts (live and replayed
 * alike): when the phase leaves pretest, or the walk's first node begins,
 * whichever comes first. */
export const DiagnosticPlate = memo(function DiagnosticPlate({ items }: { items: DiagnosticPlateItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="panel px-4 py-3 max-w-md flex flex-col gap-2 ritual-diagnostic-in">
      <div className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <div key={`${it.node}-${i}`} className="flex items-center gap-2.5">
            <VerdictGlyph verdict={it.verdict} />
            <span className="text-sm text-[var(--color-text-dim)] flex-1 min-w-0 truncate">{humanizeNodeId(it.node)}</span>
            <span className="label-data text-[10px] tracking-[0.1em] text-[var(--color-text-faint)] shrink-0">
              {VERDICT_LABEL[it.verdict]}
            </span>
          </div>
        ))}
      </div>
      <div className="fig-caption pt-2 border-t border-[var(--color-hairline)]">Fig. — the frontier this sets</div>
    </div>
  )
})
