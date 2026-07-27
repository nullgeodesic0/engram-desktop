import { useEffect, useMemo, useState } from 'react'
import type { EngramStats, ReceiptsHistory, ReceiptItem, TopicGraph, TopicListEntry, ActiveExperiment } from '../../../shared/types'
import { CoachSessionPanel } from '../components/CoachSessionPanel'
import { SkeletonBar, SkeletonGrid } from '../components/Skeleton'
import { StreakCalendar } from '../components/StreakCalendar'
import { RetentionTrend } from '../components/RetentionTrend'
import { RetentionCurve } from '../components/charts/RetentionCurve'
import { ActivityStrip } from '../components/charts/ActivityStrip'
import { CalibrationScatter } from '../components/charts/CalibrationScatter'
import { WeekDigest } from '../components/WeekDigest'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { StatBlock } from '../components/ui/StatBlock'
import { DendriteDivider } from '../components/ui/DendriteDivider'
import { Button } from '../components/ui/Button'
import { allPicks } from '../shared/calibrationStore'
import { computeWeekDigest } from '../shared/weekDigest'
import { friendlyErrorText } from '../shared/friendlyError'
import { MisconceptionLedger } from '../components/MisconceptionLedger'
import { GraderAudit } from '../components/GraderAudit'
import { ExperimentBanner } from '../components/ExperimentBanner'
import { TopicDrilldownView } from './TopicDrilldownView'
import {
  RANGE_OPTIONS,
  computeCalibration,
  filterDaysByRange,
  rangeBounds,
  rangeCaption,
  topicWeekRetention,
  type RangeKey,
} from '../shared/topicMetrics'
import { SegmentedControl } from '../components/ui/SegmentedControl'

function gradeColor(grade: string | null): string {
  if (grade === 'recalled') return 'var(--color-ink-warm)'
  if (grade === 'partial') return 'var(--color-ink-cool)'
  if (grade === 'lapsed') return 'var(--color-ink-danger)'
  return 'var(--color-text-faint)'
}

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-[var(--color-text-dim)] uppercase tracking-wide">{title}</h2>
      <DendriteDivider className="mb-3" />
      {children}
    </section>
  )
}

interface DashboardViewProps {
  /** Routes the first-run empty state's one action to the Learn view — every
   * stat below reads as noise (all zeros, no history) before a single topic exists. */
  onNewTopic?: () => void
  /** Deep-links a misconception ledger row to that node's map entry — the
   * same goToNode plumbing App.tsx wires from the command palette, threaded
   * through here rather than the ledger inventing its own navigation. */
  onGoNode?: (topicId: string, nodeId: string) => void
  /** "See all in Artifacts" from a topic drilldown's artifact tiles — routes
   * to the full gallery tab. Threaded down to TopicDrilldownView, never used
   * directly here. */
  onGoArtifacts?: () => void
}

