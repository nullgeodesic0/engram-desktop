import { useMemo, useState } from 'react'
import type { EngramNode, NodeState, TopicGraph } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { stateLabel, formatMonthDay } from '../shared/nodeDisplay'
import { DUE_LENS_COLOR, STATE_COLOR, dueStatusFor } from './GraphView'

type SortKey = 'node' | 'state' | 'stability' | 'due' | 'reps' | 'threshold'
type SortDir = 'asc' | 'desc'
type FilterKey = 'due' | 'threshold' | 'lapsing' | 'unencoded'

const STATE_RANK: Record<NodeState, number> = { new: 0, learning: 1, review: 2 }

const FILTER_LABEL: Record<FilterKey, string> = {
  due: 'Due',
  threshold: 'Threshold',
  lapsing: 'Lapsing',
  unencoded: 'Unencoded',
}

const FILTER_ORDER: FilterKey[] = ['due', 'threshold', 'lapsing', 'unencoded']

/** The four facet predicates from the brief — kept as pure functions of a
 * single node so both the filter-chip counts and the row filtering below
 * read from exactly one definition each. "due" reuses dueStatusFor's
 * semantics rather than re-deriving overdue/today from fsrs.due itself. */
function matchesFilter(key: FilterKey, node: EngramNode): boolean {
  switch (key) {
    case 'due': {
      const status = dueStatusFor(node)
      return status === 'overdue' || status === 'today'
    }
    case 'threshold':
      return node.threshold
    case 'lapsing':
      return node.fsrs.lapses > 0
    case 'unencoded':
      return node.state === 'new'
  }
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'node', label: 'Node' },
  { key: 'state', label: 'State' },
  { key: 'stability', label: 'Stability' },
  { key: 'due', label: 'Due' },
  { key: 'reps', label: 'Reps / Lapses' },
  { key: 'threshold', label: 'Threshold' },
]

function compareBy(key: SortKey, graph: TopicGraph, a: string, b: string): number {
  const na = graph.nodes[a]
  const nb = graph.nodes[b]
  switch (key) {
    case 'node':
      return humanizeNodeId(a).localeCompare(humanizeNodeId(b))
    case 'state':
      return STATE_RANK[na.state] - STATE_RANK[nb.state]
    case 'stability':
      // No stability yet (never encoded) sorts as the lowest value in either
      // direction — a null is "less scheduled", not "more" or "less" days.
      return (na.fsrs.s ?? -1) - (nb.fsrs.s ?? -1)
    case 'due':
      // ISO YYYY-MM-DD strings compare correctly lexicographically; a node
      // with no due date sorts first (empty string < any real date).
      return (na.fsrs.due ?? '').localeCompare(nb.fsrs.due ?? '')
    case 'reps':
      // Reps is the primary key, lapses the tiebreak — one combined column
      // per the brief, sorted by its more common axis of interest first.
      return na.fsrs.reps - nb.fsrs.reps || na.fsrs.lapses - nb.fsrs.lapses
    case 'threshold':
      return Number(na.threshold) - Number(nb.threshold)
  }
}

/** Node table — a peer of GraphView inside the same plate container, toggled
 * from the plate's own header. Reads the identical TopicGraph the map holds;
 * row click sets `selectedNode` on the SAME drawer the map opens, so this
 * file owns no detail surface of its own.
 *
 * The capstone node is excluded here, matching plateStats' own territory
 * framing (see plate.ts's plateStats doc comment) — it's a synthetic
 * "mastery of everything" marker with no schedule of its own to browse, and
 * excluding it is what lets this table's filter counts reconcile exactly
 * with plateStats' total/encoded/consolidated/thresholds numbers. It's still
 * reachable and selectable on the map itself; only this row-dense browsing
 * view leaves it out. */
