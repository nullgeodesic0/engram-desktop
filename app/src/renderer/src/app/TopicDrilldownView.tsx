import { useEffect, useMemo, useState } from 'react'
import type { ArtifactEntry, NodeProvenance, ReceiptsHistory, TopicGraph, TopicSummary } from '../../../shared/types'
import { RetentionCurve } from '../components/charts/RetentionCurve'
import { ActivityStrip } from '../components/charts/ActivityStrip'
import { CalibrationScatter } from '../components/charts/CalibrationScatter'
import { NodeTable } from '../components/NodeTable'
import { StatBlock } from '../components/ui/StatBlock'
import { Button } from '../components/ui/Button'
import { ArtifactTile } from '../components/ArtifactTile'
import { DendriteDivider } from '../components/ui/DendriteDivider'
import { SkeletonBar, SkeletonGrid } from '../components/Skeleton'
import { ExplorableViewer } from '../components/ExplorableViewer'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { allPicks } from '../shared/calibrationStore'
import { friendlyErrorText } from '../shared/friendlyError'
import {
  CALIBRATION_MIN_N,
  RETENTION_BUCKETS,
  bucketDisplay,
  computeCalibration,
  computeMomentum,
  computeRetentionBuckets,
  topicDayActivity,
  topicWeekRetention,
} from '../shared/topicMetrics'

/** Local YYYY-MM-DD → "Mon d, yyyy" — same local-midnight parse as
 * TopicMapView's formatProvenanceDate, never toISOString. */
function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-[var(--color-text-dim)] uppercase tracking-wide">{title}</h2>
      <DendriteDivider className="mb-3" />
      {children}
    </section>
  )
}

/** Same shape as DashboardView's own StatCard — kept local to this file (same
 * pattern DashboardView itself uses; not worth a shared export for a five-line
 * presentational wrapper two files use identically). */
