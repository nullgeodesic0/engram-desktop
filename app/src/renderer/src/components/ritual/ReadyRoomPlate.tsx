import { memo } from 'react'
import { TopicTitle } from '../TopicTitle'
import type { DueItem } from '../../../../shared/types'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { InkNode } from '../ui/InkNode'
import { Button } from '../ui/Button'
import { PlateFigure } from '../ui/PlateFigure'
import { SegmentedControl } from '../ui/SegmentedControl'
import { SittingRuler } from './SittingRuler'
import { buildRuler, snapToItem } from '../../shared/sittingRuler'
import { secondsForTopic, sittingOptions, type PaceModel } from '../../../../shared/sittingPace'
import { loadSittingOutcome, describeAccuracy } from '../../shared/lastSitting'
import type { SittingMins, SittingStyle } from '../../shared/reviewKickoff'
import type { SittingPrefs } from '../../shared/sittingPrefs'

/** Same local-date discipline as ReviewSessionView's own `daysOverdueLocal`
 * (getFullYear/Month/Date, never toISOString) — duplicated here rather than
 * imported so this component stays pure of the app-level view, the same
 * pattern LapseRite's own `formatReturnDate` copy already uses. */
/** How many of a topic's due items are already past their date. `overdue_days`
 * rides on every DueItem and was never shown per topic. */
function overdueIn(items: DueItem[]): number {
  return items.filter((i) => (i.overdue_days ?? 0) > 0).length
}

function daysOverdueLocal(due: string): number {
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const d = new Date(`${due}T00:00:00`)
  return Math.floor((dayStart.getTime() - d.getTime()) / 86400000)
}

