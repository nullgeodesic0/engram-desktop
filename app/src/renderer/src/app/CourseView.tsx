import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  type CourseList,
  type CourseTopicManifest,
  type CourseView as CourseData,
  type PartManifest,
  type PreparedCourseTopic,
  type StageManifest,
  ATTEST_NOTE_MAX,
  checkpointMet,
  consolidation,
  gateFor,
  partContext,
  partMet,
} from '../../../shared/course'
import type { Misconception, ReceiptsHistory, TopicListEntry } from '../../../shared/types'
import { Button } from '../components/ui/Button'
import { allPicks } from '../shared/calibrationStore'
import { punctualityCounts } from '../shared/gradePrefs'
import { computeShownTopicGrade, letterColorClass } from '../shared/topicGrade'

/**
 * Course: a pack's course drawn as stages (bands), tracks (lanes) and topics
 * (plates), with prerequisite edges, a checkpoint and a milestone checklist
 * per stage. Grades and node states are the engine's, read through the
 * topics list; the gates are soft, and "Start anyway" is recorded. Starting a
 * topic the engine does not have yet hands Learn a staged copy of the pack's
 * prepared map (or its outline) to register inside a sitting.
 */

const LAST_KEY = 'engram:course:last'

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

function pct(x: number | null): string {
  return x === null ? '' : `${Math.round(x * 100)}%`
}

interface Edge {
  from: string
  to: string
}

