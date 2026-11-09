import { useCallback, useEffect, useState } from 'react'
import type { PackSummary } from '../../../shared/labs'
import type { WorkbenchSummary } from '../../../shared/runtime'
import { parseLabWorkbenchId } from '../../../shared/runtime'
import { LabPage } from '../components/labs/LabPage'
import { PracticePage } from '../components/labs/PracticePage'
import { ProblemPage } from '../components/labs/ProblemPage'
import type { ProblemList } from '../../../shared/problems'
import { Button } from '../components/ui/Button'
import { Workbench } from '../components/workbench/Workbench'
import { ResizeHandle } from '../components/ui/ResizeHandle'
import { usePane } from '../shared/paneLayout'

/**
 * Labs: the labs of every content pack the learner has added (see
 * docs/content-packs.md), and their own workbenches, each a Python file of
 * cells over its own kernel. A scratch workbench always exists.
 */

const SCRATCH_ID = 'scratch'
/** The practice queue's place in the list; not a valid workbench id, so it never names one. */
const PRACTICE = ':practice'
/** A pack problem's place in the list, `:problem:<pack>/<problem>`; never a workbench id either. */
const PROBLEM = ':problem:'

function parseProblemKey(id: string): { packId: string; problemId: string } | null {
  if (!id.startsWith(PROBLEM)) return null
  const [packId, problemId] = id.slice(PROBLEM.length).split('/')
  return packId && problemId ? { packId, problemId } : null
}

const VERDICT_WORD = { passed: 'passed', slip: 'details off', core: 'central part missed', open: 'handed in' } as const
const LAST_KEY = 'engram:labs:lastWorkbench'

