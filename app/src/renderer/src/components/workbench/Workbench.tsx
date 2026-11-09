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
import { PopoverMenu, type MenuItem } from '../ui/PopoverMenu'
import { ResizeHandle } from '../ui/ResizeHandle'
import { ProseMarkdown } from '../ProseMarkdown'
import { CodeCellEditor, type NotebookName } from './CodeCellEditor'
import { CellOutputs } from './CellOutputs'
import { EditorViewMenu } from './EditorViewMenu'
import { useEditorPrefs } from '../../shared/editorPrefs'
import { usePane } from '../../shared/paneLayout'
import { SHORTCUTS, commandFor, definedNames, outlineOf, type NotebookCommand } from '../../shared/notebook'

/**
 * Notebook cells over one kernel. The kernel and the files live in main (see
 * main/runtime); this component holds the open document, sends cells to run,
 * and folds the kernel's events into each cell's result. Edits save
 * themselves shortly after they stop.
 *
 * Two modes, as in Jupyter: editing a cell, or command mode on the selected
 * cell (Escape), where single keys insert, delete, move, copy and convert
 * cells (see shared/notebook.ts and the H panel). An inspector beside the
 * cells holds the outline and the kernel's variables, at a width the learner
 * drags. Collapsed inputs and outputs are remembered per workbench.
 */

/** Cells copied or cut, shared by every workbench in the window. */
let cellClipboard: WorkbenchCell[] = []

function collapseKey(id: string): string {
  return `engram.wb.collapse.${id}`
}

