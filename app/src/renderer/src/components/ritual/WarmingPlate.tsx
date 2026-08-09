import { memo } from 'react'
import { MathRenderer } from '../MathRenderer'
import { humanizeNodeId } from '../../../../shared/humanizeId'

/** What fills the gap between pressing Start and the tutor's first word.
 *
 * A real sitting spends a dozen-odd tool calls booting — resolving the plugin,
 * reading the dialogue grammar, loading the queue — before the first probe is
 * posed. Measured on a live transcript: fifteen events, and the learner sees
 * an empty transcript for all of them. That wait is paid on EVERY sitting, and
 * an empty box is the least informative thing to show during it.
 *
 * The app already knows what is coming: it read `due()` itself to build the
 * queue. So the first item's probe is on hand well before the tutor gets to
 * it, and showing it turns dead time into recall time.
 *
 * DOCTRINE — the reason this component reads exactly one field. A `DueItem`
 * carries `claim`, `rubric` and `transfer_probe` alongside the probe, and
 * those three ARE the expected answer; showing any of them before a
 * production turns the next retrieval into recognition and inflates a
 * schedule the learner is trusting. This file touches the probe and nothing
 * else, which is also why it is not on `checkDoctrine`'s pinned answer-reader
 * list — it never becomes one.
 *
 * Honest about its own status: this is the queue's head, not the tutor's
 * choice. The tutor sequences its own sitting and may open elsewhere, so the
 * plate says "first in your queue" rather than "your first question", and it
 * disappears the instant real dialogue arrives. */
export const WarmingPlate = memo(function WarmingPlate({
  probe,
  node,
  topic,
  remaining,
}: {
  probe: string
  node: string
  topic: string | null
  /** How many items the sitting is serving, for a sense of shape. */
  remaining: number
}) {
  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="tilt-card-soft ritual-mark-in max-w-[92%] w-full flex flex-col gap-2 rounded-md border px-3 py-2.5"
        style={{ borderColor: 'var(--color-ink-cool-dim)', ['--ink-accent' as string]: 'var(--color-ink-cool)' }}
      >
        <div className="flex items-center gap-2">
          <span className="skeleton h-2 w-2 rounded-full shrink-0" />
          <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-cool)]">
            WAKING THE TUTOR
          </span>
        </div>

        <div className="fig-caption">
          first in your queue{topic ? ` · ${topic}` : ''} · {remaining === 1 ? '1 item' : `${remaining} items`} this sitting
        </div>

        <div className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]">
          {humanizeNodeId(node)}
        </div>
        <MathRenderer text={probe} className="text-xs text-[var(--color-text-dim)] leading-relaxed" />

        <div className="fig-caption">
          you can start recalling now — the composer opens as soon as the tutor does
        </div>
      </div>
    </div>
  )
})
