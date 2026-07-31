import { memo } from 'react'
import type { ProbeHeader } from '../../../../shared/probeHeader'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { MathRenderer } from '../MathRenderer'
import { ACCENT, type EnvAccent } from '../../shared/controlChrome'

/** The moment of asking, set in the same title-band anatomy as TicketCard —
 * a solid `.detail-title-band` header carrying position/node/topic/threshold/
 * overdue, the question body seated below it — while KEEPING the `border-l-2`
 * accent bar, this card's named house identity.
 *
 * Accent: the environment's chrome ink by default (Review's cool — an open
 * question is not-yet-consolidated), but a threshold node's violet is a
 * SEMANTIC signal and wins outright over any environment accent, stated in
 * words rather than leaving a dagger to be decoded. */
export const ProbeCard = memo(function ProbeCard({
  header,
  highlighted,
  onHoverChange,
  accent = 'cool',
}: {
  header: ProbeHeader
  /** Chat Instruments Wave B — true while a GradeResultCard for this SAME
   * node (matched by the caller — see ChatMessageView's own doctrine
   * comment) is hovered elsewhere in the transcript. A soft ring/wash only;
   * never anything that could move layout, since it can flip on/off many
   * times a second while a pointer drifts across the transcript. */
  highlighted?: boolean
  /** Reports THIS card's own hover state up, so the caller can highlight its
   * partner GradeResultCard in turn. Undefined at any call site that never
   * wires the linkage (SessionHistoryDrawer's replay of a Learn sitting, a
   * live Learn session — neither renders a GradeResultCard inline to pair
   * with). */
  onHoverChange?: (hovering: boolean) => void
  /** Environment chrome identity (shared/controlChrome.ts) — Review's cool
   * is the default and today's color, so non-threshold probes change
   * structurally only. Never overrides threshold violet. */
  accent?: EnvAccent
}) {
  const ink = header.threshold ? 'var(--color-ink-violet)' : ACCENT[accent].ink
  const dim = header.threshold ? 'var(--color-ink-violet-dim)' : ACCENT[accent].dim
  return (
    <div
      className={`tilt-card-soft panel border-l-2 transition-shadow duration-[var(--dur-fast)] ${highlighted ? 'pair-linked' : ''}`}
      style={{ borderLeftColor: ink }}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      <div className="detail-title-band flex items-center gap-2.5 flex-wrap px-4 py-2">
        <span
          className="label-data text-[10px] px-1.5 py-0.5 tabular-nums border inline-block shrink-0"
          style={{ color: ink, borderColor: dim, background: `color-mix(in srgb, ${ink} 16%, transparent)` }}
        >
          {header.index}/{header.total}
        </span>
        <span className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]">
          {humanizeNodeId(header.node)}
        </span>
        {header.topic && (
          <span className="label-data text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
            {header.topic}
          </span>
        )}
        {header.threshold && (
          <span
            className="label-data text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--color-ink-violet)' }}
            title="A threshold concept — the topic hinges on this one"
          >
            threshold
          </span>
        )}
        {/* Addition C (chat refine round) — a faint mono whisper of how
            overdue this item is, straight off the tutor's own header line
            (see ProbeHeader.daysOverdue's doctrine comment) — never a new
            fetch, never `due()`'s own numbers recomputed here. Absent for
            the common case of a header with no overdue clause at all. */}
        {header.daysOverdue !== null && (
          <span className="label-data text-[10px] font-mono text-[var(--color-text-faint)]">
            {header.daysOverdue} {header.daysOverdue === 1 ? 'day' : 'days'} overdue
          </span>
        )}
      </div>
      {header.body && (
        <div className="px-4 py-3.5">
          <MathRenderer
            text={header.body}
            className="voice-serif text-[var(--color-text-primary)] leading-relaxed"
          />
        </div>
      )}
    </div>
  )
})
