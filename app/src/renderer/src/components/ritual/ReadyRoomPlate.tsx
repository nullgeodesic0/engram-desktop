import { memo } from 'react'
import type { DueItem } from '../../../../shared/types'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { InkNode } from '../ui/InkNode'
import { Button } from '../ui/Button'
import { PlateFigure } from '../ui/PlateFigure'

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

/** The briefing plate — replaces the old bare "topic + first probe's raw
 * text + two buttons" panel with a full-width recompose: ONE count, said once
 * and big, the surface's own signature figure; then, only when the backlog is
 * large, a warm amnesty paragraph; then real per-topic rows.
 *
 * This still never reads `.probe`. Seeing the actual question before
 * choosing to sit down starts the retrieval clock early and invites
 * rehearsal — that discipline is unchanged. What's now ALSO permitted is the
 * due NODES' NAMES (via `humanizeNodeId`, e.g. "chain rule — composite
 * derivative"), one per row, in faint mono. A node's *name* is not its
 * *probe*: the map's own due-lens (Topic Map, Learn's node table) already
 * prints these names as a matter of course wherever a node is due, so this
 * plate showing the same names states nothing the learner couldn't already
 * see by opening the map — it just saves the click. The probe TEXT (the
 * actual question being asked) is the one thing that must never appear here,
 * because unlike a name, the question's exact wording is the retrieval cue
 * itself — reading it before the sitting starts IS rehearsal. Names orient;
 * probes cue. Keep that line bright: `dueItems[].probe` must never be
 * dereferenced anywhere in this file. */
export const ReadyRoomPlate = memo(function ReadyRoomPlate({
  dueItems,
  totalDue,
  topicTitles,
  onStart,
  onResume,
  hasPriorSession,
  blocked,
}: {
  /** The already-fetched, capped queue (`window.engram.due(12)`) — what this
   * sitting will actually cover, most-overdue-first is not guaranteed by the
   * engine's own ordering, so oldest-overdue below is computed, not assumed. */
  dueItems: DueItem[]
  /** The uncapped total (`window.engram.due()`'s length) — used both to note,
   * honestly, when the queue below is a capped subset of a larger backlog,
   * and to gate the amnesty paragraph (`totalDue > 24`). */
  totalDue: number
  /** topic id → real title, resolved non-blockingly via `window.engram.topics()`
   * in ReviewSessionView. Missing/unresolved entries fall back to the raw
   * topic slug so this plate never waits on the fetch to render. */
  topicTitles?: Record<string, string>
  onStart: () => void
  onResume: () => void
  hasPriorSession: boolean
  blocked: boolean
}) {
  const topicGroups = new Map<string, DueItem[]>()
  let oldestDays = 0
  for (const item of dueItems) {
    const list = topicGroups.get(item.topic)
    if (list) list.push(item)
    else topicGroups.set(item.topic, [item])
    oldestDays = Math.max(oldestDays, daysOverdueLocal(item.due))
  }
  const topics = [...topicGroups.entries()].sort((a, b) => b[1].length - a[1].length)

  return (
    <div className="tilt-card-soft panel px-6 py-6 flex flex-col gap-4">
      {/* ONE count, said once, big — the plate's signature. Deliberately
          `totalDue` (the true, uncapped debt), never `dueItems.length` — the
          headline must never understate what's actually owed. The sitting
          still only covers a capped subset, most-overdue first; that's
          explained by the caption below, not by shrinking this figure.
          Rendered through the shared PlateFigure anatomy — this plate is the
          origin of that grammar, and now its first consumer. */}
      <PlateFigure
        value={totalDue}
        tone="warm"
        title={`due across ${topics.length} ${topics.length === 1 ? 'topic' : 'topics'}`}
        note={
          oldestDays > 0 ? (
            <span className="text-[var(--color-ink-warm)]">
              oldest overdue by {oldestDays} {oldestDays === 1 ? 'day' : 'days'}
            </span>
          ) : undefined
        }
      />

      {/* Amnesty — folded in as a register shift inside this one document
          rather than a sibling panel (ReviewSessionView used to render this
          separately, above the plate). Same "due > 2x mode cap" heuristic
          (SKILL.md: standard cap ~12) the skill's own prose echoes once a
          session starts; this is the reliable pre-session beat. */}
      {totalDue > 24 && (
        <p className="text-sm text-[var(--color-ink-warm)] leading-relaxed">
          {totalDue} reviews have piled up — nothing is owed, and that’s not a debt to clear in one sitting. This
          sitting still only covers a capped set, most-overdue first; the rest just stays due, no guilt attached.
        </p>
      )}

      {topics.length > 0 && (
        <div className="flex flex-col gap-2.5 border-t border-[var(--color-hairline)] pt-3">
          {topics.map(([topic, items]) => (
            <div key={topic} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <InkNode id={topic} variant="outlined" size={14} />
                  <span className="text-[var(--color-text-primary)] truncate">{topicTitles?.[topic] ?? topic}</span>
                </div>
                <span className="label-data text-[var(--color-text-dim)] shrink-0">{items.length}</span>
              </div>
              {/* Node NAMES, never the probe text — see the doctrine comment
                  above this component. */}
              <div className="label-data text-[10px] text-[var(--color-text-faint)] pl-[20px] truncate">
                {items.map((it) => humanizeNodeId(it.id)).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="fig-caption">a normal sitting covers about {SITTING_CAP}, most-overdue first</div>

      <div className="flex gap-3 items-center">
        <Button variant="primary" size="lg" onClick={onStart} disabled={blocked}>
          Start review session
        </Button>
        {hasPriorSession && (
          <Button variant="ghost" onClick={onResume} disabled={blocked}>
            Resume last session
          </Button>
        )}
      </div>
    </div>
  )
})
