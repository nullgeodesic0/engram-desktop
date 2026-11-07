import { useEffect, useState } from 'react'
import type { DayActivity, Misconception, RawReceipt, TopicListEntry } from '../../../shared/types'
import { isArchivedTopic } from './archiveRules'

export { isArchivedTopic, liveNodeCounts } from './archiveRules'

/**
 * THE ARCHIVE RULES — one module, so every screen counts an archived topic
 * the same way. An archived topic (Topic Settings' archive: every node
 * retired through the engine's own reversible `retire --topic`) is finished
 * or parked work:
 *
 *  1. Out of the workload. The engine already drops retired nodes from
 *     `due`, `topics.due` and loop closure; the app's own forecast walk
 *     (dueBuckets.ts) skips them too.
 *  2. Out of live stats. GPA, Home's numbers, and Coach's recall,
 *     calibration, momentum and open-misconception counts read only
 *     non-archived topics — unless the learner flips the one shared
 *     "Count archived topics" switch below.
 *  3. A frozen final grade, computed as of `archivedAt`
 *     (computeHistoricalTopicGrade), shown in its own section on Grades.
 *  4. Its open misconceptions are set aside: they stop counting against the
 *     learner (they can never be re-tested while nothing comes due) and
 *     return on restore — a view rule, nothing in the engine changes.
 *  5. History kept. Streak, the activity calendar, sittings, receipts and
 *     the map are never filtered.
 *
 * A PARTLY retired topic is not archived; its retired nodes simply stop
 * counting against coverage (see `liveNodeCounts`).
 */

export function archivedTopicIds(topics: TopicListEntry[]): Set<string> {
  return new Set(topics.filter(isArchivedTopic).map((t) => t.topic))
}

export function partitionArchived(topics: TopicListEntry[]): { live: TopicListEntry[]; archived: TopicListEntry[] } {
  const live: TopicListEntry[] = []
  const archived: TopicListEntry[] = []
  for (const t of topics) (isArchivedTopic(t) ? archived : live).push(t)
  return { live, archived }
}

// ----------------------------------------------------------------- the switch

const KEY = 'engram-count-archived'
const EVENT = 'engram-count-archived-change'

/** Whether archived topics count in live stats. Off by default. Renderer
 * localStorage with try/catch on every touch, like gradePrefs: this changes
 * a reading of the receipts, never learning state. */
export function countArchived(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setCountArchived(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // best-effort
  }
  window.dispatchEvent(new Event(EVENT))
}

/** The switch as React state, kept in step across every mounted view —
 * Coach and Learn are keep-mounted, so a flip on Grades must reach them
 * without a remount. */
export function useCountArchived(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(countArchived)
  useEffect(() => {
    const sync = () => setOn(countArchived())
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  return [on, setCountArchived]
}

// -------------------------------------------------------------- stat filters

/** The topic ids live stats must leave out right now: every archived topic,
 * or none when the switch is on. */
export function excludedFromStats(topics: TopicListEntry[] | null, includeArchived: boolean): Set<string> {
  if (!topics || includeArchived) return new Set()
  return archivedTopicIds(topics)
}

export function withoutTopics<T extends { topic: string }>(list: T[], exclude: Set<string>): T[] {
  return exclude.size === 0 ? list : list.filter((x) => !exclude.has(x.topic))
}

export function receiptsWithout(receipts: RawReceipt[], exclude: Set<string>): RawReceipt[] {
  return withoutTopics(receipts, exclude)
}

/** Day buckets with excluded topics' items removed and counts recomputed.
 * For the recall/calibration family only — the activity calendar and streak
 * are history and always read the unfiltered days. */
export function daysWithout(days: DayActivity[], exclude: Set<string>): DayActivity[] {
  if (exclude.size === 0) return days
  return days.map((d) => {
    const items = d.items.filter((it) => !exclude.has(it.topic))
    return items.length === d.items.length ? d : { date: d.date, count: items.length, items }
  })
}

/** Open misconceptions that still count: an archived topic's are set aside
 * (rule 4) unless the switch is on. */
export function countedOpenMisconceptions(
  misconceptions: Misconception[],
  topics: TopicListEntry[] | null,
  includeArchived: boolean,
): Misconception[] {
  const exclude = excludedFromStats(topics, includeArchived)
  return misconceptions.filter((m) => m.status === 'open' && !exclude.has(m.topic))
}

/** "Oct 21" — the short local date the archive surfaces print. */
export function formatArchivedDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
