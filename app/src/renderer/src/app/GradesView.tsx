import { useEffect, useState } from 'react'
import type { DayActivity, GraderHealthResult, Misconception, RawReceipt, TopicGraph, TopicListEntry, WeekRetention } from '../../../shared/types'
import {
  computeTopicGrade,
  computeCrossTopicGPA,
  computeTopicGradeTrend,
  weeklyTrendCutoffs,
  buildTopicAssignments,
  groupAssignmentsByNode,
  letterColorClass,
  formatAssignmentDate,
  type AssignmentRow,
  type ComponentGrade,
  type GradeComponentKey,
  type GradeMode,
  type TopicGradeResult,
  type TopicGradeTrendPoint,
} from '../shared/topicGrade'
import { topicWeekRetention } from '../shared/topicMetrics'
import { allPicks } from '../shared/calibrationStore'
import { SectionBanner } from '../components/ui/SectionBanner'
import { PlateFigure } from '../components/ui/PlateFigure'
import { Button } from '../components/ui/Button'
import { SkeletonBar } from '../components/Skeleton'
import { RetentionCurve } from '../components/charts/RetentionCurve'
import { humanizeNodeId } from '../../../shared/humanizeId'

/** PlateFigure tone per letter — same scale letterColorClass encodes
 * (S violet · A/B warm · C/D cool · F danger), for the big plate letters. */
const LETTER_TONE: Record<string, 'warm' | 'cool' | 'primary' | 'dim' | 'violet' | 'danger'> = {
  S: 'violet',
  A: 'warm',
  B: 'warm',
  C: 'cool',
  D: 'cool',
  F: 'danger',
}

const COMPONENT_META: Record<GradeComponentKey, { label: string; description: string }> = {
  recall: { label: 'Recall Accuracy', description: 'Free-recall rate across every graded review — the direct exam-performance analog.' },
  punctuality: { label: 'Punctuality', description: 'How close to schedule reviews actually happen, not just whether they eventually do.' },
  coverage: { label: 'Coverage', description: 'Share of the curriculum actually consolidated, not just started.' },
  conceptual: { label: 'Conceptual Health', description: 'Share of logged misconceptions actually resolved.' },
  calibration: { label: 'Calibration', description: 'How often felt confidence matched the graded outcome.' },
}

function formatRaw(key: GradeComponentKey, c: ComponentGrade): string {
  if (!c.available || c.raw === null) return '—'
  switch (key) {
    case 'recall':
    case 'calibration':
      return `${Math.round(c.raw * 100)}%`
    case 'punctuality':
      if (c.raw <= 0) return c.raw === 0 ? 'on schedule' : `${Math.abs(Math.round(c.raw))}d early`
      return `${Math.round(c.raw)}d late (median)`
    case 'coverage':
      return `${Math.round(c.raw * 100)}%`
    case 'conceptual':
      return `${c.raw} open`
  }
}

/** One of the five statistical components the composite is weighted from —
 * NOT the same thing as an "assignment" (see AssignmentTile below), which is
 * a literal individual graded event. Kept as its own section, "Subgrades",
 * per the user's explicit call to keep both.
 *
 * `sparkline` — only ever passed for the Recall Accuracy tile: a compact
 * `RetentionCurve` reusing the existing per-topic weekly-retention data as
 * supporting evidence beside the letter, not a decorative addition. */
function SubgradeTile({
  gradeKey,
  component,
  sparkline,
}: {
  gradeKey: GradeComponentKey
  component: ComponentGrade
  sparkline?: WeekRetention[]
}) {
  const meta = COMPONENT_META[gradeKey]
  return (
    <div className="tilt-card panel px-4 py-3 flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wide">{meta.label}</div>
        <div className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0">{Math.round(component.weight * 100)}% of grade</div>
      </div>
      <div className={`label-data text-2xl font-medium ${letterColorClass(component.letter)}`}>
        {component.available ? component.letter : <span className="text-[var(--color-text-faint)] text-base">not enough data yet</span>}
      </div>
      <div className="label-data text-[10px] text-[var(--color-text-faint)]">{formatRaw(gradeKey, component)}</div>
      {sparkline && sparkline.some((w) => w.total > 0) && (
        <div className="mt-1">
          <RetentionCurve data={sparkline} compact />
        </div>
      )}
      <div className="fig-caption mt-1">{meta.description}</div>
    </div>
  )
}