export function CourseView({
  onOpenTopic,
  onStartCourseTopic,
  onGoLabs,
  onOpenSettings,
}: {
  /** Opens a topic the engine already has, in Learn. */
  onOpenTopic: (topicId: string) => void
  /** Starts a course topic the engine does not have yet, in Learn. */
  onStartCourseTopic: (prepared: PreparedCourseTopic) => void
  onGoLabs: () => void
  onOpenSettings: () => void
}) {
  const [list, setList] = useState<CourseList | null>(null)
  const [topics, setTopics] = useState<TopicListEntry[]>([])
  const [grades, setGrades] = useState<{ history: ReceiptsHistory; misconceptions: Misconception[] } | null>(null)
  const [current, setCurrent] = useState<string | null>(readLast)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void window.engram
      .courseList()
      .then(setList)
      .catch((e: Error) => setError(e.message))
    void window.engram
      .topics()
      .then(setTopics)
      .catch(() => {})
    void Promise.all([window.engram.receiptsHistory(), window.engram.misconceptions()])
      .then(([history, misconceptions]) => setGrades({ history, misconceptions }))
      .catch(() => {})
  }, [])
  useEffect(refresh, [refresh])
  useEffect(() => window.engram.onPacksChanged(() => refresh()), [refresh])

  const view: CourseData | null = useMemo(() => {
    if (!list || list.courses.length === 0) return null
    return list.courses.find((c) => c.packId === current) ?? list.courses[0]
  }, [list, current])

  const byId = useMemo(() => new Map(topics.map((t) => [t.topic, t])), [topics])
  const cons = useCallback((id: string) => consolidation(byId.get(id)), [byId])

  const letters = useMemo(() => {
    const out = new Map<string, string>()
    if (!grades || !view) return out
    for (const id of Object.keys(view.course.topics)) {
      const t = byId.get(id)
      if (!t) continue
      const g = computeShownTopicGrade({
        receipts: grades.history.receipts,
        topicEntry: t,
        misconceptions: grades.misconceptions,
        days: grades.history.days,
        picks: allPicks(),
        mode: 'completed',
        countPunctuality: punctualityCounts(),
      })
      if (g.overall.available && g.overall.letter) out.set(id, g.overall.letter)
    }
    return out
  }, [grades, view, byId])

  function choose(packId: string) {
    setCurrent(packId)
    setSelected(null)
    try {
      localStorage.setItem(LAST_KEY, packId)
    } catch {
      // A remembered course is a convenience.
    }
  }

  async function start(topic: CourseTopicManifest, anyway: string[] | null) {
    if (!view) return
    setError(null)
    if (byId.has(topic.id)) {
      onOpenTopic(topic.id)
      return
    }
    setBusy(true)
    try {
      if (anyway) await window.engram.courseStartAnyway(view.packId, topic.id, anyway)
      const prepared = await window.engram.coursePrepareTopic(view.packId, topic.id)
      onStartCourseTopic(prepared)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (list === null) {
    return <div className="h-full p-8 text-sm text-[var(--color-text-faint)]">Reading courses…</div>
  }

  if (!view) {
    return (
      <div className="h-full overflow-y-auto p-8 max-w-2xl">
        <h1 className="text-xl text-[var(--color-text-primary)] mb-2">Course</h1>
        <p className="text-sm text-[var(--color-text-dim)] mb-4">
          No course yet. A content pack with a course.json brings one: its stages, tracks and topics, with the
          prerequisites between them and a checkpoint at the end of each stage.
        </p>
        {list.errors.map((e) => (
          <p key={e.packId} className="text-sm text-[var(--color-ink-danger)] mb-2">
            {e.packTitle}: {e.error}
          </p>
        ))}
        <Button onClick={onOpenSettings}>Content packs in Settings</Button>
      </div>
    )
  }

  const course = view.course
  const ctx = partContext(view, cons)
  const sel = selected ? course.topics[selected] : null

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <header className="px-8 pt-6 pb-4 border-b border-[var(--color-hairline)]">
          <div className="label-data text-[11px] text-[var(--color-text-faint)] mb-1">{view.packTitle}</div>
          <div className="flex items-baseline gap-4 flex-wrap">
            <h1 className="text-2xl text-[var(--color-text-primary)]">{course.title}</h1>
            {list.courses.length > 1 && (
              <select
                value={view.packId}
                onChange={(e) => choose(e.target.value)}
                aria-label="Course"
                className="focus-ring bg-transparent border border-[var(--color-edge)] rounded px-2 py-1 text-sm text-[var(--color-text-dim)]"
              >
                {list.courses.map((c) => (
                  <option key={c.packId} value={c.packId}>
                    {c.course.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          {course.summary && <p className="text-sm text-[var(--color-text-dim)] mt-2 max-w-3xl">{course.summary}</p>}
          <p className="label-data text-[11px] text-[var(--color-text-faint)] mt-2">
            A topic opens quietly once each prerequisite is {pct(course.threshold)} consolidated. You can always start
            anyway.
          </p>
          {[...view.warnings, ...list.errors.map((e) => `${e.packTitle}: ${e.error}`)].map((w) => (
            <p key={w} className="text-xs text-[var(--color-ink-danger)] mt-1">
              {w}
            </p>
          ))}
          {error && <p className="text-sm text-[var(--color-ink-danger)] mt-2">{error}</p>}
        </header>
        {course.stages.map((stage) => (
          <StageBand
            key={stage.id}
            stage={stage}
            view={view}
            cons={cons}
            letters={letters}
            known={byId}
            selected={selected}
            onSelect={setSelected}
            ctxMet={checkpointMet(stage, ctx)}
            onRecords={() => refresh()}
          />
        ))}
      </div>
      {sel && (
        <TopicPanel
          key={sel.id}
          view={view}
          topic={sel}
          cons={cons}
          letter={letters.get(sel.id) ?? null}
          exists={byId.has(sel.id)}
          busy={busy}
          onClose={() => setSelected(null)}
          onSelect={setSelected}
          onStart={(anyway) => void start(sel, anyway)}
          onGoLabs={onGoLabs}
        />
      )}
    </div>
  )
}

function StageBand({
  stage,
  view,
  cons,
  letters,
  known,
  selected,
  onSelect,
  ctxMet,
  onRecords,
}: {
  stage: StageManifest
  view: CourseData
  cons: (id: string) => number | null
  letters: Map<string, string>
  known: Map<string, TopicListEntry>
  selected: string | null
  onSelect: (id: string) => void
  ctxMet: boolean
  onRecords: () => void
}) {
  const course = view.course
  const bandRef = useRef<HTMLDivElement>(null)
  const plateRefs = useRef(new Map<string, HTMLButtonElement>())
  const [lines, setLines] = useState<{ key: string; d: string; strong: boolean }[]>([])
  const inStage = useMemo(() => new Set(stage.tracks.flatMap((t) => t.topics)), [stage])
  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (const id of inStage)
      for (const r of course.topics[id].requires) if (inStage.has(r)) out.push({ from: r, to: id })
    return out
  }, [inStage, course])

  const layout = useCallback(() => {
    const band = bandRef.current
    if (!band) return
    const box = band.getBoundingClientRect()
    const out: { key: string; d: string; strong: boolean }[] = []
    for (const e of edges) {
      const a = plateRefs.current.get(e.from)?.getBoundingClientRect()
      const b = plateRefs.current.get(e.to)?.getBoundingClientRect()
      if (!a || !b) continue
      const x1 = a.left + a.width / 2 - box.left
      const y1 = a.bottom - box.top
      const x2 = b.left + b.width / 2 - box.left
      const y2 = b.top - box.top
      const sameRow = Math.abs(a.top - b.top) < 4
      const d = sameRow
        ? `M${a.right - box.left},${a.top + a.height / 2 - box.top} L${b.left - box.left},${b.top + b.height / 2 - box.top}`
        : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
      out.push({ key: `${e.from}>${e.to}`, d, strong: selected === e.from || selected === e.to })
    }
    setLines(out)
  }, [edges, selected])

  useLayoutEffect(layout, [layout, known])
  useEffect(() => {
    const band = bandRef.current
    if (!band || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => layout())
    ro.observe(band)
    return () => ro.disconnect()
  }, [layout])

  return (
    <section className="px-8 py-6 border-b border-[var(--color-hairline)]">
      <div className="flex items-baseline gap-3 mb-1">
        <h2 className="text-lg text-[var(--color-text-primary)]">{stage.title}</h2>
      </div>
      {stage.goal && <p className="text-sm text-[var(--color-text-dim)] mb-4 max-w-3xl">{stage.goal}</p>}
      <div ref={bandRef} className="relative">
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          <defs>
            <marker
              id={`arrow-${stage.id}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--color-text-faint)" />
            </marker>
          </defs>
          {lines.map((l) => (
            <path
              key={l.key}
              d={l.d}
              fill="none"
              stroke={l.strong ? 'var(--color-ink-warm)' : 'var(--color-edge)'}
              strokeWidth={l.strong ? 1.5 : 1}
              strokeOpacity={l.strong ? 0.9 : 0.6}
              markerEnd={`url(#arrow-${stage.id})`}
            />
          ))}
        </svg>
        <div className="relative flex flex-col gap-5">
          {stage.tracks.map((track) => (
            <div key={track.id} className="grid grid-cols-[150px_1fr] gap-4 items-start">
              <div className="label-data text-[11px] uppercase tracking-wide text-[var(--color-text-faint)] pt-3">
                {track.title}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-5">
                {track.topics.map((id) => {
                  const t = course.topics[id]
                  const c = cons(id)
                  const gate = gateFor(course, id, cons)
                  return (
                    <TopicPlate
                      key={id}
                      topic={t}
                      consolidated={c}
                      letter={letters.get(id) ?? null}
                      locked={c === null && !gate.open}
                      selected={selected === id}
                      hasLab={t.labs.length > 0}
                      startedAnyway={!!view.records.startedAnyway[id]}
                      onClick={() => onSelect(id)}
                      refCb={(el) => {
                        if (el) plateRefs.current.set(id, el)
                        else plateRefs.current.delete(id)
                      }}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {(stage.checkpoint || stage.milestones.length > 0) && (
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          {stage.checkpoint && (
            <PartsCard
              title={stage.checkpoint.title}
              kicker="Checkpoint"
              warm={ctxMet}
              parts={stage.checkpoint.parts}
              view={view}
              cons={cons}
              onRecords={onRecords}
            />
          )}
          {stage.milestones.length > 0 && (
            <PartsCard
              title="Milestones"
              kicker={`${stage.milestones.filter((p) => partMet(p, partContext(view, cons))).length} of ${stage.milestones.length}`}
              warm={false}
              parts={stage.milestones}
              view={view}
              cons={cons}
              onRecords={onRecords}
            />
          )}
        </div>
      )}
    </section>
  )
}

function TopicPlate({
  topic,
  consolidated,
  letter,
  locked,
  selected,
  hasLab,
  startedAnyway,
  onClick,
  refCb,
}: {
  topic: CourseTopicManifest
  consolidated: number | null
  letter: string | null
  locked: boolean
  selected: boolean
  hasLab: boolean
  startedAnyway: boolean
  onClick: () => void
  refCb: (el: HTMLButtonElement | null) => void
}) {
  const started = consolidated !== null
  return (
    <button
      ref={refCb}
      onClick={onClick}
      aria-pressed={selected}
      title={locked ? 'Prerequisites first' : undefined}
      className={`focus-ring tilt-card-soft text-left w-[200px] rounded-lg px-3 py-2.5 transition-colors bg-[var(--color-surface)] ${
        selected
          ? 'border border-[var(--color-ink-warm)]'
          : locked
            ? 'border border-dashed border-[var(--color-edge)] opacity-75 hover:opacity-100'
            : 'border border-[var(--color-edge)] hover:border-[var(--color-text-faint)]'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 text-[13px] leading-snug text-[var(--color-text-primary)]">{topic.title}</div>
        {letter && <div className={`label-data text-xs ${letterColorClass(letter)}`}>{letter}</div>}
      </div>
      <div className="mt-2 h-1 rounded-full bg-[var(--color-hairline)] overflow-hidden" aria-hidden="true">
        {started && (
          <div
            className="h-full bg-[var(--color-ink-warm)]"
            style={{ width: `${Math.round((consolidated ?? 0) * 100)}%` }}
          />
        )}
      </div>
      <div className="mt-1.5 flex gap-2 label-data text-[10.5px] text-[var(--color-text-faint)]">
        <span>{started ? `${pct(consolidated)} consolidated` : locked ? 'Prerequisites first' : 'Not started'}</span>
        {hasLab && <span className="text-[var(--color-ink-cool)]">lab</span>}
        {startedAnyway && <span title="Started before its prerequisites">early</span>}
      </div>
    </button>
  )
}

function TopicPanel({
  view,
  topic,
  cons,
  letter,
  exists,
  busy,
  onClose,
  onSelect,
  onStart,
  onGoLabs,
}: {
  view: CourseData
  topic: CourseTopicManifest
  cons: (id: string) => number | null
  letter: string | null
  exists: boolean
  busy: boolean
  onClose: () => void
  onSelect: (id: string) => void
  onStart: (anyway: string[] | null) => void
  onGoLabs: () => void
}) {
  const course = view.course
  const gate = gateFor(course, topic.id, cons)
  const c = cons(topic.id)
  const dependents = Object.values(course.topics).filter((t) => t.requires.includes(topic.id))
  return (
    <aside className="w-[340px] shrink-0 border-l border-[var(--color-hairline)] overflow-y-auto px-5 py-5">
      <div className="flex items-start gap-2 mb-1">
        <h3 className="flex-1 text-base text-[var(--color-text-primary)]">{topic.title}</h3>
        <button
          onClick={onClose}
          aria-label="Close"
          className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
        >
          ×
        </button>
      </div>
      <div className="label-data text-[11px] text-[var(--color-text-faint)] mb-3">
        {c === null ? 'Not started' : `${pct(c)} consolidated`}
        {letter && <span className={`ml-2 ${letterColorClass(letter)}`}>grade {letter}</span>}
        {!topic.graph && !topic.outline && !exists && <span className="ml-2">· the tutor builds its map</span>}
        {topic.graph && !exists && <span className="ml-2">· prepared map</span>}
      </div>
      {topic.summary && <p className="text-sm text-[var(--color-text-dim)] mb-4">{topic.summary}</p>}

      {exists ? (
        <Button variant="primary" onClick={() => onStart(null)} disabled={busy}>
          Continue in Learn
        </Button>
      ) : gate.open ? (
        <Button variant="primary" onClick={() => onStart(null)} disabled={busy}>
          {busy ? 'Preparing…' : 'Start this topic'}
        </Button>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--color-edge)] p-3 mb-1">
          <div className="text-sm text-[var(--color-text-primary)] mb-1">Prerequisites first</div>
          <p className="text-xs text-[var(--color-text-dim)] mb-2">
            These are under {pct(course.threshold)} consolidated. In order:
          </p>
          <ol className="text-sm mb-3 space-y-1">
            {gate.path.map((id, i) => (
              <li key={id} className="flex gap-2 items-start">
                <span className="label-data text-[10.5px] text-[var(--color-text-faint)] w-4 shrink-0 text-right leading-5">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <button
                    onClick={() => onSelect(id)}
                    className="focus-ring text-left text-[var(--color-ink-cool)] hover:underline"
                  >
                    {course.topics[id].title}
                  </button>
                  <span className="label-data text-[10.5px] text-[var(--color-text-faint)] ml-1">
                    {cons(id) === null ? 'not started' : pct(cons(id))}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <Button size="sm" onClick={() => onStart(gate.path)} disabled={busy}>
            {busy ? 'Preparing…' : 'Start anyway'}
          </Button>
          <p className="label-data text-[10.5px] text-[var(--color-text-faint)] mt-2">
            Starting early is recorded, not refused.
          </p>
        </div>
      )}

      {topic.requires.length > 0 && (
        <Section title="Builds on">
          {topic.requires.map((id) => (
            <TopicLink key={id} id={id} view={view} cons={cons} onSelect={onSelect} />
          ))}
        </Section>
      )}
      {dependents.length > 0 && (
        <Section title="Leads to">
          {dependents.map((t) => (
            <TopicLink key={t.id} id={t.id} view={view} cons={cons} onSelect={onSelect} />
          ))}
        </Section>
      )}
      {topic.labs.length > 0 && (
        <Section title="Labs">
          {topic.labs.map((l) => {
            const ev = view.labs[l]
            const ms = ev ? Object.entries(ev.passed) : []
            return (
              <div key={l} className="text-sm mb-1">
                <button
                  onClick={onGoLabs}
                  className="focus-ring text-left text-[var(--color-ink-cool)] hover:underline"
                >
                  {ev?.title ?? l}
                </button>
                {ev && (
                  <span className="label-data text-[10.5px] text-[var(--color-text-faint)] ml-2">
                    {ms.filter(([, at]) => at).length} of {ms.length} milestones passed
                  </span>
                )}
              </div>
            )
          })}
        </Section>
      )}
      {topic.readings.length > 0 && (
        <Section title="Readings">
          {topic.readings.map((r) => (
            <div key={r.title} className="text-sm mb-1.5">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring text-[var(--color-ink-cool)] hover:underline"
                >
                  {r.title}
                </a>
              ) : (
                <span className="text-[var(--color-text-primary)]">{r.title}</span>
              )}
              {r.note && <div className="text-xs text-[var(--color-text-faint)]">{r.note}</div>}
            </div>
          ))}
        </Section>
      )}
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="label-data text-[11px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1.5">
        {title}
      </div>
      {children}
    </div>
  )
}

function TopicLink({
  id,
  view,
  cons,
  onSelect,
}: {
  id: string
  view: CourseData
  cons: (id: string) => number | null
  onSelect: (id: string) => void
}) {
  const c = cons(id)
  const met = c !== null && c >= view.course.threshold
  return (
    <div className="text-sm mb-1 flex items-baseline gap-2">
      <span aria-hidden="true" className={met ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-text-faint)]'}>
        {met ? '●' : '○'}
      </span>
      <button
        onClick={() => onSelect(id)}
        className="focus-ring text-left text-[var(--color-text-primary)] hover:underline"
      >
        {view.course.topics[id].title}
      </button>
      <span className="label-data text-[10.5px] text-[var(--color-text-faint)]">
        {c === null ? 'not started' : pct(c)}
      </span>
    </div>
  )
}

function evidenceLine(p: PartManifest, view: CourseData): string {
  const e = p.evidence
  switch (e.kind) {
    case 'lab': {
      const lab = view.labs[e.lab]
      return `${lab?.title ?? e.lab}: ${lab?.milestoneTitles[e.milestone] ?? e.milestone} passes its core tests`
    }
    case 'topic':
      return `${view.course.topics[e.topic]?.title ?? e.topic} at ${pct(e.consolidated)} consolidated`
    case 'attested':
      return 'You tick it, with a one-line note'
    case 'link':
      return 'You tick it and attach a link'
  }
}

function PartsCard({
  title,
  kicker,
  warm,
  parts,
  view,
  cons,
  onRecords,
}: {
  title: string
  kicker: string
  warm: boolean
  parts: PartManifest[]
  view: CourseData
  cons: (id: string) => number | null
  onRecords: () => void
}) {
  const ctx = partContext(view, cons)
  return (
    <div
      className={`rounded-lg border p-4 ${
        warm
          ? 'border-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-ink-warm)_6%,transparent)]'
          : 'border-[var(--color-edge)]'
      }`}
    >
      <div className="label-data text-[11px] text-[var(--color-text-faint)]">{kicker}</div>
      <div className="text-sm text-[var(--color-text-primary)] mb-3">
        {title}
        {warm && <span className="label-data text-[11px] text-[var(--color-ink-warm)] ml-2">passed</span>}
      </div>
      <ul className="flex flex-col gap-2.5">
        {parts.map((p) => (
          <PartRow key={p.id} part={p} met={partMet(p, ctx)} view={view} onRecords={onRecords} />
        ))}
      </ul>
    </div>
  )
}

function PartRow({
  part,
  met,
  view,
  onRecords,
}: {
  part: PartManifest
  met: boolean
  view: CourseData
  onRecords: () => void
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [url, setUrl] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const attestable = part.evidence.kind === 'attested' || part.evidence.kind === 'link'
  const record = view.records.attested[part.id]

  async function save() {
    setErr(null)
    try {
      await window.engram.courseAttest(view.packId, part.id, note, url.trim() || null)
      setOpen(false)
      setNote('')
      setUrl('')
      onRecords()
    } catch (e) {
      setErr(
        e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e),
      )
    }
  }

  async function undo() {
    await window.engram.courseClearAttestation(view.packId, part.id).catch(() => {})
    onRecords()
  }

  return (
    <li className="flex gap-2.5 items-start">
      <span
        aria-label={met ? 'done' : 'not yet'}
        className={`mt-1 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
          met ? 'bg-[var(--color-ink-warm)]' : 'border border-[var(--color-text-faint)]'
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--color-text-primary)]">{part.label}</div>
        <div className="label-data text-[10.5px] text-[var(--color-text-faint)]">{evidenceLine(part, view)}</div>
        {record && (
          <div className="text-xs text-[var(--color-text-dim)] mt-0.5">
            “{record.note}”
            {record.url && (
              <a
                href={record.url}
                target="_blank"
                rel="noreferrer"
                className="ml-1 text-[var(--color-ink-cool)] hover:underline"
              >
                link
              </a>
            )}
            <button
              onClick={() => void undo()}
              className="focus-ring ml-2 text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
            >
              undo
            </button>
          </div>
        )}
        {attestable && !record && !open && (
          <button
            onClick={() => setOpen(true)}
            className="focus-ring label-data text-[11px] text-[var(--color-ink-cool)] hover:underline mt-0.5"
          >
            Tick it
          </button>
        )}
        {open && (
          <div className="mt-1.5 flex flex-col gap-1.5">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={ATTEST_NOTE_MAX}
              placeholder="One line on what you did"
              aria-label="Note"
              className="focus-ring bg-transparent border border-[var(--color-edge)] rounded px-2 py-1 text-sm"
            />
            {part.evidence.kind === 'link' && (
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                aria-label="Link"
                className="focus-ring bg-transparent border border-[var(--color-edge)] rounded px-2 py-1 text-sm"
              />
            )}
            {err && <div className="text-xs text-[var(--color-ink-danger)]">{err}</div>}
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => void save()} disabled={!note.trim()}>
                Tick
              </Button>
              <Button size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </li>
  )
}
