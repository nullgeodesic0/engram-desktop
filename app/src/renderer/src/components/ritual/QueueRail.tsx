import { memo } from 'react'
import type { GradeResult } from '../../../../shared/gradeResult'
import { humanizeNodeId } from '../../../../shared/humanizeId'

const GRADE_TONE: Record<GradeResult['grade'], string> = {
  recalled: 'var(--color-ink-warm)',
  partial: 'var(--color-ink-cool)',
  lapsed: 'var(--color-ink-danger)',
}
const GRADE_LABEL: Record<GradeResult['grade'], string> = {
  recalled: 'Recalled',
  partial: 'Partial',
  lapsed: 'Lapsed',
}

/** One mark per item in the sitting's queue, absorbing the old "Item N of M"
 * readout it sits in place of. Completed marks are filled and grade-toned
 * (the same GRADE_INK palette GradeChip uses), the current item's
 * mark sits hot and larger, and every mark still ahead is a bare hollow
 * hairline dot.
 *
 * NO-PRIMING IS A HARD SPEC CONSTRAINT, not a style choice: a remaining mark
 * carries no `title`, no `aria-label`, no identifying text in any attribute —
 * ever. A reviewer skimming the rail must never be able to read ahead to
 * what node is coming. Completed marks are the opposite — their whole point
 * is a legible record of the sitting so far, so they DO carry a `title`
 * naming the node + grade. The current mark may name its own node too
 * (`currentNodeId`), since that's already printed on the probe card sitting
 * directly above this rail — nothing is being primed that isn't already on
 * screen.
 *
 * `completedGrades` is `sessionGrades` verbatim (completion order) and
 * `total` is `sessionTotal` verbatim — the caller's own invariant
 * (`sessionTotal - queue.length === sessionGrades.length`, true from the
 * moment a sitting starts through any resume, since both update together in
 * the same rate-result handler — see ReviewSessionView's `sessionTotal`
 * doctrine comment) is what keeps this component's mark count honest; it
 * doesn't recompute anything, just renders what it's told. */
export const QueueRail = memo(function QueueRail({
  total,
  completedGrades,
  hasCurrent,
  currentNodeId,
}: {
  total: number
  completedGrades: GradeResult[]
  hasCurrent: boolean
  currentNodeId?: string | null
}) {
  if (total <= 1) return null
  const completedCount = completedGrades.length

  return (
    <div className="flex items-center gap-1.5 ritual-rail-in">
      {Array.from({ length: total }, (_, i) => {
        if (i < completedCount) {
          const g = completedGrades[i]
          return (
            <span
              key={i}
              title={`${humanizeNodeId(g.node)} — ${GRADE_LABEL[g.grade]}`}
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: GRADE_TONE[g.grade] }}
            />
          )
        }
        if (i === completedCount && hasCurrent) {
          return (
            <span
              key={i}
              title={currentNodeId ? humanizeNodeId(currentNodeId) : undefined}
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{
                background: 'var(--color-ink-hot)',
                boxShadow: '0 0 0 2px color-mix(in srgb, var(--color-ink-hot) 30%, transparent)',
              }}
            />
          )
        }
        // Remaining — hollow hairline, NO title/aria-label/identifying text.
        return <span key={i} className="h-2 w-2 rounded-full shrink-0 border border-[var(--color-hairline)]" />
      })}
    </div>
  )
})
