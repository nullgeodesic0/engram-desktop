import { useEffect, useRef, useState } from 'react'
import type { TopicSummary, TopicGraph } from '../../../shared/types'
import { useFocusTrap } from './useFocusTrap'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { InkNode } from './ui/InkNode'

interface Command {
  id: string
  label: string
  hint?: string
  action: () => void
  group?: 'Topics' | 'Nodes'
  glyphId?: string
}

interface NodeMatch {
  topic: string
  topicTitle: string
  node: string
  claim: string
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  navCommands: Command[]
  onGoTopic: (topicId: string) => void
  onGoNode: (topicId: string, nodeId: string) => void
}

/** ⌘K — jump to any view, in-progress topic, or specific node by typing, building
 * on the ⌘1–⌘6 shortcuts already in App.tsx. Everything is fetched lazily on open
 * rather than kept live in App.tsx state, since it's only needed while the
 * palette is actually open — including every topic's full graph, for the node
 * search below. Fine at current scale (a handful of topics, well under 100
 * nodes total); revisit with a real index if that changes. */
export function CommandPalette({ open, onClose, navCommands, onGoTopic, onGoNode }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [topics, setTopics] = useState<TopicSummary[]>([])
  const [nodeMatches, setNodeMatches] = useState<NodeMatch[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, open)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIdx(0)
    window.engram.topics().then((ts) => {
      setTopics(ts)
      Promise.all(
        ts.map((t) =>
          window.engram
            .topicGraph(t.topic)
            .then((g) => g as TopicGraph)
            .catch(() => null),
        ),
      ).then((graphs) => {
        const matches: NodeMatch[] = []
        for (const g of graphs) {
          if (!g) continue
          for (const id of g.order) {
            const node = g.nodes[id]
            if (!node) continue
            matches.push({ topic: g.topic, topicTitle: g.title, node: id, claim: node.claim })
          }
        }
        setNodeMatches(matches)
      })
    })
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

  const topicCommands: Command[] = topics.map((t) => ({
    id: `topic:${t.topic}`,
    label: `Continue: ${t.title}`,
    hint: 'Learn',
    group: 'Topics',
    glyphId: t.topic,
    action: () => onGoTopic(t.topic),
  }))

  const q = query.trim().toLowerCase()

  // Node search only kicks in with a real query — showing every node across every
  // topic by default would drown out the nav/topic commands the palette opens to.
  const nodeCommands: Command[] =
    q.length < 2
      ? []
      : nodeMatches
          .filter(
            (m) => m.claim.toLowerCase().includes(q) || humanizeNodeId(m.node).toLowerCase().includes(q) || m.node.toLowerCase().includes(q),
          )
          .slice(0, 20)
          .map((m) => ({
            id: `node:${m.topic}:${m.node}`,
            label: humanizeNodeId(m.node),
            hint: m.topicTitle,
            group: 'Nodes' as const,
            glyphId: m.node,
            action: () => onGoNode(m.topic, m.node),
          }))

  const all = [...navCommands, ...topicCommands, ...nodeCommands]
  const filtered = q ? all.filter((c) => c.label.toLowerCase().includes(q) || nodeCommands.includes(c)) : all

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
                      (cmd.group === 'Nodes' ? (
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
