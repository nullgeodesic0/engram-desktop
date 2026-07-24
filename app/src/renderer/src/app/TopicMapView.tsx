import { useEffect, useMemo, useRef, useState } from 'react'
import type { TopicSummary, TopicGraph } from '../../../shared/types'
import { RetentionCurve } from '../components/RetentionCurve'
import { GraphView, EDGE_STYLE } from '../components/GraphView'
import { cellBodyPath, plateStats } from '../components/graph2d/plate'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { SkeletonBar } from '../components/Skeleton'
import { StatBlock } from '../components/ui/StatBlock'
import { Button } from '../components/ui/Button'
import { useFocusTrap } from '../components/useFocusTrap'
import { friendlyErrorText } from '../shared/friendlyError'

function stateLabel(state: string): string {
  if (state === 'new') return 'not started'
  if (state === 'learning') return 'encoding'
  return 'consolidated'
}

interface TopicMapViewProps {
  /** Set by App.tsx when arriving from the ⌘K command palette's global node
   * search — selects that topic, waits for its graph to actually load, then
   * opens the node modal directly (can't set both at once: selecting a topic
   * resets openNode until the matching graph is in). */
  deepLinkNode?: { topicId: string; nodeId: string } | null
  onDeepLinkConsumed?: () => void
  /** Jump to the Learn view scoped to a topic — used by "Continue in Learn" actions. */
  onGoTopic?: (topicId: string) => void
  /** Jump to the Learn view to start a fresh topic — used by the unmapped-atlas empty state. */
  onNewTopic?: () => void
  /** Set by LearnSessionView when the tutor calls out a node mid-session — selects
   * that topic, waits for its graph to load, then just pans/selects the node (no
   * modal — this is a nudge, not a navigation). */
  spotlightNode?: { topicId: string; nodeId: string } | null
  onSpotlightConsumed?: () => void
}

