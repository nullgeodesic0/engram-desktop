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
  // NOT danger ink. This variant marks a DESTRUCTIVE ACTION — delete a topic,
  // close a window — and DESIGN.md reserves danger for the learner's struggle
  // or a lapsed memory. A shared variant is the worst place to break that,
  // because it propagates the violation to every future call site: the button
  // renders the same colour as a lapsed concept, on a surface whose whole
  // thesis is that hue carries memory state. Weight and an explicit label
  // carry "this is destructive"; confirmation carries the rest.
  danger:
    'border border-[var(--color-text-faint)] text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] hover:border-[var(--color-text-dim)] bg-transparent font-medium',
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
