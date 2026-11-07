import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { engramRead } from './readOnly'
import { getDisplayTitles, getTopicFolders } from '../session/topicSettings'
import type { TopicListEntry } from '../../shared/types'

// Matches readTopicGraph's existing convention (see readOnly.ts) — not
// ENGRAM_HOME-aware, same as the rest of this module today.
const GRAPHS_DIR = join(homedir(), '.claude', 'learning', 'graphs')

interface CacheEntry {
  signature: string
  topics: TopicListEntry[]
}

let cache: CacheEntry | null = null

/** `<filename>:<mtimeMs>` per graph file, sorted — cheap to compute, changes iff any topic file was added/removed/modified. */
async function computeSignature(): Promise<string> {
  let names: string[]
  try {
    names = (await readdir(GRAPHS_DIR)).filter((n) => n.endsWith('.json') && !n.endsWith('.bak'))
  } catch {
    return '' // graphs/ doesn't exist yet (no topics) — empty signature, stable
  }
  const stats = await Promise.all(
    names.map(async (n) => {
      const s = await stat(join(GRAPHS_DIR, n))
      return `${n}:${s.mtimeMs}`
    }),
  )
  return stats.sort().join('|')
}

/**
 * Cached wrapper around `engram.py topics` — invalidated by comparing graph
 * file mtimes rather than a TTL, so a topic-list refresh after editing/adding
 * a topic is always fresh, but repeated calls with nothing changed skip the
 * python subprocess entirely.
 */
export async function getTopicsCached(): Promise<TopicListEntry[]> {
  const signature = await computeSignature()
  let topics: TopicListEntry[]
  if (cache && cache.signature === signature) {
    topics = cache.topics
  } else {
    topics = await withRetirementDetail(await engramRead<TopicListEntry[]>('topics'))
    cache = { signature, topics }
  }
  // Display-rename overlay — applied per CALL on top of the cache, never
  // baked into it: a rename changes topic-settings.json but no graph mtime,
  // so an overlay stored in the cache would go stale invisibly. Purely
  // presentational; the engine's own title survives as `engineTitle`.
  // Folder filing rides the same per-call overlay, for the same staleness
  // reason — and applying it HERE is what makes folders app-wide by
  // construction: every surface that lists topics goes through this one
  // function, so none of them needs its own settings read.
  const [renames, folders] = await Promise.all([getDisplayTitles(), getTopicFolders()])
  if (Object.keys(renames).length === 0 && Object.keys(folders).length === 0) return topics
  return topics.map((t) => {
    const renamed = renames[t.topic] ? { ...t, engineTitle: t.title, title: renames[t.topic] } : t
    return folders[t.topic] ? { ...renamed, folder: folders[t.topic] } : renamed
  })
}

/** Mirrors engram.py's `is_retired` exactly: a `retired` block that has not
 * been restored. Shape-defensive the same way (a hand-edited string is not a
 * retirement). */
function isRetiredNode(node: unknown): node is { retired: { ts?: unknown } } {
  if (!node || typeof node !== 'object') return false
  const r = (node as { retired?: unknown }).retired
  return !!r && typeof r === 'object' && (r as { restored?: unknown }).restored == null
}

/**
 * For every topic with at least one retired node, reads its graph once to add
 * the two facts `engram.py topics` does not emit: the live (non-retired) state
 * counts and, for a fully archived topic, the date it was archived. Runs only
 * on a cache miss (graph mtimes changed), and only for topics that have
 * retired anything, so the common case reads no extra files at all. A graph
 * that cannot be read leaves its entry exactly as the engine sent it.
 */
async function withRetirementDetail(topics: TopicListEntry[]): Promise<TopicListEntry[]> {
  return Promise.all(
    topics.map(async (t) => {
      if (!t.retired) return t
      try {
        const g = JSON.parse(await readFile(join(GRAPHS_DIR, `${t.topic}.json`), 'utf-8')) as {
          nodes?: Record<string, { state?: unknown; retired?: unknown }>
        }
        const live = { review: 0, learning: 0, new: 0 }
        let latest: string | null = null
        let liveCount = 0
        for (const node of Object.values(g.nodes ?? {})) {
          if (isRetiredNode(node)) {
            const ts = node.retired.ts
            if (typeof ts === 'string' && (latest === null || ts > latest)) latest = ts.slice(0, 10)
            continue
          }
          liveCount++
          const st = node && typeof node.state === 'string' ? node.state : 'new'
          if (st === 'review' || st === 'learning' || st === 'new') live[st]++
        }
        return { ...t, liveStates: live, archivedAt: liveCount === 0 ? latest : null }
      } catch {
        return t
      }
    }),
  )
}

export function invalidateTopicsCache(): void {
  cache = null
}
