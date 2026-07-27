import { memo } from 'react'
import type { ProseBeat } from '../../../shared/beatEvents'
import { ProseMarkdown } from './ProseMarkdown'
import { splitAroundTicket } from '../shared/ticketParser'
import { TicketCard } from './ritual/TicketCard'
import { CopyButton } from './ui/CopyButton'

const BEAT_STYLE: Record<ProseBeat, { label: string; icon: string; accent: string }> = {
  open_gap: { label: 'The gap', icon: '◆', accent: 'var(--color-ink-cool)' },
  predict: { label: 'Predict', icon: '?', accent: 'var(--color-ink-cool)' },
  struggle: { label: 'Hint', icon: '△', accent: 'var(--color-ink-danger)' },
  resolve: { label: 'Resolve', icon: '●', accent: 'var(--color-ink-warm)' },
  self_explain: { label: 'Self-explain', icon: '»', accent: 'var(--color-ink-cool)' },
  connect: { label: 'Connect', icon: '↝', accent: 'var(--color-ink-hot)' },
}

export const BeatCard = memo(function BeatCard({
  beat,
  text,
  trailingCaret,
}: {
  beat: ProseBeat
  text: string
  /** Chat Presence Wave D Task 9 — see ChatMessageView's doctrine comment. */
  trailingCaret?: boolean
}) {
  const style = BEAT_STYLE[beat]
  return (
    <div className="group panel px-5 py-4 flex flex-col gap-2 border-l-2" style={{ borderLeftColor: style.accent }}>
      <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide" style={{ color: style.accent }}>
        <div className="flex items-center gap-2">
          <span className="w-4 shrink-0 flex justify-center" aria-hidden="true">{style.icon}</span>
          <span>{style.label}</span>
        </div>
        <CopyButton text={text} />
      </div>
      <ProseMarkdown text={text} className="voice-serif text-[var(--color-text-primary)]" />
      {trailingCaret && <span className="streaming-caret" aria-hidden="true" />}
    </div>
  )
})

/** Fallback for unlabeled prose chunks — a plain dialogue block, never a hard
 * failure. A session-ticket fence inside the prose renders as the themed
 * TicketCard in place of the raw mono block (parse is exact; anything that
 * isn't a well-formed ticket falls through untouched). */
export const PlainDialogueBlock = memo(function PlainDialogueBlock({
  text,
  trailingCaret,
}: {
  text: string
  /** Chat Presence Wave D Task 9 — see ChatMessageView's doctrine comment.
   * Only meaningful on this call's OWN text (never forwarded to the
   * before/after halves of a ticket split — the ticket sits between them). */
  trailingCaret?: boolean
}) {
  const ticketSplit = splitAroundTicket(text)
  if (ticketSplit) {
    return (
      <div className="flex flex-col gap-3">
        {ticketSplit.before && <PlainDialogueBlock text={ticketSplit.before} />}
        <TicketCard ticket={ticketSplit.ticket} />
        {ticketSplit.after && <PlainDialogueBlock text={ticketSplit.after} trailingCaret={trailingCaret} />}
      </div>
    )
  }
  return (
    <div className="group relative panel-raised px-5 py-4">
      <div className="absolute top-3 right-3">
        <CopyButton text={text} />
      </div>
      <ProseMarkdown text={text} className="voice-serif text-[var(--color-text-primary)] pr-5" />
      {trailingCaret && <span className="streaming-caret" aria-hidden="true" />}
    </div>
  )
})
