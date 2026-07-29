import { memo } from 'react'
import type { ParsedTicket } from '../../shared/ticketParser'
import { StatFraction } from '../ui/StatFraction'

/** Matches an "n/m"-shaped field value (optionally with trailing prose, e.g.
 * "8/13 unlocked") so every fraction the ticket carries renders through the
 * shared `.stat-fraction` anatomy instead of flat mono text. */
const FRACTION_RE = /^(\d+)\s*\/\s*(\d+)(.*)$/

/** Matches a trailing parenthetical qualifier on an otherwise plain value
 * (e.g. "13 (showing 12)") so it can render dimmer/smaller than the value it
 * qualifies, instead of running together as one flat string. */
const PAREN_TAIL_RE = /^(.*?)\s*(\(.*\))$/

/** Matches a bare leading count with no fraction shape (e.g. "0", "8",
 * "20 untouched", "8 (this topic)" after the paren tail above has already
 * been peeled off) — this is the "number said first" register: a hard fact
 * that isn't a ratio, so it doesn't want the full n/m `.stat-fraction`
 * anatomy, just its bold-numeral half. Real examples: `due today 0`,
 * `pending 0`, `stash 0`, `due 2`, `overdue 0`, `encoded 7`, `retained 17`,
 * `learning 3`, `untouched 19`, `frontier 20 untouched`. */
const BARE_COUNT_RE = /^(\d+)(\s+\S.*)?$/

/** Matches a soft estimate/duration value ("est ~9 min") — informational,
 * not a hard count, so it gets the app's existing "informational aside"
 * register (`.detail-subtitle`: italic serif, dim) instead of a numeral
 * treatment. */
const ESTIMATE_RE = /^~?\s*\d+.*\b(?:min|mins|sec|secs|hour|hours|hr|hrs)\b/i

/** Matches a multi-clause aggregate value: several small "count + word" (or
 * "word + count") facts joined by " · " prose-dots, e.g.
 * "19 retained · 2 learning · 18 untouched" (progress) or
 * "classical-mech 8 · quantum 2 · lenin 1 · labor 1" (topics). Each clause
 * pairs a bare number with a descriptor word in either order. */
const CLAUSE_RE = /^(?:(\d+)\s+(\S+)|(\S+)\s+(\d+))$/

function parseAggregateClauses(
  value: string,
): { n: string; label: string }[] | null {
  if (!value.includes('·')) return null
  const parts = value.split('·').map((p) => p.trim())
  if (parts.length < 2) return null
  const clauses: { n: string; label: string }[] = []
  for (const part of parts) {
    const m = CLAUSE_RE.exec(part)
    if (!m) return null
    const [, nFirst, labelFirst, labelSecond, nSecond] = m
    clauses.push(nFirst != null ? { n: nFirst, label: labelFirst } : { n: nSecond, label: labelSecond })
  }
  return clauses
}

/** A single field value, rendered per its semantic role rather than one flat
 * mono treatment. Classified purely from the value's own shape (and, for the
 * fraction case, reusing `.stat-fraction`) — never from the field's key or
 * from which ticket kind (`learn`/`review`) it came from, so this stays a
 * generic rendering layer over `parseTicket`'s output rather than a
 * view-specific special case. */
