import { memo } from 'react'
import type { ProseBeat } from '../../../shared/beatEvents'
import { ProseMarkdown } from './ProseMarkdown'
import { splitAroundTicket } from '../shared/ticketParser'
import { splitAroundReceiptStrip, splitLearnCoda } from '../shared/learnReceipt'
import { TicketCard } from './ritual/TicketCard'
import { ReceiptStrip, LearnCodaBlock } from './ritual/ReceiptStrip'
import { CopyButton } from './ui/CopyButton'

// Exported — Chat Instruments Wave B's transcript minimap reuses these exact
// icon/accent pairs for beat moments (see shared/instrumentMoments.ts) rather
// than inventing a parallel glyph per beat: this IS the vocabulary a beat
// already renders in, live in the transcript, right above wherever a minimap
// glyph for it would point.
export const BEAT_STYLE: Record<ProseBeat, { label: string; icon: string; accent: string }> = {
  open_gap: { label: 'The gap', icon: '◆', accent: 'var(--color-ink-cool)' },
  predict: { label: 'Predict', icon: '?', accent: 'var(--color-ink-cool)' },
  struggle: { label: 'Hint', icon: '△', accent: 'var(--color-ink-danger)' },
  resolve: { label: 'Resolve', icon: '●', accent: 'var(--color-ink-warm)' },
  self_explain: { label: 'Self-explain', icon: '»', accent: 'var(--color-ink-cool)' },
  connect: { label: 'Connect', icon: '↝', accent: 'var(--color-ink-hot)' },
  // Same glyph + ink as BeatStepper's own verify step and VerifySeal's
  // confirmed-outcome stamp (Marks.tsx) — this card is the announcement, the
  // seal is the (later, outcome-gated) receipt, but both speak "verify" in
  // the same visual language.
  verify: { label: 'Verify', icon: '✓', accent: 'var(--color-ink-warm)' },
}

export const BeatCard = memo(function BeatCard({
  beat,
  text,
  trailingCaret,
  nodeIds,
  nodeChipTopic,
}: {
  beat: ProseBeat
  text: string
  /** Chat Presence Wave D Task 9 — see ChatMessageView's doctrine comment. */
  trailingCaret?: boolean
  /** Chat Instruments Wave B — see ProseMarkdown's own doctrine comment;
   * threaded straight through, both undefined renders byte-identically. */
  nodeIds?: Set<string>
  nodeChipTopic?: string
}) {
  const style = BEAT_STYLE[beat]
  return (
    // `.tilt-card` on the labeled beat card only — PlainDialogueBlock below
    // is deliberately EXCLUDED: it's the transcript's primary reading prose
    // (often near-full transcript-measure width), and reading surfaces stay
    // planted by decree (see index.css's tilt vocabulary).
    <div className="group tilt-card panel px-5 py-4 flex flex-col gap-2 border-l-2" style={{ borderLeftColor: style.accent }}>
      <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide" style={{ color: style.accent }}>
        <div className="flex items-center gap-2">
          <span className="w-4 shrink-0 flex justify-center" aria-hidden="true">{style.icon}</span>
          <span>{style.label}</span>
        </div>
        <CopyButton text={text} />
      </div>
      <ProseMarkdown text={text} className="voice-serif text-[var(--color-text-primary)]" nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />
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
  nodeIds,
  nodeChipTopic,
}: {
  text: string
  /** Chat Presence Wave D Task 9 — see ChatMessageView's doctrine comment.
   * Only meaningful on this call's OWN text (never forwarded to the
   * before/after halves of a ticket split — the ticket sits between them). */
  trailingCaret?: boolean
  /** Chat Instruments Wave B — see ProseMarkdown's own doctrine comment;
   * threaded through every recursive split below (ticket/receipt-strip/coda
   * all carve `text` into prose fragments that still deserve chips) and into
   * the final plain render. Both undefined renders byte-identically. */
  nodeIds?: Set<string>
  nodeChipTopic?: string
}) {
  const ticketSplit = splitAroundTicket(text)
  if (ticketSplit) {
    return (
      <div className="flex flex-col gap-3">
        {ticketSplit.before && (
          <PlainDialogueBlock text={ticketSplit.before} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />
        )}
        <TicketCard ticket={ticketSplit.ticket} />
        {ticketSplit.after && (
          <PlainDialogueBlock text={ticketSplit.after} trailingCaret={trailingCaret} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />
        )}
      </div>
    )
  }
  // Batch-grading receipt strip (Verdict Anatomy §4) — checked AFTER the
  // ticket split so a session ticket is never mistaken for a strip (its
  // header line fails learnReceipt's strict row gate anyway; the order just
  // makes the precedence explicit). Live Learn, replayed Learn, and the
  // history drawer all pass through this one component, so parity is free.
  const receiptSplit = splitAroundReceiptStrip(text)
  if (receiptSplit) {
    return (
      <div className="flex flex-col gap-3">
        {receiptSplit.before && (
          <PlainDialogueBlock text={receiptSplit.before} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />
        )}
        <ReceiptStrip strip={receiptSplit.strip} />
        {receiptSplit.after && (
          <PlainDialogueBlock text={receiptSplit.after} trailingCaret={trailingCaret} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />
        )}
      </div>
    )
  }
  // The `Next time you're back:` forward-pointer coda — only meaningful once
  // fences are out of the way (both splits above recurse back through here).
  const codaSplit = splitLearnCoda(text)
  if (codaSplit) {
    return (
      <div className="flex flex-col gap-3">
        {codaSplit.before && <PlainDialogueBlock text={codaSplit.before} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />}
        <LearnCodaBlock text={codaSplit.coda} />
      </div>
    )
  }
  return (
    <div className="group relative panel-raised px-5 py-4">
      <div className="absolute top-3 right-3">
        <CopyButton text={text} />
      </div>
      <ProseMarkdown
        text={text}
        className="voice-serif text-[var(--color-text-primary)] pr-5"
        nodeIds={nodeIds}
        nodeChipTopic={nodeChipTopic}
      />
      {trailingCaret && <span className="streaming-caret" aria-hidden="true" />}
    </div>
  )
})
