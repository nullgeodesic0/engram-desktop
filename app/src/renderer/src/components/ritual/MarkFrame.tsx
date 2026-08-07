import { memo, type ReactNode } from 'react'

/** The four inks the transcript speaks in. Each is a claim about what KIND of
 * moment just happened, and it must mean the same thing on every card:
 *
 *   warm    — the loop working as intended: a beat, a consolidation, a filed
 *             receipt, an honest piece of friction the tutor will retry.
 *   cool    — a neutral instrument reading: an audit, a citation, a
 *             not-yet-graded observation. Cool never means "good" or "bad".
 *   violet  — synthesis and creation: an explorable forged, an architect's
 *             curriculum returned. Neither consolidation nor alarm.
 *   danger  — content the app is already confident is bad news: a caught
 *             misconception, a lapse. Deliberately scarce; spending it on
 *             ordinary friction is what made ToolFailureCard read as a crisis
 *             when it is not one.
 *
 * The taxonomy predates this component (it was scattered across each card's
 * own class strings); naming it here is what lets a new card pick an ink by
 * meaning instead of by copying whichever neighbour it was pasted from. */
export type MarkAccent = 'warm' | 'cool' | 'violet' | 'danger'

const ACCENT_INK: Record<MarkAccent, string> = {
  warm: 'var(--color-ink-warm)',
  cool: 'var(--color-ink-cool)',
  violet: 'var(--color-ink-violet)',
  danger: 'var(--color-ink-danger)',
}

const ACCENT_INK_DIM: Record<MarkAccent, string> = {
  warm: 'var(--color-ink-warm-dim)',
  cool: 'var(--color-ink-cool-dim)',
  violet: 'var(--color-ink-violet-dim)',
  danger: 'var(--color-ink-danger-dim)',
}

/** The shared skeleton every mark card in the transcript is built from.
 *
 * Before this existed, each card hand-rolled the same frame — `flex
 * justify-start my-1.5 pl-1` outside, `tilt-card-soft max-w-[92%] rounded-md
 * border px-3 py-2.5` inside, a 10px `label-data` caption in the accent ink
 * with a 13–14px glyph beside it — and every copy had drifted: px-3 vs px-3.5,
 * py-2.5 vs py-3, gap-1 vs gap-1.5 vs gap-2, glyphs at 13px next to glyphs at
 * 14px, and entrance animations that were present on some cards, absent on
 * others, and accent-mismatched on one. A learner sees these cards dozens of
 * times a sitting; the drift is small per card and very legible in aggregate.
 *
 * So the frame is one component and the ink is one enum. A card supplies its
 * glyph, its label, and its content — nothing about geometry or motion.
 *
 * `--ink-accent` is set here (not in the CSS file) because it is the ONE
 * value that varies per card, and `.ritual-mark-in`'s single keyframe reads
 * it. That is what guarantees a card's entrance wash matches its own border,
 * which was previously only true by convention. */
export const MarkFrame = memo(function MarkFrame({
  accent,
  label,
  glyph,
  children,
  align = 'start',
  gap = 'normal',
}: {
  accent: MarkAccent
  /** The margin-language caption, e.g. `EXPLORABLE FORGED`. Upper-cased by
   * the caller, not here — a few labels carry their own capitalization. */
  label: string
  /** The card's 14×14 mark. Pass the bare `<path>`/`<circle>` children of an
   * SVG with `viewBox="0 0 14 14"`; the frame owns the `<svg>` element so
   * size, stroke color, and `aria-hidden` can never drift between cards. */
  glyph: ReactNode
  children?: ReactNode
  /** `end` right-aligns the card — used by the few marks that read as the
   * tutor's own stamp rather than an entry in the transcript. */
  align?: 'start' | 'end'
  /** `tight` for label-plus-one-caption cards; `normal` when the body has
   * real content that needs breathing room. */
  gap?: 'tight' | 'normal'
}) {
  const ink = ACCENT_INK[accent]
  return (
    <div className={`flex my-1.5 ${align === 'end' ? 'justify-end pr-2' : 'justify-start pl-1'}`}>
      <div
        className={`tilt-card-soft ritual-mark-in max-w-[92%] flex flex-col rounded-md border px-3 py-2.5 ${
          gap === 'tight' ? 'gap-1' : 'gap-1.5'
        }`}
        style={
          {
            borderColor: ACCENT_INK_DIM[accent],
            '--ink-accent': ink,
          } as React.CSSProperties
        }
      >
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0" style={{ color: ink }}>
            {glyph}
          </svg>
          <span className="label-data text-[10px] tracking-[0.14em]" style={{ color: ink }}>
            {label}
          </span>
        </div>
        {children}
      </div>
    </div>
  )
})