function FieldValue({ value }: { value: string }) {
  const trimmed = value.trim()

  // Peel off a trailing parenthetical qualifier first — it applies on top of
  // whichever role the remaining value gets classified into below (a bare
  // count, a fraction, etc. can all carry one), and it always renders in the
  // same dim/small "secondary" register regardless of the main value's role.
  const parenMatch = PAREN_TAIL_RE.exec(trimmed)
  const main = parenMatch && parenMatch[1] ? parenMatch[1] : trimmed
  const parenTail = parenMatch && parenMatch[1] ? parenMatch[2] : null

  const fracMatch = FRACTION_RE.exec(main)
  if (fracMatch) {
    const tail = fracMatch[3].trim()
    return (
      <span className="label-data text-xs text-[var(--color-text-dim)] inline-flex items-baseline gap-1">
        <StatFraction n={fracMatch[1]} d={fracMatch[2]} className="text-xs" />
        {tail && <span>{tail}</span>}
        {parenTail && <span className="text-[var(--color-text-faint)]">{parenTail}</span>}
      </span>
    )
  }

  const clauses = parseAggregateClauses(main)
  if (clauses) {
    return (
      <span className="label-data text-xs text-[var(--color-text-dim)] inline-flex items-baseline flex-wrap gap-x-1 justify-end">
        {clauses.map((c, i) => (
          <span key={i} className="inline-flex items-baseline gap-1">
            {i > 0 && <span className="text-[var(--color-text-faint)]">·</span>}
            <span className="field-clause-n">{c.n}</span>
            <span>{c.label}</span>
          </span>
        ))}
        {parenTail && <span className="text-[var(--color-text-faint)]">{parenTail}</span>}
      </span>
    )
  }

  if (ESTIMATE_RE.test(main)) {
    return (
      <span className="detail-subtitle text-xs inline-flex items-baseline gap-1">
        <span>{main}</span>
        {parenTail && <span className="text-[var(--color-text-faint)] not-italic">{parenTail}</span>}
      </span>
    )
  }

  const bareMatch = BARE_COUNT_RE.exec(main)
  if (bareMatch) {
    const rest = bareMatch[2]?.trim()
    return (
      <span className="label-data text-xs inline-flex items-baseline gap-1">
        <span className="field-count-n">{bareMatch[1]}</span>
        {rest && <span className="text-[var(--color-text-dim)]">{rest}</span>}
        {parenTail && <span className="text-[var(--color-text-faint)]">{parenTail}</span>}
      </span>
    )
  }

  return (
    <span className="label-data text-xs text-[var(--color-text-dim)] inline-flex items-baseline gap-1">
      <span>{main}</span>
      {parenTail && <span className="text-[var(--color-text-faint)]">{parenTail}</span>}
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
  // Every ticket shape gets a real headline, not just the ones with a
  // `topic` field: Review tickets aggregate across multiple topics (no
  // single `topic` value exists to promote), which previously left this
  // variant with zero large-type hierarchy — just the small tracked-uppercase
  // band line and label-data rows. When `topic` is present it stays the
  // headline (unchanged). When it's absent, the ticket's own kind/mode —
  // already stated small in the band — is restated here at headline weight
  // ("Review · Standard"), the same font-display treatment as the topic
  // case. This deliberately does NOT reuse PlateFigure/`.figure-display`
  // (ReadyRoomPlate's big serif due-count): that class is pinned by comment
  // in index.css to one size "by decree" so every decision-moment plate
  // rhymes at full scale, and this compact, chat-embedded, max-w-sm ticket
  // card is not that surface — shrinking `.figure-display` down to fit would
  // both violate that decree and invent a second scale for the same class.
  // Reusing the existing topic-headline pattern instead is zero new
  // typography, matches the "one number, said once, big" READING at this
  // card's own scale via the kind/mode words, and needs no new component.
  const headline = topic
    ? topic.value
    : `${ticket.kind[0]?.toUpperCase()}${ticket.kind.slice(1)}${
        ticket.mode ? ` · ${ticket.mode[0]?.toUpperCase()}${ticket.mode.slice(1)}` : ''
      }`
  return (
    <div
      className={`tilt-card-soft panel-raised relative ${pinned ? 'dogear' : ''} ${compact ? '' : 'max-w-sm'}`}
    >
      <div className={`detail-title-band flex items-center justify-between gap-3 ${padX} ${compact ? 'py-1.5' : 'py-2'}`}>
        <span className="label-data text-[10px] tracking-[0.22em] uppercase text-[var(--color-ink-warm)]">
          engram · {ticket.kind}{ticket.mode != null ? ` · ${ticket.mode}` : ''}
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
        <div className={`font-(family-name:--font-display) font-semibold text-[var(--color-text-primary)] ${compact ? 'text-sm' : 'text-lg'}`}>
          {headline}
        </div>
        {rest.length > 0 && (
          <div className={`${compact ? 'mt-1.5' : 'mt-2'} divide-y divide-[var(--color-hairline)] border-t border-[var(--color-hairline)]`}>
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