/** INK ON THIS SURFACE, since two rules meet here and pull opposite ways.
 *
 * `controlChrome.ts` decrees Review accents COOL (retrieval under test), and
 * this whole plate was drawing its chrome warm. But DESIGN.md's Consolidation
 * Axis says warm marks a memory that SURVIVED — and a due review item is
 * exactly that: it reached `state: 'review'` and is now being re-tested. So
 * the split is not "make it all cool", it is:
 *
 *   · CHROME — selection, pills, active washes, section labels — takes the
 *     environment accent (cool here). It is saying "you are in Review".
 *   · STATE — the due figure, overdue emphasis — stays warm. It is saying
 *     "these are consolidated memories", which is true and is what warm means.
 *
 * Get that backwards and either the environment loses its identity or the
 * consolidation axis stops meaning anything.
 */
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
  morphName,
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
  /** Shared-element name for the view transition into the session — see
   * SessionMasthead's own `morphName`. Set only while a sitting is opening. */
  morphName?: string
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
  // NOTE: an earlier version snapped `prefs.mins` to the nearest preset in an
  // effect. That was fine while the presets were the only control and fatal
  // once the ruler existed — setting 23 minutes on the ruler was immediately
  // rewritten to the nearest preset, so the handle sprang back on every drag.
  // The ruler is the continuous control and owns `prefs.mins`; the presets are
  // jump-to shortcuts that highlight only on an exact match.

  const minsOptions = options.map((m, i) => ({
    value: `${m}` as `${SittingMins}`,
    label: i === options.length - 1 && options.length > 1 ? `${m} min · all` : `${m} min`,
  }))

  // Explicitly projected, never the DueItem itself: `DueItem` carries probe,
  // claim and rubric, and the ready room must not hold them. Mapping to the
  // three structural fields the ruler needs makes that a type guarantee
  // rather than a rule someone has to remember.
  const rulerItems = dueItems
    .filter((d) => !prefs.focusTopic || d.topic === prefs.focusTopic)
    .map((d) => ({ topic: d.topic, id: d.id, overdue_days: d.overdue_days }))
  const ruler = buildRuler(rulerItems, pace ?? null, prefs.mins)

  // The "first item is long" warning used to be a caption. The ruler says it
  // better and continuously: that item is simply the widest segment, and if it
  // alone overruns the chosen budget the ruler's own readout reports it (see
  // `overruns`). One statement, in the place you are already looking.

  // ITEM 10 — how the last estimate actually did. An estimate nobody checks
  // is a guess in a confident font.
  // The overdue spread used to be a caption here. It is now drawn: the ruler
  // foots every overdue segment in danger ink and its own caption names the
  // mark, so the sentence was a third telling of a fact already on screen
  // twice. The ruler was built to retire these lines; leaving them was an
  // admission it had not.

  // "Heavy" measured in time, not item count — see the amnesty comment below.
  const AMNESTY_MINUTES = 90
  const perItemSeconds = pace && queueTopics[0] ? secondsForTopic(pace, queueTopics[0]).seconds : 60
  const backlogFeelsHeavy = (totalDue * perItemSeconds) / 60 >= AMNESTY_MINUTES

  const lastOutcome = loadSittingOutcome()
  const accuracy = lastOutcome ? describeAccuracy(lastOutcome) : null
  const paceBasis = pace && queueTopics[0] ? secondsForTopic(pace, queueTopics[0]) : null

  return (
    // gap-6 between registers, tight inside them. Every child used to sit at
    // gap-4 — six registers at one interval, so the figure, its aside, the
    // inventory, the budget, the caveats and the action all read as equally
    // related to each other, which is to say not grouped at all. The
    // situation (figure + its aside) now holds together at gap-2 while the
    // decision below is a clear step away.
    <div
      className="tilt-card-soft panel px-6 py-6 flex flex-col gap-6"
      style={morphName ? { viewTransitionName: morphName } : undefined}
    >
      {/* ONE count, said once, big — the plate's signature. Deliberately
          `totalDue` (the true, uncapped debt), never `dueItems.length` — the
          headline must never understate what's actually owed. The sitting
          still only covers a capped subset, most-overdue first; that's
          explained by the caption below, not by shrinking this figure.
          Rendered through the shared PlateFigure anatomy — this plate is the
          origin of that grammar, and now its first consumer. */}
      <div className="flex flex-col gap-2">
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
      {/* Threshold in MINUTES of real work, not in the engine's cap.
          It was `totalDue > 24` — twice the standard cap — so the compassion
          was indexed to a scheduler constant. At the measured ~4.6 min an item
          a person is already looking at two hours of work by 24, and someone
          at 18 due got the full indictment and none of the reassurance. This
          fires when the backlog exceeds about an hour and a half of actual
          sitting, computed at this learner's own pace where one exists. */}
      {backlogFeelsHeavy && (
        // A prose measure, not the plate's. Unbounded this ran ~180
        // characters on one line — two and a half times readable — which for
        // a paragraph whose whole job is to lower the temperature is the
        // opposite of calming. The transcript caps at 92ch for the same
        // reason; this is shorter still because it is a single aside.
        <p className="text-sm text-[var(--color-ink-warm)] leading-relaxed max-w-[64ch]">
          {totalDue} reviews have piled up — nothing is owed, and that’s not a debt to clear in one sitting. This
          sitting still only covers a capped set, most-overdue first; the rest just stays due, no guilt attached.
        </p>
      )}
      </div>

      {topics.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-[var(--color-hairline)] pt-4">
          {/* The group had no name and no home for its own control. It now
              has both — and the ALL pill is where "clear the focus" lives,
              which is why the separate focus-chip row below could go. */}
          <div className="flex items-center gap-2.5">
            <span className="label-data text-[10px] uppercase tracking-[0.28em] text-[var(--color-text-dim)] shrink-0">
              Due by topic
            </span>
            {focusChoices.length > 1 && (
              <button
                onClick={() => onPrefsChange({ ...prefs, focusTopic: null })}
                aria-pressed={prefs.focusTopic === null}
                className={`focus-ring label-data text-[10px] tracking-[0.14em] px-2 py-0.5 border shrink-0 ${
                  prefs.focusTopic === null
                    ? 'border-[var(--color-ink-cool)] text-[var(--color-ink-cool)]'
                    : 'border-[var(--color-hairline)] text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]'
                }`}
              >
                ALL
              </button>
            )}
            <span className="h-px flex-1 bg-[var(--color-hairline)]" aria-hidden="true" />
          </div>

          {/* One list, not two. These rows named every topic and a separate
              chip row underneath named all of them AGAIN as focus buttons —
              the same four things twice, three hundred pixels apart, so the
              inventory and the control that acts on it had to be matched up
              by reading. The row IS the control now: pressing one works that
              topic only, pressing it again clears. Same `focusTopic` state
              and same behaviour as the chips had; it just lives on the thing
              it names. */}
          {topics.map(([topic, items]) => {
            const active = prefs.focusTopic === topic
            const selectable = focusChoices.length > 1
            const Row = selectable ? 'button' : 'div'
            return (
              <Row
                key={topic}
                {...(selectable
                  ? {
                      onClick: () => onPrefsChange({ ...prefs, focusTopic: active ? null : topic }),
                      'aria-pressed': active,
                      title: active ? 'Working this topic only — press to clear' : 'Work only this topic',
                    }
                  : {})}
                className={`w-full text-left flex flex-col gap-1 px-2 py-1.5 border transition-colors duration-[var(--dur-base)] ${
                  selectable ? 'focus-ring' : ''
                } ${
                  active
                    ? 'border-[var(--color-ink-cool-dim)] bg-[color-mix(in_srgb,var(--color-ink-cool)_8%,transparent)]'
                    : `border-transparent ${selectable ? 'hover:border-[var(--color-edge)]' : ''}`
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <InkNode
                      id={topic}
                      variant="outlined"
                      color={active ? 'var(--color-ink-cool)' : undefined}
                      size={14}
                    />
                    <TopicTitle
                      title={topicTitles?.[topic] ?? topic}
                      className={`truncate ${active ? 'text-[var(--color-ink-cool)]' : 'text-[var(--color-text-primary)]'}`}
                    />
                  </div>
                  {/* Overdue carried no colour at all: a topic nine days past
                      and a topic due this morning printed the same dim number,
                      so the queue's shape had to be read out of the node names
                      or not at all. Danger ink is right here and is already
                      the established mark for it — HealthRing's due notch and
                      the ruler's overdue foot both use it — and the count is
                      spelled out rather than implied, so the signal is not
                      hue-only. */}
                  <span className="label-data shrink-0 flex items-baseline gap-1.5">
                    {/* Total first, then the overdue share. Reversed, "2
                        overdue 4" read as "2 overdue out of 4" — the eye takes
                        the leading number as the subject, and the subject here
                        is how many are due. */}
                    <span className="text-[var(--color-text-dim)]">{items.length}</span>
                    {overdueIn(items) > 0 && (
                      <span className="text-[var(--color-ink-danger)]">· {overdueIn(items)} overdue</span>
                    )}
                  </span>
                </div>
                {/* Node NAMES, never the probe text — see the doctrine comment
                    above this component. */}
                {/* `text-dim`, not `text-faint`. Measured: faint on this
                    panel is 2.38:1 in the dark theme and 2.89:1 in the light —
                    below even the 3:1 large-text floor, at the SMALLEST size on
                    the page, on the one line that says what is actually due.
                    Dim measures 5.23:1 and clears the 4.5:1 body floor. */}
                <div className="label-data text-[10px] text-[var(--color-text-dim)] pl-[20px] truncate">
                  {items.map((it) => humanizeNodeId(it.id)).join(' · ')}
                </div>
              </Row>
            )
          })}
        </div>
      )}

      {/* The intake. The RULER is the control now — a continuous budget you
          cut against the queue's real costs — and the pickers beside it are
          shortcuts and modifiers, not the primary means. Time and style are
          session LOGISTICS (the dialogue grammar's own carve-out: menus for
          navigation, never for knowledge), so pickers remain the honest form.
          Style resets to Standard every mount (sittingPrefs.ts) — checkpoint
          is elected per sitting, never a sticky default. Still no `.probe`
          dereference anywhere in this file: the ruler is handed a projected
          shape that cannot carry one. */}
      {dueItems.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-[var(--color-hairline)] pt-3">
          <SittingRuler
            items={rulerItems}
            pace={pace ?? null}
            budgetMins={prefs.mins}
            onBudgetChange={(mins) => onPrefsChange({ ...prefs, mins })}
          />

          <div className="flex items-center gap-3 flex-wrap">
            {/* "I have to leave at 21:40" is how the constraint actually
                arrives; a duration is arithmetic the learner should not have to
                do. It used to snap to a hardcoded [5, 10, 25] — stale since the
                budgets became queue-derived, so an out-time could select a
                number the plate never offered. It now lands on a real item
                edge, the same places the ruler can stop. */}
            <input
              // `key` on the budget, so the field REMOUNTS — and therefore
              // clears — whenever the budget changes by any other means. It is
              // uncontrolled by nature (a clock time is not derivable from a
              // duration without re-deriving it every second), and left alone
              // it went on displaying "21:40" after a ruler drag had moved the
              // finish somewhere else entirely. An empty field asks a
              // question; a stale one makes a false claim.
              key={prefs.mins}
              type="time"
              aria-label="Out by — set when you have to stop"
              title="Set when you have to stop — the budget lands on the last item that fits"
              className="focus-ring panel px-2 py-1 text-xs text-[var(--color-text-primary)]"
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number)
                if (!Number.isFinite(h) || !Number.isFinite(m)) return
                const now = new Date()
                const end = new Date(now)
                end.setHours(h, m, 0, 0)
                if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1)
                const mins = (end.getTime() - now.getTime()) / 60000
                const fraction = ruler.totalSeconds > 0 ? (mins * 60) / ruler.totalSeconds : 0
                onPrefsChange({ ...prefs, mins: snapToItem(ruler, fraction) })
              }}
            />
            {/* Jump-to presets — a quarter, a half, the lot. Highlighted only
                on an exact match, because the ruler can sit between them. */}
            {/* Both controls reached a screen reader as bare unlabelled
                groups — the component supports `ariaLabel` and neither call
                site passed one, which is the exact defect its own doc comment
                warns about. Every BUTTON had a name; the group did not, so you
                heard "5 min, 15 min, 30 min" with no statement of what it
                governed. */}
            <SegmentedControl<`${SittingMins}`>
              ariaLabel="Jump the budget to a preset length"
              options={minsOptions}
              value={`${prefs.mins}`}
              onChange={(v) => onPrefsChange({ ...prefs, mins: Number(v) as SittingMins })}
            />
            <SegmentedControl<SittingStyle>
              ariaLabel="Sitting style — free recall or checkpoints"
              options={STYLE_OPTIONS}
              value={prefs.style}
              onChange={(v) => onPrefsChange({ ...prefs, style: v })}
            />
          </div>

        </div>
      )}

      {/* The notes register — a stacked COLUMN. These were seven siblings
          inside one `flex gap-3 items-center` row together with the buttons,
          so a caption, a warning and a CTA wrapped against each other at
          whatever width the window happened to be. Facts stack; the action
          gets its own row below. */}
      <div className="flex flex-col gap-1">
        {dueItems.length === 0 && (
          <div className="fig-caption">
            Nothing is due — the schedule is ahead of you. Reviewing early would teach the engine that
            recall was easier than it was, so the honest move is to leave it and learn something new.
          </div>
        )}
        {accuracy && <div className="fig-caption">{accuracy}</div>}
        {/* The first-run case was the one that said nothing. `paceBasis` is
            null when `pace` itself is null, so a learner with NO history saw
            equal-width segments under a caption reading "each item as wide as
            it costs you" — the app asserting a measurement it had not taken,
            which PRODUCT.md forbids by name. That case now speaks first. */}
        {!pace && (
          <div className="fig-caption">
            no pace history yet — every item is drawn at the same assumed minute, and the widths will separate
            once you have sat a few
          </div>
        )}
        {pace && paceBasis?.basis === 'overall' && (
          <div className="fig-caption">widths come from your overall pace — this topic has little history yet</div>
        )}
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
