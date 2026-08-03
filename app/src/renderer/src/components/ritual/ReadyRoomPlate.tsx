import { memo } from 'react'
import type { DueItem } from '../../../../shared/types'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { InkNode } from '../ui/InkNode'
import { Button } from '../ui/Button'
import { PlateFigure } from '../ui/PlateFigure'
import { SegmentedControl } from '../ui/SegmentedControl'
import { capForMins, coveredCount, type SittingMins, type SittingStyle } from '../../shared/reviewKickoff'
import type { SittingPrefs } from '../../shared/sittingPrefs'

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
  prefs,
  onPrefsChange,
  quickShareStat,
  resumeLabel = 'Resume last session',
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
  /** The intake picker's state, lifted to ReviewSessionView (two plate call
   * sites share it, and startSession composes the kickoff from it). */
  prefs: SittingPrefs
  onPrefsChange: (p: SittingPrefs) => void
  /** The quiet meter (shared/checkpointEvidence.ts's quickShare over the
   * trailing 30 reviews) — null hides the line entirely (no data, or the
   * receipts read failed; a meter never fabricates a zero). */
  quickShareStat: { quick: number; total: number } | null
  /** Override for the ghost CTA's text — the detached-sitting page reads
   * "Return to the sitting" (its onResume just re-enters the live view, no
   * respawn) while the default stays the plain resume wording. */
  resumeLabel?: string
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

      {/* The intake — time and style are session LOGISTICS (the dialogue
          grammar's own carve-out: menus for navigation, never for
          knowledge), so pickers are the honest form here. Style resets to
          Standard every mount (sittingPrefs.ts) — checkpoint is elected per
          sitting, never a sticky default. Still no `.probe` dereference
          anywhere in this file — the picker reads counts, never content. */}
      <div className="flex flex-col gap-2 border-t border-[var(--color-hairline)] pt-3">
        <div className="flex items-center gap-3 flex-wrap">
          <SegmentedControl<`${SittingMins}`>
            options={[
              { value: '5', label: '5 min' },
              { value: '10', label: '10 min' },
              { value: '25', label: '25 min' },
            ]}
            value={`${prefs.mins}`}
            onChange={(v) => onPrefsChange({ ...prefs, mins: Number(v) as SittingMins })}
          />
          <SegmentedControl<SittingStyle>
            options={[
              { value: 'standard', label: 'Free recall', description: 'type your answers cold — the standard sitting' },
              {
                value: 'checkpoint',
                label: 'Checkpoints',
                description: 'chains of small choices — weaker evidence, rated no higher than good, back sooner',
              },
            ]}
            value={prefs.style}
            onChange={(v) => onPrefsChange({ ...prefs, style: v })}
          />
        </div>
        <div className="fig-caption">
          covers about {coveredCount(capForMins(prefs.mins), totalDue)} of {totalDue}
          {prefs.style === 'checkpoint' ? ' · checkpoint style where eligible' : ''}, in triage order
        </div>
        {quickShareStat && quickShareStat.quick > 0 && (
          <div className="fig-caption">
            {quickShareStat.quick} of your last {quickShareStat.total} reviews were checkpoint style — checkpoint
            evidence is weaker than recall
          </div>
        )}
      </div>

      <div className="flex gap-3 items-center">
        <Button variant="primary" size="lg" onClick={onStart} disabled={blocked}>
          Start review session
        </Button>
        {hasPriorSession && (
          <Button variant="ghost" onClick={onResume} disabled={blocked}>
            {resumeLabel}
          </Button>
        )}
      </div>
    </div>
  )
})
