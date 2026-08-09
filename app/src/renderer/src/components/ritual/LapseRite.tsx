import { memo } from 'react'

/** Same UTC-midnight display trick ReviewSessionView's own `formatDueDate`
 * uses — `returnDate` is a plain local calendar-date string (see
 * `lapseReturnDate` in shared/gradeResult.ts), and parsing it as UTC midnight
 * for display avoids a timezone shift nudging the shown day by one. */
function formatReturnDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** The lapse rite — a small quiet marker filed right after a `rate` call comes
 * back `again` (grade 'lapsed'), naming what just happened without any of the
 * alarm GradeResultCard's danger ink otherwise carries: a lapse isn't a
 * failure to correct for, it's the schedule doing its job. Copy is exact, no
 * exclamation marks (dialogue-grammar's honesty-over-hype rule, same spirit
 * as VerifySeal only ever marking a genuinely confirmed verify). Derivable —
 * see deriveRitualMarks in shared/ritualFromTranscript.ts, which rebuilds
 * this mark from the same `rate --rating again` result a resumed sitting's
 * transcript already carries. */
export const LapseRite = memo(function LapseRite({ returnDate }: { node: string; returnDate: string | null }) {
  return (
    <div className="flex justify-start my-1.5 pl-1">
      {/* `ritual-mark-in`, NOT `ritual-misconception-in`.
          That class sets `--ink-accent: danger`, and `mark-settle-in` opens at
          a 15% wash of it — so this card spent its first 600ms flashing the
          alarm colour while its own copy said "a lapse resets the interval,
          not the work", inside a warm border. The entrance contradicted both
          the frame and the sentence. MarkFrame's doctrine says the accent
          variable exists precisely so entrance can never mismatch border; this
          card had simply never been migrated. */}
      <div className="tilt-card-soft max-w-[92%] flex flex-col gap-1 rounded-md border border-[var(--color-ink-warm-dim)] px-3 py-2.5 ritual-mark-in">
        <span className="text-xs text-[var(--color-ink-warm)]">
          Filed for relearning{returnDate ? ` — returns ${formatReturnDate(returnDate)}.` : '.'}
        </span>
        <span className="fig-caption">a lapse resets the interval, not the work.</span>
      </div>
    </div>
  )
})