function readLast(): string {
  try {
    return localStorage.getItem(LAST_KEY) || SCRATCH_ID
  } catch {
    return SCRATCH_ID
  }
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function LabsView({
  onOpenSettings,
  onDiscuss,
}: {
  onOpenSettings: () => void
  /** Opens the tutor on a topic with a lab hand-in in the composer, never sent. */
  onDiscuss?: (topicId: string, text: string) => void
}) {
  const [list, setList] = useState<WorkbenchSummary[]>([])
  const [current, setCurrent] = useState<string>(readLast)
  const [naming, setNaming] = useState(false)
  const listPane = usePane('labs.list', 240, 180, 420)
  const [newTitle, setNewTitle] = useState('')

  const [packs, setPacks] = useState<PackSummary[] | null>(null)
  const [practiceDue, setPracticeDue] = useState(0)
  const [problems, setProblems] = useState<ProblemList | null>(null)

  const refresh = useCallback(() => {
    void window.engram.workbenchList().then(setList)
  }, [])
  const refreshPacks = useCallback(() => {
    void window.engram.packsList().then(setPacks)
    void window.engram
      .problemList()
      .then(setProblems)
      .catch(() => {})
    void window.engram
      .practiceQueue()
      .then((q) => setPracticeDue(q.due.length))
      .catch(() => {})
  }, [])

  useEffect(refresh, [refresh])
  useEffect(() => {
    refreshPacks()
    return window.engram.onPacksChanged(setPacks)
  }, [refreshPacks])

  const currentLab = parseLabWorkbenchId(current)
  const currentProblem = parseProblemKey(current)

  // A remembered workbench or lab that no longer exists falls back to scratch.
  useEffect(() => {
    if (currentLab) {
      if (
        packs &&
        !packs.some((p) => p.labs.some((l) => l.packId === currentLab.packId && l.labId === currentLab.labId))
      ) {
        setCurrent(SCRATCH_ID)
      }
    } else if (currentProblem) {
      if (
        problems &&
        !problems.problems.some((x) => x.packId === currentProblem.packId && x.problemId === currentProblem.problemId)
      )
        setCurrent(SCRATCH_ID)
    } else if (list.length && current !== SCRATCH_ID && current !== PRACTICE && !list.some((w) => w.id === current))
      setCurrent(SCRATCH_ID)
  }, [list, packs, problems, current, currentLab, currentProblem])

  function open(id: string) {
    setCurrent(id)
    try {
      localStorage.setItem(LAST_KEY, id)
    } catch {
      // A remembered tab is a convenience; nothing breaks without it.
    }
  }

  async function create() {
    const doc = await window.engram.workbenchCreate(newTitle)
    setNaming(false)
    setNewTitle('')
    refresh()
    open(doc.id)
  }

  const onTitleChange = useCallback(
    (title: string) => setList((l) => l.map((w) => (w.id === current ? { ...w, title } : w))),
    [current],
  )

  const others = list.filter((w) => w.id !== SCRATCH_ID)
  const scratch = list.find((w) => w.id === SCRATCH_ID)

  const row = (id: string, title: string, sub: string) => (
    <button
      key={id}
      onClick={() => open(id)}
      aria-current={id === current ? 'true' : undefined}
      className={`focus-ring text-left px-3 py-2 border-l-2 transition-colors ${
        id === current
          ? 'border-[var(--color-ink-warm)] text-[var(--color-text-primary)]'
          : 'border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <div className="text-sm truncate">{title}</div>
      {sub && <div className="label-data text-[11px] text-[var(--color-text-faint)]">{sub}</div>}
    </button>
  )

  return (
    <div className="h-full flex min-h-0">
      {listPane.collapsed ? (
        <button
          onClick={listPane.toggle}
          title="Show the list of labs"
          aria-label="Show the list of labs"
          className="focus-ring w-6 shrink-0 border-r border-[var(--color-hairline)] text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] text-xs"
        >
          ›
        </button>
      ) : (
        <aside
          style={{ width: listPane.size }}
          className="shrink-0 border-r border-[var(--color-hairline)] flex flex-col min-h-0"
        >
          <div className="px-4 pt-6 pb-3">
            <h1 className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)] leading-none">
              Labs
            </h1>
            <p className="text-xs text-[var(--color-text-dim)] mt-2">
              Pack labs with milestones and hidden tests, and Python workbenches of your own.
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            {packs?.some((p) => p.labs.length > 0) &&
              row(PRACTICE, 'Practice', practiceDue ? `${practiceDue} due · mixed across labs` : 'nothing due')}
            {packs
              ?.filter((p) => p.labs.length > 0)
              .map((p) => (
                <div key={p.folder} className="flex flex-col">
                  <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] px-4 pt-2 pb-1 truncate">
                    {p.title}
                  </div>
                  {p.labs.map((l) =>
                    row(
                      `${l.packId}/${l.labId}`,
                      l.title,
                      l.milestones
                        ? `${l.passed} of ${l.milestones} milestones${l.started ? '' : ' · not started'}`
                        : 'briefs only',
                    ),
                  )}
                </div>
              ))}
            {problems && problems.problems.length > 0 && (
              <div className="flex flex-col">
                <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] px-4 pt-2 pb-1">
                  Problems
                </div>
                {problems.problems.map((x) =>
                  row(
                    `${PROBLEM}${x.packId}/${x.problemId}`,
                    x.title,
                    `${x.type === 'figure' ? 'figure reading' : x.type}${x.last ? ` · ${VERDICT_WORD[x.last]}` : x.attempts ? ' · in progress' : ''}`,
                  ),
                )}
              </div>
            )}
            {problems?.errors.map((e, i) => (
              <div key={i} className="px-4 pb-1 text-[11px] text-[var(--color-text-faint)] break-words">
                {e.packTitle}: {e.error}
              </div>
            ))}
            {packs && packs.every((p) => p.labs.length === 0) && (
              <div className="px-4 pb-2 text-xs text-[var(--color-text-faint)]">
                No pack labs yet.{' '}
                <button
                  className="focus-ring underline hover:text-[var(--color-text-primary)]"
                  onClick={onOpenSettings}
                >
                  Add a content pack
                </button>{' '}
                in Settings.
              </div>
            )}
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] px-4 pt-2 pb-1">
              Workbenches
            </div>
            <nav className="flex flex-col" aria-label="Workbenches">
              {row(SCRATCH_ID, scratch?.title ?? 'Scratch', scratch ? when(scratch.updatedAt) : '')}
              {others.map((w) =>
                row(w.id, w.title, `${w.cellCount} ${w.cellCount === 1 ? 'cell' : 'cells'} · ${when(w.updatedAt)}`),
              )}
            </nav>
          </div>
          <div className="px-4 py-3 mt-auto border-t border-[var(--color-hairline)]">
            {naming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void create()
                }}
                className="flex flex-col gap-2"
              >
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
                  placeholder="Title, e.g. Repetition code"
                  aria-label="New workbench title"
                  className="focus-ring px-2 py-1.5 text-sm bg-transparent border border-[var(--color-hairline)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)]"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" type="submit">
                    Create
                  </Button>
                  <Button size="sm" type="button" onClick={() => setNaming(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button size="sm" onClick={() => setNaming(true)} className="w-full">
                New workbench
              </Button>
            )}
          </div>
          <button
            onClick={listPane.toggle}
            className="focus-ring mx-4 mb-3 text-left label-data text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
          >
            ‹ Hide this list
          </button>
        </aside>
      )}
      {!listPane.collapsed && <ResizeHandle pane={listPane} edge="end" label="Labs list width" />}
      <section className="flex-1 min-w-0 min-h-0">
        {current === PRACTICE ? (
          <PracticePage
            layerOf={(packId) => packs?.find((p) => p.id === packId)?.layer ?? 'base'}
            onOpenSettings={onOpenSettings}
            onChanged={refreshPacks}
          />
        ) : currentProblem ? (
          <ProblemPage
            key={current}
            packId={currentProblem.packId}
            problemId={currentProblem.problemId}
            onChanged={refreshPacks}
            onDiscuss={onDiscuss}
          />
        ) : currentLab ? (
          <LabPage
            key={current}
            packId={currentLab.packId}
            labId={currentLab.labId}
            onOpenSettings={onOpenSettings}
            onChanged={refreshPacks}
            onDiscuss={onDiscuss}
          />
        ) : (
          <Workbench
            key={current}
            workbenchId={current}
            onOpenSettings={onOpenSettings}
            onTitleChange={onTitleChange}
          />
        )}
      </section>
    </div>
  )
}
