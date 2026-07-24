import type { ArtifactEntry, ReceiptsHistory, TopicGraph, TopicSummary } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'

export type SearchEntryKind = 'view' | 'topic' | 'node' | 'receipt' | 'artifact'

export interface SearchEntry {
  kind: SearchEntryKind
  title: string
  subtitle?: string
  topic?: string
  node?: string
  artifactPath?: string
}

/** Only the four IPC calls the index needs, injected so callers (and tests)
 * don't have to know about `window.engram` — matches the shape of `window.engram`
 * closely enough that its methods can be passed straight through. */
export interface SearchIndexDeps {
  topics: () => Promise<TopicSummary[]>
  topicGraph: (topic: string) => Promise<unknown>
  receiptsHistory: () => Promise<ReceiptsHistory>
  artifactList: () => Promise<ArtifactEntry[]>
}

// Module-level cache: the palette can reopen many times in a session without
// re-walking every topic graph each time. `invalidateSearchIndex` is the
// escape hatch for whoever refreshes topics (see App.tsx).
let cached: Promise<SearchEntry[]> | null = null

export function invalidateSearchIndex(): void {
  cached = null
}

export function buildSearchIndex(deps: SearchIndexDeps): Promise<SearchEntry[]> {
  if (!cached) {
    cached = build(deps).catch((err) => {
      // Don't poison the cache with a rejected promise — next call retries.
      cached = null
      throw err
    })
  }
  return cached
}

async function build(deps: SearchIndexDeps): Promise<SearchEntry[]> {
  const entries: SearchEntry[] = []
  const topics = await deps.topics()

  for (const t of topics) {
    entries.push({ kind: 'topic', title: t.title, subtitle: t.goal, topic: t.topic })
  }

  const graphs = await Promise.all(
    topics.map((t) =>
      deps
        .topicGraph(t.topic)
        .then((g) => g as TopicGraph)
        .catch(() => null),
    ),
  )
  for (const g of graphs) {
    if (!g) continue
    for (const id of g.order) {
      const node = g.nodes[id]
      if (!node) continue
      entries.push({ kind: 'node', title: humanizeNodeId(id), subtitle: g.title, topic: g.topic, node: id })
    }
  }

  const [receipts, artifacts] = await Promise.all([
    deps.receiptsHistory().catch((): ReceiptsHistory => ({ days: [], weeks: [] })),
    deps.artifactList().catch((): ArtifactEntry[] => []),
  ])

  // Most-recent-first, deduped to one entry per node — only the latest grade
  // matters for jumping back to a node from the palette. `days` is oldest-first.
  const seenReceipts = new Set<string>()
  for (let i = receipts.days.length - 1; i >= 0; i--) {
    const day = receipts.days[i]
    for (const item of day.items) {
      const key = `${item.topic}:${item.node}`
      if (seenReceipts.has(key)) continue
      seenReceipts.add(key)
      entries.push({
        kind: 'receipt',
        title: humanizeNodeId(item.node),
        subtitle: item.grade ? `${item.grade} · ${day.date}` : day.date,
        topic: item.topic,
        node: item.node,
      })
    }
  }

  for (const a of artifacts) {
    if (!a.exists) continue
    entries.push({
      kind: 'artifact',
      title: humanizeNodeId(a.node),
      subtitle: a.topic,
      topic: a.topic,
      node: a.node,
      artifactPath: a.artifact,
    })
  }

  return entries
}

const MAX_PER_KIND = 8

/** Lower is better; -1 means "no match". Exact prefix beats a word-boundary
 * substring beats a mid-word substring beats a subsequence fuzzy match. */
function scoreField(field: string, q: string): number {
  const text = field.toLowerCase()
  if (text.startsWith(q)) return 0
  const idx = text.indexOf(q)
  if (idx >= 0) {
    const before = text[idx - 1]
    return /[a-z0-9]/.test(before) ? 2 : 1
  }
  return isSubsequence(q, text) ? 3 : -1
}

function isSubsequence(q: string, text: string): boolean {
  let qi = 0
  for (let ti = 0; ti < text.length && qi < q.length; ti++) {
    if (text[ti] === q[qi]) qi++
  }
  return qi === q.length
}

function scoreEntry(entry: SearchEntry, q: string): number {
  const fields = [entry.title, entry.node, entry.subtitle].filter((v): v is string => Boolean(v))
  let best = -1
  for (const field of fields) {
    const s = scoreField(field, q)
    if (s === -1) continue
    if (best === -1 || s < best) best = s
  }
  return best
}

export function searchEntries(index: SearchEntry[], query: string): SearchEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const scored = index
    .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
    .filter((s) => s.score !== -1)
    .sort((a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title))

  const counts = new Map<SearchEntryKind, number>()
  const capped: SearchEntry[] = []
  for (const { entry } of scored) {
    const n = counts.get(entry.kind) ?? 0
    if (n >= MAX_PER_KIND) continue
    counts.set(entry.kind, n + 1)
    capped.push(entry)
  }
  return capped
}
