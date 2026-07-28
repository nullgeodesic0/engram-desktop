import { useEffect, useMemo, useState } from 'react'
import type { ArtifactEntry, NodeProvenance, ReceiptsHistory, TopicGraph, TopicSummary } from '../../../shared/types'
import { RetentionCurve } from '../components/charts/RetentionCurve'
import { ActivityStrip } from '../components/charts/ActivityStrip'
import { CalibrationScatter } from '../components/charts/CalibrationScatter'
import { NodeTable } from '../components/NodeTable'
import { StatBlock } from '../components/ui/StatBlock'
import { PlateFigure } from '../components/ui/PlateFigure'
import { Button } from '../components/ui/Button'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { ArtifactTile } from '../components/ArtifactTile'
import { SkeletonBar, SkeletonGrid } from '../components/Skeleton'
import { SectionBanner } from '../components/ui/SectionBanner'
import { ExplorableViewer } from '../components/ExplorableViewer'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { allPicks } from '../shared/calibrationStore'
import { friendlyErrorText } from '../shared/friendlyError'
import {
  CALIBRATION_MIN_N,
  RANGE_OPTIONS,
  RETENTION_BUCKETS,
  bucketDisplay,
  computeCalibration,
  computeMomentum,
  computeRetentionBuckets,
  filterDaysByRange,
  rangeBounds,
  rangeCaption,
  topicDayActivity,
  topicWeekRetention,
  type RangeKey,
} from '../shared/topicMetrics'

/** Local YYYY-MM-DD → "Mon d, yyyy" — same local-midnight parse as
 * TopicMapView's formatProvenanceDate, never toISOString. */