export function NodeTable({
  graph,
  selectedNode,
  onSelectNode,
}: {
  graph: TopicGraph
  selectedNode: string | null
  onSelectNode: (id: string) => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>('node')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set())

  const territoryIds = useMemo(() => graph.order.filter((id) => !graph.nodes[id]?.capstone), [graph])

  // Counts per facet over the WHOLE territory (not the current filtered
  // subset) — clicking one chip doesn't move another chip's number, so each
  // one keeps answering "how many nodes in this topic match this?".
  const filterCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = { due: 0, threshold: 0, lapsing: 0, unencoded: 0 }
    for (const id of territoryIds) {
      const node = graph.nodes[id]
      if (!node) continue
      for (const key of FILTER_ORDER) {
        if (matchesFilter(key, node)) counts[key]++
      }
    }
    return counts
  }, [territoryIds, graph])

  function toggleFilter(key: FilterKey) {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const rows = useMemo(() => {
    const filtered = territoryIds.filter((id) => {
      const node = graph.nodes[id]
      if (!node) return false
      for (const key of activeFilters) {
        if (!matchesFilter(key, node)) return false
      }
      return true
    })
    const sign = sortDir === 'asc' ? 1 : -1
    return filtered.sort((a, b) => sign * compareBy(sortKey, graph, a, b))
  }, [territoryIds, graph, activeFilters, sortKey, sortDir])

  return (
    <div className="h-full flex flex-col">
      <div role="group" aria-label="Filter nodes" className="shrink-0 flex items-center gap-1.5 px-3 py-2 flex-wrap">
        {FILTER_ORDER.map((key) => {
          const pressed = activeFilters.has(key)
          return (
            <button
              key={key}
              onClick={() => toggleFilter(key)}
              aria-pressed={pressed}
              className={`focus-ring label-data text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border transition-colors ${
                pressed
                  ? 'bg-[var(--color-surface-3)] border-[var(--color-ink-warm)] text-[var(--color-ink-warm)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {FILTER_LABEL[key]} <span className="label-data">{filterCounts[key]}</span>
            </button>
          )
        })}
        {activeFilters.size > 0 && (
          <button
            onClick={() => setActiveFilters(new Set())}
            className="focus-ring text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] px-1.5"
          >
            clear
          </button>
        )}
        <span className="label-data text-[10px] text-[var(--color-text-faint)] ml-auto">
          {rows.length}/{territoryIds.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-[var(--color-surface)] z-10">
            <tr className="border-b border-[var(--color-hairline)]">
              {COLUMNS.map((col) => {
                const active = sortKey === col.key
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="text-left font-normal py-1.5 pr-3 first:pl-0"
                  >
                    <button
                      onClick={() => toggleSort(col.key)}
                      className={`focus-ring label-data text-[10px] uppercase tracking-wide flex items-center gap-1 whitespace-nowrap ${
                        active ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]'
                      }`}
                    >
                      {col.label}
                      <span className="w-2.5 inline-block">{active ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-[var(--color-hairline)] [&>tr:last-child]:border-b-0">
            {rows.map((id) => {
              const node = graph.nodes[id]
              const dueStatus = dueStatusFor(node)
              const isSelected = selectedNode === id
              return (
                <tr
                  key={id}
                  onClick={() => onSelectNode(id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'bg-[var(--color-surface-3)]' : 'hover:bg-[var(--color-surface-2)]/60'
                  }`}
                >
                  <td className="py-1.5 pr-3 first:pl-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectNode(id)
                      }}
                      title={id}
                      className="focus-ring text-left text-[var(--color-text-primary)] hover:text-[var(--color-ink-warm)]"
                    >
                      {humanizeNodeId(id)}
                    </button>
                  </td>
                  <td className="py-1.5 pr-3" style={{ color: STATE_COLOR[node.state] }}>
                    {stateLabel(node.state)}
                  </td>
                  <td className="label-data py-1.5 pr-3 text-[var(--color-text-dim)]">
                    {node.fsrs.s != null ? `${node.fsrs.s.toFixed(1)}d` : '—'}
                  </td>
                  <td
                    className="label-data py-1.5 pr-3"
                    style={{ color: dueStatus ? DUE_LENS_COLOR[dueStatus] : 'var(--color-text-faint)' }}
                    title={node.fsrs.due ?? undefined}
                  >
                    {node.fsrs.due ? formatMonthDay(node.fsrs.due) : '—'}
                  </td>
                  <td className="label-data py-1.5 pr-3 text-[var(--color-text-dim)]">
                    {node.fsrs.reps} / {node.fsrs.lapses}
                  </td>
                  <td className="py-1.5 pr-3 text-[var(--color-ink-hot)]">{node.threshold ? '†' : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="fig-caption px-1 py-4">No nodes match the current filters.</div>}
      </div>
    </div>
  )
}
