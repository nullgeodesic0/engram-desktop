import { memo } from 'react'
import type { ProbeHeader } from '../../../../shared/probeHeader'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { MathRenderer } from '../MathRenderer'

/** The moment of asking, set as a card rather than left as prose.
 *
 * Cool ink throughout: a probe is an open question, and warm is this app's
 * colour for consolidated/settled things — colouring the ask warm would say
 * the wrong thing before you've answered. A threshold node (`†`) gets the
 * violet accent the design language reserves for gateway concepts, and says
 * so in words rather than leaving a dagger to be decoded. */
export const ProbeCard = memo(function ProbeCard({
  header,
  highlighted,
  onHoverChange,
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
}) {
  const accent = header.threshold ? 'var(--color-ink-violet)' : 'var(--color-ink-cool)'
  return (
    <div
      className={`tilt-card-soft panel px-5 py-4 flex flex-col gap-3 border-l-2 transition-shadow duration-[var(--dur-fast)] ${highlighted ? 'pair-linked' : ''}`}
      style={{ borderLeftColor: accent }}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <span
          className="label-data text-[10px] px-1.5 py-0.5 rounded tabular-nums"
          style={{ color: accent, background: 'var(--color-surface-2)' }}
        >
          {header.index}/{header.total}
        </span>
        <span className="font-[var(--font-serif)] text-sm text-[var(--color-text-primary)]">
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
        <MathRenderer
          text={header.body}
          className="voice-serif text-[var(--color-text-primary)] leading-relaxed"
        />
      )}
    </div>
  )
})
