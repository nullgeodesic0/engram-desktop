import type { ReactNode, Ref } from 'react'
import { ACCENT, type EnvAccent } from '../shared/controlChrome'

/** The ONE session masthead both chat environments speak — a bounded
 * `tilt-card panel` plate (full-scale tilt: page chrome, not a chat card)
 * whose title band carries a 2px accent top rule and a tracked environment
 * eyebrow (LEARN warm / REVIEW cool), identity on the left, commands on the
 * right, and an instruments register on its own quieter row beneath the
 * band's interior rule. The old full-bleed `-mx-*` hairline command bars
 * die here — a plate is bounded.
 *
 * Stateless and ZERO-hook by design (KeepMounted discipline): Learn's
 * masthead collapse machinery — the 0fr↔1fr grid animation, peek/pin
 * state, the settled-pointer timers — stays entirely in the view and
 * arrives as the `collapsed`/`headerRef`/`onPeek`/`onFocusPeek` props,
 * preserved verbatim from the pre-extraction JSX (timings included).
 * `collapsed === undefined` renders the non-collapsing variant (Review). */
export function SessionMasthead({
  accent,
  eyebrow,
  title,
  identity,
  commands,
  instruments,
  extra,
  collapsed,
  headerRef,
  onPeek,
  onFocusPeek,
}: {
  /** Environment chrome identity (shared/controlChrome.ts) — colors the
   * band's top rule and the eyebrow only; everything inside the slots keeps
   * its own inks. */
  accent: EnvAccent
  /** The tracked environment word above the title — 'LEARN' / 'REVIEW'. */
  eyebrow: string
  /** Serif session title — rendered in the shared h1 register (text-xl,
   * truncating) so both environments read identically. */
  title: ReactNode
  /** The identity sub-line under the title — a label-data lockup on its own
   * line (node · position · walk in Learn; loop position in Review), never
   * nested inside prose-size text. */
  identity?: ReactNode
  /** Right cluster of the title band — command items, pin, dividers. */
  commands?: ReactNode
  /** Row 2 under the band's interior rule — live instruments (beat trail,
   * flow chain, ink well, sitting clock, context gauge). Omitted renders no
   * second row at all. */
  instruments?: ReactNode
  /** Below the rows, still inside the plate — Learn's why-chain panel. */
  extra?: ReactNode
  /** Learn's grid-collapse: boolean drives the 0fr↔1fr fold; undefined
   * renders a plain non-collapsing header (Review). State lives in the view. */
  collapsed?: boolean
  headerRef?: Ref<HTMLElement>
  /** Pointer-enter peek — the view decides when it applies (Learn passes it
   * only mid-session). */
  onPeek?: () => void
  /** Focus-capture peek — keyboard travel into the folded header claims it
   * open, same as the pre-extraction behavior. */
  onFocusPeek?: () => void
}) {
  const a = ACCENT[accent]
  const plate = (
    <div className="tilt-card panel flex flex-col">
      {/* Deliberately compact (user decree: the masthead was eating real
          estate) — tight band padding, text-lg title, slim instrument row.
          The plate should read as chrome above the transcript, never as a
          content region of its own. */}
      <div
        className="detail-title-band px-6 py-2 flex items-center justify-between gap-6"
        style={{ boxShadow: `inset 0 2px 0 ${a.dim}` }}
      >
        <div className="flex flex-col min-w-0">
          <span className="label-data text-[9px] uppercase tracking-[0.28em]" style={{ color: a.ink }}>
            {eyebrow}
          </span>
          <h1 className="font-(family-name:--font-serif) text-lg leading-tight text-[var(--color-text-primary)] truncate">
            {title}
          </h1>
          {identity}
        </div>
        {commands && <div className="flex items-center gap-4 shrink-0">{commands}</div>}
      </div>
      {instruments && <div className="px-6 py-1.5 flex items-center gap-4 min-w-0 overflow-hidden">{instruments}</div>}
      {extra && <div className="px-6 pb-2 pt-1 flex flex-col gap-2">{extra}</div>}
    </div>
  )

  if (collapsed === undefined) {
    return (
      <header ref={headerRef} onMouseEnter={onPeek} onFocusCapture={onFocusPeek} className="shrink-0">
        {plate}
      </header>
    )
  }

  return (
    // Grid 0fr↔1fr animates to the header's TRUE height — unlike a
    // max-height cap, the motion spans the whole duration in both directions
    // with no dead zone. Directional timing: the reveal is quick
    // (--dur-base, ease-out) so the header feels on-call; the hide is longer
    // and eased through both ends so it reads as a settle, not a snap.
    <header
      ref={headerRef}
      // Direct hover is AUTHORITATIVE: entering the header (including
      // mid-fold, while its content is still visibly painted) claims it open
      // immediately, independent of the view's container-mousemove sampling —
      // the sampled-position proxy alone had holes at exactly the top edge
      // where these controls live.
      onMouseEnter={onPeek}
      onFocusCapture={onFocusPeek}
      className={`shrink-0 grid transition-[grid-template-rows] ${
        collapsed
          ? 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)]'
          : 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)]'
      }`}
      style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
    >
      <div
        // The fold fades the whole plate (borders included) while the row
        // track collapses — opacity carries what the old border-transparent
        // swap used to.
        className={`min-h-0 overflow-hidden transition-[opacity,transform] ${
          collapsed
            ? 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)] opacity-0 -translate-y-1'
            : 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)] opacity-100 translate-y-0'
        }`}
      >
        {plate}
      </div>
    </header>
  )
}
