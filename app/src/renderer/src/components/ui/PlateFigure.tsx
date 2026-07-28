import type { ReactNode } from 'react'

const TONE: Record<string, string> = {
  warm: 'text-[var(--color-ink-warm)]',
  cool: 'text-[var(--color-ink-cool)]',
  primary: 'text-[var(--color-text-primary)]',
  dim: 'text-[var(--color-text-dim)]',
}

/** The briefing-plate headline anatomy — ONE number, said once and big (the
 * `.figure-display` serif), with a two-line context block hung off its
 * baseline: a primary title line and an optional label-data note. Extracted
 * from the Review ready-room plate (ritual/ReadyRoomPlate.tsx, which now
 * renders through this) so every "decision moment" surface — Home's status
 * band, Learn's shelf header, a topic's own page, the session ceremony —
 * states its signature figure in the same voice instead of four bespoke ways.
 *
 * Layout and type scale ONLY: the caller owns panel chrome, labeled rows,
 * fig-captions, and the action row. `title`/`note` are ReactNodes so a caller
 * can re-ink a span (the ready-room's warm "oldest overdue" line, a
 * drilldown's danger "due now") without this component growing tone props for
 * every slot. `pulse` reuses the shared one-shot `pulse-once` emphasis (see
 * HomeView's due-count tracking — fires only on a real increase). */
export function PlateFigure({
  value,
  title,
  note,
  tone = 'warm',
  pulse = false,
  onPulseEnd,
}: {
  value: ReactNode
  title: ReactNode
  note?: ReactNode
  tone?: 'warm' | 'cool' | 'primary' | 'dim'
  pulse?: boolean
  onPulseEnd?: () => void
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span
        className={`figure-display ${TONE[tone]} ${pulse ? 'pulse-once' : ''}`}
        onAnimationEnd={pulse ? onPulseEnd : undefined}
      >
        {value}
      </span>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm text-[var(--color-text-primary)]">{title}</span>
        {note && <span className="label-data text-xs text-[var(--color-text-dim)]">{note}</span>}
      </div>
    </div>
  )
}
