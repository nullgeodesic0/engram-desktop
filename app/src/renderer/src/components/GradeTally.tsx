import type { GradeResult } from '../../../shared/gradeResult'

/** Shared tally row for a session's graded results — recalled/partial/lapsed
 * counts plus an optional streak, in the label-data strip style both
 * ReviewSessionView and LearnSessionView render above/below their grade
 * cards. `label` is the item-count noun ("item(s)" for Review, "graded" for
 * Learn) so wording can differ per view while the counting logic stays
 * identical. */
export function GradeTally({
  results,
  streakDays,
  label,
}: {
  results: GradeResult[]
  streakDays: number | null
  label: string
}) {
  return (
    <div className="flex items-center gap-4 text-xs label-data text-[var(--color-text-dim)]">
      <span>
        {results.length} {label}
      </span>
      <span className="text-[var(--color-ink-warm)]">
        {results.filter((g) => g.grade === 'recalled').length} recalled
      </span>
      <span className="text-[var(--color-ink-cool)]">
        {results.filter((g) => g.grade === 'partial').length} partial
      </span>
      <span className="text-[var(--color-ink-danger)]">
        {results.filter((g) => g.grade === 'lapsed').length} lapsed
      </span>
      {streakDays !== null && streakDays > 0 && (
        <span>
          {streakDays} day{streakDays === 1 ? '' : 's'} streak
        </span>
      )}
    </div>
  )
}
