import { useEffect, useMemo, useRef, useState } from 'react'
import type { TopicListEntry, TopicGraph, MapAnnotations, NodeProvenance, ProvenanceEvent, Misconception, RawReceipt } from '../../../shared/types'
import { RetentionCurve } from '../components/RetentionCurve'
import { GraphView, EDGE_STYLE } from '../components/GraphView'
import { NodeTable } from '../components/NodeTable'
import { GrowthScrubber } from '../components/GrowthScrubber'
import { PressureReadout } from '../components/PressureReadout'
import { cellBodyPath, plateStats, ancestorClosure, descendantPath } from '../components/graph2d/plate'
import { mapToPrintHtml } from '../shared/mapToPrintHtml'
import { layersOf, computeHubNodeIds } from '../components/graph3d/layout'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { SkeletonBar } from '../components/Skeleton'
import { StatBlock } from '../components/ui/StatBlock'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { MathRenderer } from '../components/MathRenderer'
import { SessionHistoryDrawer } from '../components/SessionHistoryDrawer'
import { ExplorableViewer } from '../components/ExplorableViewer'
import { friendlyErrorText } from '../shared/friendlyError'
import { recordView } from '../shared/recentlyViewed'
import { stateLabel, formatMonthDay } from '../shared/nodeDisplay'

/** `date` is a local YYYY-MM-DD string (see ProvenanceEvent) — parsed without
 * a `Z` suffix so `Date` reads it in local time instead of shifting it a day
 * at UTC-negative offsets. */
function formatProvenanceDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Local YYYY-MM-DD for a Date object — getFullYear/Month/Date, never
 * toISOString, matching the local-date discipline every other due/date
 * comparison in this app already uses (see GraphView's dueStatusFor). */
function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** [0,1] → a YYYY-MM-DD between the timeline's earliest dated node and
 * today, linearly interpolated over local-midnight epoch ms. */
function dateAtT(timeline: { earliest: string; today: string }, t: number): string {
  const start = new Date(`${timeline.earliest}T00:00:00`).getTime()
  const end = new Date(`${timeline.today}T00:00:00`).getTime()
  if (end <= start) return timeline.today
  return localDateString(new Date(start + (end - start) * t))
}

/** Provenance block shown in both the node drawer and the full-node modal —
 * "First encoded"/"Pretested" line (whichever `firstEncoded.kind` is; absent
 * entirely if null) plus a newest-first "Reviewed N times" list. Every row is
 * a real button that hands its own event to `onOpen`, which resolves the
 * history key (topic id for encode/pretest, 'review' for review — see
 * openProvenanceEvent below) and opens the anchored SessionHistoryDrawer.
 * Renders nothing for a node with no events at all — no empty chrome. */
function ProvenanceBlock({
  entry,
  onOpen,
  compact,
}: {
  entry: NodeProvenance | undefined
  onOpen: (ev: ProvenanceEvent) => void
  compact: boolean
}) {
  if (!entry || (!entry.firstEncoded && entry.reviews.length === 0)) return null
  const textSize = compact ? 'text-xs' : 'text-sm'
  return (
    // Set apart from the node's prose: a warm-hairline spine and faint wash so
    // the history register reads as a record, not more description.
    <div
      className={`${textSize} text-[var(--color-text-dim)] border-l-2 border-[var(--color-ink-warm-dim)] bg-[var(--color-surface-2)]/40 rounded-r-md ${compact ? 'pl-2.5 pr-2 py-1.5' : 'pl-3 pr-2.5 py-2'}`}
    >
      <div className={`label-data uppercase tracking-wide text-[10px] text-[var(--color-ink-warm)] ${compact ? 'mb-1' : 'mb-1.5'}`}>
        Provenance
      </div>
      <div className="flex flex-col gap-1 items-start">
        {entry.firstEncoded && (
          <button
            onClick={() => onOpen(entry.firstEncoded!)}
            aria-label={`Open ${entry.firstEncoded.kind === 'pretest' ? 'pretest' : 'encoding'} of ${formatProvenanceDate(entry.firstEncoded.date)}`}
            className="focus-ring text-left hover:text-[var(--color-text-primary)]"
          >
            {entry.firstEncoded.kind === 'pretest' ? 'Pretested' : 'First encoded'} — {formatProvenanceDate(entry.firstEncoded.date)}
          </button>
        )}
        {entry.reviews.length > 0 && (
          <div className="flex flex-col gap-1 items-start mt-0.5">
            <div className="text-[10px] label-data text-[var(--color-text-faint)]">
              Reviewed {entry.reviews.length} time{entry.reviews.length === 1 ? '' : 's'}
            </div>
            {entry.reviews.map((r, i) => (
              <button
                key={`${r.sessionId}-${r.anchor}-${i}`}
                onClick={() => onOpen(r)}
                aria-label={`Open review of ${formatProvenanceDate(r.date)}`}
                className="focus-ring pl-2 text-left hover:text-[var(--color-text-primary)]"
              >
                {formatProvenanceDate(r.date)}
                {r.grade ? ` — ${capitalize(r.grade)}` : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** This node's open misconceptions — shown in both the node drawer and the
 * full-node modal, right alongside Provenance. Deliberately quiet: no danger
 * ink, no "you still owe this" framing, since a misconception is a recorded
 * fact about the learner's model of the world (something noticed, filed for
 * re-testing), not a failure — same absolve-never-pity voice LapseRite uses
 * for a lapse. Renders nothing once loaded with zero items — no empty
 * chrome for the common case (most nodes have none). */
function NodeMisconceptions({
  items,
  loaded,
  error,
  compact,
}: {
  items: Misconception[]
  loaded: boolean
  error: boolean
  compact: boolean
}) {
  const textSize = compact ? 'text-xs' : 'text-sm'
  if (error) {
    return <div className={`${textSize} text-[var(--color-text-faint)]`}>couldn’t read misconceptions</div>
  }
  if (!loaded) return <div className="fig-caption">reading misconceptions…</div>
  if (items.length === 0) return null
  return (
    <div
      className={`${textSize} text-[var(--color-text-dim)] border-l-2 border-[var(--color-ink-cool-dim)] bg-[var(--color-surface-2)]/40 rounded-r-md ${compact ? 'pl-2.5 pr-2 py-1.5' : 'pl-3 pr-2.5 py-2'}`}
    >
      <div className={`label-data uppercase tracking-wide text-[10px] text-[var(--color-ink-cool)] ${compact ? 'mb-1' : 'mb-1.5'}`}>
        Filed here
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((m) => (
          <MathRenderer key={m.id} text={m.description} className="leading-snug" />
        ))}
      </div>
    </div>
  )
}

/** Requires (root-first prerequisite closure) and Unlocks (downstream
 * closure) for a node — sorted by `layers` (the same dependency-depth
 * `layersOf` gives the map itself), ties broken by graph order for
 * determinism. Requires reads shallowest-layer-first: the deepest
 * ancestors — the foundational nodes with no prerequisites of their own —
 * come first, building up toward what's nearest this node. Unlocks reads
 * the same direction, nearest milestone first.
 *
 * `ancestorClosure`/`descendantPath` (plate.ts) stop the walk at a hub
 * boundary for every OTHER node's trail, but neither stops at the START
 * node itself — so calling this on a hub node (`computeHubNodeIds`: the
 * capstone, or a capstone-like synthesis node nearly everything requires-
 * into) would enumerate its own near-universal direct requires right back
 * out as "the closure". `hubRequiresCount` is how the caller renders that
 * case instead: `requires` comes back empty and the direct-requires count
 * rides along separately, so NodeStructure can show one honest line ("the
 * territory — N nodes") rather than a 30+ row list. Unlocks doesn't need the
 * same guard — nothing but another hub ever requires-into a hub, and hubs
 * are excluded from the walk, so a hub's descendantPath is empty in every
 * graph shipped today. */
function computeNodeStructure(
  graph: TopicGraph,
  nodeId: string,
  layers: Map<string, number>,
  orderIndex: Map<string, number>,
  hubs: Set<string>,
): { requires: string[]; unlocks: string[]; hubRequiresCount: number | null } {
  const byDepth = (a: string, b: string) =>
    (layers.get(a) ?? 0) - (layers.get(b) ?? 0) || (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0)
  const isHub = hubs.has(nodeId)
  return {
    requires: isHub ? [] : [...ancestorClosure(graph, nodeId)].sort(byDepth),
    unlocks: [...descendantPath(graph, nodeId)].sort(byDepth),
    hubRequiresCount: isHub ? (graph.nodes[nodeId]?.edges.requires ?? []).length : null,
  }
}

/** The node's place in the graph's shape — shown in both the node drawer and
 * the full-node modal, alongside Provenance and Filed-here. Built on
 * `ancestorClosure`/`descendantPath` (plate.ts) rather than the node's own
 * direct `edges.requires` — those two walks already stop at hub boundaries,
 * so a node sitting right next to the capstone (or a capstone-like synthesis
 * node) still gets a real, bounded trail instead of the whole topic. This is
 * the SINGLE place a node's requires relationships render: the drawer's old
 * direct-`edges.requires` chip row and the modal's `requires` case in the
 * EDGE_STYLE loop were both removed in favor of this block. In the common
 * case a node's ancestor closure is non-empty whenever its direct requires
 * is — the closure includes the direct edges as its own nearest layer — but
 * that's not a guarantee: a node whose direct prerequisites are ALL hubs
 * would have a non-empty `edges.requires` and an empty closure (every one of
 * them stopped at the hub boundary). No node in any graph shipped today hits
 * that case, so it isn't specially handled — a node like that would silently
 * render no Requires line at all, same as an actual root. `derives_from`/
 * `contrasts_with`/`analogous_to` have no closure equivalent, so they still
 * render via their own EDGE_STYLE loop elsewhere in the modal. Violet is this
 * app's synthesis/structure accent: warm is provenance/history, cool is
 * misconceptions, violet is the shape of the graph itself — hence the outer
 * "Structure" label, with "Requires"/"Unlocks" as sub-captions. Renders
 * nothing for a node with neither and no hub count (roots have no requires,
 * leaves have no unlocks) — no empty chrome, same discipline as
 * NodeMisconceptions. */
function NodeStructure({
  requires,
  unlocks,
  hubRequiresCount,
  onSelect,
  compact,
}: {
  requires: string[]
  unlocks: string[]
  /** Set (instead of null) only when this node is itself a hub — the direct-
   * requires count to state in place of enumerating `requires` (always empty
   * in that case; see computeNodeStructure). */
  hubRequiresCount: number | null
  onSelect: (id: string) => void
  compact: boolean
}) {
  if (requires.length === 0 && unlocks.length === 0 && hubRequiresCount === null) return null
  const textSize = compact ? 'text-xs' : 'text-sm'
  return (
    <div
      className={`${textSize} text-[var(--color-text-dim)] border-l-2 border-[var(--color-ink-violet-dim)] bg-[var(--color-surface-2)]/40 rounded-r-md ${compact ? 'pl-2.5 pr-2 py-1.5' : 'pl-3 pr-2.5 py-2'}`}
    >
      <div className={`label-data uppercase tracking-wide text-[10px] text-[var(--color-ink-violet)] ${compact ? 'mb-1' : 'mb-1.5'}`}>
        Structure
      </div>
      <div className="flex flex-col gap-2">
        {(requires.length > 0 || hubRequiresCount !== null) && (
          <div className="flex flex-col gap-1 items-start">
            <div className="text-[10px] label-data text-[var(--color-text-faint)]">Requires</div>
            {hubRequiresCount !== null ? (
              <p className="pl-2">the territory — {hubRequiresCount} nodes</p>
            ) : (
              requires.map((id) => (
                <button
                  key={id}
                  onClick={() => onSelect(id)}
                  title={id}
                  className="focus-ring pl-2 text-left hover:text-[var(--color-text-primary)]"
                >
                  {humanizeNodeId(id)}
                </button>
              ))
            )}
          </div>
        )}
        {unlocks.length > 0 && (
          <div className="flex flex-col gap-1 items-start">
            <div className="text-[10px] label-data text-[var(--color-text-faint)]">Unlocks</div>
            {unlocks.map((id) => (
              <button
                key={id}
                onClick={() => onSelect(id)}
                title={id}
                className="focus-ring pl-2 text-left hover:text-[var(--color-text-primary)]"
              >
                {humanizeNodeId(id)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
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
  const [topics, setTopics] = useState<TopicListEntry[]>([])
  const [topicsLoaded, setTopicsLoaded] = useState(false)
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [graph, setGraph] = useState<TopicGraph | null>(null)
  const [retrievability, setRetrievability] = useState<Map<string, number> | null>(null)
  // F10: `retrievability === null` is ALREADY a legitimate resolved state
  // (a topic with no decay-relevant history yet — GraphView treats it as
  // full brightness, see the `.catch` below), so it can't double as "still
  // loading" too. Without this flag, exporting in the gap between the graph
  // resolving and `decay()` resolving silently printed every cell at full
  // ink — a plate that looks nothing like the (correctly faded) screen it
  // claims to reproduce. True once the in-flight `decay()` call for the
  // CURRENT `selectedTopic` has settled, resolved or rejected either way.
  const [decayReady, setDecayReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [openNode, setOpenNode] = useState<string | null>(null)
  // Node whose explorable is currently open in the in-app viewer — separate
  // from selectedNode/openNode so the drawer, the full-node modal, and the
  // viewer can each be open independently (e.g. viewer opened from the
  // drawer, drawer stays open behind it).
  const [explorableNode, setExplorableNode] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Schedule lens toggle — legend-area button, see the legend swap below.
  // Reset isn't tied to topic switches: staying "on" while browsing between
  // topics matches how a lens works (you don't re-pick it every time you
  // move your eyes).
  const [dueLens, setDueLens] = useState(false)
  // Map/table toggle for the plate — view-local, default map, and
  // deliberately NOT reset on topic switches (same reasoning as dueLens
  // above: it's a viewing preference, not per-topic state).
  const [plateView, setPlateView] = useState<'map' | 'table'>('map')
  // Tutor-authored LaTeX overrides for the selected topic's nodes (see
  // mapAnnotations.ts) — keyed by node id, refreshed on topic switch and on
  // every live annotate_node bridge:ui event for this topic.
  const [annotations, setAnnotations] = useState<MapAnnotations>({})
  // Node id whose claim block should ink-in warm right now — set by the live
  // annotate_node listener below, cleared a beat after the CSS animation
  // finishes. A timeout (not onAnimationEnd) is what clears it, since the
  // claim block for the flashed node might not even be mounted (neither the
  // drawer nor the full-node modal open on it) when the update lands.
  const [inkFlashNode, setInkFlashNode] = useState<string | null>(null)
  const inkFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Per-node provenance for the selected topic — null means "still loading"
  // (renders the quiet fig-caption), {} means "loaded, nothing to show" (no
  // node has events). Reset on topic switch, alongside annotations.
  const [provenance, setProvenance] = useState<Record<string, NodeProvenance> | null>(null)
  // Which anchored sitting the SessionHistoryDrawer is currently showing —
  // null closes it. historyKey follows the encode/pretest→topic,
  // review→'review' mapping (see openProvenanceEvent).
  const [historyDrawer, setHistoryDrawer] = useState<{ historyKey: string; sessionId: string; anchorIndex: number } | null>(null)
  // Growth time-lapse — the replay ghost button (near the due-lens toggle)
  // and the GrowthScrubber it reveals. `replayT` is [0,1]; visibleNodes
  // (below) is what actually drives GraphView's replay lens. Both reset on
  // topic switch alongside provenance, so a fresh topic never opens with a
  // stale scrub position.
  const [replayActive, setReplayActive] = useState(false)
  const [replayT, setReplayT] = useState(0)
  // The whole ledger, fetched once (unscoped by topic — window.engram.misconceptions()
  // always returns everything) and filtered per-node below. null = still loading,
  // a rejected read leaves it null forever and flips misconceptionsError instead —
  // the drawer/modal render a quiet inline message rather than losing the whole map.
  const [misconceptions, setMisconceptions] = useState<Misconception[] | null>(null)
  const [misconceptionsError, setMisconceptionsError] = useState(false)
  // Exam mode (P4 Task 1): the selected topic's own deadline (null if unset)
  // plus every raw receipt ever written — receiptsHistory()'s `receipts`
  // field is deliberately unwindowed (see that file's doc comment), which is
  // exactly what pressure.ts needs to find a topic's FIRST encode regardless
  // of how long ago it was.
  const [targetDate, setTargetDate] = useState<string | null>(null)
  const [receipts, setReceipts] = useState<RawReceipt[]>([])
  // Map-as-plate export (P5 Task 3) — same exporting/status shape
  // SessionHistoryDrawer's sitting export already uses, so this reads
  // identically rather than inventing a second export-feedback convention.
  const [exportingMap, setExportingMap] = useState(false)
  const [mapExportStatus, setMapExportStatus] = useState<{ text: string; failed: boolean } | null>(null)

  /** The print-plate export's entry point — builds the SAME figure GraphView
   * renders (mapToPrintHtml calls the identical settlePlate/cellBodyPath/
   * edge-path functions, just as markup instead of JSX; see that file's own
   * header comment for the full reasoning) and hands it to main's
   * exportSitting-pipeline-reusing hidden-window printer. Deliberately reads
   * `graph`/`retrievability`/`annotations` — never `selectedNode`, `query`,
   * `dueLens`, `replayActive`/`replayT` — so an export never freezes
   * whatever transient interaction happened to be on screen; see
   * mapToPrintHtml.ts for why each of those is resolved off/full rather than
   * captured mid-interaction.
   *
   * F10: guarded on `decayReady` too, not just `graph` — the export button
   * itself is disabled until both are true (see the render below), so this
   * is the defensive second line, not the only one: without it, a
   * still-possible race between a fast graph load and a slower still-pending
   * `decay()` call would export with `retrievability` stuck at its initial
   * `null` — indistinguishable from "no decay history", so every cell would
   * silently print at full ink, unlike the correctly-faded screen it's
   * supposed to reproduce. */
  async function handleExportMap() {
    if (!graph || !decayReady) return
    setExportingMap(true)
    setMapExportStatus(null)
    try {
      const printHtml = mapToPrintHtml(graph, retrievability, annotations)
      const result = await window.engram.exportMap({ title: graph.title, printHtml })
      if (result.ok) setMapExportStatus({ text: `Saved to ${result.path}`, failed: false })
      else if (result.reason !== 'canceled') setMapExportStatus({ text: `Export failed: ${result.reason}`, failed: true })
    } finally {
      setExportingMap(false)
    }
  }

  function openProvenanceEvent(ev: ProvenanceEvent, topicId: string) {
    setHistoryDrawer({ historyKey: ev.kind === 'review' ? 'review' : topicId, sessionId: ev.sessionId, anchorIndex: ev.anchor })
  }

  function openMisconceptionsFor(topicId: string | null, nodeId: string | null): Misconception[] {
    if (!misconceptions || !topicId || !nodeId) return []
    return misconceptions.filter((m) => m.topic === topicId && m.node === nodeId && m.status === 'open')
  }

  useEffect(() => {
    window.engram.topics().then((ts) => {
      setTopics(ts)
      setTopicsLoaded(true)
      if (ts.length > 0 && !deepLinkNode && !spotlightNode) setSelectedTopic(ts[0].topic)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    window.engram
      .misconceptions()
      .then(setMisconceptions)
      .catch(() => setMisconceptionsError(true))
  }, [])

  useEffect(() => {
    window.engram
      .receiptsHistory()
      .then((h) => setReceipts(h.receipts))
      .catch(() => setReceipts([]))
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
    setDecayReady(false)
    setAnnotations({})
    setProvenance(null)
    setReplayActive(false)
    setReplayT(0)
    setTargetDate(null)
    setMapExportStatus(null)
    window.engram
      .topicGraph(selectedTopic)
      .then((g) => setGraph(g as TopicGraph))
      .catch((e: Error) => setError(e.message))
    window.engram
      .getTopicSettings(selectedTopic)
      .then((s) => setTargetDate(s.targetDate ?? null))
      .catch(() => setTargetDate(null))
    window.engram
      .decay(selectedTopic)
      .then((result) => {
        const map = new Map(result.nodes.map((n) => [n.node, n.r_now] as const))
        setRetrievability(map)
      })
      .catch(() => setRetrievability(null)) // topic with no decay-relevant history yet — GraphView treats this as full brightness
      .finally(() => setDecayReady(true))
    window.engram
      .mapAnnotations(selectedTopic)
      .then(setAnnotations)
      .catch(() => setAnnotations({}))
    window.engram
      .nodeProvenance(selectedTopic)
      .then(setProvenance)
      .catch(() => setProvenance({}))
  }, [selectedTopic])

  // Live annotate_node bridge:ui events (fired by a running Learn session)
  // refresh this topic's annotations in place — payload is untrusted model
  // output relayed straight from the bridge worker, so every field is
  // typeof-checked before use (same discipline as LearnSessionView's onBridgeUi
  // switch), and events for a topic other than the one currently open are ignored.
  useEffect(() => {
    const off = window.engram.onBridgeUi((req) => {
      if (req.tool !== 'annotate_node') return
      if (typeof req.payload !== 'object' || req.payload === null) return
      const payload = req.payload as Record<string, unknown>
      const topic = payload.topic
      if (typeof topic !== 'string' || topic !== selectedTopic) return
      window.engram
        .mapAnnotations(topic)
        .then((next) => {
          setAnnotations(next)
          // Ink-in only the node this update actually touched — every other
          // node's claim block stays put even though `annotations` as a
          // whole just changed.
          const node = payload.node
          if (typeof node !== 'string') return
          setInkFlashNode(node)
          if (inkFlashTimer.current) clearTimeout(inkFlashTimer.current)
          inkFlashTimer.current = setTimeout(() => setInkFlashNode(null), 500)
        })
        .catch(() => {})
    })
    return off
  }, [selectedTopic])

  useEffect(() => {
    return () => {
      if (inkFlashTimer.current) clearTimeout(inkFlashTimer.current)
    }
  }, [])

  // Only fires once the freshly-loaded graph actually matches the deep-linked
  // topic — setting openNode any earlier would just get wiped by the effect above.
  // Waiting on `graph.topic === deepLinkNode.topicId` first (rather than
  // consuming as soon as `deepLinkNode` is set) is what keeps this from
  // canceling a legitimate pending open: the right graph might just not have
  // finished loading yet, and that's not the same thing as an unresolvable link.
  useEffect(() => {
    if (!deepLinkNode || !graph || graph.topic !== deepLinkNode.topicId) return
    if (!graph.nodes[deepLinkNode.nodeId]) {
      // The right topic loaded, but this node doesn't exist in it — a stale
      // or poisoned deep link (e.g. a recentlyViewed row pointing at a node
      // id that never belonged to this topic). Consume it anyway: leaving
      // `deepLinkNode` set would force this topic open on every subsequent
      // Topic Map mount (see the `!deepLinkNode` guard in the topics-load
      // effect above), silently overriding whatever the learner picks next.
      onDeepLinkConsumed?.()
      return
    }
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

  // Recently-viewed recording — a quiet convenience for Home/the palette, not
  // app state. selectedNode/openNode are the two choke points every path that
  // opens a node already funnels through (the plate's own click/dblclick, the
  // node table's row click, NodeStructure's requires/unlocks buttons, the
  // deep-link/spotlight effects above), so one effect per state covers all of
  // them rather than a recordView() sprinkled at each call site. Never fires
  // on a clear (selectedNode/openNode going back to null).
  //
  // The `graph.topic === selectedTopic` check matters on a topic switch:
  // React can commit a render where `selectedTopic` already reads the new
  // topic while `selectedNode`/`graph` are still the OLD topic's — the effect
  // that resets them on a topic change only *schedules* those clears, it
  // doesn't apply them synchronously. Without this check that render would
  // record `{topic: <new>, node: <old node>}` — a node id that doesn't even
  // exist in the new topic, mislabeled with the old topic's title.
  useEffect(() => {
    if (!selectedTopic || !selectedNode || !graph || graph.topic !== selectedTopic) return
    recordView({ kind: 'node', topic: selectedTopic, node: selectedNode, label: humanizeNodeId(selectedNode), topicTitle: graph.title })
  }, [selectedTopic, selectedNode, graph])

  useEffect(() => {
    if (!selectedTopic || !openNode || !graph || graph.topic !== selectedTopic) return
    recordView({ kind: 'node', topic: selectedTopic, node: openNode, label: humanizeNodeId(openNode), topicTitle: graph.title })
  }, [selectedTopic, openNode, graph])

  const node = graph && selectedNode ? graph.nodes[selectedNode] : null
  const opened = graph && openNode ? graph.nodes[openNode] : null
  const stats = useMemo(() => (graph ? plateStats(graph, retrievability) : null), [graph, retrievability])

  // Dependency-depth layers + a stable graph-order index, both reused by
  // NodeStructure's root-first sort below — computed once per graph rather
  // than per render, since ancestorClosure/descendantPath already do a full
  // walk of their own. structureHubs is the same hub set ancestorClosure/
  // descendantPath already consult internally — computeNodeStructure needs
  // its own copy too, to know when the SELECTED node (not just a node it
  // walks through) is itself a hub.
  const structureLayers = useMemo(() => (graph ? layersOf(graph) : null), [graph])
  const structureOrderIndex = useMemo(
    () => (graph ? new Map(graph.order.map((id, i) => [id, i] as const)) : null),
    [graph],
  )
  const structureHubs = useMemo(() => (graph ? computeHubNodeIds(graph) : null), [graph])
  const selectedStructure = useMemo(
    () =>
      graph && selectedNode && structureLayers && structureOrderIndex && structureHubs
        ? computeNodeStructure(graph, selectedNode, structureLayers, structureOrderIndex, structureHubs)
        : { requires: [], unlocks: [], hubRequiresCount: null },
    [graph, selectedNode, structureLayers, structureOrderIndex, structureHubs],
  )
  const openedStructure = useMemo(
    () =>
      graph && openNode && structureLayers && structureOrderIndex && structureHubs
        ? computeNodeStructure(graph, openNode, structureLayers, structureOrderIndex, structureHubs)
        : { requires: [], unlocks: [], hubRequiresCount: null },
    [graph, openNode, structureLayers, structureOrderIndex, structureHubs],
  )

  // Growth timeline — earliest firstEncoded.date across the topic's nodes,
  // through today. null when provenance hasn't loaded yet or no node has a
  // date at all (nothing to replay), which also disables the replay toggle.
  const growthTimeline = useMemo(() => {
    if (!provenance || !graph) return null
    const dates = graph.order
      .map((id) => provenance[id]?.firstEncoded?.date)
      .filter((d): d is string => Boolean(d))
    if (dates.length === 0) return null
    const earliest = dates.reduce((a, b) => (a < b ? a : b))
    return { earliest, today: localDateString(new Date()) }
  }, [provenance, graph])

  // visibleNodes for GraphView's replay lens — a node with a firstEncoded
  // date shows once that date is at or before the scrub cutoff; a node with
  // no date at all (still un-encoded, or provenance genuinely has nothing
  // for it) only appears once the scrub reaches the very end (t===1).
  const replayVisibleNodes = useMemo(() => {
    if (!replayActive || !growthTimeline || !provenance || !graph) return null
    const cutoff = dateAtT(growthTimeline, replayT)
    const s = new Set<string>()
    for (const id of graph.order) {
      const date = provenance[id]?.firstEncoded?.date
      if (date) {
        if (date <= cutoff) s.add(id)
      } else if (replayT >= 1) {
        s.add(id)
      }
    }
    return s
  }, [replayActive, replayT, growthTimeline, provenance, graph])

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
          {/* The plate sits over the app's ambient NeuralField canvas, which
              competes with the specimen for attention. A backdrop blur (plus
              a whisper of surface tint) pushes that field out of focus behind
              the map without touching the map's own ink — the plate reads as
              the thing in focus, everything else as depth. */}
          <div className="relative flex-1 min-w-0 flex flex-col rounded-xl overflow-hidden backdrop-blur-md bg-[var(--color-void)]/55">
            {/* Plate header — map/table toggle. A real header bar rather than
                another floating overlay: the table's own column headers need
                the top-left/top-right corners the map's search box and stats
                readout already occupy, so the toggle lives above both instead
                of stacking on top of either. */}
            <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--color-hairline)]">
              <div className="flex items-center gap-3 min-w-0">
                {mapExportStatus && (
                  <span
                    className={`text-xs truncate max-w-[16rem] ${mapExportStatus.failed ? 'text-[var(--color-ink-danger)]' : 'text-[var(--color-text-faint)]'}`}
                    title={mapExportStatus.text}
                  >
                    {mapExportStatus.text}
                  </span>
                )}
                <button
                  onClick={handleExportMap}
                  disabled={exportingMap || !decayReady}
                  title={!decayReady ? 'Waiting on this topic’s decay figures before the plate can print them faithfully…' : undefined}
                  className="focus-ring no-press text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  {exportingMap ? 'Exporting…' : decayReady ? 'Export plate ↗' : 'Preparing plate…'}
                </button>
              </div>
              <div role="group" aria-label="Map or table view" className="flex items-center gap-0.5 panel p-0.5 bg-[var(--color-surface)]/90">
                {(['map', 'table'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setPlateView(v)}
                    aria-pressed={plateView === v}
                    className={`focus-ring label-data text-[10px] uppercase tracking-wide px-2.5 py-1 rounded-md transition-colors ${
                      plateView === v
                        ? 'bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]'
                        : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {v === 'map' ? 'Map' : 'Table'}
                  </button>
                ))}
              </div>
            </div>

            {plateView === 'table' && (
              <div className="relative flex-1 min-h-0">
                <NodeTable graph={graph} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
              </div>
            )}

            {plateView === 'map' && (
            <div className="relative flex-1 min-h-0">
            <GraphView
              graph={graph}
              selected={selectedNode}
              onSelect={setSelectedNode}
              onOpen={setOpenNode}
              query={query}
              retrievability={retrievability}
              annotations={annotations}
              dueLens={dueLens && !replayActive}
              visibleNodes={replayVisibleNodes}
            />

            {/* Growth time-lapse scrubber — only mounted while the replay
                toggle (in the legend header, below) is on and there's an
                actual timeline to scrub. */}
            {replayActive && growthTimeline && (
              <GrowthScrubber
                t={replayT}
                onChangeT={setReplayT}
                dateLabel={formatMonthDay(dateAtT(growthTimeline, replayT))}
                inked={replayVisibleNodes?.size ?? 0}
                total={graph.order.length}
              />
            )}

            {/* Floating search — mirrors Obsidian's graph-view search field. */}
            <div className="absolute top-3 left-3 w-56">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search nodes…"
                aria-label="Search nodes"
                className="focus-ring w-full panel px-3 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] bg-[var(--color-surface)]/90 backdrop-blur"
              />
            </div>

            {/* Progress readout — where Graph Settings used to sit — plus the
                exam-mode pressure figure stacked beneath it. The latter is
                only ever present when this topic has a targetDate set;
                PressureReadout itself renders null otherwise, so the stack
                collapses to just the territory readout with no gap or empty
                chrome left behind. */}
            {stats && (
              <div className="absolute top-4 right-4 z-10 w-52 flex flex-col gap-3">
                <div className="panel p-3 flex flex-col gap-2 bg-[var(--color-surface)]/90 backdrop-blur">
                  <div className="fig-caption">Fig. — state of the territory</div>
                  <div className="grid grid-cols-2 gap-2">
                    <StatBlock compact label="Encoded" value={`${stats.encoded}/${stats.total}`} tone="cool" />
                    <StatBlock
                      compact
                      label="Consolidated"
                      value={`${Math.round((stats.consolidated / Math.max(1, stats.total)) * 100)}%`}
                      tone="warm"
                    />
                    <StatBlock compact label="Decaying" value={String(stats.decaying)} tone={stats.decaying > 0 ? 'violet' : 'neutral'} />
                    <StatBlock
                      compact
                      label="Thresholds"
                      value={`${stats.thresholdsMet}/${stats.thresholdsTotal}`}
                      tone={stats.thresholdsTotal > 0 && stats.thresholdsMet === stats.thresholdsTotal ? 'warm' : 'neutral'}
                    />
                  </div>
                </div>
                {graph && <PressureReadout graph={graph} receipts={receipts} targetDate={targetDate} />}
              </div>
            )}

            {/* Legend — glyph key mirroring the plate's own ink states. */}
            <div
              role="group"
              aria-label="Map legend"
              className="absolute bottom-3 left-3 panel bg-[var(--color-surface)]/90 backdrop-blur px-3 py-2 flex flex-col gap-1.5 text-[10px] label-data text-[var(--color-text-dim)]"
            >
              <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
                <defs>
                  <clipPath id="legend-half-clip">
                    <rect x={-10} y={0} width={20} height={10} />
                  </clipPath>
                </defs>
              </svg>
              <div className="flex items-center justify-between gap-3 pb-1 mb-0.5 border-b border-[var(--color-hairline)]">
                <span className="uppercase tracking-wide">Key</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setReplayActive((v) => !v)}
                    disabled={!growthTimeline}
                    title={growthTimeline ? undefined : 'Nothing dated yet to replay'}
                    aria-pressed={replayActive}
                    className={`focus-ring px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      replayActive
                        ? 'bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]'
                        : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    replay
                  </button>
                  <button
                    onClick={() => setDueLens((v) => !v)}
                    aria-pressed={dueLens && !replayActive}
                    disabled={replayActive}
                    title={replayActive ? 'One lens at a time — close the replay first' : undefined}
                    className={`focus-ring px-1.5 py-0.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      dueLens && !replayActive
                        ? 'bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]'
                        : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    due lens
                  </button>
                </div>
              </div>
              {/* Keyed on the same EFFECTIVE expression GraphView receives —
                  the legend must never explain a lens the plate isn't wearing
                  (replay forces the due lens off; see dueLens && !replayActive
                  at the GraphView call). */}
              {dueLens && !replayActive ? (
                <div className="flex flex-col divide-y divide-[var(--color-hairline)] [&>div]:py-1 first:[&>div]:pt-0 last:[&>div]:pb-0">
                  <div className="flex items-center gap-2">
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
                      <circle r={7.5} fill="none" stroke="var(--color-ink-danger)" strokeWidth={1.2} />
                      <path d={cellBodyPath('legend-overdue', 6)} fill="var(--color-ink-danger)" fillOpacity={0.85} />
                    </svg>
                    overdue
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
                      <path d={cellBodyPath('legend-due-today', 6)} fill="var(--color-ink-warm)" fillOpacity={0.85} />
                    </svg>
                    due today
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
                      <path d={cellBodyPath('legend-due-future', 6)} fill="none" stroke="var(--color-ink-cool-dim)" strokeWidth={1.2} />
                    </svg>
                    not yet due
                  </div>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-[var(--color-hairline)] [&>div]:py-1 first:[&>div]:pt-0 last:[&>div]:pb-0">
                  <div className="flex items-center gap-2">
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
                      <path d={cellBodyPath('legend-new', 6)} fill="none" stroke="var(--color-ink-cool-dim)" strokeWidth={1.2} />
                    </svg>
                    not started
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
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
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
                      <path d={cellBodyPath('legend-review', 6)} fill="var(--color-ink-warm)" fillOpacity={0.85} />
                    </svg>
                    consolidated
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
                      <path d={cellBodyPath('legend-threshold', 6)} fill="none" stroke="var(--color-ink-hot)" strokeWidth={1.2} strokeDasharray="3 2.5" />
                    </svg>
                    threshold
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
                      <path d={cellBodyPath('legend-frontier', 5)} fill="none" stroke="var(--color-ink-cool)" strokeWidth={1} />
                      <circle r={7.5} fill="none" stroke="var(--color-ink-warm)" strokeWidth={1} />
                    </svg>
                    learn next
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
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
                    <svg width={18} height={18} viewBox="-9 -9 18 18" aria-hidden="true">
                      <circle r={8} fill="none" stroke="var(--color-ink-warm)" strokeWidth={1} />
                      <path d={cellBodyPath('legend-capstone', 5)} fill="var(--color-ink-warm)" fillOpacity={0.85} />
                    </svg>
                    capstone seal
                  </div>
                </div>
              )}
              <div className="border-t border-[var(--color-hairline)] mt-1 pt-1 text-[var(--color-text-faint)]">
                double-click to open
              </div>
            </div>
            </div>
            )}
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

              {node.artifact && (
                <button
                  onClick={() => setExplorableNode(selectedNode)}
                  className="focus-ring self-start px-3 py-1.5 rounded-lg text-xs bg-[var(--color-surface-3)] text-[var(--color-ink-violet)] hover:bg-[var(--color-surface-2)]"
                >
                  Open explorable ↗
                </button>
              )}

              <div className={inkFlashNode === selectedNode ? 'annotation-ink-in' : undefined}>
                <MathRenderer
                  className="text-sm text-[var(--color-text-primary)] leading-snug"
                  text={annotations[selectedNode!]?.latexClaim ?? node.claim}
                />
              </div>

              <div className="panel-raised px-2.5 pt-2 pb-1.5 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="fig-caption">Fig. — decay, R(t)</span>
                  <span className="label-data text-[10px] text-[var(--color-text-faint)]">
                    s {node.fsrs.s != null ? `${node.fsrs.s.toFixed(1)}d` : '—'}
                  </span>
                </div>
                <RetentionCurve stabilityDays={node.fsrs.s} width={224} height={84} figure />
              </div>

              <div className="text-xs text-[var(--color-text-dim)]">
                <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1">Probe</div>
                <MathRenderer text={node.probe} />
              </div>

              {node.rubric.length > 0 && (
                <div className="text-xs text-[var(--color-text-dim)]">
                  <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1">Rubric</div>
                  <ul className="list-disc list-inside flex flex-col gap-0.5">
                    {node.rubric.map((r, i) => (
                      <li key={i}>
                        <MathRenderer className="inline" text={r} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <NodeMisconceptions
                items={openMisconceptionsFor(selectedTopic, selectedNode)}
                loaded={misconceptions !== null}
                error={misconceptionsError}
                compact
              />

              <NodeStructure
                requires={selectedStructure.requires}
                unlocks={selectedStructure.unlocks}
                hubRequiresCount={selectedStructure.hubRequiresCount}
                onSelect={setSelectedNode}
                compact
              />

              {provenance === null && <div className="fig-caption">reading provenance…</div>}
              {provenance !== null && (
                <ProvenanceBlock
                  entry={provenance[selectedNode!]}
                  onOpen={(ev) => openProvenanceEvent(ev, selectedTopic!)}
                  compact
                />
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

      <Modal open={Boolean(opened && openNode)} onClose={() => setOpenNode(null)} wide>
        {opened && openNode && (
          <div className="flex flex-col gap-4">
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

            <div className={inkFlashNode === openNode ? 'annotation-ink-in' : undefined}>
              <MathRenderer
                className="text-base text-[var(--color-text-primary)] leading-relaxed"
                text={annotations[openNode]?.latexClaim ?? opened.claim}
              />
            </div>

            <div className="panel-raised px-3 pt-2 pb-2 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="fig-caption">Fig. — decay, R(t)</span>
                <span className="label-data text-xs text-[var(--color-text-faint)]">
                  {opened.fsrs.s != null ? `stability ${opened.fsrs.s.toFixed(1)}d · ` : ''}
                  {opened.fsrs.reps} reps · {opened.fsrs.lapses} lapses
                </span>
              </div>
              <RetentionCurve stabilityDays={opened.fsrs.s} width={320} height={100} figure />
            </div>

            <div className="text-sm text-[var(--color-text-dim)]">
              <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1.5">
                Probe
              </div>
              <MathRenderer text={opened.probe} />
            </div>

            {opened.rubric.length > 0 && (
              <div className="text-sm text-[var(--color-text-dim)]">
                <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1.5">
                  Rubric
                </div>
                <ul className="list-disc list-inside flex flex-col gap-1">
                  {opened.rubric.map((r, i) => (
                    <li key={i}>
                      <MathRenderer className="inline" text={r} />
                    </li>
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
                    <li key={i}>
                      <MathRenderer className="inline" text={w} />
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {opened.transfer_probe && (
              <div className="text-sm text-[var(--color-text-dim)]">
                <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)] mb-1.5">
                  Transfer probe
                </div>
                <MathRenderer text={opened.transfer_probe} />
              </div>
            )}

            {/* 'requires' excluded here — Structure (below, alongside Provenance)
                covers it with the full root-first closure instead of just the
                direct edges, so this loop would otherwise duplicate it under
                an identically-worded "REQUIRES" header. */}
            {(['derives_from', 'contrasts_with', 'analogous_to'] as const).map(
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

            <NodeMisconceptions
              items={openMisconceptionsFor(selectedTopic, openNode)}
              loaded={misconceptions !== null}
              error={misconceptionsError}
              compact={false}
            />

            <NodeStructure
              requires={openedStructure.requires}
              unlocks={openedStructure.unlocks}
              hubRequiresCount={openedStructure.hubRequiresCount}
              onSelect={setOpenNode}
              compact={false}
            />

            {provenance === null && <div className="fig-caption">reading provenance…</div>}
            {provenance !== null && (
              <ProvenanceBlock
                entry={provenance[openNode]}
                onOpen={(ev) => openProvenanceEvent(ev, selectedTopic!)}
                compact={false}
              />
            )}

            {opened.artifact && (
              <button
                onClick={() => setExplorableNode(openNode)}
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
        )}
      </Modal>

      {explorableNode && graph?.nodes[explorableNode]?.artifact && (
        <ExplorableViewer
          path={graph.nodes[explorableNode].artifact!}
          nodeId={explorableNode}
          onClose={() => setExplorableNode(null)}
          onJumpToNode={(nodeId) => {
            setExplorableNode(null)
            setSelectedNode(nodeId)
          }}
        />
      )}

      <SessionHistoryDrawer
        historyKey={historyDrawer?.historyKey ?? ''}
        title={
          historyDrawer?.historyKey === 'review'
            ? 'Review'
            : topics.find((t) => t.topic === historyDrawer?.historyKey)?.title
        }
        open={historyDrawer !== null}
        onClose={() => setHistoryDrawer(null)}
        initialSessionId={historyDrawer?.sessionId}
        anchorIndex={historyDrawer?.anchorIndex}
      />
    </div>
  )
}