function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      {/* `contents`: same accessibility-preserving wrap as DashboardView's
          identical Section helper (see its own doctrine comment) — a real
          `<h2>` landmark with zero box of its own, styling delegated whole to
          SectionBanner. */}
      <h2 className="contents">
        <SectionBanner label={title} />
      </h2>
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
    <div className="tilt-card panel px-4 py-3 flex flex-col gap-1 min-w-0">
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

  // Task 4: ONE range control for this surface. Governs the Retention
  // buckets/chart, the Activity/weekly-trend charts, and Calibration below —
  // never Momentum (see its own section comment: `computeMomentum` mirrors
  // the engine's compute_momentum field-for-field, including its hardcoded
  // 7-day window; two of its three rendered fields are current-graph-state
  // reads with no date-range meaning at all regardless). Default 'all' means
  // every number here shows exactly what it showed before this control
  // existed.
  const [rangeKey, setRangeKey] = useState<RangeKey>('all')
  const bounds = useMemo(() => rangeBounds(rangeKey), [rangeKey])
  const rangeText = rangeCaption(rangeKey, bounds)
  const daysInRange = useMemo(() => filterDaysByRange(history.days, bounds), [history, bounds])

  // Each of these sorts/re-groups `history.receipts` (every receipt this
  // install has ever written, unfiltered — see ReceiptsHistory's own doc
  // comment) down to one topic on every call; memoized so a re-render that
  // doesn't touch `history`/`graphs`/`topic`/the range (opening the node
  // table, toggling an artifact viewer) doesn't redo that work.
  //
  // `allBuckets` — UNfiltered by range, on purpose: it's what decides
  // whether this topic has EVER had a review/retrieval (see `hasActivity`
  // below), a question the range control must not be able to answer "no"
  // to just because the current window happens to be empty. `buckets` is
  // the range-filtered one the StatCards/chart actually render — `range`
  // only restricts WHICH REVIEWS are tallied, never which receipt counts as
  // a node's first (encoding) receipt, so a review from day 100 doesn't get
  // silently miscounted as a fresh day-0 encode just because its encoding
  // predates a narrow selected window (see computeRetentionBuckets's own
  // comment).
  const allBuckets = useMemo(() => computeRetentionBuckets(history.receipts, topic), [history, topic])
  const buckets = useMemo(() => computeRetentionBuckets(history.receipts, topic, bounds), [history, topic, bounds])
  // Momentum is NOT range-filtered — always the engine-mirrored last 7 days,
  // regardless of what's selected above (see the Momentum section's comment).
  const momentum = useMemo(() => computeMomentum(history.receipts, graphs, topic), [history, graphs, topic])
  const cal = useMemo(() => computeCalibration(daysInRange, allPicks(), topic), [daysInRange, topic])
  const days = useMemo(() => topicDayActivity(daysInRange, topic), [daysInRange, topic])
  const weeks = useMemo(() => topicWeekRetention(daysInRange, topic), [daysInRange, topic])
  // Whether this topic has EVER had a review/retrieval — deliberately the
  // same unwindowed, unranged population `allBuckets` is computed over
  // (every receipt ever written), not `days` (windowed to the last 180 days,
  // like ReceiptsHistory.days always is, and now also range-sliced). A topic
  // whose only activity predates that window has n>0 buckets but zero
  // windowed `days`; deriving this from `days` made the caption ("no reviews
  // yet") lie under real numbers. Also gates the whole Momentum section, not
  // just the Retention chart panel — a topic with no reviews at all has
  // nothing real to report in either section, and rendering five "— / no
  // reviews yet" cards plus an all-zero Momentum grid is exactly the empty
  // chrome this app's hidden-when-empty discipline exists to avoid.
  const hasActivity = useMemo(() => Object.values(allBuckets).some((b) => b.n > 0), [allBuckets])
  // Whether the SELECTED RANGE has any activity, given the topic has some
  // ever — the honest-blank case Task 4 asks for: a narrow range with zero
  // reviews in it must not render five dash cards implying zero learning,
  // it renders one caption saying so (see the Retention section below).
  const rangeHasActivity = useMemo(() => Object.values(buckets).some((b) => b.n > 0), [buckets])

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
          {/* The topic's key number as the briefing figure (ui/PlateFigure):
              how much of this territory is held in review — the warm,
              surviving-signal count — with the cool not-yet count on its
              title line and the danger due count as the note. Same three
              numbers the old label-data strip showed, same inks, re-set into
              the plate grammar. */}
          <PlateFigure
            value={topicSummary.states.review}
            tone="warm"
            title={
              <>
                in review · <span className="text-[var(--color-ink-cool)]">{topicSummary.states.new} new</span>
              </>
            }
            note={due > 0 ? <span className="text-[var(--color-ink-danger)]">{due} due now</span> : undefined}
          />
        </div>
        {hasActivity && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-[var(--color-text-dim)]">
              Range — <span className="label-data text-[var(--color-text-primary)]">{rangeText}</span>
            </div>
            <SegmentedControl
              options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={rangeKey}
              onChange={setRangeKey}
            />
          </div>
        )}
      </header>

      <Section title="Retention">
        {!hasActivity ? (
          <div className="fig-caption">no reviews yet for this topic</div>
        ) : !rangeHasActivity ? (
          <div className="fig-caption">no reviews in the selected range ({rangeText})</div>
        ) : (
          <>
            <div className="fig-caption">Reflects: {rangeText}</div>
            <div className="grid grid-cols-5 gap-2">
              {RETENTION_BUCKETS.map(([name]) => {
                const { value, caption, tone } = bucketDisplay(buckets[name])
                return <StatCard key={name} label={name} value={value} sub={caption} tone={tone} />
              })}
            </div>
            <div className="tilt-card panel px-4 py-4 flex flex-col gap-5 mt-1">
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
          <>
            {/* Always the engine-mirrored last N days, regardless of the range
                control above — `computeMomentum` mirrors engram.py's
                compute_momentum field-for-field, including its hardcoded
                window, and "Most durable" is a current-graph-state read with
                no date-range meaning at all (see topicMetrics.ts's "date
                range" header comment). */}
            <div className="fig-caption mb-1">Always the last {momentum.windowDays} days — not affected by the range above.</div>
            <div className="grid grid-cols-3 gap-3">
              <StatBlock label={`Reviews (${momentum.windowDays}d)`} value={String(momentum.reviewsWindow)} />
              <StatBlock label="Stability gained" value={`+${momentum.stabilityGainedWindow.toFixed(0)}d`} tone="warm" />
              <StatBlock
                label="Most durable"
                value={momentum.mostDurable ? `${momentum.mostDurable.stabilityDays.toFixed(0)}d` : '—'}
                caption={momentum.mostDurable ? humanizeNodeId(momentum.mostDurable.node) : undefined}
              />
            </div>
          </>
        )}
      </Section>

      <Section title="Calibration">
        {cal.total === 0 ? (
          <div className="fig-caption">no paired picks yet for this topic ({rangeText})</div>
        ) : cal.total < CALIBRATION_MIN_N ? (
          <div className="fig-caption">
            too few paired picks to rate yet (n={cal.total}, need {CALIBRATION_MIN_N}) — {rangeText}
          </div>
        ) : (
          <>
            <div className="fig-caption">Reflects: {rangeText}</div>
            <div className="grid grid-cols-3 gap-3">
              <StatBlock label="Overconfident" value={String(cal.overconfident)} tone="warm" />
              <StatBlock label="Underconfident" value={String(cal.underconfident)} tone="cool" />
              <StatBlock label="Calibrated" value={String(cal.calibrated)} tone="neutral" />
            </div>
            <div className="fig-caption">Fig. — how your felt-sense tracks the assessor, this topic only</div>
            <div className="tilt-card panel px-4 py-4 mt-1">
              <CalibrationScatter data={{ picks: cal.picks, days: daysInRange }} />
            </div>
          </>
        )}
      </Section>

      <Section title="Nodes">
        {graph ? (
          <div className="tilt-card panel h-[420px]">
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
