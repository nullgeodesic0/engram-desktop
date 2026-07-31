import type { ReactNode } from 'react'
import type { GradeResult } from '../../../../shared/gradeResult'

/** The single source of the grade→ink mapping — GradeResultCard's badge and
 * return chip, VerdictRows' rating echo, and instrumentMoments' minimap
 * tones all resolve through this table, so "recalled is warm, partial is
 * cool, lapsed is danger" is stated exactly once. */
export const GRADE_INK: Record<GradeResult['grade'], { label: string; ink: string; dim: string }> = {
  recalled: { label: 'Recalled', ink: 'var(--color-ink-warm)', dim: 'var(--color-ink-warm-dim)' },
  partial: { label: 'Partial', ink: 'var(--color-ink-cool)', dim: 'var(--color-ink-cool-dim)' },
  lapsed: { label: 'Lapsed', ink: 'var(--color-ink-danger)', dim: 'var(--color-ink-danger-dim)' },
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
