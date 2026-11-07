/** Shared chrome-control recipes — the small bordered tilt-card buttons/
 * toggles first cut for the Topic Map's toolbar, now the app-wide idiom for
 * page-level controls. Rail tilt tier by standing decree (small chrome tilts
 * MORE, not less). Transparent at rest (`CTRL_QUIET`); the FILLED variant
 * marks importance — an active toggle/lens or a primary action — in the
 * environment's own accent.
 *
 * `EnvAccent` is the per-environment identity (2026-07-30 decision): Learn's
 * chrome accents WARM (encoding new ground), Review's accents COOL
 * (retrieval under test). It travels as an explicit prop on shared
 * components, never a context provider — and SEMANTIC inks (grade colors,
 * threshold violet, danger) never route through it.
 *
 * `ctrlFilled` returns one of two STATIC template strings (not runtime
 * interpolation) so Tailwind's JIT sees both literal class lists. */
export type EnvAccent = 'warm' | 'cool'

export const ACCENT: Record<EnvAccent, { ink: string; dim: string }> = {
  warm: { ink: 'var(--color-ink-warm)', dim: 'var(--color-ink-warm-dim)' },
  cool: { ink: 'var(--color-ink-cool)', dim: 'var(--color-ink-cool-dim)' },
}

export const CTRL =
  'focus-ring tilt-card-rail label-data text-[11px] uppercase tracking-[0.1em] px-2.5 py-1 border transition-colors duration-[var(--dur-fast)]'

export const CTRL_QUIET = `${CTRL} border-[var(--color-edge)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]`

const CTRL_FILLED_WARM = `${CTRL} border-[var(--color-ink-warm-dim)] bg-[color-mix(in_srgb,var(--color-ink-warm)_16%,transparent)] text-[var(--color-ink-warm)]`
const CTRL_FILLED_COOL = `${CTRL} border-[var(--color-ink-cool-dim)] bg-[color-mix(in_srgb,var(--color-ink-cool)_16%,transparent)] text-[var(--color-ink-cool)]`

/** SOLID variant, for the one send-now action (the composer's Submit once
 * there is something to send). The 16% tint of `ctrlFilled` reads as a
 * selected toggle, not as "this will send", and sat beside four toggles of
 * the same weight. Static strings for Tailwind's JIT, as above. */
const CTRL_SOLID_WARM = `${CTRL} font-semibold border-[var(--color-ink-warm)] bg-[var(--color-ink-warm)] text-[var(--color-void)]`
const CTRL_SOLID_COOL = `${CTRL} font-semibold border-[var(--color-ink-cool)] bg-[var(--color-ink-cool)] text-[var(--color-void)]`

export function ctrlSolid(accent: EnvAccent): string {
  return accent === 'warm' ? CTRL_SOLID_WARM : CTRL_SOLID_COOL
}

export function ctrlFilled(accent: EnvAccent): string {
  return accent === 'warm' ? CTRL_FILLED_WARM : CTRL_FILLED_COOL
}