export function DashboardView({ onNewTopic, onGoNode, onGoArtifacts }: DashboardViewProps = {}) {
  const [stats, setStats] = useState<EngramStats | null>(null)
  const [history, setHistory] = useState<ReceiptsHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ label: string; items: ReceiptItem[] } | null>(null)
  const [graphs, setGraphs] = useState<Record<string, TopicGraph> | null>(null)
  // `stats.topics[]` (compute_stats) is `{topic, title, states}` only — the
  // engine's own `due` count lives in `engram.py topics` instead (cmd_topics
  // computes it fresh against today's date). Fetched separately so the "N
  // due" chip on a topic row, and the same number handed to the drilldown
  // header, are real rather than permanently `undefined > 0`. Already the
  // pattern `window.engram.topics()` — HomeView, TopicMapView, LearnSessionView
  // all call it the same way, and it's mtime-cached (topicsCache.ts), so this
  // is not a second parallel fetch of anything expensive.
  const [topicsList, setTopicsList] = useState<TopicListEntry[] | null>(null)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [activeExperiment, setActiveExperiment] = useState<ActiveExperiment | null>(null)
  // Which topic's drilldown is open, if any — a view swap within this same
  // tab (KeepMounted in App.tsx keeps this state alive across tab switches),
  // never a route of its own. Clicking a Topics row sets this; the
  // drilldown's own "Coach" button clears it.
  const [openTopic, setOpenTopic] = useState<string | null>(null)

  // Task 4: ONE range control for this whole surface. Governs Activity,
  // weekly trend, and Calibration below (all receipt-derived) — never the
  // Retention/Momentum StatCards above, which read `stats.retention`/
  // `stats.momentum` (the engine's own fixed windows; see topicMetrics.ts's
  // "date range" header comment for the full boundary and why). Default
  // 'all' means every chart shows exactly what it showed before this
  // control existed.
  const [rangeKey, setRangeKey] = useState<RangeKey>('all')
  const bounds = useMemo(() => rangeBounds(rangeKey), [rangeKey])
  const rangeText = rangeCaption(rangeKey, bounds)
  const daysInRange = useMemo(() => filterDaysByRange(history?.days ?? [], bounds), [history, bounds])
  // Weekly rollup re-derived from the (possibly range-sliced) days, through
  // the SAME function TopicDrilldownView already uses for its own weekly
  // chart — not `history.weeks` (the main process's own pre-aggregation),
  // which has no range parameter. Verified once against real data that this
  // reproduces `history.weeks` exactly when unfiltered (task-4-report.md).
  const weeksInRange = useMemo(() => topicWeekRetention(daysInRange), [daysInRange])

  useEffect(() => {
    window.engram
      .stats()
      .then((s) => {
        setStats(s)
        // stats.active_experiment is only ever the experiment's question
        // string (or null) — see engram.py's compute_stats. Gate the richer
        // fetch (started date, arms) on that so a fresh install with no
        // experiment ever run never pays a second subprocess call for this.
        if (typeof s.active_experiment === 'string' && s.active_experiment.length > 0) {
          window.engram.activeExperiment().then(setActiveExperiment)
        }
      })
      .catch((e: Error) => setError(e.message))
    window.engram.receiptsHistory().then(setHistory)
    window.engram.topics().then(setTopicsList)
  }, [])

  // topic -> due count, from `engram.py topics` (see topicsList's own doc
  // comment) — `stats.topics[]` never carries this field.
  const dueByTopic = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of topicsList ?? []) map.set(t.topic, t.due)
    return map
  }, [topicsList])

  // Topic graphs, fetched once stats names the topics — only used for the
  // weekly digest's threshold-flag lookup (WeekDigest reads `graphs`, not
  // this effect's inputs directly), so it's fine for this to resolve after
  // the first paint.
  useEffect(() => {
    if (!stats) return
    let cancelled = false
    Promise.all(
      stats.topics.map(async (t) => {
        try {
          const g = (await window.engram.topicGraph(t.topic)) as TopicGraph
          return [t.topic, g] as const
        } catch {
          return null
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      const map: Record<string, TopicGraph> = {}
      for (const entry of entries) {
        if (entry) map[entry[0]] = entry[1]
      }
      setGraphs(map)
    })
    return () => {
      cancelled = true
    }
  }, [stats])

  const weekDigest = useMemo(() => {
    if (!history || !graphs) return null
    return computeWeekDigest({ days: history.days, weeks: history.weeks, picks: allPicks(), graphs })
  }, [history, graphs])

  // computeCalibration re-sorts/re-joins every local pick against every
  // receipt day — cheap today, but there is no reason to redo it on every
  // render (a StatCard hover, an unrelated setState) rather than once per
  // `history`/range change. Retention/Momentum no longer need this
  // treatment: they read `stats.retention`/`stats.momentum` directly now
  // (F1), which is already-computed data, not a render-body computation.
  // `daysInRange` (Task 4) — passing the range-filtered day set here is
  // enough to scope the whole join: a pick whose own local day isn't a key
  // in `daysInRange` simply finds no match and is dropped, correctly.
  const cal = useMemo(() => (history ? computeCalibration(daysInRange, allPicks()) : null), [history, daysInRange])

  if (error) {
    const fe = friendlyErrorText(error)
    return (
      <div className="p-8">
        <div className="panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)]">
          <div>Couldn’t read Engram state: {fe.headline}</div>
          {fe.detail && (
            <details className="mt-1 text-xs text-[var(--color-text-faint)]">
              <summary className="cursor-pointer">raw error</summary>
              <div className="mt-1">{fe.detail}</div>
            </details>
          )}
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="p-8 flex flex-col gap-8 w-full h-full overflow-y-auto">
        <header className="flex flex-col gap-2">
          <SkeletonBar width={140} height={26} />
          <SkeletonBar width={280} height={14} />
        </header>
        <SkeletonGrid count={3} />
        <SkeletonGrid count={5} />
      </div>
    )
  }

  // A topic's own page — swaps in for the whole tab (a view, not a modal;
  // "Coach" in the sidebar stays active throughout). `history`/`graphs` load
  // slightly after `stats`, so a topic clicked in that gap gets a lightweight
  // loading state with the same "back" affordance rather than the drilldown
  // demanding data it can't have yet.
  if (openTopic) {
    const topicSummary = stats.topics.find((t) => t.topic === openTopic)
    if (history && graphs && topicSummary) {
      return (
        <TopicDrilldownView
          topic={openTopic}
          topicSummary={topicSummary}
          due={dueByTopic.get(openTopic) ?? 0}
          history={history}
          graphs={graphs}
          onBack={() => setOpenTopic(null)}
          onGoNode={onGoNode}
          onGoArtifacts={onGoArtifacts}
        />
      )
    }
    return (
      <div className="p-8 flex flex-col gap-4 w-full h-full overflow-y-auto">
        <Button variant="ghost" onClick={() => setOpenTopic(null)} className="self-start">
          ← Coach
        </Button>
        <SkeletonBar width={200} height={26} />
        <SkeletonGrid count={3} />
      </div>
    )
  }

  // Narration order mirrors /coach: loop-closure gate first, then grader-health,
  // retention, transfer, calibration, momentum, misconceptions, backlog.
  const loopClosure = stats.adherence.loop_closure

  return (
    <div className="p-8 flex flex-col gap-8 w-full h-full overflow-y-auto">
      <header className="flex flex-col gap-3">
        <h1 className="font-[var(--font-display)] text-2xl text-[var(--color-text-primary)]">Coach</h1>
        <div className="grid grid-cols-3 gap-3">
          <StatBlock label="Due now" value={String(stats.due_now)} />
          <StatBlock label="Pending grading" value={String(stats.pending_verify)} />
          <StatBlock label="Streak" value={`${stats.streak_days}d`} />
        </div>
      </header>

      <ExperimentBanner experiment={activeExperiment} />

      {stats.topics.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-10">
          <div className="fig-caption">Fig. — nothing to coach yet</div>
          <div className="font-[var(--font-serif)] text-[length:var(--text-display)] text-[var(--color-text-primary)]">
            Coaching starts once you do.
          </div>
          <p className="text-sm text-[var(--color-text-dim)] max-w-md">
            Loop closure, retention, calibration, and momentum all read from real sessions — they’ll fill in once your
            first topic has some.
          </p>
          {onNewTopic && <Button variant="primary" onClick={onNewTopic}>Start your first topic</Button>}
        </div>
      ) : (
        <>
      {history === null && (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="panel px-4 py-4 flex flex-col gap-3">
              <SkeletonBar width="55%" height={12} />
              <SkeletonBar height={90} />
            </div>
          ))}
        </div>
      )}

      {/* This install has SOME history ever — the gate above stays unfiltered
          by design: narrowing the range to an empty window should show the
          honest blank inside these panels (each chart component already
          falls back to its own "no activity"/"not enough reviews yet"
          caption when handed empty data), not hide the whole surface as if
          this were a fresh install. */}
      {history && (history.days.some((d) => d.count > 0) || history.weeks.some((w) => w.total > 0)) && (
        <>
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
          <div className="grid grid-cols-2 gap-4">
            <div className="panel px-4 py-4 flex flex-col gap-3">
              <div className="text-xs font-medium text-[var(--color-text-dim)] uppercase tracking-wide">
                Activity, {rangeText}
              </div>
              <StreakCalendar
                days={daysInRange}
                onSelectDay={(day) => setDetail({ label: day.date, items: day.items })}
              />
            </div>
            <div className="panel px-4 py-4 flex flex-col gap-3">
              <div className="text-xs font-medium text-[var(--color-text-dim)] uppercase tracking-wide">
                Recall rate, weekly
              </div>
              <RetentionTrend
                weeks={weeksInRange}
                days={daysInRange}
                onSelectWeek={(weekStart, items) => setDetail({ label: `Week of ${weekStart}`, items })}
              />
            </div>
          </div>

          {detail && (
            <div className="panel px-4 py-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-[var(--color-text-dim)] uppercase tracking-wide">
                  {detail.label} · {detail.items.length} item{detail.items.length === 1 ? '' : 's'}
                </div>
                <button
                  onClick={() => setDetail(null)}
                  className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] text-sm leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                {detail.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: gradeColor(item.grade) }} />
                      <span className="text-[var(--color-text-primary)] truncate">{humanizeNodeId(item.node)}</span>
                      <span className="label-data text-[10px] text-[var(--color-text-faint)] truncate">{item.topic}</span>
                    </div>
                    <span className="text-xs text-[var(--color-text-dim)] shrink-0">{item.grade ?? '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <CoachSessionPanel />

      <Section title="Loop closure">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Encoded past due" value={String(loopClosure.encoded_past_due)} />
          <StatCard label="First review done" value={String(loopClosure.first_review_done)} />
          <StatCard
            label="Closure rate"
            value={`${Math.round(loopClosure.rate * 100)}%`}
            tone={loopClosure.rate >= 0.9 ? 'warm' : loopClosure.rate < 0.5 ? 'danger' : 'default'}
          />
        </div>
      </Section>

      <Section title="Grader health">
        <GraderAudit />
      </Section>

      <Section title="This week">
        <WeekDigest digest={weekDigest} />
      </Section>

      <Section title="Retention">
        {/* Straight from the engine's own compute_retention — the oracle,
            never shared/topicMetrics.ts's port (that stays scoped to the
            per-topic drilldown, which has no engine equivalent to read
            instead). See topicMetrics.ts's header comment and
            scripts/checkTopicMetricsAgreement.ts, which is what keeps the
            port from silently drifting off this number. */}
        <div className="grid grid-cols-5 gap-2">
          {Object.entries(stats.retention.buckets).map(([bucket, b]) => (
            <StatCard
              key={bucket}
              label={bucket}
              value={b.rate != null ? `${Math.round(b.rate * 100)}%` : '—'}
              sub={`n=${b.n}`}
              tone={b.rate == null ? 'dim' : b.rate >= 0.85 ? 'warm' : b.rate < 0.6 ? 'danger' : 'default'}
            />
          ))}
        </div>
        {/* The range control above the Activity panel doesn't reach the
            cards above — they're the engine's own fixed windows (stats.
            retention.buckets), never re-scoped from the app (see
            topicMetrics.ts's "date range" header comment). Said in words
            here so a filtered chart just below never gets mistaken for a
            filtered StatCard above it. */}
        <div className="fig-caption mt-1">n/rate above are the engine's own fixed windows — not affected by the range.</div>
        {history === null ? (
          <div className="panel px-4 py-4 flex flex-col gap-4 mt-1">
            <SkeletonBar width="45%" height={12} />
            <SkeletonBar height={90} />
            <SkeletonBar width="40%" height={12} />
            <SkeletonBar height={50} />
          </div>
        ) : (
          <div className="panel px-4 py-4 flex flex-col gap-5 mt-1">
            <div className="fig-caption">Chart below reflects: {rangeText}</div>
            <RetentionCurve data={weeksInRange} />
            <ActivityStrip data={daysInRange} />
          </div>
        )}
      </Section>

      <Section title="Momentum">
        {/* stats.momentum — the engine's own compute_momentum, not the port
            (see the Retention section's comment above; same doctrine).
            Always the engine's own 7-day window, regardless of the range
            control above: momentum's meaning IS "the last 7 days," the same
            way it is in engram.py, and two of its three numbers below
            (stability gained, most durable) are graph-state reads with no
            date-range concept at all — see topicMetrics.ts's header comment. */}
        <div className="fig-caption mb-1">Always the engine's own last {stats.momentum.window_days} days — not affected by the range above.</div>
        <div className="grid grid-cols-3 gap-3">
          <StatBlock label={`Reviews (${stats.momentum.window_days}d)`} value={String(stats.momentum.reviews_7d)} />
          <StatBlock label="Stability gained" value={`+${stats.momentum.stability_gained_7d.toFixed(0)}d`} tone="warm" />
          <StatBlock
            label="Most durable"
            value={stats.momentum.most_durable ? `${stats.momentum.most_durable.stability_days.toFixed(0)}d` : '—'}
            caption={stats.momentum.most_durable ? humanizeNodeId(stats.momentum.most_durable.node) : undefined}
          />
        </div>
      </Section>

      <Section title="Calibration">
        {history == null || cal == null ? (
          <SkeletonBar width="60%" height={14} />
        ) : cal.total === 0 ? (
          <div className="fig-caption">no paired picks yet ({rangeText})</div>
        ) : (
          <>
            <div className="fig-caption">Reflects: {rangeText}</div>
            <div className="grid grid-cols-3 gap-3">
              <StatBlock label="Overconfident" value={String(cal.overconfident)} tone="warm" />
              <StatBlock label="Underconfident" value={String(cal.underconfident)} tone="cool" />
              <StatBlock label="Calibrated" value={String(cal.calibrated)} tone="neutral" />
            </div>
            <div className="fig-caption">Fig. — how your felt-sense tracks the assessor</div>
            <div className="panel px-4 py-4 mt-1">
              <CalibrationScatter data={{ picks: cal.picks, days: daysInRange }} />
            </div>
          </>
        )}
      </Section>

      <Section title="Topics">
        <div className="flex flex-col gap-2">
          {stats.topics.map((t) => {
            const due = dueByTopic.get(t.topic) ?? 0
            return (
              <button
                key={t.topic}
                onClick={() => setOpenTopic(t.topic)}
                className="focus-ring panel px-4 py-3 flex items-center justify-between text-left w-full hover:border-[var(--color-text-faint)] transition-colors"
              >
                <div>
                  <div className="text-sm text-[var(--color-text-primary)]">{t.title}</div>
                  <div className="label-data text-xs text-[var(--color-text-faint)]">{t.topic}</div>
                </div>
                <div className="flex gap-4 text-xs label-data">
                  <span className="text-[var(--color-ink-warm)]">{t.states.review} review</span>
                  <span className="text-[var(--color-ink-cool)]">{t.states.new} new</span>
                  {due > 0 && <span className="text-[var(--color-ink-danger)]">{due} due</span>}
                </div>
              </button>
            )
          })}
        </div>
      </Section>

      {stats.misconceptions_open > 0 && (
        <Section title="Misconceptions">
          <button
            onClick={() => setLedgerOpen(true)}
            className="focus-ring panel px-4 py-3 flex items-center justify-between gap-3 w-full text-left hover:border-[var(--color-text-faint)] transition-colors"
          >
            <span className="text-sm text-[var(--color-text-primary)]">
              {stats.misconceptions_open} open — noticed along the way, filed for re-testing.
            </span>
            <span className="text-xs text-[var(--color-ink-warm)] shrink-0">View →</span>
          </button>
        </Section>
      )}
        </>
      )}

      <MisconceptionLedger open={ledgerOpen} onClose={() => setLedgerOpen(false)} onGoNode={onGoNode} />
    </div>
  )
}
