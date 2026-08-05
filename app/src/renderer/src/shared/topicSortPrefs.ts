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
