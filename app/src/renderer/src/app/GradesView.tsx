import { useEffect, useState } from 'react'
import type { DayActivity, GraderHealthResult, Misconception, RawReceipt, TopicListEntry } from '../../../shared/types'
import { computeTopicGrade, type ComponentGrade, type GradeComponentKey, type TopicGradeResult } from '../shared/topicGrade'
import { allPicks } from '../shared/calibrationStore'
import { SectionBanner } from '../components/ui/SectionBanner'
import { PlateFigure } from '../components/ui/PlateFigure'
import { Button } from '../components/ui/Button'
import { SkeletonBar } from '../components/Skeleton'

const LETTER_TONE: Record<string, 'warm' | 'cool' | 'primary' | 'dim'> = {
  A: 'warm',
  B: 'warm',
  C: 'cool',
  D: 'cool',
  F: 'dim',
}

function letterColorClass(letter: string | null): string {
  if (letter === 'A' || letter === 'B') return 'text-[var(--color-ink-warm)]'
  if (letter === 'C') return 'text-[var(--color-ink-cool)]'
  if (letter === 'D' || letter === 'F') return 'text-[var(--color-ink-danger)]'
  return 'text-[var(--color-text-faint)]'
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

function AssignmentTile({ gradeKey, component }: { gradeKey: GradeComponentKey; component: ComponentGrade }) {
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
      <div className="fig-caption mt-1">{meta.description}</div>
    </div>
  )
}

function TopicRosterRow({ entry, grade, onOpen }: { entry: TopicListEntry; grade: TopicGradeResult; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="tilt-card panel-raised px-4 py-3 flex items-center justify-between gap-4 w-full text-left frame-hover">
      <div className="min-w-0">
        <div className="text-sm text-[var(--color-text-primary)] truncate">{entry.title}</div>
        <div className="label-data text-[10px] text-[var(--color-text-faint)] mt-0.5">
          {entry.states.review}/{entry.nodes} consolidated
        </div>
      </div>
      <span className={`figure-display text-3xl ${letterColorClass(grade.overall.letter)}`}>
        {grade.overall.available ? grade.overall.letter : '—'}
      </span>
    </button>
  )
}

const COMPONENT_ORDER: GradeComponentKey[] = ['recall', 'punctuality', 'coverage', 'conceptual', 'calibration']

/** Per-topic A-F course grade, for accountability — not a game score. Plain
 * letter + weight + description + number throughout, matching
 * GraderAudit.tsx's ThresholdStat register: no progress bars, streaks,
 * points, or badges. Roster (every topic, click through) -> drilldown (one
 * topic's full breakdown), mirroring TopicDrilldownView's onBack shape,
 * though this view fetches its own data rather than receiving it as props —
 * it's a top-level nav destination now, not a child of Coach. */
export function GradesView() {
  const [topics, setTopics] = useState<TopicListEntry[] | null>(null)
  const [receipts, setReceipts] = useState<RawReceipt[] | null>(null)
  const [misconceptions, setMisconceptions] = useState<Misconception[] | null>(null)
  const [days, setDays] = useState<DayActivity[] | null>(null)
  const [health, setHealth] = useState<GraderHealthResult | null>(null)
  const [openTopic, setOpenTopic] = useState<string | null>(null)

  useEffect(() => {
    window.engram.topics().then(setTopics)
    window.engram.receiptsHistory().then((h) => {
      setReceipts(h.receipts)
      setDays(h.days)
    })
    window.engram.misconceptions().then(setMisconceptions)
    window.engram.graderHealth().then(setHealth)
  }, [])

  const loading = !topics || !receipts || !misconceptions || !days

  if (loading) {
    return (
      <div className="h-full overflow-y-auto p-6 flex flex-col gap-3 max-w-2xl">
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
      computeTopicGrade({ receipts, topic: t.topic, topicEntry: t, misconceptions, days, picks }),
    ]),
  )

  const open = openTopic ? topics.find((t) => t.topic === openTopic) : null
  const openGrade = openTopic ? grades.get(openTopic) : null

  if (open && openGrade) {
    return (
      <div className="h-full overflow-y-auto p-6 flex flex-col gap-4 max-w-2xl">
        <Button variant="ghost" onClick={() => setOpenTopic(null)} className="self-start">
          ← All grades
        </Button>
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
        <SectionBanner label="Assignments" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {COMPONENT_ORDER.map((key) => (
            <AssignmentTile key={key} gradeKey={key} component={openGrade.components[key]} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6 flex flex-col gap-4 max-w-2xl">
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
          return <TopicRosterRow key={t.topic} entry={t} grade={grade} onOpen={() => setOpenTopic(t.topic)} />
        })}
        {topics.length === 0 && <div className="fig-caption">No topics yet — start one from Learn.</div>}
      </div>
    </div>
  )
}
