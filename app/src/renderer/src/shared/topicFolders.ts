import type { TopicListEntry } from '../../../shared/types'
import { sortTopics, type TopicSortKey } from './topicSort'

/**
 * Folders are a VIEW over the topic list, not a location. Nothing moves on
 * disk: `TopicSettings.folder` is an app-local label overlaid onto every
 * `topics()` result by getTopicsCached, so this module only ever partitions
 * a list that already carries its filing.
 *
 * The folder SET is implicit — exactly the distinct names in use. That means
 * there is no registry to keep in sync with reality, no orphan folder to
 * garbage-collect, and emptying a folder makes it stop existing on its own.
 * The cost is that renaming a folder means re-filing its topics; at the
 * scale this app operates on (a personal atlas of a handful of topics) that
 * is the right trade against a whole second store to keep consistent.
 */

/** The bucket unfiled topics collect in. Not a real folder name — kept out
 * of `folderNames` so it can never be picked from a datalist, and always
 * rendered last. */
export const UNFILED = 'Unfiled'

/** The group-by picker's vocabulary, shared by Learn's shelf and the map's
 * tab strip so both offer the same two ways to read one library. */
export const TOPIC_GROUP_OPTIONS: { value: 'state' | 'folder'; label: string; description: string }[] = [
  { value: 'state', label: 'State', description: 'continuing · consolidated · not started' },
  { value: 'folder', label: 'Folder', description: 'your own filing — set a topic’s folder in its settings' },
]

/** Normalizes what a text input hands back: trimmed, and empty becomes null
 * (unfiled) rather than a folder literally named "". Collapses internal
 * whitespace so "Physics  Quals" and "Physics Quals" are the same folder. */
export function normalizeFolderName(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 ? trimmed : null
}

/** Every folder currently in use, alphabetical — the datalist behind the
 * settings modal's folder input, so filing a second topic into an existing
 * folder is a pick rather than a retype (which is how folders drift into
 * near-duplicates). Case-insensitive de-duplication keeps "Physics" and
 * "physics" from both appearing; first spelling seen wins. */
export function folderNames(topics: TopicListEntry[]): string[] {
  const seen = new Map<string, string>()
  for (const t of topics) {
    const name = t.folder?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (!seen.has(key)) seen.set(key, name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

export interface FolderGroup {
  /** Display name; `UNFILED` for the catch-all. */
  name: string
  /** True for the catch-all, so callers can style it as the quiet one. */
  unfiled: boolean
  topics: TopicListEntry[]
}

/**
 * Partitions topics into folder groups, each internally ordered by the
 * shared sort. Folders come alphabetically and `Unfiled` always comes last —
 * a named shelf outranks the pile of things not yet put away.
 *
 * Groups with no topics are never emitted, so a folder that just lost its
 * last topic simply disappears rather than lingering as an empty heading.
 */
export function groupTopicsByFolder(topics: TopicListEntry[], sortKey: TopicSortKey): FolderGroup[] {
  const byFolder = new Map<string, TopicListEntry[]>()
  const unfiled: TopicListEntry[] = []
  for (const t of topics) {
    const name = t.folder?.trim()
    if (!name) {
      unfiled.push(t)
      continue
    }
    const list = byFolder.get(name) ?? []
    list.push(t)
    byFolder.set(name, list)
  }
  const groups: FolderGroup[] = [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, unfiled: false, topics: sortTopics(list, sortKey) }))
  if (unfiled.length > 0) {
    groups.push({ name: UNFILED, unfiled: true, topics: sortTopics(unfiled, sortKey) })
  }
  return groups
}
