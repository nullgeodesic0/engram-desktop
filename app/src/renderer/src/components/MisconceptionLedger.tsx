import { useEffect, useState } from 'react'
import type { Misconception } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { Modal } from './ui/Modal'
import { SkeletonBar } from './Skeleton'
import { friendlyErrorText } from '../shared/friendlyError'
import { MathRenderer } from './MathRenderer'
import { CTRL_QUIET, ctrlFilled } from '../shared/controlChrome'

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

/** One ledger row. Open rows carry the quiet manual-resolve affordance (an
 * inline two-step confirm, never a nested modal); resolved rows state their
 * resolution date and, where the app's own provenance store matched, a
 * faint "manual" chip. Provenance is display-only — the grade reads the
 * engine's status alone, so a manual resolve counts exactly like one
 * demonstrated in a sitting; the chip just keeps the audit trail honest. */
function Row({
  row,
  onGoNode,
  onResolve,
  onRetest,
  resolveDisabledReason,
  retestDisabledReason,
  manual,
}: {
  row: Misconception
  onGoNode?: (topicId: string, nodeId: string) => void
  /** Present only on open rows when the ledger's resolve path is wired. */
  onResolve?: (id: string) => Promise<void>
  /** The earned path — launches a targeted review sitting on this row.
   * Visually primary (filled cool, Review's environment accent) beside the
   * quieter manual resolve. */
  onRetest?: (row: Misconception) => void
  /** Non-null disables the manual-resolve affordance with this title text
   * (any live session — the tutor's delivered ledger view must not race). */
  resolveDisabledReason?: string | null
  /** Non-null disables Re-test only (a live REVIEW sitting — review sittings
   * may otherwise start freely, e.g. alongside a live Learn session). */
  retestDisabledReason?: string | null
  /** Manual-resolve provenance for this row, when it exists. */
  manual?: { date: string }
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)

  async function confirmResolve() {
    if (!onResolve || busy) return
    setBusy(true)
    setResolveError(null)
    try {
      await onResolve(row.id)
    } catch (e) {
      setResolveError(friendlyErrorText(e instanceof Error ? e.message : String(e)).headline)
      setBusy(false)
      setConfirming(false)
    }
  }

  const body = (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-[var(--color-text-primary)]">{humanizeNodeId(row.node)}</span>
        <span className="label-data text-[10px] text-[var(--color-text-faint)]">{formatTs(row.ts)}</span>
        {row.status === 'resolved' && (
          <>
            <span className="label-data text-[10px] text-[var(--color-ink-warm)]">
              resolved {formatTs(row.resolved_ts ?? row.ts)}
            </span>
            {manual && (
              <span className="label-data text-[9px] uppercase tracking-[0.14em] px-1 py-0.5 border border-[var(--color-edge)] text-[var(--color-text-faint)]">
                manual
              </span>
            )}
          </>
        )}
      </div>
      <MathRenderer text={row.description} className="text-xs text-[var(--color-text-dim)] leading-snug" />
      {resolveError && <div className="fig-caption text-[var(--color-ink-danger)]">couldn’t resolve: {resolveError}</div>}
    </div>
  )

  const bodySeat = onGoNode ? (
    <button
      onClick={() => onGoNode(row.topic, row.node)}
      className="focus-ring text-left flex-1 min-w-0 hover:opacity-90 transition-opacity"
    >
      {body}
    </button>
  ) : (
    <div className="flex-1 min-w-0">{body}</div>
  )

  return (
    <div className="tilt-card panel px-3 py-2.5 flex items-start justify-between gap-3">
      {bodySeat}
      {(onResolve || onRetest) && row.status === 'open' && (
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          {onRetest && !confirming && (
            <button
              onClick={() => onRetest(row)}
              disabled={retestDisabledReason != null}
              className={`${ctrlFilled('cool')} disabled:opacity-40`}
              title={retestDisabledReason ?? 'Launch a review sitting targeted at this misconception'}
            >
              Re-test
            </button>
          )}
          {onResolve && confirming ? (
            <>
              <button
                onClick={confirmResolve}
                disabled={busy || resolveDisabledReason != null}
                className={`${CTRL_QUIET} disabled:opacity-40`}
                title={resolveDisabledReason ?? 'Counts like any resolution — the grade reads engine status only'}
              >
                {busy ? 'Resolving…' : 'Resolve'}
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy} className={CTRL_QUIET}>
                Cancel
              </button>
            </>
          ) : onResolve ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={resolveDisabledReason != null}
              className={`${CTRL_QUIET} disabled:opacity-40`}
              title={resolveDisabledReason ?? 'Mark this entry resolved without a sitting (for stale or duplicate filings)'}
            >
              Mark resolved
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** The misconception ledger — a browsable record of what the engine has
 * noticed about the learner's model of the world, so it can re-test it
 * later. Deliberately not framed as a debt or an alarm (no danger ink, no
 * "you still owe" language) — the same absolve-never-pity voice LapseRite
 * uses for a lapse applies here: a misconception is a recorded fact, not a
 * failure. Grouped by topic, open items shown plainly, resolved ones tucked
 * behind a disclosure per topic (worth keeping, not worth dwelling on).
 * Each row deep-links to that node's map entry via `onGoNode`.
 *
 * Manual resolution rides the app's one action-gated mutation door
 * (engram:misconceptionResolve — see readOnly.ts's doctrine comment) and is
 * DISABLED while any session is live: the engine's advisory lock makes the
 * write mechanically safe, but a mid-sitting resolve races the tutor's
 * already-delivered view of the open ledger. */
export function MisconceptionLedger({
  open,
  onClose,
  onGoNode,
  onResolved,
  onRetest,
  reviewSessionLive,
}: {
  open: boolean
  onClose: () => void
  onGoNode?: (topicId: string, nodeId: string) => void
  /** Fired after a manual resolve lands, so hosts can refresh their own
   * misconception-derived surfaces (Coach's teaser count, grades). */
  onResolved?: () => void
  /** The earned path — closes the ledger and launches a review sitting
   * targeted at the row (App's retest deep-link). */
  onRetest?: (row: Misconception) => void
  /** True while a review sitting is live (App's activity state) — gates
   * Re-test only; manual resolve gates on ANY live session separately. */
  reviewSessionLive?: boolean
}) {
  const [rows, setRows] = useState<Misconception[] | null>(null)
  const [manualResolves, setManualResolves] = useState<Record<string, { date: string }>>({})
  const [sessionLive, setSessionLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Modal unmounts its children whenever `open` is false (see Modal.tsx), so
  // this only actually runs while showing — but keying off `open` explicitly
  // (rather than mount) means reopening after a failed read tries again, and
  // `refreshKey` re-runs it in place after a manual resolve.
  useEffect(() => {
    if (!open) return
    setRows(null)
    setError(null)
    window.engram
      .misconceptions()
      .then(setRows)
      .catch((e: Error) => setError(e.message))
    window.engram
      .misconceptionManualResolves()
      .then(setManualResolves)
      .catch(() => setManualResolves({}))
    window.engram
      .anySessionActive()
      .then(setSessionLive)
      .catch(() => setSessionLive(false))
  }, [open, refreshKey])

  const groups = rows ? groupByTopic(rows) : []
  const openCount = rows ? rows.filter((r) => r.status === 'open').length : 0

  function goto(topicId: string, nodeId: string) {
    onClose()
    onGoNode?.(topicId, nodeId)
  }

  async function resolve(id: string): Promise<void> {
    // Re-check at confirm time — the modal may have been sitting open while
    // a sitting started elsewhere. The engine's lock backstops the rest.
    if (await window.engram.anySessionActive()) {
      setSessionLive(true)
      throw new Error('a sitting is live — finish it first')
    }
    await window.engram.misconceptionResolve(id)
    setRefreshKey((k) => k + 1)
    onResolved?.()
  }

  const resolveDisabledReason = sessionLive ? 'a sitting is live — finish it first' : null
  const retestDisabledReason = reviewSessionLive ? 'a review sitting is already live' : null

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
                    <Row
                      key={row.id}
                      row={row}
                      onGoNode={onGoNode ? goto : undefined}
                      onResolve={resolve}
                      onRetest={
                        onRetest
                          ? (r) => {
                              onClose()
                              onRetest(r)
                            }
                          : undefined
                      }
                      resolveDisabledReason={resolveDisabledReason}
                      retestDisabledReason={retestDisabledReason}
                    />
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
                      <Row key={row.id} row={row} onGoNode={onGoNode ? goto : undefined} manual={manualResolves[row.id]} />
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
