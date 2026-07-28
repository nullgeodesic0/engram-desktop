import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'

export interface ReviewDocketItem {
  id: string
  topic: string
  /** Computed client-side against LOCAL today (getFullYear/Month/Date — never
   * toISOString, see ReviewSessionView.startSession) rather than trusting the
   * engine's own `overdue_days`, which the docket never reads. */
  daysOverdue: number
}

const DOCKET_CAP = 8

/** The opening docket — a snapshot of what's due, staged above the transcript
 * the instant a fresh review sitting opens (Review's answer to Learn's
 * AtlasBirth: a one-time card marking how the sitting begins). Rows read
 * humanized node + raw topic tag + tabular days-overdue, oldest (most
 * overdue) first, capped at DOCKET_CAP with an "and N more…" tail instead of
 * scrolling the whole queue into view. Built once from `window.engram.due()`
 * in ReviewSessionView.startSession — a plain snapshot read with no durable
 * record in the transcript, so (per the doctrine comment on RitualMark in
 * Marks.tsx) it never reappears on resume or in SessionHistoryDrawer's replay. */
export const ReviewDocket = memo(function ReviewDocket({ items }: { items: ReviewDocketItem[] }) {
  if (items.length === 0) return null
  const shown = items.slice(0, DOCKET_CAP)
  const overflow = items.length - shown.length
  return (
    <div className="tilt-card panel px-4 py-3 max-w-md flex flex-col gap-2 ritual-diagnostic-in">
      <div className="flex flex-col gap-1.5">
        {shown.map((it) => (
          <div key={it.id} className="flex items-center gap-2.5">
            <span className="text-sm text-[var(--color-text-dim)] flex-1 min-w-0 truncate">{humanizeNodeId(it.id)}</span>
            <span className="label-data text-[10px] tracking-[0.1em] text-[var(--color-text-faint)] shrink-0 uppercase">
              {it.topic}
            </span>
            <span className="label-data text-[10px] text-[var(--color-ink-warm)] shrink-0 w-9 text-right">
              {it.daysOverdue}d
            </span>
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <div className="fig-caption pt-2 border-t border-[var(--color-hairline)]">and {overflow} more…</div>
      )}
    </div>
  )
})
