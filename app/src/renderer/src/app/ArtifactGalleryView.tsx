import { useEffect, useMemo, useState } from 'react'
import type { ArtifactEntry, NodeProvenance, ProvenanceEvent, TopicListEntry } from '../../../shared/types'
import { SkeletonCard } from '../components/Skeleton'
import { ArtifactTile } from '../components/ArtifactTile'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { friendlyErrorText } from '../shared/friendlyError'
import { ExplorableViewer } from '../components/ExplorableViewer'
import { SessionHistoryDrawer } from '../components/SessionHistoryDrawer'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { scoreEntry, type SearchEntry } from '../shared/searchIndex'

interface ArtifactGalleryViewProps {
  /** Routes the empty state's one action to Learn — explorables are only ever
   * built during a live session, so that's the one thing to do about "none yet". */
  onGoLearn?: () => void
  /** "Jump to node" inside the viewer routes through here — the gallery never
   * navigates itself, App.tsx's goToNode owns switching to the Topic Map and
   * deep-linking the node modal open. */
  onOpenNode?: (topicId: string, nodeId: string) => void
}

/** True if `a` matches the (already-lowercased) query — reuses
 * searchIndex.ts's exported `scoreEntry` (the same matcher the command
 * palette scores nodes/topics/receipts/artifacts with) rather than a second
 * matching function. Only the match/no-match boundary is used here, not the
 * relevance ordering `scoreEntry` also returns: this page's display order is
 * governed by the recency sort below, in both the searched and unsearched
 * case, so a filtered result never reorders relative to an unfiltered one. */
function matchesQuery(a: ArtifactEntry, q: string): boolean {
  const entry: SearchEntry = {
    kind: 'artifact',
    title: humanizeNodeId(a.node),
    subtitle: a.topic,
    topic: a.topic,
    node: a.node,
    artifactPath: a.artifact,
  }
  return scoreEntry(entry, q) !== -1
}

