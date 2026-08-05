/** The topic-sort pick, persisted the way sittingPrefs/calibrationStore
 * persist theirs (renderer localStorage, try/catch on every touch, garbage
 * degrades to the default; no IPC, no pinned writer, losing it costs one
 * re-pick).
 *
 * Unlike the sitting's checkpoint style — which deliberately never persists,
 * because a per-sitting election is half of that feature's bargain — an
 * ordering preference SHOULD stick: it's a view preference about a list, not
 * a claim about evidence, and re-picking it on every launch would be pure
 * friction. */

import { DEFAULT_TOPIC_SORT, type TopicSortKey } from './topicSort'

const KEY = 'engram-topic-sort'
const GROUP_KEY = 'engram-topic-group'

const VALID: readonly TopicSortKey[] = ['due', 'title', 'progress', 'size']

export function loadTopicSort(): TopicSortKey {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw && (VALID as readonly string[]).includes(raw)) return raw as TopicSortKey
  } catch {
    // fall through to the default
  }
  return DEFAULT_TOPIC_SORT
}

export function saveTopicSort(key: TopicSortKey): void {
  try {
    localStorage.setItem(KEY, key)
  } catch {
    // best-effort — a failed save costs one re-pick, never a topic
  }
}

/** How topic lists are partitioned before the sort runs inside each group.
 * `state` is the existing three-bucket shelf grouping (and, on the map, a
 * flat strip); `folder` is the learner's own filing (topicFolders.ts). One
 * pick shared by every surface, so a library filed into folders reads as
 * folders wherever it's drawn. */
export type TopicGroupKey = 'state' | 'folder'

export const DEFAULT_TOPIC_GROUP: TopicGroupKey = 'state'

export function loadTopicGroup(): TopicGroupKey {
  try {
    const raw = localStorage.getItem(GROUP_KEY)
    if (raw === 'state' || raw === 'folder') return raw
  } catch {
    // fall through to the default
  }
  return DEFAULT_TOPIC_GROUP
}

export function saveTopicGroup(key: TopicGroupKey): void {
  try {
    localStorage.setItem(GROUP_KEY, key)
  } catch {
    // best-effort
  }
}
