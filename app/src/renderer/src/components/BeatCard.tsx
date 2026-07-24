import { memo, useState } from 'react'
import type { ProseBeat } from '../../../shared/beatEvents'
import { MathRenderer } from './MathRenderer'
import { splitAroundTicket } from '../shared/ticketParser'
import { TicketCard } from './ritual/TicketCard'

const BEAT_STYLE: Record<ProseBeat, { label: string; icon: string; accent: string }> = {
  open_gap: { label: 'The gap', icon: '◆', accent: 'var(--color-ink-cool)' },
  predict: { label: 'Predict', icon: '?', accent: 'var(--color-ink-cool)' },
  struggle: { label: 'Hint', icon: '△', accent: 'var(--color-ink-danger)' },
  resolve: { label: 'Resolve', icon: '●', accent: 'var(--color-ink-warm)' },
  self_explain: { label: 'Self-explain', icon: '»', accent: 'var(--color-ink-cool)' },
  connect: { label: 'Connect', icon: '↝', accent: 'var(--color-ink-hot)' },
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      title="Copy"
      className="focus-ring no-press opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--dur-fast)] shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] text-xs"
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

export const BeatCard = memo(function BeatCard({ beat, text }: { beat: ProseBeat; text: string }) {
  const style = BEAT_STYLE[beat]
  return (
    <div className="group panel px-5 py-4 flex flex-col gap-2 border-l-2" style={{ borderLeftColor: style.accent }}>
      <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide" style={{ color: style.accent }}>
        <div className="flex items-center gap-2">
          <span className="w-4 shrink-0 flex justify-center">{style.icon}</span>
          <span>{style.label}</span>
        </div>
        <CopyButton text={text} />
      </div>
      <MathRenderer text={text} className="voice-serif text-[var(--color-text-primary)]" />
    </div>
  )
})

/** Fallback for unlabeled prose chunks — a plain dialogue block, never a hard
 * failure. A session-ticket fence inside the prose renders as the themed
 * TicketCard in place of the raw mono block (parse is exact; anything that
 * isn't a well-formed ticket falls through untouched). */
export const PlainDialogueBlock = memo(function PlainDialogueBlock({ text }: { text: string }) {
  const ticketSplit = splitAroundTicket(text)
  if (ticketSplit) {
    return (
      <div className="flex flex-col gap-3">
        {ticketSplit.before && <PlainDialogueBlock text={ticketSplit.before} />}
        <TicketCard ticket={ticketSplit.ticket} />
        {ticketSplit.after && <PlainDialogueBlock text={ticketSplit.after} />}
      </div>
    )
  }
  return (
    <div className="group relative panel-raised px-5 py-4">
      <div className="absolute top-3 right-3">
        <CopyButton text={text} />
      </div>
      <MathRenderer text={text} className="voice-serif text-[var(--color-text-primary)] pr-5" />
    </div>
  )
})
