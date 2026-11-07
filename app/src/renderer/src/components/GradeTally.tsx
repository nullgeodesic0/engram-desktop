import type { GradeResult } from '../../../shared/gradeResult'

/** Shared tally row for a session's graded results — recalled/partial/lapsed
 * counts, in the label-data strip style both
 * ReviewSessionView and LearnSessionView render above/below their grade
 * cards. `label` is the item-count noun ("item(s)" for Review, "graded" for
 * Learn) so wording can differ per view while the counting logic stays
 * identical. */
export function GradeTally({
  results,
  label,
  omitTotal = false,
}: {
  results: GradeResult[]
  /** Accepted for call-site compatibility and deliberately not rendered. */
  streakDays?: number | null
  label: string
  /** Skip the leading "{n} {label}" span — for hosts (SessionCeremony) whose
   * PlateFigure headline already states the total; the tally then reads as
   * the breakdown row under the figure rather than saying the count twice. */
  omitTotal?: boolean
}) {
  return (
    <div className="flex items-center gap-4 text-xs label-data text-[var(--color-text-dim)]">
      {!omitTotal && (
        <span>
          {results.length} {label}
        </span>
      )}
      <span className="text-[var(--color-ink-warm)]">
        {results.filter((g) => g.grade === 'recalled').length} recalled
      </span>
      <span className="text-[var(--color-ink-cool)]">
        {results.filter((g) => g.grade === 'partial').length} partial
      </span>
      {/* Neutral, future-tense: a lapse is a card coming back sooner, not
          a failure (see ritual/GradeChip's GRADE_INK). No streak here —
          a consecutive-day count is the one figure a day off can zero. */}
      <span className="text-[var(--color-text-dim)]">
        {results.filter((g) => g.grade === 'lapsed').length} back sooner
      </span>
    </div>
  )
}