function StatCard({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'warm' | 'danger' | 'dim' }) {
  const valueColor =
    tone === 'warm'
      ? 'text-[var(--color-ink-warm)]'
      : tone === 'danger'
        ? 'text-[var(--color-ink-danger)]'
        : tone === 'dim'
          ? 'text-[var(--color-text-dim)]'
          : 'text-[var(--color-text-primary)]'
  return (
    <div className="panel px-4 py-3 flex flex-col gap-1 min-w-0">
      <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wide">{label}</div>
      <div className={`label-data text-2xl font-medium ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--color-text-faint)]">{sub}</div>}
    </div>
  )
}

/** Aggregate read of `nodeProvenance(topic)` — how much of the graph has ever
 * been touched, and when, without repeating the per-node ProvenanceBlock
 * TopicMapView already owns (that stays the one place a single node's history
 * renders). `null` while loading; an entry with nothing at all (a topic just
 * created, never opened in a session yet) renders as hidden-when-empty. */
function provenanceSummary(provenance: Record<string, NodeProvenance>): {
  encoded: number
  reviewed: number
  totalReviews: number
  lastTouched: string | null
} {
  let encoded = 0
  let reviewed = 0
  let totalReviews = 0
  let lastTouched: string | null = null
  for (const entry of Object.values(provenance)) {
    if (entry.firstEncoded) {
      encoded++
      if (!lastTouched || entry.firstEncoded.date > lastTouched) lastTouched = entry.firstEncoded.date
    }
    if (entry.reviews.length > 0) reviewed++
    totalReviews += entry.reviews.length
    for (const r of entry.reviews) {
      if (!lastTouched || r.date > lastTouched) lastTouched = r.date
    }
  }
  return { encoded, reviewed, totalReviews, lastTouched }
}

interface TopicDrilldownViewProps {
  topic: string
  topicSummary: TopicSummary
  /** This topic's due-now count — from `engram.py topics` (DashboardView's
   * `dueByTopic`), NOT `topicSummary.due`: `topicSummary` comes from
   * `stats.topics[]` (compute_stats), which only ever sends
   * `{topic, title, states}` — no `due` field exists there to read. */
  due: number
  /** Already fetched by DashboardView (one `receiptsHistory()` call powers
   * both scopes) — see shared/topicMetrics.ts's header comment. */
  history: ReceiptsHistory
  /** Already fetched by DashboardView for the week digest; `graphs[topic]`
   * may briefly be absent if this topic's own fetch hasn't resolved yet. */
  graphs: Record<string, TopicGraph>
  onBack: () => void
  /** Jump to a node in the full Topic Map — same plumbing App.tsx's
   * goToNode already wires everywhere else (MisconceptionLedger, Artifacts,
   * the command palette). This view never opens a second node-detail surface
   * of its own; the table hands off to the one that already exists. */
  onGoNode?: (topicId: string, nodeId: string) => void
  /** "See all in Artifacts" for this topic's tiles — routes to the full
   * gallery rather than this panel growing its own search/filter (that's
   * Task 3's surface). */
  onGoArtifacts?: () => void
}

/** A topic's own page — retention, calibration, and momentum computed over
 * ONLY this topic's receipts, plus its node table, a provenance summary, and
 * its artifacts. Every number here is computed by the SAME functions
 * (shared/topicMetrics.ts) DashboardView calls with no topic filter — this
 * file supplies the filter, never a second implementation. A view, not a
 * modal: reached by clicking a topic row in Coach, left by the button below,
 * with no route of its own in App.tsx. */
export function TopicDrilldownView({ topic, topicSummary, due, history, graphs, onBack, onGoNode, onGoArtifacts }: TopicDrilldownViewProps) {
  const [provenance, setProvenance] = useState<Record<string, NodeProvenance> | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactEntry[] | null>(null)
  const [artifactsError, setArtifactsError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<ArtifactEntry | null>(null)

  useEffect(() => {
    let cancelled = false
    setProvenance(null)
    window.engram
      .nodeProvenance(topic)
      .then((p) => {
        if (!cancelled) setProvenance(p)
      })
      .catch(() => {
        if (!cancelled) setProvenance({})
      })
    return () => {
      cancelled = true
    }
  }, [topic])

  useEffect(() => {
    let cancelled = false
    window.engram
      .artifactList()
      .then((all) => {
        if (!cancelled) setArtifacts(all.filter((a) => a.topic === topic))
      })
      .catch((e: Error) => {
        if (!cancelled) setArtifactsError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [topic])

  const graph = graphs[topic]
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  // Each of these sorts/re-groups `history.receipts` (every receipt this
  // install has ever written, unfiltered — see ReceiptsHistory's own doc
  // comment) down to one topic on every call; memoized so a re-render that
  // doesn't touch `history`/`graphs`/`topic` (opening the node table,
  // toggling an artifact viewer) doesn't redo that work.
  const buckets = useMemo(() => computeRetentionBuckets(history.receipts, topic), [history, topic])
  const momentum = useMemo(() => computeMomentum(history.receipts, graphs, topic), [history, graphs, topic])
  const cal = useMemo(() => computeCalibration(history.days, allPicks(), topic), [history, topic])
  const days = useMemo(() => topicDayActivity(history.days, topic), [history, topic])
  const weeks = useMemo(() => topicWeekRetention(history.days, topic), [history, topic])
  // Whether this topic has EVER had a review/retrieval — deliberately the
  // same unwindowed population `buckets` is computed over (every receipt
  // ever written), not `days` (windowed to the last 180 days, like
  // ReceiptsHistory.days always is). A topic whose only activity predates
  // that window has n>0 buckets but zero windowed `days`; deriving this from
  // `days` made the caption ("no reviews yet") lie under real numbers. Also
  // gates the whole Momentum section, not just the Retention chart panel —
  // a topic with no reviews at all has nothing real to report in either
  // section, and rendering five "— / no reviews yet" cards plus an all-zero
  // Momentum grid is exactly the empty chrome this app's hidden-when-empty
  // discipline exists to avoid.
  const hasActivity = useMemo(() => Object.values(buckets).some((b) => b.n > 0), [buckets])

  return (
    <div className="p-8 flex flex-col gap-8 w-full h-full overflow-y-auto">
      <header className="flex flex-col gap-3">
        <Button variant="ghost" onClick={onBack} className="self-start">
          ← Coach
        </Button>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-[var(--font-serif)] text-[length:var(--text-display)] text-[var(--color-text-primary)]">
              {topicSummary.title}
            </h1>
            <div className="label-data text-xs text-[var(--color-text-faint)] mt-1">{topic}</div>
          </div>
          <div className="flex gap-4 text-xs label-data">
            <span className="text-[var(--color-ink-warm)]">{topicSummary.states.review} review</span>
            <span className="text-[var(--color-ink-cool)]">{topicSummary.states.new} new</span>
            {due > 0 && <span className="text-[var(--color-ink-danger)]">{due} due</span>}
          </div>
        </div>
      </header>

      <Section title="Retention">
        {!hasActivity ? (
          <div className="fig-caption">no reviews yet for this topic</div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-2">
              {RETENTION_BUCKETS.map(([name]) => {
                const { value, caption, tone } = bucketDisplay(buckets[name])
                return <StatCard key={name} label={name} value={value} sub={caption} tone={tone} />
              })}
            </div>
            <div className="panel px-4 py-4 flex flex-col gap-5 mt-1">
              <RetentionCurve data={weeks} />
              <ActivityStrip data={days} />
            </div>
          </>
        )}
      </Section>

      <Section title="Momentum">
        {!hasActivity ? (
          <div className="fig-caption">no reviews yet for this topic</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <StatBlock label={`Reviews (${momentum.windowDays}d)`} value={String(momentum.reviewsWindow)} />
            <StatBlock label="Stability gained" value={`+${momentum.stabilityGainedWindow.toFixed(0)}d`} tone="warm" />
            <StatBlock
              label="Most durable"
              value={momentum.mostDurable ? `${momentum.mostDurable.stabilityDays.toFixed(0)}d` : '—'}
              caption={momentum.mostDurable ? humanizeNodeId(momentum.mostDurable.node) : undefined}
            />
          </div>
        )}
      </Section>

      <Section title="Calibration">
        {cal.total === 0 ? (
          <div className="fig-caption">no paired picks yet for this topic</div>
        ) : cal.total < CALIBRATION_MIN_N ? (
          <div className="fig-caption">
            too few paired picks to rate yet (n={cal.total}, need {CALIBRATION_MIN_N})
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <StatBlock label="Overconfident" value={String(cal.overconfident)} tone="warm" />
              <StatBlock label="Underconfident" value={String(cal.underconfident)} tone="cool" />
              <StatBlock label="Calibrated" value={String(cal.calibrated)} tone="neutral" />
            </div>
            <div className="fig-caption">Fig. — how your felt-sense tracks the assessor, this topic only</div>
            <div className="panel px-4 py-4 mt-1">
              <CalibrationScatter data={{ picks: cal.picks, days: history.days }} />
            </div>
          </>
        )}
      </Section>

      <Section title="Nodes">
        {graph ? (
          <div className="panel h-[420px]">
            <NodeTable graph={graph} selectedNode={selectedNode} onSelectNode={(id) => (onGoNode ? onGoNode(topic, id) : setSelectedNode(id))} />
          </div>
        ) : (
          <SkeletonBar height={200} />
        )}
      </Section>

      {provenance !== null && (() => {
        const summary = provenanceSummary(provenance)
        if (summary.encoded === 0) return null
        const totalNodes = graph ? Object.keys(graph.nodes).length : summary.encoded
        return (
          <Section title="Provenance">
            <div className="grid grid-cols-3 gap-3">
              <StatBlock label="Encoded" value={`${summary.encoded}/${totalNodes}`} />
              <StatBlock label="Reviewed at least once" value={String(summary.reviewed)} />
              <StatBlock
                label="Last touched"
                value={summary.lastTouched ? formatDate(summary.lastTouched) : '—'}
                caption={`${summary.totalReviews} review${summary.totalReviews === 1 ? '' : 's'} on record`}
              />
            </div>
          </Section>
        )
      })()}

      {artifactsError && (() => {
        const fe = friendlyErrorText(artifactsError)
        return (
          <div className="panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)]">
            {fe.headline}
          </div>
        )
      })()}

      {artifacts === null && !artifactsError && <SkeletonGrid count={3} />}

      {artifacts !== null && artifacts.length > 0 && (
        <Section title="Artifacts">
          <div className="grid grid-cols-3 gap-4">
            {artifacts.map((a) => (
              <ArtifactTile
                key={`${a.topic}:${a.node}`}
                artifact={a}
                provenance={provenance?.[a.node]}
                showTopic={false}
                onOpen={setViewing}
              />
            ))}
          </div>
          {onGoArtifacts && (
            <Button variant="ghost" onClick={onGoArtifacts} className="self-start">
              See all in Artifacts →
            </Button>
          )}
        </Section>
      )}

      {viewing && (
        <ExplorableViewer
          path={viewing.artifact}
          nodeId={viewing.node}
          onClose={() => setViewing(null)}
          onJumpToNode={onGoNode ? (nodeId) => onGoNode(topic, nodeId) : undefined}
        />
      )}
    </div>
  )
}
