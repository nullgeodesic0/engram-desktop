import type { TopicListEntry } from '../../../shared/types'
import { isArchivedTopic } from './archiveRules'
import { sortTopics, type TopicSortKey } from './topicSort'
import { groupTopicsByFolder } from './topicFolders'
import { topicBucket } from './topicShelf'
import type { TopicGroupKey } from './topicSortPrefs'

/**
 * The Topic Map's topic index: the rail beside the plate that picks which
 * map is drawn. It reads the library exactly the way Learn's does (the same
 * Group and Sort picks, the same folder order, the same find-a-topic match),
 * so a topic sits in the same place on both screens.
 *
 * Archived topics (archive.ts) are never mixed into the working sections.
 * They gather in one section of their own at the bottom of the rail, which
 * the rail keeps collapsed until it is asked for: the map of a finished
 * topic is history, still one click away, but not part of the day's work.
 */

export interface MapIndexSection {
  key: string
  heading: string
  /** The catch-all sections (Unfiled) draw in quieter ink. */
  quiet: boolean
  topics: TopicListEntry[]
}

export interface MapIndex {
  sections: MapIndexSection[]
  /** Archived topics that pass the find-a-topic filter, in the shared sort. */
  archived: TopicListEntry[]
  /** Every archived topic, filter or not — the section's count. */
  archivedTotal: number
  /** Live topics that pass the filter. */
  liveShown: number
}

function partition(topics: TopicListEntry[]) {
  const live: TopicListEntry[] = []
  const archived: TopicListEntry[] = []
  for (const t of topics) (isArchivedTopic(t) ? archived : live).push(t)
  return { live, archived }
}

/** Same fields Learn's library searches: title, goal, folder, id. */
export function matchesTopicQuery(t: TopicListEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [t.title, t.goal, t.folder ?? '', t.topic].some((s) => s?.toLowerCase().includes(q))
}

const STATE_SECTIONS: { key: 'active' | 'consolidated' | 'notStarted'; heading: string }[] = [
  { key: 'active', heading: 'Continue learning' },
  { key: 'consolidated', heading: 'Consolidated' },
  { key: 'notStarted', heading: 'Not started' },
]

export function buildMapIndex(
  topics: TopicListEntry[],
  opts: { group: TopicGroupKey; sort: TopicSortKey; folderOrder: string[]; query: string },
): MapIndex {
  const { live, archived } = partition(topics)
  const shown = live.filter((t) => matchesTopicQuery(t, opts.query))
  const sections: MapIndexSection[] =
    opts.group === 'folder'
      ? groupTopicsByFolder(shown, opts.sort, { order: opts.folderOrder }).map((g) => ({
          key: `f:${g.name}`,
          heading: g.name,
          quiet: g.unfiled,
          topics: g.topics,
        }))
      : STATE_SECTIONS.map((s) => ({
          key: `s:${s.key}`,
          heading: s.heading,
          quiet: false,
          topics: sortTopics(
            shown.filter((t) => topicBucket(t) === s.key),
            opts.sort,
          ),
        })).filter((s) => s.topics.length > 0)
  return {
    sections,
    archived: sortTopics(
      archived.filter((t) => matchesTopicQuery(t, opts.query)),
      opts.sort,
    ),
    archivedTotal: archived.length,
    liveShown: shown.length,
  }
}

/** The map to open on when nothing asked for a particular one: the first
 * topic as the rail draws it. Never an archived topic while a live one
 * exists (the old strip could open on a finished topic under some sorts);
 * the first archived one only when everything is archived. */
export function firstDrawnTopic(
  topics: TopicListEntry[],
  opts: { group: TopicGroupKey; sort: TopicSortKey; folderOrder: string[] },
): string | null {
  const index = buildMapIndex(topics, { ...opts, query: '' })
  for (const s of index.sections) if (s.topics.length > 0) return s.topics[0].topic
  return index.archived[0]?.topic ?? null
}
