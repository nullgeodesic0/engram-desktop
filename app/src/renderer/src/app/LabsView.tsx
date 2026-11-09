import { useCallback, useEffect, useState } from 'react'
import type { PackSummary } from '../../../shared/labs'
import type { WorkbenchSummary } from '../../../shared/runtime'
import { parseLabWorkbenchId } from '../../../shared/runtime'
import { LabPage } from '../components/labs/LabPage'
import { Button } from '../components/ui/Button'
import { Workbench } from '../components/workbench/Workbench'

/**
 * Labs: the labs of every content pack the learner has added (see
 * docs/content-packs.md), and their own workbenches, each a Python file of
 * cells over its own kernel. A scratch workbench always exists.
 */

const SCRATCH_ID = 'scratch'
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

export function LabsView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [list, setList] = useState<WorkbenchSummary[]>([])
  const [current, setCurrent] = useState<string>(readLast)
  const [naming, setNaming] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const [packs, setPacks] = useState<PackSummary[] | null>(null)

  const refresh = useCallback(() => {
    void window.engram.workbenchList().then(setList)
  }, [])
  const refreshPacks = useCallback(() => {
    void window.engram.packsList().then(setPacks)
  }, [])

  useEffect(refresh, [refresh])
  useEffect(() => {
    refreshPacks()
    return window.engram.onPacksChanged(setPacks)
  }, [refreshPacks])

  const currentLab = parseLabWorkbenchId(current)

  // A remembered workbench or lab that no longer exists falls back to scratch.
  useEffect(() => {
    if (currentLab) {
      if (
        packs &&
        !packs.some((p) => p.labs.some((l) => l.packId === currentLab.packId && l.labId === currentLab.labId))
      ) {
        setCurrent(SCRATCH_ID)
      }
    } else if (list.length && current !== SCRATCH_ID && !list.some((w) => w.id === current)) setCurrent(SCRATCH_ID)
  }, [list, packs, current, currentLab])

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
      <aside className="w-60 shrink-0 border-r border-[var(--color-hairline)] flex flex-col min-h-0">
        <div className="px-4 pt-6 pb-3">
          <h1 className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)] leading-none">
            Labs
          </h1>
          <p className="text-xs text-[var(--color-text-dim)] mt-2">
            Pack labs with milestones and hidden tests, and Python workbenches of your own.
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
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
          {packs && packs.every((p) => p.labs.length === 0) && (
            <div className="px-4 pb-2 text-xs text-[var(--color-text-faint)]">
              No pack labs yet.{' '}
              <button className="focus-ring underline hover:text-[var(--color-text-primary)]" onClick={onOpenSettings}>
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
      </aside>
      <section className="flex-1 min-w-0 min-h-0">
        {currentLab ? (
          <LabPage
            key={current}
            packId={currentLab.packId}
            labId={currentLab.labId}
            onOpenSettings={onOpenSettings}
            onChanged={refreshPacks}
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