export function TopicMapView({
  deepLinkNode,
  onDeepLinkConsumed,
  onGoTopic,
  onNewTopic,
  spotlightNode,
  onSpotlightConsumed,
}: TopicMapViewProps = {}) {
  const [topics, setTopics] = useState<TopicSummary[]>([])
  const [topicsLoaded, setTopicsLoaded] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [graph, setGraph] = useState<TopicGraph | null>(null)
  const [retrievability, setRetrievability] = useState<Map<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [openNode, setOpenNode] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    window.engram.topics().then((ts) => {
      setTopics(ts)
      setTopicsLoaded(true)
      if (ts.length > 0 && !deepLinkNode && !spotlightNode) setSelectedTopic(ts[0].topic)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!deepLinkNode) return
    setSelectedTopic(deepLinkNode.topicId)
  }, [deepLinkNode])

  useEffect(() => {
    if (!spotlightNode) return
    setSelectedTopic(spotlightNode.topicId)
  }, [spotlightNode])

  useEffect(() => {
    if (!selectedTopic) return
    setGraph(null)
    setSelectedNode(null)
    setOpenNode(null)
    setRetrievability(null)
    window.engram
      .topicGraph(selectedTopic)
      .then((g) => setGraph(g as TopicGraph))
      .catch((e: Error) => setError(e.message))
    window.engram
      .decay(selectedTopic)
      .then((result) => {
        const map = new Map(result.nodes.map((n) => [n.node, n.r_now] as const))
        setRetrievability(map)
      })
      .catch(() => setRetrievability(null)) // topic with no decay-relevant history yet — GraphView treats this as full brightness
  }, [selectedTopic])

  // Only fires once the freshly-loaded graph actually matches the deep-linked
  // topic — setting openNode any earlier would just get wiped by the effect above.
  useEffect(() => {
    if (!deepLinkNode || !graph || graph.topic !== deepLinkNode.topicId) return
    if (!graph.nodes[deepLinkNode.nodeId]) return
    setOpenNode(deepLinkNode.nodeId)
    // Also select it, so the plate pans/zooms to the node — closing the modal
    // then leaves you looking at the right spot instead of the default view.
    setSelectedNode(deepLinkNode.nodeId)
    onDeepLinkConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkNode, graph])

  // Same wait-for-graph pattern as deepLinkNode, but this is a nudge, not a
  // navigation — pan/select the node only, no modal, no interruption.
  useEffect(() => {
    if (!spotlightNode || !graph || graph.topic !== spotlightNode.topicId) return
    if (graph.nodes[spotlightNode.nodeId]) {
      setSelectedNode(spotlightNode.nodeId)
    }
    onSpotlightConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotlightNode, graph])

  const node = graph && selectedNode ? graph.nodes[selectedNode] : null
  const opened = graph && openNode ? graph.nodes[openNode] : null
  const stats = useMemo(() => (graph ? plateStats(graph, retrievability) : null), [graph, retrievability])
  const modalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(modalRef, Boolean(opened && openNode))

  useEffect(() => {
    if (!openNode) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenNode(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openNode])

  return (
    <div className="p-8 flex flex-col gap-4 h-full min-h-0">
      <header className="shrink-0 flex flex-col gap-3">
        <h1 className="font-[var(--font-display)] text-2xl text-[var(--color-text-primary)]">Topic Map</h1>
        <div className="flex gap-2 flex-wrap">
          {topics.map((t) => (
            <button
              key={t.topic}
              onClick={() => setSelectedTopic(t.topic)}
              title={t.title}
              className={`focus-ring max-w-64 px-3 py-1.5 rounded-lg text-sm text-left truncate transition-colors ${
                selectedTopic === t.topic
                  ? 'bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]'
                  : 'text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]'
              }`}
            >
              {t.topic}
            </button>
          ))}
        </div>
      </header>

      {error && (() => {
        const fe = friendlyErrorText(error)
        return (
          <div className="shrink-0 panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)]">
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

      {graph && (
        <div className="flex-1 min-h-0 flex gap-4">
          <div className="relative flex-1 min-w-0 flex flex-col">
            <GraphView
              graph={graph}
              selected={selectedNode}
              onSelect={setSelectedNode}
              onOpen={setOpenNode}
              query={query}
              retrievability={retrievability}
            />

            {/* Floating search — mirrors Obsidian's graph-view search field. */}
            <div className="absolute top-3 left-3 w-56">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search nodes…"
                className="focus-ring w-full panel px-3 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] bg-[var(--color-surface)]/90 backdrop-blur"
              />
            </div>

            {/* Progress readout — where Graph Settings used to sit. */}
            {stats && (
              <div className="panel absolute top-4 right-4 z-10 p-3 w-52 flex flex-col gap-2 bg-[var(--color-surface)]/90 backdrop-blur">
                <div className="fig-caption">Fig. — state of the territory</div>
                <div className="grid grid-cols-2 gap-2">
                  <StatBlock label="Encoded" value={`${stats.encoded}/${stats.total}`} tone="cool" />
                  <StatBlock
                    label="Consolidated"
                    value={`${Math.round((stats.consolidated / Math.max(1, stats.total)) * 100)}%`}
                    tone="warm"
                  />
                  <StatBlock label="Decaying" value={String(stats.decaying)} tone={stats.decaying > 0 ? 'violet' : 'neutral'} />
                  <StatBlock label="Capstone" value={`${stats.capstonePrereqsMet}/${stats.capstonePrereqsTotal}`} tone="neutral" />
                </div>
              </div>
            )}

            {/* Legend — glyph key mirroring the plate's own ink states. */}
            <div className="absolute bottom-3 left-3 panel bg-[var(--color-surface)]/90 backdrop-blur px-3 py-2 flex flex-col gap-1.5 text-[10px] label-data text-[var(--color-text-dim)]">
              <svg width={0} height={0} style={{ position: 'absolute' }}>
                <defs>
                  <clipPath id="legend-half-clip">
                    <rect x={-10} y={0} width={20} height={10} />
                  </clipPath>
                </defs>
              </svg>
              <div className="flex items-center gap-2">
                <svg width={18} height={18} viewBox="-9 -9 18 18">
                  <path d={cellBodyPath('legend-new', 6)} fill="none" stroke="var(--color-ink-cool-dim)" strokeWidth={1.2} />
                </svg>
                not started
              </div>
              <div className="flex items-center gap-2">
                <svg width={18} height={18} viewBox="-9 -9 18 18">
                  <path d={cellBodyPath('legend-learning', 6)} fill="none" stroke="var(--color-ink-cool)" strokeWidth={1.2} />
                  <path
                    d={cellBodyPath('legend-learning', 6)}
                    fill="var(--color-ink-cool)"
                    fillOpacity={0.8}
                    clipPath="url(#legend-half-clip)"
                  />
                </svg>
                encoding
              </div>
              <div className="flex items-center gap-2">
                <svg width={18} height={18} viewBox="-9 -9 18 18">
                  <path d={cellBodyPath('legend-review', 6)} fill="var(--color-ink-warm)" fillOpacity={0.85} />
                </svg>
                consolidated
              </div>
              <div className="flex items-center gap-2">
                <svg width={18} height={18} viewBox="-9 -9 18 18">
                  <path d={cellBodyPath('legend-threshold', 6)} fill="none" stroke="var(--color-ink-hot)" strokeWidth={1.2} strokeDasharray="3 2.5" />
                </svg>
                threshold
              </div>
              <div className="flex items-center gap-2">
                <svg width={18} height={18} viewBox="-9 -9 18 18">
                  <path d={cellBodyPath('legend-frontier', 5)} fill="none" stroke="var(--color-ink-cool)" strokeWidth={1} />
                  <circle r={7.5} fill="none" stroke="var(--color-ink-warm)" strokeWidth={1} />
                </svg>
                learn next
              </div>
              <div className="flex items-center gap-2">
                <svg width={18} height={18} viewBox="-9 -9 18 18">
                  <path d={cellBodyPath('legend-lapsed', 5)} fill="none" stroke="var(--color-ink-cool)" strokeWidth={1} />
                  {Array.from({ length: 8 }, (_, i) => {
                    const angle = (i / 8) * Math.PI * 2
                    const r = 8
                    return <circle key={i} cx={Math.cos(angle) * r} cy={Math.sin(angle) * r} r={0.8} fill="var(--color-ink-danger)" opacity={0.7} />
                  })}
                </svg>
                lapsed
              </div>
              <div className="flex items-center gap-2">
                <svg width={18} height={18} viewBox="-9 -9 18 18">
                  <circle r={8} fill="none" stroke="var(--color-ink-warm)" strokeWidth={1} />
                  <path d={cellBodyPath('legend-capstone', 5)} fill="var(--color-ink-warm)" fillOpacity={0.85} />
                </svg>
                capstone seal
              </div>
              <div className="border-t border-[var(--color-hairline)] mt-1 pt-1 text-[var(--color-text-faint)]">
                double-click to open
              </div>
            </div>
          </div>

          {/* Node detail drawer — slides in on select, like Obsidian's file-properties pane. */}
          {node && (
            <div className="w-72 shrink-0 panel p-4 flex flex-col gap-3 overflow-y-auto">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{humanizeNodeId(selectedNode!)}</div>
                  <div className="text-xs label-data text-[var(--color-text-faint)] uppercase tracking-wide mt-0.5">
                    {selectedNode}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-ink-warm)' }}>
                    {node.state && stateLabel(node.state)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setOpenNode(selectedNode)}
                    title="Open full node"
                    className="focus-ring text-[10px] label-data px-2 py-1 rounded bg-[var(--color-surface-3)] text-[var(--color-ink-warm)] hover:text-[var(--color-text-primary)]"
                  >
                    Open ↗
                  </button>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] text-lg leading-none"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
              </div>

              {onGoTopic && (
                <Button variant="ghost" onClick={() => onGoTopic(selectedTopic!)}>
                  Continue in Learn
                </Button>
              )}

              <div className="flex gap-1.5 flex-wrap">
                {node.capstone && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded label-data" style={{ background: 'var(--color-surface-3)', color: 'var(--color-ink-hot)' }}>
                    ★ capstone
                  </span>
                )}
                {node.threshold && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded label-data" style={{ background: 'var(--color-surface-3)', color: 'var(--color-ink-hot)' }}>
                    † threshold
                  </span>
                )}
                {node.arbitrary && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded label-data bg-[var(--color-surface-3)] text-[var(--color-text-dim)]">
                    arbitrary
                  </span>
                )}
                {node.artifact && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded label-data bg-[var(--color-surface-3)] text-[var(--color-ink-violet)]">
                    explorable
                  </span>
                )}
              </div>

              <p className="text-sm text-[var(--color-text-primary)] leading-snug">{node.claim}</p>

              <div className="flex items-center justify-between panel-raised px-2.5 py-1.5">
                <RetentionCurve stabilityDays={node.fsrs.s} width={100} height={22} />
                <span className="label-data text-[10px] text-[var(--color-text-faint)]">
                  {node.fsrs.s != null ? `${node.fsrs.s.toFixed(1)}d` : '—'}
                </span>
              </div>

              <div className="text-xs text-[var(--color-text-dim)]">
                <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1">Probe</div>
                {node.probe}
              </div>

              {node.rubric.length > 0 && (
                <div className="text-xs text-[var(--color-text-dim)]">
                  <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1">Rubric</div>
                  <ul className="list-disc list-inside flex flex-col gap-0.5">
                    {node.rubric.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(node.edges.requires ?? []).length > 0 && (
                <div className="text-xs">
                  <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1">Requires</div>
                  <div className="flex flex-wrap gap-1">
                    {(node.edges.requires ?? []).map((r) => (
                      <button
                        key={r}
                        onClick={() => setSelectedNode(r)}
                        title={r}
                        className="focus-ring text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-ink-cool)] hover:text-[var(--color-text-primary)]"
                      >
                        {humanizeNodeId(r)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {topicsLoaded && topics.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <div className="fig-caption">Fig. — the atlas is unmapped</div>
          <p className="text-sm text-[var(--color-text-dim)]">No territories yet — the map draws itself as you learn.</p>
          <Button variant="ghost" onClick={onNewTopic}>Start your first topic</Button>
        </div>
      )}

      {!(topicsLoaded && topics.length === 0) && !graph && !error && (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="w-full max-w-md flex flex-col gap-2">
            <div className="fig-caption">reading the topic map…</div>
            <SkeletonBar height={220} />
            <div className="flex gap-2">
              <SkeletonBar width="30%" height={10} />
              <SkeletonBar width="20%" height={10} />
            </div>
          </div>
        </div>
      )}

      {opened && openNode && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center p-10 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpenNode(null)}
        >
          <div
            ref={modalRef}
            className="panel bg-[var(--color-surface)] w-full max-w-2xl max-h-full overflow-y-auto p-7 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs label-data text-[var(--color-text-faint)] uppercase tracking-wide">
                  {selectedTopic}
                </div>
                <h2 className="font-[var(--font-display)] text-xl text-[var(--color-text-primary)] mt-1">
                  {humanizeNodeId(openNode)}
                </h2>
                <div className="label-data text-[10px] text-[var(--color-text-faint)] mt-0.5">{openNode}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-ink-warm)' }}>
                  {opened.state && stateLabel(opened.state)}
                </div>
              </div>
              <button
                onClick={() => setOpenNode(null)}
                className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex gap-1.5 flex-wrap">
              {opened.capstone && (
                <span className="text-[10px] px-1.5 py-0.5 rounded label-data" style={{ background: 'var(--color-surface-3)', color: 'var(--color-ink-hot)' }}>
                  ★ capstone
                </span>
              )}
              {opened.threshold && (
                <span className="text-[10px] px-1.5 py-0.5 rounded label-data" style={{ background: 'var(--color-surface-3)', color: 'var(--color-ink-hot)' }}>
                  † threshold
                </span>
              )}
              {opened.arbitrary && (
                <span className="text-[10px] px-1.5 py-0.5 rounded label-data bg-[var(--color-surface-3)] text-[var(--color-text-dim)]">
                  arbitrary — sequence is bookkeeping, not physics
                </span>
              )}
            </div>

            <p className="text-base text-[var(--color-text-primary)] leading-relaxed">{opened.claim}</p>

            <div className="flex items-center justify-between panel-raised px-3 py-2">
              <div className="flex items-center gap-2">
                <RetentionCurve stabilityDays={opened.fsrs.s} width={120} height={26} />
                <span className="label-data text-xs text-[var(--color-text-dim)]">
                  {opened.fsrs.s != null ? `stability ${opened.fsrs.s.toFixed(1)}d` : 'not yet reviewed'}
                </span>
              </div>
              <span className="label-data text-xs text-[var(--color-text-faint)]">
                {opened.fsrs.reps} reps · {opened.fsrs.lapses} lapses
              </span>
            </div>

            <div className="text-sm text-[var(--color-text-dim)]">
              <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1.5">
                Probe
              </div>
              {opened.probe}
            </div>

            {opened.rubric.length > 0 && (
              <div className="text-sm text-[var(--color-text-dim)]">
                <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1.5">
                  Rubric
                </div>
                <ul className="list-disc list-inside flex flex-col gap-1">
                  {opened.rubric.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {opened.why_chain.length > 0 && (
              <div className="text-sm text-[var(--color-text-dim)]">
                <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1.5">
                  Why chain
                </div>
                <ol className="list-decimal list-inside flex flex-col gap-1">
                  {opened.why_chain.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ol>
              </div>
            )}

            {opened.transfer_probe && (
              <div className="text-sm text-[var(--color-text-dim)]">
                <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1.5">
                  Transfer probe
                </div>
                {opened.transfer_probe}
              </div>
            )}

            {(['requires', 'derives_from', 'contrasts_with', 'analogous_to'] as const).map(
              (kind) =>
                (opened.edges[kind] ?? []).length > 0 && (
                  <div key={kind} className="text-sm">
                    <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1.5">
                      {EDGE_STYLE[kind].label}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(opened.edges[kind] ?? []).map((r) => (
                        <button
                          key={r}
                          onClick={() => setOpenNode(r)}
                          title={r}
                          className="focus-ring text-xs px-2 py-1 rounded bg-[var(--color-surface-3)] text-[var(--color-ink-cool)] hover:text-[var(--color-text-primary)]"
                        >
                          {humanizeNodeId(r)}
                        </button>
                      ))}
                    </div>
                  </div>
                )
            )}

            {opened.artifact && (
              <button
                onClick={() => window.engram.openArtifact(opened.artifact!)}
                className="focus-ring self-start mt-1 px-4 py-2 rounded-lg text-sm bg-[var(--color-surface-3)] text-[var(--color-ink-violet)] hover:bg-[var(--color-surface-2)]"
              >
                Open explorable ↗
              </button>
            )}

            {onGoTopic && (
              <Button variant="ghost" className="self-start" onClick={() => onGoTopic(selectedTopic!)}>
                Continue in Learn
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
