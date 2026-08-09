import { memo, useEffect } from 'react'
import { TopicTitle } from '../TopicTitle'
import type { DueItem } from '../../../../shared/types'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { InkNode } from '../ui/InkNode'
import { Button } from '../ui/Button'
import { PlateFigure } from '../ui/PlateFigure'
import { SegmentedControl } from '../ui/SegmentedControl'
import { planSitting, secondsForTopic, humanMinutes, sittingOptions, nearestOption, type PaceModel } from '../../../../shared/sittingPace'
import { loadSittingOutcome, describeAccuracy } from '../../shared/lastSitting'
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
// Hoisted static option arrays (rerender-memo-with-default-value): inline
// literals would re-create these on every plate render and defeat any
// downstream memoization by identity.
const STYLE_OPTIONS: { value: SittingStyle; label: string; description?: string }[] = [
  { value: 'standard', label: 'Free recall', description: 'type your answers cold — the standard sitting' },
  {
    value: 'checkpoint',
    label: 'Checkpoints',
    description: 'chains of small choices — weaker evidence, rated no higher than good, back sooner',
  },
]

export const ReadyRoomPlate = memo(function ReadyRoomPlate({
  dueItems,
  totalDue,
  topicTitles,
  onStart,
  pace,
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
  /** Measured per-topic pace; null while it loads or when nothing is known. */
  pace?: PaceModel | null
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

  const focusChoices = Array.from(new Set(dueItems.map((d) => d.topic))).sort()

  // What the chosen budget actually buys, charged at this learner's own
  // measured pace per topic rather than a flat item count. The old table
  // promised 24 items for 25 minutes; measurement put that nearer 4.
  const queueTopics = dueItems
    .filter((d) => !prefs.focusTopic || d.topic === prefs.focusTopic)
    .map((d) => d.topic)
  // The offered budgets, from what this queue actually costs. Fixed 5/10/25
  // answered a question nobody asked: with 18 items at ~4 min each the real
  // quantity is 70-odd minutes, so the "long" option cleared a third of the
  // queue and there was no finish-it option at all.
  const queueTotalSeconds = pace
    ? queueTopics.reduce((sum, t) => sum + secondsForTopic(pace, t).seconds, 0)
    : 0
  const options = sittingOptions(queueTotalSeconds)
  // A budget remembered from a different queue must still read as selected.
  const activeMins = nearestOption(prefs.mins, options)
  // The largest option always clears the queue, and says so — that is the
  // number a learner most needs and never had.
  // Persist the snap. The plate showing one budget while the sitting starts
  // from another would be the worst of both: the view reads `prefs.mins`
  // directly, so display and behaviour have to agree on one number.
  useEffect(() => {
    if (options.length > 0 && activeMins !== prefs.mins) {
      onPrefsChange({ ...prefs, mins: activeMins })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMins])

  const minsOptions = options.map((m, i) => ({
    value: `${m}` as `${SittingMins}`,
    label: i === options.length - 1 && options.length > 1 ? `${m} min · all` : `${m} min`,
  }))

  const plan = pace ? planSitting(activeMins, queueTopics, pace) : null

  // ITEM 4 — what the FIRST item costs, when that alone is a sitting. A
  // 14-minute stat-mech item inside a "5 min" budget is an ambush; saying so
  // up front lets the learner pick a different budget instead of abandoning
  // the sitting halfway.
  const firstCost = pace && queueTopics[0] ? secondsForTopic(pace, queueTopics[0]) : null
  const firstIsLong = firstCost !== null && firstCost.seconds > 8 * 60

  // ITEM 10 — how the last estimate actually did. An estimate nobody checks
  // is a guess in a confident font.
  const overdueItems = dueItems.filter((d) => (d.overdue_days ?? 0) > 0)
  const overdueSpread =
    overdueItems.length > 0
      ? `${overdueItems.length} of ${dueItems.length} already overdue, the oldest by ${Math.max(
          ...overdueItems.map((d) => d.overdue_days ?? 0),
        )} days — the engine serves those first`
      : null

  const lastOutcome = loadSittingOutcome()
  const accuracy = lastOutcome ? describeAccuracy(lastOutcome) : null
  const paceBasis = pace && queueTopics[0] ? secondsForTopic(pace, queueTopics[0]) : null

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
                  <TopicTitle title={topicTitles?.[topic] ?? topic} className="text-[var(--color-text-primary)] truncate" />
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
          {/* ITEM 3 — "I have to leave at 21:40" is how the constraint
              actually arrives; a duration is arithmetic the learner should
              not have to do. Snaps to the nearest offered budget rather than
              inventing a fourth. */}
          <input
            type="time"
            aria-label="Out by"
            title="Set when you have to stop — the budget snaps to the nearest option"
            className="focus-ring panel px-2 py-1 text-xs text-[var(--color-text-primary)]"
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number)
              if (!Number.isFinite(h) || !Number.isFinite(m)) return
              const now = new Date()
              const end = new Date(now)
              end.setHours(h, m, 0, 0)
              if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1)
              const mins = (end.getTime() - now.getTime()) / 60000
              const nearest = ([5, 10, 25] as SittingMins[]).reduce((a, b) =>
                Math.abs(b - mins) < Math.abs(a - mins) ? b : a,
              )
              onPrefsChange({ ...prefs, mins: nearest })
            }}
          />
          <SegmentedControl<`${SittingMins}`>
            options={minsOptions}
            value={`${activeMins}`}
            onChange={(v) => onPrefsChange({ ...prefs, mins: Number(v) as SittingMins })}
          />
          <SegmentedControl<SittingStyle>
            options={STYLE_OPTIONS}
            value={prefs.style}
            onChange={(v) => onPrefsChange({ ...prefs, style: v })}
          />
        </div>
        <div className="fig-caption">
          covers about {coveredCount(capForMins(activeMins), totalDue)} of {totalDue}
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
        {/* ITEM 7 — the queue's own shape. `overdue_days` rides on every due
            item and was never shown, so the ordering looked arbitrary when it
            is in fact most-overdue-first. */}
        {/* ITEM 9 — nothing due used to be a dead end: a Start button over an
            empty queue. An empty queue is the system working, and the useful
            next move is learning something new, so say both. */}
        {dueItems.length === 0 && (
          <div className="fig-caption">
            Nothing is due — the schedule is ahead of you. Reviewing early would teach the engine that
            recall was easier than it was, so the honest move is to leave it and learn something new.
          </div>
        )}

        {overdueSpread && <div className="fig-caption">{overdueSpread}</div>}

        {firstIsLong && (
          <div className="fig-caption text-[var(--color-ink-warm)]">
            {`heads up — the first item here usually takes about ${humanMinutes(firstCost.seconds)} on its own`}
          </div>
        )}

        {accuracy && <div className="fig-caption">{accuracy}</div>}

        {plan && plan.items > 0 && (
          <div className="fig-caption">
            {`${activeMins} min covers about ${plan.items} ${plan.items === 1 ? 'item' : 'items'} — ${humanMinutes(plan.predictedSeconds)} at your pace`}
            {paceBasis?.basis === 'topic' && ` (~${humanMinutes(paceBasis.seconds)} each here)`}
            {paceBasis?.basis === 'overall' && ' (from your overall pace — this topic has little history yet)'}
            {plan.overruns && ' · one item already runs past this'}
          </div>
        )}

        {/* One topic at a time. A mixed queue is engine-ordered by savings,
            which is right for retention and hard on a person — an observed
            sitting stepped from stat-mech into quantum between two items.
            Only shown when the queue actually spans more than one topic. */}
        {focusChoices.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="fig-caption shrink-0">focus</span>
            {[null, ...focusChoices].map((t) => (
              <button
                key={t ?? '__all__'}
                onClick={() => onPrefsChange({ ...prefs, focusTopic: t })}
                className={`focus-ring label-data text-[10px] tracking-[0.14em] px-2 py-0.5 border ${
                  prefs.focusTopic === t
                    ? 'border-[var(--color-ink-warm)] text-[var(--color-ink-warm)]'
                    : 'border-[var(--color-hairline)] text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]'
                }`}
              >
                {t === null ? 'ALL' : <TopicTitle title={topicTitles?.[t] ?? t} />}
              </button>
            ))}
          </div>
        )}

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