function readCollapse(id: string): { input: string[]; output: string[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(collapseKey(id)) ?? 'null') as { input?: unknown; output?: unknown }
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { input: list(raw?.input), output: list(raw?.output) }
  } catch {
    return { input: [], output: [] }
  }
}

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
  const [prefs, setPrefs] = useEditorPrefs()
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'command' | 'edit'>('command')
  const [collapsedIn, setCollapsedIn] = useState<Set<string>>(new Set())
  const [collapsedOut, setCollapsedOut] = useState<Set<string>>(new Set())
  const [inspector, setInspector] = useState<'outline' | 'variables' | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [kernelNames, setKernelNames] = useState<NotebookName[]>([])
  const trash = useRef<{ cell: WorkbenchCell; index: number }[]>([])
  const lastKey = useRef<{ key: string; at: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inspectorPane = usePane('workbench.inspector', 260, 180, 520)

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
    const c = readCollapse(workbenchId)
    setCollapsedIn(new Set(c.input))
    setCollapsedOut(new Set(c.output))
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
      // Frozen cells neither run nor grow: a sealed submission is being judged.
      if (frozen) return
      void runCell(cell)
      if (!advance) return
      const next = cells[index + 1]
      if (next) setFocus({ id: next.id, key: Date.now() })
      else insertCell(index, 'code')
    },
    [cells, runCell, insertCell, frozen],
  )

  // Collapsed state, remembered per workbench.
  useEffect(() => {
    if (!doc) return
    try {
      localStorage.setItem(
        collapseKey(workbenchId),
        JSON.stringify({ input: [...collapsedIn], output: [...collapsedOut] }),
      )
    } catch {
      // Storage unavailable: collapse lasts this session.
    }
  }, [doc, workbenchId, collapsedIn, collapsedOut])

  // The kernel's names, for completion, refreshed each time it settles.
  useEffect(() => {
    if (kernel !== 'idle' || !prefs.autocomplete) return
    const t = setTimeout(() => {
      window.engram
        .kernelVars(workbenchId)
        .then((vs) =>
          setKernelNames(
            vs.map((v) => ({
              label: v.name,
              type:
                v.type === 'function'
                  ? 'function'
                  : v.type === 'module'
                    ? 'module'
                    : v.type === 'type'
                      ? 'class'
                      : 'variable',
              detail: v.type,
            })),
          ),
        )
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [kernel, workbenchId, prefs.autocomplete, results])

  const names = useMemo<NotebookName[]>(() => {
    const seen = new Set(kernelNames.map((n) => n.label))
    return [...kernelNames, ...definedNames(cells).filter((n) => !seen.has(n.label))]
  }, [kernelNames, cells])
  const outline = useMemo(() => (inspector === 'outline' ? outlineOf(cells) : []), [inspector, cells])

  const scrollToCell = (id: string) => {
    listRef.current?.querySelector(`[data-cell-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  /** Select a cell in command mode, keeping the keyboard on the notebook. */
  const selectCommand = (id: string | null) => {
    setSelected(id)
    setMode('command')
    if (id) requestAnimationFrame(() => scrollToCell(id))
    listRef.current?.focus({ preventScroll: true })
  }

  const editCell = (id: string) => {
    const cell = cells.find((c) => c.id === id)
    if (!cell) return
    setSelected(id)
    setMode('edit')
    if (cell.kind === 'note' && !frozen) setEditingNotes((s) => new Set(s).add(id))
    setCollapsedIn((s) => {
      if (!s.has(id)) return s
      const n = new Set(s)
      n.delete(id)
      return n
    })
    setFocus({ id, key: Date.now() })
  }

  const toggleIn = (set: typeof setCollapsedIn, id: string) =>
    set((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  function duplicateCell(index: number) {
    const c = cells[index]
    if (!c || c.kind === 'given') return
    const copy = { ...c, id: newCellId() }
    setCells((cs) => [...cs.slice(0, index + 1), copy, ...cs.slice(index + 1)])
    selectCommand(copy.id)
  }

  function pasteAt(index: number) {
    if (!cellClipboard.length) return
    // Pasted cells are the learner's: given cells paste as code.
    const fresh = cellClipboard.map(
      (c) => ({ ...c, id: newCellId(), kind: c.kind === 'given' ? 'code' : c.kind }) as WorkbenchCell,
    )
    setCells((cs) => [...cs.slice(0, index), ...fresh, ...cs.slice(index)])
    selectCommand(fresh[0].id)
  }

  function removeCell(index: number) {
    const c = cells[index]
    if (!c || c.kind === 'given') return
    trash.current.push({ cell: c, index })
    if (trash.current.length > 20) trash.current.shift()
    const next = cells[index + 1] ?? cells[index - 1]
    deleteCell(c.id)
    selectCommand(next?.id ?? null)
  }

  function undoDelete() {
    const t = trash.current.pop()
    if (!t) return
    setCells((cs) => [...cs.slice(0, t.index), t.cell, ...cs.slice(t.index)])
    selectCommand(t.cell.id)
  }

  async function runRange(from: number, to: number) {
    if (!runtimeReady) return
    stopAll.current = false
    setRunningAll(true)
    for (const cell of cells.slice(from, to)) {
      if (stopAll.current) break
      if (cell.kind === 'note') continue
      const ok = await runCell(cell)
      if (!ok) break
    }
    setRunningAll(false)
  }

  function clearOutputs() {
    for (const c of cells) dropResult(workbenchId, c.id)
    setResults({})
  }

  function runCommand(cmd: NotebookCommand) {
    const index = Math.max(
      0,
      cells.findIndex((c) => c.id === selected),
    )
    const cell = cells[index]
    const mutable = !frozen
    const editable = mutable && !!cell && cell.kind !== 'given'
    switch (cmd) {
      case 'up':
        return selectCommand(cells[Math.max(0, index - 1)]?.id ?? null)
      case 'down':
        return selectCommand(cells[Math.min(cells.length - 1, index + 1)]?.id ?? null)
      case 'top':
        return selectCommand(cells[0]?.id ?? null)
      case 'bottom':
        return selectCommand(cells[cells.length - 1]?.id ?? null)
      case 'edit':
        return cell && editCell(cell.id)
      case 'run':
      case 'runAdvance':
        if (!cell || !runtimeReady) return
        void runCell(cell)
        if (cmd === 'runAdvance') {
          const next = cells[index + 1]
          if (next) selectCommand(next.id)
          else if (mutable) insertCell(index, 'code')
        }
        return
      case 'insertAbove':
      case 'insertBelow':
        if (!mutable) return
        insertCell(cmd === 'insertAbove' ? index - 1 : index, 'code')
        return
      case 'delete':
        return editable && removeCell(index)
      case 'undoDelete':
        return mutable && undoDelete()
      case 'toNote':
      case 'toCode':
        if (editable) setKind(cell.id, cmd === 'toNote' ? 'note' : 'code')
        return
      case 'copy':
        if (cell) cellClipboard = [{ ...cell }]
        return
      case 'cut':
        if (!editable) return
        cellClipboard = [{ ...cell }]
        return removeCell(index)
      case 'pasteBelow':
      case 'pasteAbove':
        return mutable && pasteAt(cmd === 'pasteBelow' ? index + 1 : index)
      case 'moveUp':
      case 'moveDown':
        if (editable) moveCell(index, cmd === 'moveUp' ? -1 : 1)
        return
      case 'toggleOutput':
        return cell && toggleIn(setCollapsedOut, cell.id)
      case 'toggleInput':
        return cell && toggleIn(setCollapsedIn, cell.id)
      case 'toggleLineNumbers':
        return setPrefs({ lineNumbers: !prefs.lineNumbers })
      case 'interrupt':
        return interrupt()
      case 'restart':
        return layerReady && restart()
      case 'help':
        return setShowHelp((h) => !h)
    }
  }

  function onListKey(e: React.KeyboardEvent<HTMLDivElement>) {
    // Keys typed into an editor, a note or an input belong to them.
    const t = e.target as HTMLElement
    if (t !== e.currentTarget && (t.closest('.cm-editor') || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    if (e.key === 'Escape') {
      setShowHelp(false)
      return
    }
    const now = Date.now()
    const cmd = commandFor(
      { key: e.key, shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey },
      lastKey.current,
      now,
    )
    lastKey.current = e.metaKey || e.ctrlKey || e.altKey ? null : { key: e.key, at: now }
    if (!cmd) return
    e.preventDefault()
    if (cmd === 'delete' || cmd === 'interrupt' || cmd === 'restart') lastKey.current = null
    if (!selected && cells[0] && cmd !== 'help') setSelected(cells[0].id)
    runCommand(cmd)
  }

  function cellMenu(index: number): MenuItem[] {
    const c = cells[index]
    const editable = !frozen && c.kind !== 'given'
    return [
      { label: 'Run cells above', onSelect: () => void runRange(0, index), disabled: !runtimeReady || index === 0 },
      { label: 'Run this and below', onSelect: () => void runRange(index, cells.length), disabled: !runtimeReady },
      { kind: 'separator' },
      { label: 'Duplicate', onSelect: () => duplicateCell(index), disabled: !editable },
      { label: 'Copy', onSelect: () => (cellClipboard = [{ ...c }]) },
      {
        label: 'Cut',
        onSelect: () => {
          cellClipboard = [{ ...c }]
          removeCell(index)
        },
        disabled: !editable,
      },
      { label: 'Paste below', onSelect: () => pasteAt(index + 1), disabled: frozen || !cellClipboard.length },
      { kind: 'separator' },
      { label: 'Move up', onSelect: () => moveCell(index, -1), disabled: !editable || index === 0 },
      { label: 'Move down', onSelect: () => moveCell(index, 1), disabled: !editable || index === cells.length - 1 },
      { kind: 'separator' },
      { label: collapsedIn.has(c.id) ? 'Show code' : 'Collapse code', onSelect: () => toggleIn(setCollapsedIn, c.id) },
      {
        label: collapsedOut.has(c.id) ? 'Show output' : 'Collapse output',
        onSelect: () => toggleIn(setCollapsedOut, c.id),
      },
      {
        label: 'Clear output',
        onSelect: () => {
          dropResult(workbenchId, c.id)
          setResults(({ [c.id]: _gone, ...rest }) => rest)
        },
      },
      {
        label: c.kind === 'note' ? 'Make it code' : 'Make it a note',
        onSelect: () => setKind(c.id, c.kind === 'note' ? 'code' : 'note'),
        disabled: !editable,
      },
      { kind: 'separator' },
      { label: 'Delete', onSelect: () => removeCell(index), disabled: !editable },
    ]
  }

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
    if (inspector === 'variables') {
      setInspector(null)
      return
    }
    setInspector('variables')
    if (kernel === 'idle') setVars(await window.engram.kernelVars(workbenchId))
  }

  // The variables list follows the kernel while it is open.
  useEffect(() => {
    if (inspector !== 'variables' || kernel !== 'idle') return
    void window.engram
      .kernelVars(workbenchId)
      .then(setVars)
      .catch(() => {})
  }, [inspector, kernel, workbenchId, results])

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
        <Button size="sm" onClick={() => void showVars()} aria-pressed={inspector === 'variables'}>
          Variables
        </Button>
        <Button
          size="sm"
          onClick={() => setInspector((i) => (i === 'outline' ? null : 'outline'))}
          aria-pressed={inspector === 'outline'}
        >
          Outline
        </Button>
        <Button size="sm" onClick={clearOutputs} disabled={busy} title="Clear every cell's output">
          Clear
        </Button>
        <EditorViewMenu prefs={prefs} onChange={setPrefs} />
        <Button size="sm" onClick={() => setShowHelp((h) => !h)} aria-pressed={showHelp} title="Keyboard shortcuts (H)">
          Keys
        </Button>
        <Button
          size="sm"
          onClick={() => void window.engram.workbenchReveal(workbenchId)}
          disabled={frozen}
          title={frozen ? 'Closed while the submission is sealed' : 'Open the folder holding lab.py'}
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

      {showHelp && (
        <div className="mx-6 mt-3 panel px-4 py-3 max-h-72 overflow-auto" role="region" aria-label="Keyboard shortcuts">
          <div className="flex items-center mb-2">
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
              Keyboard · command mode is Esc, then single keys
            </div>
            <button
              className="focus-ring ml-auto text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
              onClick={() => setShowHelp(false)}
            >
              Close
            </button>
          </div>
          <table className="w-full text-xs">
            <tbody>
              {SHORTCUTS.map((k) => (
                <tr key={k.keys}>
                  <td className="label-data pr-4 py-0.5 text-[var(--color-text-primary)] whitespace-nowrap">
                    {k.keys}
                  </td>
                  <td className="py-0.5 text-[var(--color-text-dim)]">{k.does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <div
          ref={listRef}
          tabIndex={-1}
          onKeyDown={onListKey}
          aria-label="Cells"
          className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-3 outline-none"
        >
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
            const isSelected = selected === cell.id
            const inCollapsed = collapsedIn.has(cell.id)
            const outCollapsed = collapsedOut.has(cell.id)
            return (
              <div
                key={cell.id}
                data-cell-id={cell.id}
                onMouseDown={() => setSelected(cell.id)}
                className={`group flex gap-3 min-w-0 border-l-2 -ml-[2px] ${
                  isSelected
                    ? mode === 'command'
                      ? 'border-l-[var(--color-ink-cool)]'
                      : 'border-l-[var(--color-ink-warm)]'
                    : 'border-l-transparent'
                }`}
              >
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
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            setEditingNotes((s) => {
                              const n = new Set(s)
                              n.delete(cell.id)
                              return n
                            })
                            selectCommand(cell.id)
                          }
                        }}
                        onFocus={() => {
                          setSelected(cell.id)
                          setMode('edit')
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
                      {inCollapsed ? (
                        <button
                          className="focus-ring w-full text-left px-3 py-1.5 label-data text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]"
                          onClick={() => toggleIn(setCollapsedIn, cell.id)}
                          title="Show the code"
                        >
                          ⋯{' '}
                          {cell.source
                            .split('\n')
                            .find((l) => l.trim())
                            ?.slice(0, 80) || 'empty cell'}{' '}
                          · {cell.source.split('\n').length} lines
                        </button>
                      ) : (
                        <CodeCellEditor
                          value={cell.source}
                          prefs={prefs}
                          names={names}
                          readOnly={cell.kind === 'given' || frozen}
                          autoFocus={focus?.id === cell.id}
                          focusKey={focus?.id === cell.id ? focus.key : undefined}
                          errorLine={errorOut?.type === 'error' ? errorOut.line : null}
                          onChange={(v) => updateSource(cell.id, v)}
                          onRun={(advance) => runtimeReady && runAndAdvance(index, advance)}
                          onRunInsert={() => {
                            if (!runtimeReady) return
                            void runCell(cell)
                            insertCell(index, 'code')
                          }}
                          onEscape={() => selectCommand(cell.id)}
                          onFocus={() => {
                            setSelected(cell.id)
                            setMode('edit')
                          }}
                        />
                      )}
                      {(r.outputs.length > 0 || r.ms != null) && outCollapsed && (
                        <button
                          className="focus-ring w-full text-left border-t border-[var(--color-hairline)] px-3 py-1 label-data text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]"
                          onClick={() => toggleIn(setCollapsedOut, cell.id)}
                        >
                          Output collapsed · {r.outputs.length} part{r.outputs.length === 1 ? '' : 's'} · show
                        </button>
                      )}
                      {(r.outputs.length > 0 || r.ms != null) && !outCollapsed && (
                        <div className="border-t border-[var(--color-hairline)]">
                          <div
                            style={prefs.outputMaxHeight ? { maxHeight: prefs.outputMaxHeight } : undefined}
                            className={prefs.outputMaxHeight ? 'overflow-auto' : undefined}
                            onDoubleClick={() => toggleIn(setCollapsedOut, cell.id)}
                            title="Double-click to collapse"
                          >
                            <CellOutputs outputs={r.outputs} />
                          </div>
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
                <div
                  className={`w-16 shrink-0 flex flex-col items-start gap-0.5 pt-1.5 transition-opacity text-xs ${
                    isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                  }`}
                >
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
                    <div className="flex gap-1.5">
                      <button
                        className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
                        onClick={() => moveCell(index, -1)}
                        disabled={index === 0}
                        aria-label="Move cell up"
                        title="Move up (Alt+↑)"
                      >
                        ↑
                      </button>
                      <button
                        className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
                        onClick={() => moveCell(index, 1)}
                        disabled={index === cells.length - 1}
                        aria-label="Move cell down"
                        title="Move down (Alt+↓)"
                      >
                        ↓
                      </button>
                    </div>
                  )}
                  <PopoverMenu
                    label="Cell actions"
                    align="left"
                    items={cellMenu(index)}
                    trigger="More"
                    triggerClassName="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
                  />
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
        {inspector && !inspectorPane.collapsed && (
          <>
            <ResizeHandle pane={inspectorPane} edge="start" label="Inspector width" />
            <aside
              style={{ width: inspectorPane.size }}
              className="shrink-0 border-l border-[var(--color-hairline)] overflow-y-auto px-4 py-3 flex flex-col gap-2"
              aria-label={inspector === 'outline' ? 'Outline' : 'Variables'}
            >
              <div className="flex items-center">
                <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
                  {inspector === 'outline' ? 'Outline' : 'Variables'}
                </div>
                <button
                  className="focus-ring ml-auto text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
                  onClick={() => setInspector(null)}
                >
                  Close
                </button>
              </div>
              {inspector === 'outline' ? (
                outline.length === 0 ? (
                  <div className="text-xs text-[var(--color-text-faint)]">
                    Headings in notes and top-level defs and classes show here.
                  </div>
                ) : (
                  <nav className="flex flex-col">
                    {outline.map((o, i) => (
                      <button
                        key={`${o.cellId}-${i}`}
                        onClick={() => selectCommand(o.cellId)}
                        style={{ paddingLeft: `${(Math.min(o.level, 4) - 1) * 10}px` }}
                        className={`focus-ring text-left py-0.5 truncate hover:text-[var(--color-text-primary)] ${
                          o.kind === 'heading'
                            ? 'text-sm text-[var(--color-text-dim)]'
                            : 'label-data text-xs text-[var(--color-text-faint)]'
                        }`}
                      >
                        {o.kind === 'def' ? 'def ' : o.kind === 'class' ? 'class ' : ''}
                        {o.text}
                      </button>
                    ))}
                  </nav>
                )
              ) : kernel !== 'idle' && !vars ? (
                <div className="text-xs text-[var(--color-text-faint)]">
                  The kernel lists its variables once it is idle.
                </div>
              ) : !vars || vars.length === 0 ? (
                <div className="text-xs text-[var(--color-text-faint)]">No variables yet.</div>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {vars.map((v) => (
                      <tr key={v.name} className="align-top">
                        <td className="label-data pr-2 py-0.5 text-[var(--color-text-primary)]">{v.name}</td>
                        <td className="pr-2 py-0.5 text-[var(--color-text-faint)]">{v.type}</td>
                        <td className="py-0.5 text-[var(--color-text-dim)] font-mono break-all">{v.repr}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </aside>
          </>
        )}
      </div>
    </div>
  )
}
