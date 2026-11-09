import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  CellKind,
  CellResult,
  KernelState,
  KernelVar,
  RuntimeStatus,
  WorkbenchCell,
  WorkbenchDoc,
} from '../../../../shared/runtime'
import { dropResult, isRunning, kernelStatus, liveResults, runCellCode, subscribe } from '../../shared/kernelSession'
import { Button } from '../ui/Button'
import { ProseMarkdown } from '../ProseMarkdown'
import { CodeCellEditor } from './CodeCellEditor'
import { CellOutputs } from './CellOutputs'

/**
 * Notebook-lite cells over one kernel. The kernel and the files live in main
 * (see main/runtime); this component holds the open document, sends cells to
 * run, and folds the kernel's events into each cell's result. Edits save
 * themselves shortly after they stop.
 */

const SAVE_DELAY_MS = 700
const BASE_PACKAGES = new Set(['numpy', 'scipy', 'matplotlib', 'pytest'])

function newCellId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return 'c' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const EMPTY_RESULT: CellResult = {
  state: 'idle',
  outputs: [],
  count: null,
  ms: null,
}

function kernelLabel(state: KernelState): string {
  return {
    starting: 'Starting…',
    idle: 'Idle',
    busy: 'Running',
    dead: 'Not started',
  }[state]
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

export interface WorkbenchSnapshot {
  title: string
  cells: WorkbenchCell[]
  results: Record<string, CellResult>
}

interface WorkbenchProps {
  workbenchId: string
  onOpenSettings: () => void
  onTitleChange?: (title: string) => void
  /** The runtime layer this workbench's kernel runs on: "base", or a content pack's. */
  layerId?: string
  /** Read-only and not runnable, e.g. while a Submit's results are sealed. */
  frozen?: boolean
  /** Shown in the toolbar after the kernel controls (a lab puts Smoke and Submit here). */
  toolbarExtra?: ReactNode
  /** Every edit, so a lab can hand main exactly what is on screen at Submit. */
  onDocChange?: (doc: WorkbenchSnapshot) => void
  titleEditable?: boolean
}

export function Workbench({
  workbenchId,
  onOpenSettings,
  onTitleChange,
  layerId = 'base',
  frozen = false,
  toolbarExtra,
  onDocChange,
  titleEditable = true,
}: WorkbenchProps) {
  const [doc, setDoc] = useState<WorkbenchDoc | null>(null)
  const [cells, setCells] = useState<WorkbenchCell[]>([])
  const [results, setResults] = useState<Record<string, CellResult>>({})
  const [title, setTitle] = useState('')
  const [kernel, setKernel] = useState<KernelState>('dead')
  const [kernelDetail, setKernelDetail] = useState<string | null>(null)
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [editingNotes, setEditingNotes] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState<{ id: string; key: number } | null>(null)
  const [vars, setVars] = useState<KernelVar[] | null>(null)
  const [runningAll, setRunningAll] = useState(false)

  const loaded = useRef(false)
  const skipSave = useRef(false)
  const stopAll = useRef(false)
  const focusedKey = useRef(0)
  // What an unmount or a switch to another workbench must not lose.
  const unsaved = useRef<{
    id: string
    title: string
    cells: WorkbenchCell[]
    results: Record<string, CellResult>
  } | null>(null)

  // Load the document and the runtime's state.
  useEffect(() => {
    loaded.current = false
    setDoc(null)
    setError(null)
    setVars(null)
    window.engram
      .workbenchOpen(workbenchId)
      .then((d) => {
        // Anything that finished while this workbench was off screen wins over the file.
        const fresh = liveResults(workbenchId)
        const ids = new Set(d.cells.map((c) => c.id))
        const merged = { ...d.results }
        let changed = false
        for (const [id, r] of Object.entries(fresh)) {
          if (!ids.has(id)) continue
          merged[id] = r
          changed = true
        }
        setDoc(d)
        setCells(d.cells)
        setResults(merged)
        setTitle(d.title)
        setEditingNotes(new Set(d.cells.filter((c) => c.kind === 'note' && !c.source.trim()).map((c) => c.id)))
        setSaved('saved')
        skipSave.current = !changed
        loaded.current = true
      })
      .catch((e: Error) => setError(e.message))
    const known = kernelStatus(workbenchId)
    if (known) {
      setKernel(known.state)
      setKernelDetail(known.detail)
    } else void window.engram.kernelState(workbenchId).then(setKernel)
    void window.engram.runtimeStatus().then(setRuntime)
    const offRuntime = window.engram.onRuntimeChanged(setRuntime)
    return () => {
      offRuntime()
      const pending = unsaved.current
      unsaved.current = null
      if (pending) void window.engram.workbenchSave(pending.id, pending)
    }
  }, [workbenchId])

  // Kernel events for this workbench, through the app-wide store.
  useEffect(() => {
    return subscribe(workbenchId, () => {
      const k = kernelStatus(workbenchId)
      if (k) {
        setKernel(k.state)
        setKernelDetail(k.detail)
      }
      const fresh = liveResults(workbenchId)
      setResults((r) => {
        let next = r
        for (const [id, res] of Object.entries(fresh)) {
          if (r[id] !== res) next = next === r ? { ...r, [id]: res } : Object.assign(next, { [id]: res })
        }
        return next
      })
    })
  }, [workbenchId])

  // Autosave once edits pause.
  useEffect(() => {
    if (!loaded.current) return
    // The render that delivers a freshly opened document is not an edit.
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    setSaved('unsaved')
    unsaved.current = { id: workbenchId, title, cells, results }
    const t = setTimeout(() => {
      unsaved.current = null
      setSaved('saving')
      window.engram
        .workbenchSave(workbenchId, { title, cells, results })
        .then(() => setSaved('saved'))
        .catch((e: Error) => {
          setSaved('unsaved')
          setError(`Could not save: ${e.message}`)
        })
    }, SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [workbenchId, title, cells, results])

  useEffect(() => {
    if (doc) onTitleChange?.(title)
  }, [title, doc, onTitleChange])

  useEffect(() => {
    if (doc) onDocChange?.({ title, cells, results })
  }, [doc, title, cells, results, onDocChange])

  // A layer still serves cells while an update of it builds beside the old env.
  const layer = runtime?.layers.find((l) => l.id === layerId) ?? null
  const layerReady = !!layer && (layer.state === 'ready' || (layer.state === 'installing' && !!layer.envDir))
  const runtimeReady = layerReady && !frozen
  // The badge names the layer's first package beyond the base set, e.g. a pack's main library.
  const badgePackage = layer?.watch.find((n) => !BASE_PACKAGES.has(n) && layer.packages[n]) ?? null

  const runCell = useCallback(
    (cell: WorkbenchCell): Promise<boolean> => {
      if (cell.kind === 'note') {
        setEditingNotes((s) => {
          const n = new Set(s)
          n.delete(cell.id)
          return n
        })
        return Promise.resolve(true)
      }
      // One run per cell at a time: a second would interleave its outputs with the first.
      if (isRunning(workbenchId, cell.id)) return Promise.resolve(false)
      setVars(null)
      return runCellCode(workbenchId, cell.id, cell.source)
    },
    [workbenchId],
  )

  const insertCell = useCallback((afterIndex: number, kind: CellKind): string => {
    const cell: WorkbenchCell = { id: newCellId(), kind, source: '' }
    setCells((cs) => [...cs.slice(0, afterIndex + 1), cell, ...cs.slice(afterIndex + 1)])
    if (kind === 'note') setEditingNotes((s) => new Set(s).add(cell.id))
    setFocus({ id: cell.id, key: Date.now() })
    return cell.id
  }, [])

  const runAndAdvance = useCallback(
    (index: number, advance: boolean) => {
      const cell = cells[index]
      if (!cell) return
      void runCell(cell)
      if (!advance) return
      const next = cells[index + 1]
      if (next) setFocus({ id: next.id, key: Date.now() })
      else insertCell(index, 'code')
    },
    [cells, runCell, insertCell],
  )

  async function runAll() {
    stopAll.current = false
    setRunningAll(true)
    for (const cell of cells) {
      if (stopAll.current) break
      if (cell.kind === 'note') continue
      const ok = await runCell(cell)
      if (!ok) break
    }
    setRunningAll(false)
  }

  function interrupt() {
    stopAll.current = true
    void window.engram.kernelInterrupt(workbenchId)
  }

  function restart() {
    stopAll.current = true
    setVars(null)
    void window.engram.kernelRestart(workbenchId)
  }

  function updateSource(id: string, source: string) {
    setCells((cs) => cs.map((c) => (c.id === id ? { ...c, source } : c)))
  }

  function moveCell(index: number, delta: number) {
    setCells((cs) => {
      const j = index + delta
      if (j < 0 || j >= cs.length) return cs
      const next = [...cs]
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  function deleteCell(id: string) {
    dropResult(workbenchId, id)
    setCells((cs) => (cs.length <= 1 ? [{ id: newCellId(), kind: 'code', source: '' }] : cs.filter((c) => c.id !== id)))
    setResults((r) => {
      const { [id]: _gone, ...rest } = r
      return rest
    })
  }

  function setKind(id: string, kind: CellKind) {
    setCells((cs) => cs.map((c) => (c.id === id ? { ...c, kind } : c)))
    if (kind === 'note') setEditingNotes((s) => new Set(s).add(id))
  }

  async function showVars() {
    if (vars) {
      setVars(null)
      return
    }
    setVars(await window.engram.kernelVars(workbenchId))
  }

  const busy = kernel === 'busy' || kernel === 'starting'
  const codeCount = useMemo(() => cells.filter((c) => c.kind !== 'note').length, [cells])

  if (error && !doc) {
    return <div className="p-8 text-sm text-[var(--color-text-dim)]">{error}</div>
  }
  if (!doc) return <div className="p-8 text-sm text-[var(--color-text-faint)]">Opening…</div>

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--color-hairline)] flex-wrap">
        {titleEditable ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Workbench title"
            className="focus-ring bg-transparent font-(family-name:--font-serif) text-xl text-[var(--color-text-primary)] min-w-0 flex-1"
          />
        ) : (
          <div className="flex-1 min-w-0" />
        )}
        <span className="label-data text-xs text-[var(--color-text-faint)]" aria-live="polite">
          {saved === 'saved' ? 'Saved' : saved === 'saving' ? 'Saving…' : 'Edited'}
        </span>
        <span
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-dim)]"
          title={kernelDetail ?? undefined}
        >
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${busy ? 'animate-pulse' : ''}`}
            style={{
              background:
                kernel === 'idle'
                  ? 'var(--color-ink-cool)'
                  : busy
                    ? 'var(--color-ink-warm)'
                    : 'var(--color-text-faint)',
            }}
          />
          Kernel: {kernelLabel(kernel)}
        </span>
        {layerReady && layer && (
          <button
            onClick={onOpenSettings}
            title={
              layer.updateAvailable
                ? 'A newer package set is ready to install in Settings'
                : `Python ${layer.pythonVersion ?? ''}`
            }
            className="focus-ring label-data text-[11px] px-2 py-0.5 border border-[var(--color-hairline)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
          >
            {layer.id} · py {layer.pythonVersion ?? '?'}
            {badgePackage && ` · ${badgePackage} ${layer.packages[badgePackage]}`}
            {layer.updateAvailable && <span className="text-[var(--color-ink-warm)]"> · update</span>}
          </button>
        )}
        <Button size="sm" variant="primary" onClick={runAll} disabled={!runtimeReady || runningAll || codeCount === 0}>
          Run all
        </Button>
        <Button size="sm" onClick={interrupt} disabled={!busy}>
          Interrupt
        </Button>
        <Button size="sm" onClick={restart} disabled={!layerReady}>
          Restart
        </Button>
        <Button size="sm" onClick={showVars} disabled={kernel !== 'idle'} aria-pressed={!!vars}>
          Variables
        </Button>
        <Button
          size="sm"
          onClick={() => void window.engram.workbenchReveal(workbenchId)}
          title="Open the folder holding lab.py"
        >
          Folder
        </Button>
        {toolbarExtra}
      </div>

      {frozen && (
        <div className="mx-6 mt-3 text-xs text-[var(--color-text-dim)]">
          Cells are frozen while this submission is sealed. They open again once its results are in.
        </div>
      )}

      {!layerReady && runtime && (
        <div className="mx-6 mt-4 panel px-4 py-3 flex items-center gap-3">
          <div className="flex-1 text-sm text-[var(--color-text-dim)]">
            {!runtime.supported
              ? 'The code runtime cannot install on this machine yet: the scientific packages it pins publish no builds for it.'
              : !layer
                ? `This lab runs on the ${layerId} layer, which no added content pack provides. Check Settings → Content packs.`
                : layer.state === 'installing'
                  ? `The ${layer.label} layer is installing. Cells can run as soon as it finishes.`
                  : layerId === 'base'
                    ? 'Code cells need the code runtime, a private Python with NumPy, SciPy and Matplotlib. Install it once in Settings.'
                    : `This lab runs on the ${layer.label} layer from ${layer.sourceTitle}. Install it once in Settings.`}
          </div>
          <Button size="sm" variant="primary" onClick={onOpenSettings}>
            Open Settings
          </Button>
        </div>
      )}
      {kernel === 'dead' &&
        kernelDetail &&
        layerReady &&
        kernelDetail !== 'Shut down.' &&
        kernelDetail !== 'Restarted.' && (
          <div className="mx-6 mt-3 text-xs text-[var(--color-text-dim)]">{kernelDetail}</div>
        )}
      {error && <div className="mx-6 mt-3 text-xs text-[var(--color-text-dim)]">{error}</div>}

      {vars && (
        <div className="mx-6 mt-4 panel px-4 py-3 max-h-56 overflow-auto">
          {vars.length === 0 ? (
            <div className="text-xs text-[var(--color-text-faint)]">No variables yet.</div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {vars.map((v) => (
                  <tr key={v.name} className="align-top">
                    <td className="label-data pr-3 py-0.5 text-[var(--color-text-primary)]">{v.name}</td>
                    <td className="pr-3 py-0.5 text-[var(--color-text-faint)]">{v.type}</td>
                    <td className="py-0.5 text-[var(--color-text-dim)] font-mono break-all">{v.repr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-3">
        {cells.map((cell, index) => {
          const r = results[cell.id] ?? EMPTY_RESULT
          const errorOut = r.outputs.find((o) => o.type === 'error')
          const gutter =
            cell.kind === 'note' ? '' : r.state === 'running' ? '[*]' : r.count != null ? `[${r.count}]` : '[ ]'
          // Night Atlas states: cool ink for not yet run, warm for ran clean, danger for raised.
          const gutterInk =
            r.state === 'error'
              ? 'var(--color-ink-danger)'
              : r.state === 'ok'
                ? 'var(--color-ink-warm)'
                : r.state === 'running'
                  ? 'var(--color-text-primary)'
                  : 'var(--color-ink-cool)'
          const editing = cell.kind === 'note' && editingNotes.has(cell.id) && !frozen
          return (
            <div key={cell.id} className="group flex gap-3 min-w-0">
              <div
                className={`w-12 shrink-0 pt-2.5 pr-1 text-right label-data text-xs ${cell.kind === 'given' ? 'cell-gutter-given' : ''}`}
                style={{ color: cell.kind === 'note' ? undefined : gutterInk }}
                title={cell.kind === 'given' ? 'Given: scaffolding you run but do not edit' : undefined}
              >
                {gutter}
                {cell.kind === 'given' && (
                  <div className="text-[10px] uppercase tracking-[0.1em] mt-1 text-[var(--color-text-faint)]">
                    given
                  </div>
                )}
              </div>
              <div
                className={`flex-1 min-w-0 ${
                  cell.kind === 'note' && !editing ? '' : 'panel'
                } ${r.state === 'running' ? 'border-l-2 border-l-[var(--color-ink-warm)]' : ''}`}
              >
                {cell.kind === 'note' ? (
                  editing ? (
                    <textarea
                      autoFocus={focus?.id === cell.id}
                      value={cell.source}
                      onChange={(e) => updateSource(cell.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          runAndAdvance(index, e.shiftKey)
                        }
                      }}
                      placeholder="Notes in Markdown, with $math$. Shift+Enter to render."
                      rows={Math.max(3, cell.source.split('\n').length + 1)}
                      className="focus-ring w-full bg-transparent px-3 py-2 text-sm text-[var(--color-text-primary)] font-mono resize-y"
                    />
                  ) : (
                    <div
                      ref={(el) => {
                        if (el && focus?.id === cell.id && focusedKey.current !== focus.key) {
                          focusedKey.current = focus.key
                          el.focus()
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title="Double-click to edit"
                      onDoubleClick={() => !frozen && setEditingNotes((s) => new Set(s).add(cell.id))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault()
                          runAndAdvance(index, true)
                        } else if (e.key === 'Enter' && !frozen) setEditingNotes((s) => new Set(s).add(cell.id))
                      }}
                      className="focus-ring px-3 py-1"
                    >
                      <ProseMarkdown text={cell.source || '*Empty note*'} />
                    </div>
                  )
                ) : (
                  <>
                    <CodeCellEditor
                      value={cell.source}
                      readOnly={cell.kind === 'given' || frozen}
                      autoFocus={focus?.id === cell.id}
                      focusKey={focus?.id === cell.id ? focus.key : undefined}
                      errorLine={errorOut?.type === 'error' ? errorOut.line : null}
                      onChange={(v) => updateSource(cell.id, v)}
                      onRun={(advance) => runtimeReady && runAndAdvance(index, advance)}
                    />
                    {(r.outputs.length > 0 || r.ms != null) && (
                      <div className="border-t border-[var(--color-hairline)]">
                        <CellOutputs outputs={r.outputs} />
                        {r.ms != null && r.state !== 'running' && (
                          <div className="px-3 pb-2 label-data text-[10px] text-[var(--color-text-faint)]">
                            {formatMs(r.ms)}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="w-20 shrink-0 flex flex-col items-start gap-0.5 pt-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity text-xs">
                {cell.kind !== 'note' && (
                  <button
                    className="focus-ring text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
                    disabled={!runtimeReady}
                    onClick={() => void runCell(cell)}
                  >
                    Run
                  </button>
                )}
                {cell.kind !== 'given' && !frozen && (
                  <>
                    <button
                      className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
                      onClick={() => setKind(cell.id, cell.kind === 'note' ? 'code' : 'note')}
                    >
                      {cell.kind === 'note' ? 'To code' : 'To note'}
                    </button>
                    <button
                      className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
                      onClick={() => moveCell(index, -1)}
                      disabled={index === 0}
                      aria-label="Move cell up"
                    >
                      Up
                    </button>
                    <button
                      className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
                      onClick={() => moveCell(index, 1)}
                      disabled={index === cells.length - 1}
                      aria-label="Move cell down"
                    >
                      Down
                    </button>
                    <button
                      className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
                      onClick={() => deleteCell(cell.id)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
        <div className={`flex gap-2 ml-[60px] ${frozen ? 'hidden' : ''}`}>
          <Button size="sm" onClick={() => insertCell(cells.length - 1, 'code')}>
            + Code
          </Button>
          <Button size="sm" onClick={() => insertCell(cells.length - 1, 'note')}>
            + Note
          </Button>
        </div>
        <div className="h-16 shrink-0" />
      </div>
    </div>
  )
}