/** Adapts a completed-mode grade trend into the shape `RetentionCurve`
 * already renders (`WeekRetention`) — reused as-is, not forked, per the
 * "reuse over invention" rule: an unavailable point becomes a null-rate
 * entry so the line breaks there instead of interpolating through it, the
 * same gap discipline `RetentionCurve` already applies to a real missing
 * review week. */
function trendToWeekRetention(trend: TopicGradeTrendPoint[]): WeekRetention[] {
  return trend.map((p) => ({
    weekStart: p.cutoff,
    total: p.result.overall.available ? 1 : 0,
    recalled: p.result.overall.available ? (p.result.overall.score ?? 0) / 100 : 0,
    rate: p.result.overall.available ? (p.result.overall.score ?? 0) / 100 : null,
  }))
}

/** ▲/▼/– point delta between the oldest and newest computed trend points —
 * completed-mode only (see `computeHistoricalTopicGrade`'s own doctrine
 * comment on why total mode's coverage can't be reconstructed historically). */
function TrendArrow({ trend }: { trend: TopicGradeTrendPoint[] }) {
  const available = trend.filter((p) => p.result.overall.available)
  if (available.length < 2) return null
  const oldest = available[0].result.overall.score ?? 0
  const newest = available[available.length - 1].result.overall.score ?? 0
  const delta = Math.round(newest - oldest)
  if (delta === 0) return <span className="label-data text-[10px] text-[var(--color-text-faint)]">–</span>
  const up = delta > 0
  return (
    <span className={`label-data text-[10px] ${up ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-ink-danger)]'}`}>
      {up ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  )
}

/** What each event kind is called on an assignment row — structural, from
 * AssignmentRow.kind, never re-parsed out of the label prose. */
const KIND_LABEL: Record<AssignmentRow['kind'], string> = {
  encode: 'First Learn',
  review: 'Review',
  transfer: 'Transfer Probe',
  unstarted: 'Not Yet Started',
}

/** A literal graded event inside its node's group — kind + date + letter as
 * three structured registers (the node's own name lives on the group header,
 * never repeated per row). This is the audit trail underneath the Subgrades'
 * numbers, not a second weighted score of its own. */
function AssignmentRowView({ row }: { row: AssignmentRow }) {
  const tone = row.outcome === 'unstarted' ? 'text-[var(--color-text-faint)]' : letterColorClass(row.letter)
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="label-data text-[10px] uppercase tracking-wide text-[var(--color-text-dim)] shrink-0">
        {KIND_LABEL[row.kind]}
      </span>
      <div className="flex items-center gap-3 shrink-0">
        {row.date && <span className="label-data text-[10px] text-[var(--color-text-faint)]">{formatAssignmentDate(row.date)}</span>}
        <span className={`label-data text-sm font-medium w-4 text-right ${tone}`}>
          {row.outcome === 'unstarted' ? '—' : row.letter}
        </span>
      </div>
    </div>
  )
}

/** One node's assignments as a bordered group card (the same 1px edge-line
 * row idiom Home's topic rows use), collapsed by default — a mature topic's
 * 44+ individual reviews would otherwise be one long undifferentiated
 * scroll. The COLLAPSED header already carries the story: the node's name,
 * a faint-mono tally line (recalled/partial/lapsed counts + the date span,
 * ReadyRoomPlate's own second-line register), the event count, and the most
 * recent letter at figure scale. Expanding reveals the per-event rows. */
