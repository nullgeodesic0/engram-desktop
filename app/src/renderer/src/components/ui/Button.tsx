import type { ButtonHTMLAttributes } from 'react'

const VARIANT: Record<string, string> = {
  // `--color-accent-cta`/`-hover` default to `--color-ink-warm`/`--color-ink-hot`
  // (dark theme renders byte-identical to before); the light theme overrides
  // just this pair to a grayish-blue so the primary-button chrome role shifts
  // without touching `--color-ink-warm` itself, which stays the app's
  // cross-theme "surviving signal" semantic elsewhere (StatBlock, GradeResultCard,
  // node-state ink all still read amber in light mode on purpose).
  primary:
    'bg-[color-mix(in_srgb,var(--color-accent-cta)_82%,transparent)] text-[var(--color-void)] hover:bg-[color-mix(in_srgb,var(--color-accent-cta-hover)_86%,transparent)] font-medium',
  ghost:
    'border border-[var(--color-edge)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-faint)] bg-transparent',
  danger:
    'border border-[var(--color-ink-danger-dim)] text-[var(--color-ink-danger)] hover:bg-[var(--color-ink-danger-dim)]/30 bg-transparent',
}

/** `md` is the original, unchanged geometry (px-3 py-1.5 text-sm) — every
 * existing call site that doesn't pass `size` renders byte-identical to
 * before this scale existed. `sm` is for dense inline affordances, `lg` for
 * full-width hero CTAs (Home's "Clear today's reviews" / Review's "Start")
 * that used to hand-roll bang-prefixed padding overrides past this component. */
const SIZE: Record<string, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-6 py-4 text-base',
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <button
      className={`focus-ring rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${SIZE[size]} ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  )
}
