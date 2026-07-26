import { memo } from 'react'
import type { DueItem } from '../../../../shared/types'

/** Matches SKILL.md's own standard-mode cap (~12, most-overdue first) — the
 * "estimated length" line states this heuristic in prose rather than a
 * countdown timer, since the engine (not this view) decides how many items
 * an actual sitting covers. */
const SITTING_CAP = 12

/** Same local-date discipline as ReviewSessionView's own `daysOverdueLocal`
 * (getFullYear/Month/Date, never toISOString) — duplicated here rather than
 * imported so this component stays pure of the app-level view, the same
 * pattern LapseRite's own `formatReturnDate` copy already uses. */
function daysOverdueLocal(due: string): number {
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const d = new Date(`${due}T00:00:00`)
  return Math.floor((dayStart.getTime() - d.getTime()) / 86400000)
}

/** The ready room — replaces the old bare "topic + first probe's raw text +
 * two buttons" panel. Names the *shape* of the sitting (how many, across how
 * many topics, how overdue the oldest is) instead of the probe: seeing the
 * question before choosing to sit down starts the retrieval clock early and
 * invites rehearsal, so this surface never reads `.probe`. The amnesty panel
 * (totalDue > 24) stays a sibling panel in ReviewSessionView, unchanged. */
export const ReadyRoomPlate = memo(function ReadyRoomPlate({
  dueItems,
  totalDue,
  onStart,
  onResume,
  hasPriorSession,
  blocked,
}: {
  /** The already-fetched, capped queue (`window.engram.due(12)`) — what this
   * sitting will actually cover, most-overdue-first is not guaranteed by the
   * engine's own ordering, so oldest-overdue below is computed, not assumed. */
  dueItems: DueItem[]
  /** The uncapped total (`window.engram.due()`'s length) — used only to note,
   * honestly, when the queue below is a capped subset of a larger backlog. */
  totalDue: number
  onStart: () => void
  onResume: () => void
  hasPriorSession: boolean
  blocked: boolean
}) {
  const topicCounts = new Map<string, number>()
  let oldestDays = 0
  for (const item of dueItems) {
    topicCounts.set(item.topic, (topicCounts.get(item.topic) ?? 0) + 1)
    oldestDays = Math.max(oldestDays, daysOverdueLocal(item.due))
  }
  const topics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="panel px-5 py-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="text-sm text-[var(--color-text-primary)]">
          {dueItems.length} due across {topics.length} {topics.length === 1 ? 'topic' : 'topics'}
          {totalDue > dueItems.length && (
            <span className="text-[var(--color-text-faint)]"> · {totalDue} in total</span>
          )}
        </div>
        {oldestDays > 0 && (
          <div className="label-data text-xs text-[var(--color-ink-warm)]">
            oldest overdue by {oldestDays} {oldestDays === 1 ? 'day' : 'days'}
          </div>
        )}
      </div>

      {topics.length > 1 && (
        <div className="flex flex-col gap-1 border-t border-[var(--color-hairline)] pt-2">
          {topics.map(([topic, count]) => (
            <div key={topic} className="flex items-center justify-between gap-2 text-xs">
              <span className="label-data uppercase tracking-wider text-[var(--color-text-faint)] truncate">{topic}</span>
              <span className="label-data text-[var(--color-text-dim)] shrink-0">{count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="fig-caption">a normal sitting covers about {SITTING_CAP}, most-overdue first</div>

      <div className="flex gap-2 items-center">
        <button
          onClick={onStart}
          disabled={blocked}
          className="focus-ring self-start px-4 py-2 rounded-lg text-sm bg-[var(--color-surface-3)] text-[var(--color-ink-warm)] hover:bg-[var(--color-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Start review session
        </button>
        {hasPriorSession && (
          <button
            onClick={onResume}
            disabled={blocked}
            className="focus-ring self-start px-3 py-2 rounded-lg text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          >
            Resume last session
          </button>
        )}
      </div>
    </div>
  )
})
