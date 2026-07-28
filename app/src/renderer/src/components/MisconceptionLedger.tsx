import { useEffect, useState } from 'react'
import type { Misconception } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { Modal } from './ui/Modal'
import { SkeletonBar } from './Skeleton'
import { friendlyErrorText } from '../shared/friendlyError'
import { MathRenderer } from './MathRenderer'

/** `ts` is a local YYYY-MM-DD string (engram.py's own `date.today()`) — parsed
 * without a `Z` suffix so it reads as local midnight, same discipline every
 * other date display in this app already follows (see TopicMapView's
 * formatProvenanceDate / LapseRite's formatReturnDate). */
function formatTs(ts: string): string {
  return new Date(`${ts}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface TopicGroup {
  topic: string
  open: Misconception[]
  resolved: Misconception[]
}

function groupByTopic(rows: Misconception[]): TopicGroup[] {
  const map = new Map<string, TopicGroup>()
  for (const row of rows) {
    let g = map.get(row.topic)
    if (!g) {
      g = { topic: row.topic, open: [], resolved: [] }
      map.set(row.topic, g)
    }
    ;(row.status === 'open' ? g.open : g.resolved).push(row)
  }
  // Newest first within each bucket.
  for (const g of map.values()) {
    g.open.sort((a, b) => (a.ts < b.ts ? 1 : -1))
    g.resolved.sort((a, b) => (a.ts < b.ts ? 1 : -1))
  }
  return Array.from(map.values()).sort((a, b) => a.topic.localeCompare(b.topic))
}

function Row({ row, onGoNode }: { row: Misconception; onGoNode?: (topicId: string, nodeId: string) => void }) {
  const body = (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-[var(--color-text-primary)]">{humanizeNodeId(row.node)}</span>
        <span className="label-data text-[10px] text-[var(--color-text-faint)]">{formatTs(row.ts)}</span>
      </div>
      <MathRenderer text={row.description} className="text-xs text-[var(--color-text-dim)] leading-snug" />
    </div>
  )
  if (!onGoNode) {
    return <div className="tilt-card panel px-3 py-2.5">{body}</div>
  }
  return (
    <button
      onClick={() => onGoNode(row.topic, row.node)}
      className="focus-ring tilt-card panel px-3 py-2.5 text-left w-full hover:border-[var(--color-text-faint)] transition-colors"
    >
      {body}
    </button>
  )
}

/** The misconception ledger — a browsable record of what the engine has
 * noticed about the learner's model of the world, so it can re-test it
 * later. Deliberately not framed as a debt or an alarm (no danger ink, no
 * "you still owe" language) — the same absolve-never-pity voice LapseRite
 * uses for a lapse applies here: a misconception is a recorded fact, not a
 * failure. Grouped by topic, open items shown plainly, resolved ones tucked
 * behind a disclosure per topic (worth keeping, not worth dwelling on).
 * Each row is a real link to that node's map entry via `onGoNode` — the same
 * deep-link plumbing App.tsx already wires from the command palette, reused
 * here rather than invented twice. */
export function MisconceptionLedger({
  open,
  onClose,
  onGoNode,
}: {
  open: boolean
  onClose: () => void
  onGoNode?: (topicId: string, nodeId: string) => void
}) {
  const [rows, setRows] = useState<Misconception[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Modal unmounts its children whenever `open` is false (see Modal.tsx), so
  // this only actually runs while showing — but keying off `open` explicitly
  // (rather than mount) means reopening after a failed read tries again.
  useEffect(() => {
    if (!open) return
    setRows(null)
    setError(null)
    window.engram
      .misconceptions()
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }, [open])

  const groups = rows ? groupByTopic(rows) : []
  const openCount = rows ? rows.filter((r) => r.status === 'open').length : 0

  function goto(topicId: string, nodeId: string) {
    onClose()
    onGoNode?.(topicId, nodeId)
  }

  return (
    <Modal open={open} onClose={onClose} title="Misconceptions" wide>
      <div className="flex flex-col gap-5">
        <p className="fig-caption">
          Fig. — what the engine has noticed about your model of the world, filed for re-testing.
        </p>

        {error &&
          (() => {
            const fe = friendlyErrorText(error)
            return (
              <div className="panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)]">
                <div>Couldn’t read the ledger: {fe.headline}</div>
                {fe.detail && (
                  <details className="mt-1 text-xs text-[var(--color-text-faint)]">
                    <summary className="cursor-pointer">raw error</summary>
                    <div className="mt-1">{fe.detail}</div>
                  </details>
                )}
              </div>
            )
          })()}

        {!error && rows === null && (
          <div className="flex flex-col gap-2">
            <SkeletonBar height={54} />
            <SkeletonBar height={54} />
          </div>
        )}

        {!error && rows !== null && rows.length === 0 && (
          <div className="fig-caption">Nothing filed yet.</div>
        )}

        {!error && rows !== null && rows.length > 0 && openCount === 0 && (
          <div className="fig-caption">Nothing open right now — what’s below is already squared away.</div>
        )}

        {!error &&
          groups.map((g) => (
            <div key={g.topic} className="flex flex-col gap-2">
              <div className="label-data uppercase tracking-wide text-[10px] text-[var(--color-text-faint)]">
                {g.topic}
              </div>
              {g.open.length > 0 && (
                <div className="flex flex-col gap-2">
                  {g.open.map((row) => (
                    <Row key={row.id} row={row} onGoNode={onGoNode ? goto : undefined} />
                  ))}
                </div>
              )}
              {g.resolved.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs label-data text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]">
                    {g.resolved.length} resolved
                  </summary>
                  <div className="flex flex-col gap-2 mt-2">
                    {g.resolved.map((row) => (
                      <Row key={row.id} row={row} onGoNode={onGoNode ? goto : undefined} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
      </div>
    </Modal>
  )
}
