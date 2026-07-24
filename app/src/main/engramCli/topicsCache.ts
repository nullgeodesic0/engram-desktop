import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { engramRead } from './readOnly'
import type { TopicSummary } from '../../shared/types'

// Matches readTopicGraph's existing convention (see readOnly.ts) — not
// ENGRAM_HOME-aware, same as the rest of this module today.
const GRAPHS_DIR = join(homedir(), '.claude', 'learning', 'graphs')

interface CacheEntry {
  signature: string
  topics: TopicSummary[]
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
export async function getTopicsCached(): Promise<TopicSummary[]> {
  const signature = await computeSignature()
  if (cache && cache.signature === signature) return cache.topics
  const topics = await engramRead<TopicSummary[]>('topics')
  cache = { signature, topics }
  return topics
}

export function invalidateTopicsCache(): void {
  cache = null
}
