import { memo } from 'react'
import type { ParsedReceiptStrip } from '../../shared/learnReceipt'
import { ProseMarkdown } from '../ProseMarkdown'

/** The batch-grading receipt strip, set as a filing stub — TicketCard's
 * field-grid idiom without the perforation (a ticket admits you; a stub
 * records what happened). Full-width rows rather than the ticket's 2-column
 * grid: receipt values ("moment-of-inertia-integration, impulsive-collision-
 * rigid-body → tomorrow") run long, and wrapping inside a half-column would
 * shear them. Every byte of the strip renders — this is a re-setting of the
 * fence, never a summary of it. */
export const ReceiptStrip = memo(function ReceiptStrip({ strip }: { strip: ParsedReceiptStrip }) {
  return (
    <div className="panel-raised px-4 py-3 border-l-2" style={{ borderLeftColor: 'var(--color-ink-warm-dim)' }}>
      <div className="label-data text-[10px] tracking-[0.22em] uppercase text-[var(--color-ink-warm)]">
        {strip.heading ?? 'Receipt'}
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {strip.rows.map((r, i) => (
          <div key={`${r.key}-${i}`} className="flex items-baseline gap-3">
            <span className="label-data text-[10px] text-[var(--color-text-faint)] w-16 shrink-0">{r.key}</span>
            <span className="label-data text-xs text-[var(--color-text-dim)] break-words min-w-0">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

/** Quiet forward-pointer eyebrow above the `Next time you're back:` coda —
 * cool ink, matching the app's open-question register (the coda points at
 * unfinished ground, not settled fact). The prose beneath is untouched. */
export const LearnCodaBlock = memo(function LearnCodaBlock({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2" aria-hidden="true">
        <span className="label-data text-[9px] tracking-[0.18em] uppercase text-[var(--color-ink-cool-dim)]">
          next time →
        </span>
        <span className="h-px flex-1 max-w-24 bg-[var(--color-hairline)]" />
      </div>
      <div className="group relative panel-raised px-5 py-4">
        <ProseMarkdown text={text} className="voice-serif text-[var(--color-text-primary)]" />
      </div>
    </div>
  )
})
