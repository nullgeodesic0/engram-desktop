import type { ReactNode } from 'react'
import type { GradeResult } from '../../../../shared/gradeResult'

/** The single source of the grade→ink mapping — GradeResultCard's badge and
 * return chip, VerdictRows' rating echo, and instrumentMoments' minimap
 * tones all resolve through this table, so "recalled is warm, partial is
 * cool, lapsed is neutral" is stated exactly once.
 *
 * LAPSED IS NOT DANGER (2026-11). A forgotten item is the scheduler working,
 * not the learner failing: it simply comes back sooner. A transcript of red
 * "Lapsed" receipts reads as a failure report, and emotion dysregulation is
 * a large effect in adult ADHD (Beheshti et al. 2020, g = 1.17), so the
 * honest grade is kept and the alarm is taken off it. Danger ink stays
 * reserved for misconceptions — a wrong belief held, which IS worth a
 * flag. See DESIGN.md's Reserved Danger Rule. */
export const GRADE_INK: Record<GradeResult['grade'], { label: string; ink: string; dim: string }> = {
  recalled: { label: 'Recalled', ink: 'var(--color-ink-warm)', dim: 'var(--color-ink-warm-dim)' },
  partial: { label: 'Partial', ink: 'var(--color-ink-cool)', dim: 'var(--color-ink-cool-dim)' },
  lapsed: { label: 'Back sooner', ink: 'var(--color-text-dim)', dim: 'var(--color-edge)' },
}

/** ONE bordered grade chip — ink text, `-dim` border, 16% ink wash (the
 * same fill formula as controlChrome's filled controls, so grade chips and
 * environment chrome read as one family). Children default to the grade's
 * own label; callers with their own text (the rating word, the return-chip
 * sentence) pass it through. */
export function GradeChip({
  grade,
  className = '',
  children,
}: {
  grade: GradeResult['grade']
  className?: string
  children?: ReactNode
}) {
  const g = GRADE_INK[grade]
  return (
    <span
      className={`label-data text-[10px] px-2 py-0.5 inline-block border ${className}`}
      style={{
        color: g.ink,
        borderColor: g.dim,
        background: `color-mix(in srgb, ${g.ink} 16%, transparent)`,
      }}
    >
      {children ?? g.label}
    </span>
  )
}
