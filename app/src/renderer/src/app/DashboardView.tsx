import { useEffect, useMemo, useState } from 'react'
import type { EngramStats, ReceiptsHistory, ReceiptItem, TopicGraph } from '../../../shared/types'
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
}

export function DashboardView({ onNewTopic, onGoNode }: DashboardViewProps = {}) {
  const [stats, setStats] = useState<EngramStats | null>(null)
  const [history, setHistory] = useState<ReceiptsHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ label: string; items: ReceiptItem[] } | null>(null)
  const [graphs, setGraphs] = useState<Record<string, TopicGraph> | null>(null)
  const [ledgerOpen, setLedgerOpen] = useState(false)

  useEffect(() => {
    window.engram
      .stats()
      .then(setStats)
      .catch((e: Error) => setError(e.message))
    window.engram.receiptsHistory().then(setHistory)
  }, [])

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

  // Narration order mirrors /coach: loop-closure gate first, then grader-health,
  // retention, transfer, calibration, momentum, misconceptions, backlog.
  const loopClosure = stats.adherence.loop_closure
  const grader = stats.grader_health
  const momentum = stats.momentum

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

      {history && (history.days.some((d) => d.count > 0) || history.weeks.some((w) => w.total > 0)) && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="panel px-4 py-4 flex flex-col gap-3">
              <div className="text-xs font-medium text-[var(--color-text-dim)] uppercase tracking-wide">
                Activity, last 180 days
              </div>
              <StreakCalendar
                days={history.days}
                onSelectDay={(day) => setDetail({ label: day.date, items: day.items })}
              />
            </div>
            <div className="panel px-4 py-4 flex flex-col gap-3">
              <div className="text-xs font-medium text-[var(--color-text-dim)] uppercase tracking-wide">
                Recall rate, weekly
              </div>
              <RetentionTrend
                weeks={history.weeks}
                days={history.days}
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
        <div className="panel px-4 py-3 text-sm">
          <span
            className={grader.audited ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-text-dim)]'}
          >
            {grader.stamp}
          </span>
        </div>
      </Section>

      <Section title="This week">
        <WeekDigest digest={weekDigest} />
      </Section>

      <Section title="Retention">
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
        {history === null ? (
          <div className="panel px-4 py-4 flex flex-col gap-4 mt-1">
            <SkeletonBar width="45%" height={12} />
            <SkeletonBar height={90} />
            <SkeletonBar width="40%" height={12} />
            <SkeletonBar height={50} />
          </div>
        ) : (
          <div className="panel px-4 py-4 flex flex-col gap-5 mt-1">
            <RetentionCurve data={history.weeks} />
            <ActivityStrip data={history.days} />
          </div>
        )}
      </Section>

      <Section title="Momentum">
        <div className="grid grid-cols-3 gap-3">
          <StatBlock label="Reviews (7d)" value={String(momentum.reviews_7d)} />
          <StatBlock label="Stability gained" value={`+${momentum.stability_gained_7d.toFixed(0)}d`} tone="warm" />
          <StatBlock
            label="Most durable"
            value={momentum.most_durable ? `${momentum.most_durable.stability_days.toFixed(0)}d` : '—'}
            caption={momentum.most_durable?.node}
          />
        </div>
      </Section>

      <Section title="Calibration">
        {history == null ? (
          <SkeletonBar width="60%" height={14} />
        ) : (() => {
          // Join local confidence picks (calibrationStore) against the assessor's
          // own grade history (receiptsHistory) by topic+node+day — the pick's own
          // module never sees a grade, so this join is the only place "felt vs.
          // graded" comes together. Picks store an option INDEX, not a label
          // string, because the four band labels live in the skill's dialogue
          // grammar (not this app) and could drift — see task-8-brief.md's
          // deviation note. Index 2-3 (the picker's upper half) = "felt sure";
          // 0-1 = "felt shaky". Picks with no index (persisted before this field
          // existed) can't be classified and are skipped.
          const itemsByDay = new Map(history?.days.map((d) => [d.date, d.items]) ?? [])
          const picks = allPicks()
          let overconfident = 0
          let underconfident = 0
          let calibrated = 0
          for (const pick of picks) {
            if (pick.index === undefined) continue
            // Receipts are keyed by the engine's LOCAL calendar date (engram.py's
            // `date.today()`, written verbatim into the JSONL) — toISOString() (UTC)
            // would silently mis-bucket evening picks for any non-UTC user.
            const d = new Date(pick.ts)
            const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            const items = itemsByDay.get(day)
            if (!items) continue
            const match = items.find((it) => it.topic === pick.topic && it.node === pick.node)
            if (!match) continue
            const feltSure = pick.index >= 2
            const recalled = match.grade === 'recalled'
            if (feltSure && !recalled) overconfident++
            else if (!feltSure && recalled) underconfident++
            else calibrated++
          }
          const total = overconfident + underconfident + calibrated
          if (total === 0) {
            return <div className="fig-caption">no paired picks yet</div>
          }
          return (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatBlock label="Overconfident" value={String(overconfident)} tone="warm" />
                <StatBlock label="Underconfident" value={String(underconfident)} tone="cool" />
                <StatBlock label="Calibrated" value={String(calibrated)} tone="neutral" />
              </div>
              <div className="fig-caption">Fig. — how your felt-sense tracks the assessor</div>
              <div className="panel px-4 py-4 mt-1">
                <CalibrationScatter data={{ picks, days: history?.days ?? [] }} />
              </div>
            </>
          )
        })()}
      </Section>

      <Section title="Topics">
        <div className="flex flex-col gap-2">
          {stats.topics.map((t) => (
            <div key={t.topic} className="panel px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm text-[var(--color-text-primary)]">{t.title}</div>
                <div className="label-data text-xs text-[var(--color-text-faint)]">{t.topic}</div>
              </div>
              <div className="flex gap-4 text-xs label-data">
                <span className="text-[var(--color-ink-warm)]">{t.states.review} review</span>
                <span className="text-[var(--color-ink-cool)]">{t.states.new} new</span>
                {t.due > 0 && <span className="text-[var(--color-ink-danger)]">{t.due} due</span>}
              </div>
            </div>
          ))}
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
