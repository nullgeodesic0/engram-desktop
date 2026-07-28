import { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from './useFocusTrap'
import { buildSearchIndex, fetchTopicEntries, searchEntries, type SearchEntry } from '../shared/searchIndex'
import { recentViews, type RecentView } from '../shared/recentlyViewed'
import { InkNode } from './ui/InkNode'
import { SectionBanner } from './ui/SectionBanner'

interface Command {
  id: string
  label: string
  hint?: string
  action: () => void
  group?: 'Topics' | 'Nodes' | 'Receipts' | 'Artifacts' | 'Recently viewed'
  glyphId?: string
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  navCommands: Command[]
  onGoTopic: (topicId: string) => void
  onGoNode: (topicId: string, nodeId: string) => void
  onGoSitting: (sessionId: string) => void
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
  // Node subtitle is "topic title — claim" (claim folded in purely so it's
  // searchable); only show the topic title as the row's hint.
  const hint = e.kind === 'node' ? e.subtitle?.split(' — ')[0] : e.subtitle
  return {
    id: `${e.kind}:${e.topic}:${e.node ?? e.artifactPath}`,
    label: e.title,
    hint,
    group,
    glyphId: e.node,
    action:
      e.kind === 'artifact'
        ? () => e.artifactPath && window.engram.openArtifact(e.artifactPath)
        : () => e.topic && e.node && onGoNode(e.topic, e.node),
  }
}

function topicEntryToCommand(e: SearchEntry, onGoTopic: (topicId: string) => void): Command {
  return {
    id: `topic:${e.topic}`,
    label: `Continue: ${e.title}`,
    hint: 'Learn',
    group: 'Topics',
    glyphId: e.topic,
    action: () => e.topic && onGoTopic(e.topic),
  }
}

/** A recently-viewed node or sitting (see shared/recentlyViewed.ts), turned
 * into a palette row exactly like any other command. Reuses the same
 * onGoNode/onGoSitting navigation App.tsx already wires everywhere else — a
 * recent row is just a shortcut into the ordinary deep-link path, not a new one. */
function recentEntryToCommand(
  v: RecentView,
  onGoNode: (topicId: string, nodeId: string) => void,
  onGoSitting: (sessionId: string) => void,
): Command {
  if (v.kind === 'node') {
    return {
      id: `recent:node:${v.topic}:${v.node}`,
      label: v.label,
      hint: v.topicTitle,
      group: 'Recently viewed',
      glyphId: v.node,
      action: () => onGoNode(v.topic, v.node),
    }
  }
  return {
    id: `recent:sitting:${v.sessionId}`,
    label: v.label,
    group: 'Recently viewed',
    action: () => onGoSitting(v.sessionId),
  }
}

/** ⌘K — jump to any view, in-progress topic, specific node, past receipt, or
 * artifact by typing, building on the ⌘1–⌘6 shortcuts already in App.tsx.
 * Loads in two phases so the palette doesn't sit blank while the heavy part
 * builds: the topic list resolves immediately from `topics()` (`fastTopics`),
 * while the full index — every topic's graph, plus receipts and artifacts —
 * builds in the background and is cached at module scope by `buildSearchIndex`
 * (see `invalidateSearchIndex`, called from `refreshTopics` in
 * LearnSessionView wherever a topic/node actually changes). Until the full
 * index resolves, `fastTopics` is all `combinedIndex` has to offer. */
export function CommandPalette({ open, onClose, navCommands, onGoTopic, onGoNode, onGoSitting }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [fastTopics, setFastTopics] = useState<SearchEntry[]>([])
  const [fullIndex, setFullIndex] = useState<SearchEntry[] | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, open)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIdx(0)
    setFullIndex(null)
    const deps = {
      topics: window.engram.topics,
      topicGraph: window.engram.topicGraph,
      receiptsHistory: window.engram.receiptsHistory,
      artifactList: window.engram.artifactList,
    }
    fetchTopicEntries(deps).then(setFastTopics)
    buildSearchIndex(deps)
      .then(setFullIndex)
      .catch((err) => {
        // Degrade to nav + topics rather than leaving the palette stuck — keep
        // fullIndex null (not []) so `fullIndex ?? fastTopics` still falls
        // back to the topics-only list instead of an empty combined index.
        console.error('[CommandPalette] failed to build search index', err)
        setFullIndex(null)
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

  const combinedIndex = fullIndex ?? fastTopics
  const q = query.trim().toLowerCase()

  // Topics rank/cap through the same searchEntries pass as everything else
  // once there's a query; with no query it's the plain browse list, as before.
  const ranked = q.length >= 1 ? searchEntries(combinedIndex, q) : []
  const topicCommands: Command[] = (
    q.length >= 1 ? ranked.filter((e) => e.kind === 'topic') : combinedIndex.filter((e) => e.kind === 'topic')
  ).map((e) => topicEntryToCommand(e, onGoTopic))

  // Node/receipt/artifact search only kicks in with a real query — showing
  // every result across every topic by default would drown out the nav/topic
  // commands the palette opens to.
  const searchCommands: Command[] =
    q.length < 2 ? [] : ranked.filter((e) => e.kind !== 'topic').map((e) => entryToCommand(e, onGoNode))

  // Recently viewed — empty-query only, and slotted right under the nav
  // commands (before Topics/Nodes/…) rather than mixed into the search ranking,
  // so it never displaces the nav commands and never touches the two-phase
  // index load above. A plain localStorage read (see recentlyViewed.ts), not
  // state — cheap enough to recompute per render, and it needs no loading phase.
  const recentCommands: Command[] = q ? [] : recentViews().map((v) => recentEntryToCommand(v, onGoNode, onGoSitting))

  const filtered = q
    ? [...navCommands.filter((c) => c.label.toLowerCase().includes(q)), ...topicCommands, ...searchCommands]
    : [...navCommands, ...recentCommands, ...topicCommands, ...searchCommands]

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
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="panel-raised w-full max-w-lg overflow-hidden palette-enter"
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
                {/* Mini section-banner — same hairline-rules-above-and-below
                    grammar as every other group header in the app, just
                    tucked to the row's own px-4. The very first group sits
                    flush under the search input's own border-bottom, so its
                    top rule is dropped (a utility class, not a components-
                    layer override — Tailwind's utilities layer always wins
                    over @layer components regardless of source order, so
                    `border-t-0` reliably beats `.section-banner`'s own
                    border-top here). */}
                {group !== prevGroup && (
                  <SectionBanner label={group} className={`px-4 ${i === 0 ? 'border-t-0' : 'mt-1'}`} />
                )}
                <button
                  onClick={() => run(cmd)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`focus-ring no-press w-full flex items-center justify-between px-4 py-2.5 text-left text-sm border ${
                    i === activeIdx
                      ? 'bg-[var(--color-surface-3)] border-[var(--color-ink-warm)] text-[var(--color-ink-warm)]'
                      : 'border-transparent text-[var(--color-text-primary)]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0 truncate">
                    {cmd.glyphId &&
                      (cmd.group === 'Nodes' || cmd.group === 'Receipts' || cmd.group === 'Artifacts' || cmd.group === 'Recently viewed' ? (
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
        <div className="detail-footer px-4 py-2 shrink-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="kbd-hint">↑↓ navigate</span>
            <span className="text-[var(--color-text-faint)]">·</span>
            <span className="kbd-hint">↵ run</span>
            <span className="text-[var(--color-text-faint)]">·</span>
            <span className="kbd-hint">esc close</span>
          </span>
        </div>
      </div>
    </div>
  )
}
