import type { TopicListEntry } from '../../../shared/types'

/**
 * One topic ordering, shared by every surface that lists topics — Learn's
 * shelf (inside each of its three buckets) and the Topic Map's tab strip.
 * Same reasoning as topicShelf.ts's `topicBucket`: two hand-rolled orderings
 * would quietly drift apart, and the learner would learn two different
 * mental models for the same list.
 *
 * Two rules hold across EVERY key, so the list never surprises:
 *
 *  - **Archived topics sink to the bottom.** A closed-out topic (Topic
 *    Settings' archive; every node retired) is browsable history, not work.
 *    Letting it sort into the middle of an alphabetical list puts a dead
 *    topic between two live ones with nothing but a chip to say so.
 *  - **Ties break on title, always.** Every key below has ties by
 *    construction (many topics share `due: 0`), and an unstable tiebreak
 *    would let rows swap places between renders for no reason the learner
 *    could see. One deterministic fallback means a given library always
 *    draws in exactly one order.
 *
 * `[...topics].sort()` rather than `toSorted()` — same immutability (the
 * caller's array is never touched), but `toSorted` is ES2023 and both
 * tsconfigs target ES2022.
 */

export type TopicSortKey = 'due' | 'title' | 'progress' | 'size'

export const DEFAULT_TOPIC_SORT: TopicSortKey = 'due'

/** The picker's own vocabulary — label short enough for a segmented control,
 * description carried as the control's tooltip. */
export const TOPIC_SORT_OPTIONS: { value: TopicSortKey; label: string; description: string }[] = [
  { value: 'due', label: 'Due', description: 'most reviews waiting first — the library as a work queue' },
  { value: 'title', label: 'A–Z', description: 'alphabetical by title' },
  { value: 'progress', label: 'Progress', description: 'furthest consolidated first' },
  { value: 'size', label: 'Size', description: 'largest maps first' },
]

/** Every node retired — the archive state topicChips already renders as its
 * own single chip. `retired` is sparse (older engines omit it), so an absent
 * count reads as "not archived", never as zero-of-zero. */
export function isArchivedTopic(t: TopicListEntry): boolean {
  return t.retired != null && t.nodes > 0 && t.retired >= t.nodes
}

/** Share of the map that has reached `review` — the engine's own definition
 * of a consolidated node. A topic with no nodes at all reads as 0 rather
 * than NaN (which would sort unpredictably). */
export function consolidatedFraction(t: TopicListEntry): number {
  return t.nodes > 0 ? t.states.review / t.nodes : 0
}

function compareByKey(a: TopicListEntry, b: TopicListEntry, key: TopicSortKey): number {
  switch (key) {
    case 'due':
      return b.due - a.due
    case 'progress':
      return consolidatedFraction(b) - consolidatedFraction(a)
    case 'size':
      return b.nodes - a.nodes
    case 'title':
      return 0 // the shared tiebreak below IS this key's comparison
  }
}

/** Note on `title`: the Topic Map's tabs display each topic's SLUG, not its
 * title, so an A–Z map strip is alphabetical by a key one step removed from
 * what's drawn. In practice slugs are derived from titles and the two agree;
 * where a Topic Settings display-title override has moved them apart, the
 * tab's tooltip (and its aria-label) still carries the title being sorted
 * on. Sorting the map by slug instead would split this into two orderings
 * for the same list — exactly what this module exists to prevent. */
export function sortTopics(topics: TopicListEntry[], key: TopicSortKey): TopicListEntry[] {
  return [...topics].sort((a, b) => {
    const aArchived = isArchivedTopic(a)
    if (aArchived !== isArchivedTopic(b)) return aArchived ? 1 : -1
    const primary = compareByKey(a, b, key)
    if (primary !== 0) return primary
    return a.title.localeCompare(b.title)
  })
}
