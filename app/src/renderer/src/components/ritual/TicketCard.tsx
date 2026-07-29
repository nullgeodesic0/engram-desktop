import { memo } from 'react'
import type { ParsedTicket } from '../../shared/ticketParser'
import { StatFraction } from '../ui/StatFraction'

/** Matches an "n/m"-shaped field value (optionally with trailing prose, e.g.
 * "8/13 unlocked") so every fraction the ticket carries renders through the
 * shared `.stat-fraction` anatomy instead of flat mono text. */
const FRACTION_RE = /^(\d+)\s*\/\s*(\d+)(.*)$/

function FieldValue({ value }: { value: string }) {
  const m = FRACTION_RE.exec(value.trim())
  if (!m) return <span className="label-data text-xs text-[var(--color-text-dim)]">{value}</span>
  const tail = m[3].trim()
  return (
    <span className="label-data text-xs text-[var(--color-text-dim)] inline-flex items-baseline gap-1">
      <StatFraction n={m[1]} d={m[2]} className="text-xs" />
      {tail && <span>{tail}</span>}
    </span>
  )
}

/** The session ticket — the dialogue grammar's fenced mono block given a home
 * in the app's full sharp anatomy: a solid `.detail-title-band` header plate
 * carrying the tracked-uppercase session line (walk badge seated in its right
 * edge as a square chip), a serif topic line, then the fields as full-width
 * hairline-divided rows with `.stat-fraction` for every n/m value. `compact`
 * is the rail-pinned variant; `pinned` folds the `.dogear` corner — the pin
 * is the active claim on this card, per the dogear scarcity doctrine.
 *
 * The old perforated left edge (punched radial-gradient notches + dashed rim)
 * is retired: it was kept through the Guardian Atlas restyle as this object's
 * engraved-artifact identity, until the user chose the sharp band/row anatomy
 * for the session cards — the ticket now speaks the same grammar as the rest
 * of the app's detail surfaces. */
export const TicketCard = memo(function TicketCard({
  ticket,
  walkNumber = null,
  compact = false,
  pinned = false,
}: {
  ticket: ParsedTicket
  walkNumber?: number | null
  compact?: boolean
  pinned?: boolean
}) {
  const topic = ticket.fields.find((f) => f.key.toLowerCase() === 'topic')
  const rest = ticket.fields.filter((f) => f !== topic)
  const padX = compact ? 'px-3' : 'px-4'
  return (
    <div
      className={`tilt-card-soft panel-raised relative ${pinned ? 'dogear' : ''} ${compact ? '' : 'max-w-sm'}`}
    >
      <div className={`detail-title-band flex items-center justify-between gap-3 ${padX} ${compact ? 'py-1.5' : 'py-2'}`}>
        <span className="label-data text-[10px] tracking-[0.22em] uppercase text-[var(--color-ink-warm)]">
          engram · {ticket.kind} · {ticket.mode}
        </span>
        {walkNumber != null && (
          <span
            className="label-data text-[9px] tracking-[0.14em] uppercase text-[var(--color-ink-warm-dim)] border border-[var(--color-ink-warm-dim)] px-1 py-0.5 shrink-0"
            aria-label={`Walk ${walkNumber}`}
          >
            walk {walkNumber}
          </span>
        )}
      </div>
      <div className={`${padX} ${compact ? 'py-2' : 'py-2.5'}`}>
        {topic && (
          <div className={`font-(family-name:--font-display) font-semibold text-[var(--color-text-primary)] ${compact ? 'text-sm' : 'text-lg'}`}>
            {topic.value}
          </div>
        )}
        {rest.length > 0 && (
          <div className={`${topic ? (compact ? 'mt-1.5' : 'mt-2') : ''} divide-y divide-[var(--color-hairline)] border-t border-[var(--color-hairline)]`}>
            {rest.map((f) => (
              <div key={f.key} className={`flex items-baseline justify-between gap-3 ${compact ? 'py-1' : 'py-1.5'}`}>
                <span className="label-data text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider">{f.key}</span>
                <FieldValue value={f.value} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