function AssignmentGroupView({
  node,
  rows,
  expanded,
  onToggle,
}: {
  node: string
  rows: AssignmentRow[]
  expanded: boolean
  onToggle: () => void
}) {
  const graded = rows.filter((r) => r.outcome !== 'unstarted')
  const recalled = graded.filter((r) => r.outcome === 'recalled').length
  const partial = graded.filter((r) => r.outcome === 'partial').length
  const lapsed = graded.filter((r) => r.outcome === 'lapsed').length
  const dates = graded.map((r) => r.date).filter((d): d is string => d !== null).sort()
  const span =
    dates.length === 0
      ? null
      : dates[0] === dates[dates.length - 1]
        ? formatAssignmentDate(dates[0])
        : `${formatAssignmentDate(dates[0])} – ${formatAssignmentDate(dates[dates.length - 1])}`
  const unstartedOnly = graded.length === 0
  const mostRecent = rows.find((r) => r.date) ?? rows[0]
  const tally = unstartedOnly
    ? 'not yet started'
    : [
        recalled > 0 ? `${recalled} recalled` : null,
        partial > 0 ? `${partial} partial` : null,
        lapsed > 0 ? `${lapsed} lapsed` : null,
        span,
      ]
        .filter(Boolean)
        .join(' · ')
  return (
    <div className="border border-[var(--color-edge)]">
      <button
        onClick={onToggle}
        className="focus-ring w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] transition-colors duration-[var(--dur-fast)]"
      >
        <div className="min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
            <span className="text-[var(--color-text-faint)] text-xs shrink-0">{expanded ? '▾' : '▸'}</span>
            <span className="truncate">{humanizeNodeId(node)}</span>
          </div>
          <div className="label-data text-[10px] text-[var(--color-text-faint)] pl-[18px] truncate">{tally}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="label-data text-[10px] text-[var(--color-text-dim)]">
            {graded.length > 0 ? `${graded.length} ${graded.length === 1 ? 'event' : 'events'}` : ''}
          </span>
          <span
            className={`figure-display text-2xl ${
              unstartedOnly ? 'text-[var(--color-text-faint)]' : letterColorClass(mostRecent?.letter ?? null)
            }`}
          >
            {unstartedOnly ? '—' : mostRecent?.letter}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-hairline)] px-3 pl-[30px] flex flex-col divide-y divide-[var(--color-hairline)]">
          {rows.map((row) => (
            <AssignmentRowView key={row.key} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}

function TopicRosterRow({
  entry,
  grade,
  trend,
  onOpen,
}: {
  entry: TopicListEntry
  grade: TopicGradeResult
  trend: TopicGradeTrendPoint[]
  onOpen: () => void
}) {
  return (
    <button onClick={onOpen} className="tilt-card panel-raised px-4 py-3 flex items-center justify-between gap-4 w-full text-left frame-hover">
      <div className="min-w-0">
        <div className="text-sm text-[var(--color-text-primary)] truncate">{entry.title}</div>
        <div className="label-data text-[10px] text-[var(--color-text-faint)] mt-0.5">
          {entry.states.review}/{entry.nodes} consolidated
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <TrendArrow trend={trend} />
        <span className={`figure-display text-3xl ${letterColorClass(grade.overall.letter)}`}>
          {grade.overall.available ? grade.overall.letter : '—'}
        </span>
      </div>
    </button>
  )
}

function ModeToggle({ mode, onChange }: { mode: GradeMode; onChange: (m: GradeMode) => void }) {
  return (
    <div className="flex items-center gap-1 self-start">
      {(['completed', 'total'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`label-data text-[10px] uppercase tracking-wide px-2.5 py-1 border ${
            mode === m
              ? 'border-[var(--color-ink-warm)] text-[var(--color-ink-warm)]'
              : 'border-[var(--color-hairline)] text-[var(--color-text-faint)]'
          }`}
        >
          {m === 'completed' ? 'Completed work' : 'Total work'}
        </button>
      ))}
    </div>
  )
}

const COMPONENT_ORDER: GradeComponentKey[] = ['recall', 'punctuality', 'coverage', 'conceptual', 'calibration']

/** Per-topic A-F course grade, for accountability — not a game score. Plain
 * letter + weight + description + number throughout, matching
 * GraderAudit.tsx's ThresholdStat register: no progress bars, streaks,
 * points, or badges. Roster (every topic, click through) -> drilldown (one
 * topic's full breakdown: Subgrades' statistical components + a literal
 * Assignments gradebook), mirroring TopicDrilldownView's onBack shape,
 * though this view fetches its own data rather than receiving it as props —
 * it's a top-level nav destination now, not a child of Coach.
 *
 * `mode` (completed/total) is ONE shared toggle for the whole view, visible
 * on both the roster and the drilldown — not two independent controls —
 * since it's the same underlying question ("count unfinished work against
 * me or not") regardless of which screen is showing it. */
export function GradesView() {
  const [topics, setTopics] = useState<TopicListEntry[] | null>(null)
  const [receipts, setReceipts] = useState<RawReceipt[] | null>(null)
  const [misconceptions, setMisconceptions] = useState<Misconception[] | null>(null)
  const [days, setDays] = useState<DayActivity[] | null>(null)
  const [health, setHealth] = useState<GraderHealthResult | null>(null)
  const [openTopic, setOpenTopic] = useState<string | null>(null)
  // Defaults to completed-work (per the user's explicit call): the UI's
  // headline GPA grades the work actually done; the total-work lens stays
  // one toggle away.
  const [mode, setMode] = useState<GradeMode>('completed')
  const [openGraph, setOpenGraph] = useState<TopicGraph | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [lapsedOnly, setLapsedOnly] = useState(false)

  useEffect(() => {
    window.engram.topics().then(setTopics)
    window.engram.receiptsHistory().then((h) => {
      setReceipts(h.receipts)
      setDays(h.days)
    })
    window.engram.misconceptions().then(setMisconceptions)
    window.engram.graderHealth().then(setHealth)
  }, [])

  // Fetched lazily, per opened topic — only `order` (the bare node-id list)
  // is ever read off this, never `nodes` (which carries each node's
  // claim/rubric) — the assignments list needs to know WHICH node ids exist
  // to find unstarted ones, nothing about their content.
  useEffect(() => {
    if (!openTopic) {
      setOpenGraph(null)
      return
    }
    let cancelled = false
    window.engram.topicGraph(openTopic).then((g) => {
      if (!cancelled) setOpenGraph(g as TopicGraph)
    })
    return () => {
      cancelled = true
    }
  }, [openTopic])

  const loading = !topics || !receipts || !misconceptions || !days

  if (loading) {
    return (
      <div className="h-full overflow-y-auto p-8 flex flex-col gap-3 w-full">
        <SkeletonBar height={24} width="30%" />
        <SkeletonBar height={64} />
        <SkeletonBar height={64} />
        <SkeletonBar height={64} />
      </div>
    )
  }

  const picks = allPicks()
  const grades = new Map<string, TopicGradeResult>(
    topics.map((t) => [
      t.topic,
      computeTopicGrade({ receipts, topic: t.topic, topicEntry: t, misconceptions, days, picks, mode }),
    ]),
  )

  // Grade trend — completed-mode only (see computeHistoricalTopicGrade's own
  // doctrine comment), computed once per topic regardless of the current
  // `mode` toggle: the roster's arrow and the drilldown's chart both read
  // from this same list, never a second trend computation.
  const cutoffs = weeklyTrendCutoffs(days, 12)
  const trends = new Map<string, TopicGradeTrendPoint[]>(
    topics.map((t) => [
      t.topic,
      computeTopicGradeTrend({ receipts, topic: t.topic, misconceptions, days, picks, cutoffs }),
    ]),
  )

  const gpa = computeCrossTopicGPA(topics, grades)

  const open = openTopic ? topics.find((t) => t.topic === openTopic) : null
  const openGrade = openTopic ? grades.get(openTopic) : null
  const openTrend = openTopic ? (trends.get(openTopic) ?? []) : []

  if (open && openGrade) {
    const allAssignments = buildTopicAssignments(receipts, open.topic, mode, openGraph?.order)
    const assignments = lapsedOnly ? allAssignments.filter((r) => r.outcome === 'lapsed') : allAssignments
    const assignmentGroups = groupAssignmentsByNode(assignments)
    const recallSparkline = topicWeekRetention(days, open.topic)
    return (
      <div className="h-full overflow-y-auto p-8 flex flex-col gap-4 w-full">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setOpenTopic(null)}>
            ← All grades
          </Button>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        {/* Same plate anatomy as ReadyRoomPlate's own — a tilt-card panel
            wrapping the PlateFigure, never a bare figure floating with no
            card underneath it. */}
        <div className="tilt-card panel px-6 py-6 flex flex-col gap-2">
          <PlateFigure
            value={openGrade.overall.available ? openGrade.overall.letter : '—'}
            title={open.title}
            note={
              openGrade.overall.available
                ? `${Math.round(openGrade.overall.score ?? 0)} composite`
                : 'not enough data yet for an overall grade'
            }
            tone={LETTER_TONE[openGrade.overall.letter ?? ''] ?? 'dim'}
          />
        </div>
        {openTrend.filter((p) => p.result.overall.available).length >= 2 && (
          <>
            <SectionBanner label="Grade Trend" />
            {/* `tilt-card` — the same card physics every other plate on this
                screen already carries. */}
            <div className="tilt-card panel px-4 py-3 flex flex-col gap-1">
              <RetentionCurve data={trendToWeekRetention(openTrend)} />
              <div className="fig-caption">completed-work trend — coverage isn't reconstructable historically</div>
            </div>
          </>
        )}
        <SectionBanner label="Subgrades" />
        {/* `items-start` — without it, the Recall tile's sparkline (the
            other four tiles have no chart) stretches every tile in its row
            to match, leaving visible dead space in the shorter siblings. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-start gap-3">
          {COMPONENT_ORDER.map((key) => (
            <SubgradeTile
              key={key}
              gradeKey={key}
              component={openGrade.components[key]}
              sparkline={key === 'recall' ? recallSparkline : undefined}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <SectionBanner label="Assignments" count={assignments.length} className="flex-1" />
          <button
            onClick={() => setLapsedOnly((v) => !v)}
            className={`label-data text-[10px] uppercase tracking-wide px-2.5 py-1 border shrink-0 ${
              lapsedOnly
                ? 'border-[var(--color-ink-danger)] text-[var(--color-ink-danger)]'
                : 'border-[var(--color-hairline)] text-[var(--color-text-faint)]'
            }`}
          >
            Lapsed only
          </button>
        </div>
        {/* One plate of bordered group cards — the same plate-of-rows
            anatomy Home's Sections and topic registers use, replacing the
            old cramped shared-panel text list. */}
        <div className="tilt-card-soft panel px-6 py-5 flex flex-col gap-2">
          {assignments.length === 0 && (
            <div className="fig-caption py-3">{lapsedOnly ? 'No lapsed reviews — nothing to re-review.' : 'No graded work yet.'}</div>
          )}
          {assignmentGroups.map((group) => (
            <AssignmentGroupView
              key={group.node}
              node={group.node}
              rows={group.rows}
              expanded={expandedNodes.has(group.node)}
              onToggle={() =>
                setExpandedNodes((prev) => {
                  const next = new Set(prev)
                  if (next.has(group.node)) next.delete(group.node)
                  else next.add(group.node)
                  return next
                })
              }
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-8 flex flex-col gap-4 w-full">
      {/* Same plate anatomy as ReadyRoomPlate's own — a tilt-card panel
          wrapping the PlateFigure, never a bare figure floating with no
          card underneath it. */}
      <div className="tilt-card panel px-6 py-6 flex items-center justify-between gap-3">
        <PlateFigure
          value={gpa.available ? gpa.letter : '—'}
          title="GPA across your topics"
          note={gpa.available ? `composite across ${gpa.topicsCounted} of ${topics.length} topics` : 'not enough data yet'}
          tone={LETTER_TONE[gpa.letter ?? ''] ?? 'dim'}
        />
        <ModeToggle mode={mode} onChange={setMode} />
      </div>
      <SectionBanner label="Grades" count={topics.length} />
      {health && (
        <div className="label-data text-[10px] text-[var(--color-text-faint)]">
          Grader self-audit: {health.verdict} — see Coach → Grader Audit. Not a factor in any topic's grade below.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {topics.map((t) => {
          const grade = grades.get(t.topic)
          if (!grade) return null
          return (
            <TopicRosterRow
              key={t.topic}
              entry={t}
              grade={grade}
              trend={trends.get(t.topic) ?? []}
              onOpen={() => setOpenTopic(t.topic)}
            />
          )
        })}
        {topics.length === 0 && <div className="fig-caption">No topics yet — start one from Learn.</div>}
      </div>
    </div>
  )
}
