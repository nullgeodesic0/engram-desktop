import { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from './useFocusTrap'
import { buildSearchIndex, searchEntries, type SearchEntry } from '../shared/searchIndex'
import { InkNode } from './ui/InkNode'

interface Command {
  id: string
  label: string
  hint?: string
  action: () => void
  group?: 'Topics' | 'Nodes' | 'Receipts' | 'Artifacts'
  glyphId?: string
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  navCommands: Command[]
  onGoTopic: (topicId: string) => void
  onGoNode: (topicId: string, nodeId: string) => void
}

const GROUP_BY_KIND: Record<'node' | 'receipt' | 'artifact', Command['group']> = {
  node: 'Nodes',
  receipt: 'Receipts',
  artifact: 'Artifacts',
}

/** Node/receipt entries both land on the node in the topic map; artifacts open
 * their file directly. `e.topic`/`e.node`/`e.artifactPath` are always set for
 * these three kinds — see how `buildSearchIndex` constructs them. */
function entryToCommand(e: SearchEntry, onGoNode: (topicId: string, nodeId: string) => void): Command {
  const group = GROUP_BY_KIND[e.kind as 'node' | 'receipt' | 'artifact']
  return {
    id: `${e.kind}:${e.topic}:${e.node ?? e.artifactPath}`,
    label: e.title,
    hint: e.subtitle,
    group,
    glyphId: e.node,
    action:
      e.kind === 'artifact'
        ? () => e.artifactPath && window.engram.openArtifact(e.artifactPath)
        : () => e.topic && e.node && onGoNode(e.topic, e.node),
  }
}

/** ⌘K — jump to any view, in-progress topic, specific node, past receipt, or
 * artifact by typing, building on the ⌘1–⌘6 shortcuts already in App.tsx. The
 * search index (nodes/receipts/artifacts, built from every topic's graph) is
 * fetched once and cached at module scope by `buildSearchIndex` — App.tsx
 * invalidates it whenever topics are refreshed, so reopening the palette
 * afterwards rebuilds. Topics themselves are re-derived from the index each
 * open rather than fetched separately. */
export function CommandPalette({ open, onClose, navCommands, onGoTopic, onGoNode }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<SearchEntry[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, open)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIdx(0)
    buildSearchIndex({
      topics: window.engram.topics,
      topicGraph: window.engram.topicGraph,
      receiptsHistory: window.engram.receiptsHistory,
      artifactList: window.engram.artifactList,
    }).then(setIndex)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const topicCommands: Command[] = index
    .filter((e) => e.kind === 'topic' && e.topic)
    .map((t) => ({
      id: `topic:${t.topic}`,
      label: `Continue: ${t.title}`,
      hint: 'Learn',
      group: 'Topics',
      glyphId: t.topic,
      action: () => onGoTopic(t.topic as string),
    }))

  const q = query.trim().toLowerCase()

  // Node/receipt/artifact search only kicks in with a real query — showing
  // every result across every topic by default would drown out the nav/topic
  // commands the palette opens to.
  const searchCommands: Command[] =
    q.length < 2
      ? []
      : searchEntries(index, q)
          .filter((e) => e.kind === 'node' || e.kind === 'receipt' || e.kind === 'artifact')
          .map((e) => entryToCommand(e, onGoNode))

  const all = [...navCommands, ...topicCommands, ...searchCommands]
  const filtered = q ? all.filter((c) => c.label.toLowerCase().includes(q) || searchCommands.includes(c)) : all

  function run(cmd: Command) {
    cmd.action()
    onClose()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && filtered[activeIdx]) {
      run(filtered[activeIdx])
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-32 z-50 p-8" onClick={onClose}>
      <div
        ref={containerRef}
        className="panel-raised w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIdx(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search the atlas…"
          className="w-full px-4 py-3.5 text-sm bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] border-b border-[var(--color-hairline)] focus:outline-none"
        />
        <div className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-sm text-[var(--color-text-faint)]">No matches</div>
          )}
          {filtered.map((cmd, i) => {
            const group = cmd.group ?? 'Views'
            const prevGroup = i > 0 ? filtered[i - 1].group ?? 'Views' : null
            return (
              <div key={cmd.id}>
                {group !== prevGroup && <div className="fig-caption px-3 pt-2 pb-1">{group}</div>}
                <button
                  onClick={() => run(cmd)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`focus-ring no-press w-full flex items-center justify-between px-4 py-2.5 text-left text-sm ${
                    i === activeIdx ? 'bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]' : 'text-[var(--color-text-primary)]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0 truncate">
                    {cmd.glyphId &&
                      (cmd.group === 'Nodes' || cmd.group === 'Receipts' || cmd.group === 'Artifacts' ? (
                        <InkNode id={cmd.glyphId} variant="outlined" color="var(--color-ink-cool)" size={12} />
                      ) : (
                        <InkNode id={cmd.glyphId} variant="filled" size={12} />
                      ))}
                    <span className="truncate">{cmd.label}</span>
                  </span>
                  {cmd.hint && <span className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0 ml-3">{cmd.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