export function ArtifactGalleryView({ onGoLearn, onOpenNode }: ArtifactGalleryViewProps = {}) {
  const [artifacts, setArtifacts] = useState<ArtifactEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<ArtifactEntry | null>(null)
  const [query, setQuery] = useState('')
  const [topicsList, setTopicsList] = useState<TopicListEntry[]>([])
  // topic -> node -> provenance. Fetched per distinct topic present in the
  // artifact list (nodeProvenance is topic-scoped — see sessionScan.ts) once
  // artifacts arrive, reusing the same IPC TopicDrilldownView already calls
  // for its own Provenance section rather than a second scan.
  const [provenanceByTopic, setProvenanceByTopic] = useState<Record<string, Record<string, NodeProvenance>>>({})
  const [historyDrawer, setHistoryDrawer] = useState<{ topic: string; sessionId: string; anchorIndex: number } | null>(null)

  useEffect(() => {
    window.engram
      .artifactList()
      .then(setArtifacts)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    window.engram.topics().then(setTopicsList).catch(() => setTopicsList([]))
  }, [])

  useEffect(() => {
    if (!artifacts || artifacts.length === 0) return
    let cancelled = false
    const topics = Array.from(new Set(artifacts.map((a) => a.topic)))
    Promise.all(
      topics.map((t) =>
        window.engram
          .nodeProvenance(t)
          .then((p): [string, Record<string, NodeProvenance>] => [t, p])
          .catch((): [string, Record<string, NodeProvenance>] => [t, {}]),
      ),
    ).then((pairs) => {
      if (!cancelled) setProvenanceByTopic(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [artifacts])

  function topicTitle(topic: string): string {
    return topicsList.find((t) => t.topic === topic)?.title ?? topic
  }

  function openSitting(a: ArtifactEntry, ev: ProvenanceEvent): void {
    setHistoryDrawer({ topic: a.topic, sessionId: ev.sessionId, anchorIndex: ev.anchor })
  }

  // Filter (search), then group by topic, then sort — recency within a
  // group (newest mtime first; artifacts with no mtime sort last, not
  // first, so a broken or unstattable file never reads as "most recent"),
  // and groups themselves ordered by their own most-recent artifact so the
  // topic with the freshest activity surfaces first.
  const groups = useMemo(() => {
    if (!artifacts) return []
    const q = query.trim().toLowerCase()
    const filtered = q ? artifacts.filter((a) => matchesQuery(a, q)) : artifacts

    const byTopic = new Map<string, ArtifactEntry[]>()
    for (const a of filtered) {
      const arr = byTopic.get(a.topic) ?? []
      arr.push(a)
      byTopic.set(a.topic, arr)
    }

    return Array.from(byTopic.entries())
      .map(([topic, items]) => ({
        topic,
        items: [...items].sort((x, y) => (y.mtimeMs ?? -Infinity) - (x.mtimeMs ?? -Infinity)),
      }))
      .sort((g1, g2) => (g2.items[0]?.mtimeMs ?? -Infinity) - (g1.items[0]?.mtimeMs ?? -Infinity))
  }, [artifacts, query])

  const totalCount = artifacts?.length ?? 0
  const visibleCount = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="p-8 flex flex-col gap-6 h-full overflow-y-auto">
      <div className="flex flex-col gap-3">
        <PageHeader
          title="Artifacts"
          subtitle="Interactive explorables the artifact-smith has built for threshold concepts."
        />
        {totalCount > 0 && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artifacts…"
            aria-label="Search artifacts"
            className="w-full max-w-sm px-3 py-2 text-sm bg-transparent border border-[var(--color-hairline)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] focus-ring"
          />
        )}
      </div>

      {error && (() => {
        const fe = friendlyErrorText(error)
        return (
          <div className="panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)]">
            <div>{fe.headline}</div>
            {fe.detail && (
              <details className="mt-1 text-xs text-[var(--color-text-faint)]">
                <summary className="cursor-pointer">raw error</summary>
                <div className="mt-1">{fe.detail}</div>
              </details>
            )}
          </div>
        )
      })()}

      {artifacts === null && !error && (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} lines={3} />
          ))}
        </div>
      )}

      {artifacts?.length === 0 && !error && (
        <div className="flex flex-col items-start gap-2">
          <div className="fig-caption">Fig. — no explorables built yet; threshold concepts earn them.</div>
          <div className="text-sm text-[var(--color-text-dim)]">
            No explorables registered yet — they’re built during /learn sessions on threshold nodes.
          </div>
          {onGoLearn && <Button variant="ghost" onClick={onGoLearn}>Continue learning</Button>}
        </div>
      )}

      {totalCount > 0 && visibleCount === 0 && (
        <div className="flex flex-col items-start gap-2">
          <div className="text-sm text-[var(--color-text-dim)]">No artifacts match “{query}”.</div>
          <Button variant="ghost" onClick={() => setQuery('')}>Clear search</Button>
        </div>
      )}

      {groups.map(({ topic, items }) => (
        <section key={topic} className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="font-[var(--font-serif)] text-lg text-[var(--color-text-primary)]">{topicTitle(topic)}</h2>
            <span className="label-data text-[10px] text-[var(--color-text-faint)]">{topic}</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {items.map((a) => (
              <ArtifactTile
                key={`${a.topic}:${a.node}`}
                artifact={a}
                provenance={provenanceByTopic[a.topic]?.[a.node]}
                showTopic={false}
                onOpen={setViewing}
                onOpenSitting={openSitting}
              />
            ))}
          </div>
        </section>
      ))}

      {viewing && (
        <ExplorableViewer
          path={viewing.artifact}
          nodeId={viewing.node}
          onClose={() => setViewing(null)}
          onJumpToNode={onOpenNode ? (nodeId) => onOpenNode(viewing.topic, nodeId) : undefined}
        />
      )}

      <SessionHistoryDrawer
        historyKey={historyDrawer?.topic ?? ''}
        title={historyDrawer ? topicTitle(historyDrawer.topic) : undefined}
        open={historyDrawer !== null}
        onClose={() => setHistoryDrawer(null)}
        initialSessionId={historyDrawer?.sessionId}
        anchorIndex={historyDrawer?.anchorIndex}
      />
    </div>
  )
}
