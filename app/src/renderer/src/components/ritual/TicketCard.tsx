import { memo } from 'react'
import type { ParsedTicket } from '../../shared/ticketParser'

/** The session ticket, set as an actual ticket — the dialogue grammar's
 * fenced mono block given a home: perforated left edge, stamped header,
 * serif topic line, mono field grid. `compact` is the rail-pinned variant.
 *
 * Deliberate keep (Guardian Atlas restyle): the perforation stays a punched
 * radial-gradient notch, not squared off with the rest of the app's edges —
 * it's the engraved-artifact identity of this one object (a literal ticket
 * stub), not a generic panel corner, so the sharp-corners sweep does not
 * touch it. */
export const TicketCard = memo(function TicketCard({
  ticket,
  walkNumber = null,
  compact = false,
}: {
  ticket: ParsedTicket
  walkNumber?: number | null
  compact?: boolean
}) {
  const topic = ticket.fields.find((f) => f.key.toLowerCase() === 'topic')
  const rest = ticket.fields.filter((f) => f !== topic)
  return (
    <div
      className={`tilt-card panel-raised relative overflow-hidden ${compact ? 'px-3 py-2.5' : 'px-4 py-3 max-w-sm'}`}
      style={{
        // Perforated edge: punched notches down the left rim.
        backgroundImage:
          'radial-gradient(circle at 0 50%, var(--color-void) 2.5px, transparent 3px)',
        backgroundSize: '8px 12px',
        backgroundRepeat: 'repeat-y',
        backgroundPosition: 'left center',
        borderLeft: '1px dashed var(--color-ink-warm-dim)',
      }}
    >
      <div className="flex items-center justify-between gap-3 pl-2">
        <span className="label-data text-[10px] tracking-[0.22em] uppercase text-[var(--color-ink-warm)]">
          engram · {ticket.kind} · {ticket.mode}
        </span>
        {walkNumber != null && (
          <span
            className="label-data text-[9px] tracking-[0.14em] uppercase text-[var(--color-ink-warm-dim)] border border-[var(--color-ink-warm-dim)] rounded-sm px-1 py-0.5 rotate-2"
            aria-label={`Walk ${walkNumber}`}
          >
            walk {walkNumber}
          </span>
        )}
      </div>
      {topic && (
        <div className={`pl-2 font-[var(--font-serif)] text-[var(--color-text-primary)] ${compact ? 'text-sm mt-1' : 'text-lg mt-1.5'}`}>
          {topic.value}
        </div>
      )}
      <div className={`pl-2 grid grid-cols-2 gap-x-4 gap-y-0.5 ${compact ? 'mt-1' : 'mt-2'}`}>
        {rest.map((f) => (
          <div key={f.key} className="flex items-baseline justify-between gap-2">
            <span className="label-data text-[10px] text-[var(--color-text-faint)]">{f.key}</span>
            <span className="label-data text-xs text-[var(--color-text-dim)]">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
})
