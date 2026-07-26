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
export const ProbeCard = memo(function ProbeCard({ header }: { header: ProbeHeader }) {
  const accent = header.threshold ? 'var(--color-ink-violet)' : 'var(--color-ink-cool)'
  return (
    <div
      className="panel px-5 py-4 flex flex-col gap-3 border-l-2"
      style={{ borderLeftColor: accent }}
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
