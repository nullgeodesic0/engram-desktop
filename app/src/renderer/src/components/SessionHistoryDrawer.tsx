import { useEffect, useRef, useState } from 'react'
import type { ExportSittingFormat, ExportSittingResult, SessionIndexEntry } from '../../../shared/types'
import type { ChatMessage } from '../../../shared/chatMessages'
import { parseGradeResult, parseGradeResults, type GradeResult } from '../../../shared/gradeResult'
import { deriveRitualMarks, type DerivedRitualMark } from '../../../shared/ritualFromTranscript'
import { sittingToMarkdown, sittingToPrintHtml, type SittingMeta } from '../shared/sittingToMarkdown'
import { Modal } from './ui/Modal'
import { ChatMessageView } from './ChatMessageView'
import { GradeResultCard } from './GradeResultCard'
import { MarkView } from './ritual/Marks'

interface TranscriptLine {
  type?: string
  /** ISO timestamp on the raw transcript entry — same field
   * ritualFromTranscript.ts's `walkTranscript` reads for the lapse rite's
   * date anchor. Needed here so a replayed grade card's interval ladder can
   * time-bound itself to the sitting it belongs to (see GradeBatch.date)
   * instead of reading receipts up through today. */
  timestamp?: string
  message?: {
    content?: string | { type?: string; text?: string; content?: unknown }[]
  }
}

// Local-date discipline (getFullYear/Month/Date — never toISOString), same
// pattern this codebase uses everywhere a timestamp needs to become a
// calendar day rather than a UTC instant.
function localDateFromIso(ts: string | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface GradeBatch {
  id: string
  /** Same convention as LearnSessionView's `marks` — the message-array length
   * at the moment the receipt/rate tool_result landed, so the card slots in
   * right after the turn that produced it. */
  atIndex: number
  results: GradeResult[]
  /** The raw transcript-line index of the tool_result entry this batch was
   * parsed from — same convention as `ProvenanceEvent.anchor` (see
   * shared/types.ts), so an anchor can be matched to a batch by equality. */
  sourceIndex: number
  /** Local 'YYYY-MM-DD' this batch's tool_result line was timestamped, or
   * null when the raw line carried no usable timestamp — passed straight
   * through to GradeResultCard's `asOfDate` prop (time-bounds the interval
   * ladder to this sitting). Never falls back to "today" here; a missing
   * date just means the ladder renders as of today, same as before this
   * field existed — never fabricated. */
  date: string | null
}

/** Rebuilds both the chat transcript AND its grade-receipt cards from a raw
 * session transcript, read-only. Message shaping mirrors
 * `parseTranscriptToMessages` exactly (same merge rule, same synthetic-first-
 * turn skip) — kept as a local superset here rather than editing that shared
 * helper, so live-session hydration behavior is untouched. Grade cards are
 * recovered by attempting both the batch (Learn's `receipt`) and single
 * (Review's `rate`) parsers on every tool_result — both parsers already
 * validate shape strictly (a `rating` in a known enum, a string `node`), so
 * this doesn't require re-deriving which Bash command produced it.
 *
 * Durable ritual marks (beat cards + node crossings) come from
 * `deriveRitualMarks` (`shared/ritualFromTranscript.ts`), which replays the
 * same skip/merge index rules independently — its `atIndex` values already
 * line up with this function's `messages` array without any extra bookkeeping
 * here. */
export function buildHistoryTimeline(
  rawLines: unknown[],
): { messages: ChatMessage[]; grades: GradeBatch[]; messageSourceIndex: number[]; marks: DerivedRitualMark[] } {
  const lines = rawLines as TranscriptLine[]
  const messages: ChatMessage[] = []
  // Parallel to `messages` — the raw transcript-line index each message was
  // first created from (see GradeBatch.sourceIndex for the matching grade-side
  // field, and ProvenanceEvent.anchor in shared/types.ts for the convention
  // both are keyed against). An assistant message that grows by merging text
  // blocks from later lines keeps the index of the line that STARTED it.
  const messageSourceIndex: number[] = []
  const grades: GradeBatch[] = []
  let seenFirstUser = false
  let idCounter = 0
  let gradeSeq = 0

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    if (line.type === 'user' && typeof line.message?.content === 'string') {
      if (!seenFirstUser) {
        seenFirstUser = true
        continue // the app's own synthetic kickoff — not a real human message
      }
      messages.push({ id: `t${idCounter++}`, role: 'user', text: line.message.content })
      messageSourceIndex.push(idx)
      continue
    }

    if (line.type === 'assistant' && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (block.type !== 'text' || !block.text) continue
        const last = messages[messages.length - 1]
        if (last && last.role === 'assistant') {
          last.text += block.text
        } else {
          messages.push({ id: `t${idCounter++}`, role: 'assistant', text: block.text })
          messageSourceIndex.push(idx)
        }
      }
      continue
    }

    if (line.type === 'user' && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (block.type !== 'tool_result') continue
        const batch = parseGradeResults(block.content)
        const results = batch.length > 0 ? batch : (() => {
          const single = parseGradeResult(block.content)
          return single ? [single] : []
        })()
        if (results.length > 0) {
          grades.push({
            id: `g${gradeSeq++}`,
            atIndex: messages.length,
            results,
            sourceIndex: idx,
            date: localDateFromIso(line.timestamp),
          })
        }
      }
    }
  }

  return { messages, grades, messageSourceIndex, marks: deriveRitualMarks(rawLines) }
}

/** The lab-notebook export's single entry point — shared by the drawer's own
 * per-sitting Export buttons below AND LearnSessionView/ReviewSessionView's
 * "export the open sitting" header actions, so every export surface goes
 * through the exact same rebuild-timeline → assemble-document → hand-to-main
 * path rather than each call site re-deriving its own shape. Always rebuilds
 * from a fresh `getTranscript` read (never a caller's own in-memory message
 * state) — for a still-running sitting this means the export reflects
 * whatever's landed on disk so far, same as replaying that sitting in this
 * drawer would show; nothing from `sessionId`'s live ephemera (beat trail,
 * jobs rail, …) is or could be included, matching this module's read-only
 * contract. */
export async function exportSittingTranscript(
  sessionId: string,
  format: ExportSittingFormat,
  meta: SittingMeta,
): Promise<ExportSittingResult> {
  const lines = await window.engram.getTranscript(sessionId)
  const { messages, grades } = buildHistoryTimeline(lines)
  const content =
    format === 'md'
      ? { markdown: sittingToMarkdown(messages, grades, meta) }
      : { printHtml: sittingToPrintHtml(messages, grades, meta) }
  return window.engram.exportSitting({ format, title: meta.title, ...content })
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  )
}

/** Read-only browser for past sittings on a topic (Learn) or the review queue
 * (Review). Fully self-contained: its own list/selection/transcript state,
 * no reach into the live session view that opened it, and no path to
 * `startSession`/`resumeSession` — selecting an entry only ever replays a
 * transcript already on disk. Marks/ephemera (beat trail, jobs rail, atlas
 * plates, …) are live-session-only and are never reconstructed here; tickets
 * and grade receipts ARE reconstructed, since both are exact-parsed from the
 * transcript itself. */
export function SessionHistoryDrawer({
  historyKey,
  title,
  open,
  onClose,
  initialSessionId,
  anchorIndex,
}: {
  /** A topic id for Learn history, or the literal string 'review' for Review
   * history — mirrors how `sessionHistoryFor`'s key space works server-side. */
  historyKey: string
  /** Display title for exported documents (a topic's real title for Learn,
   * "Review" for the review queue) — `historyKey` itself is a raw topic id,
   * not fit for a document header. Falls back to `historyKey` if omitted. */
  title?: string
  open: boolean
  onClose: () => void
  /** Opens directly on this sitting instead of "most recent" — provenance
   * deep-links pass the sessionId a ProvenanceEvent came from. Ignored (falls
   * back to the default "most recent" behavior) if the id isn't in this
   * history's entry list. */
  initialSessionId?: string
  /** The transcript-line index (ProvenanceEvent.anchor) to scroll to and
   * warm-highlight, once, on the initial open of `initialSessionId`. Has no
   * effect without `initialSessionId`; a miss (no timeline item at or before
   * this index) just leaves the view at the top of the sitting. */
  anchorIndex?: number
}) {
  // Learn history's `historyKey` is a real topic id; Review history's is the
  // literal 'review' sentinel spanning every topic — only the former gives
  // the interval ladder a single topic to filter receipts by (see
  // GradeResultCard's optional `topic` prop).
  const ladderTopic = historyKey !== 'review' ? historyKey : undefined
  const [entries, setEntries] = useState<SessionIndexEntry[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<{
    messages: ChatMessage[]
    grades: GradeBatch[]
    messageSourceIndex: number[]
    marks: DerivedRitualMark[]
  } | null>(null)
  const [loadingTranscript, setLoadingTranscript] = useState(false)
  const [exportStatus, setExportStatus] = useState<{ text: string; failed: boolean } | null>(null)
  const [exporting, setExporting] = useState<ExportSittingFormat | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Guards the anchor scroll/highlight to a single attempt per drawer open —
  // without it, StrictMode's double-invoked effects (or a second `timeline`
  // update from re-selecting the same sitting) would re-trigger the scroll.
  const anchorAppliedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setEntries(null)
    setSelectedId(null)
    setTimeline(null)
    anchorAppliedRef.current = false
    const fetchEntries =
      historyKey === 'review' ? window.engram.sessionHistoryFor('review') : window.engram.sessionHistoryFor('learn', historyKey)
    fetchEntries.then((list) => {
      setEntries(list)
      // Anchored open lands on the requested sitting; otherwise most-recent
      // sitting is selected by default — same "land on the latest"
      // convenience as any other history browser. Nothing here touches the
      // live session that opened the drawer.
      const target =
        initialSessionId && list.some((e) => e.sessionId === initialSessionId) ? initialSessionId : (list[0]?.sessionId ?? null)
      if (target) selectEntry(target)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, historyKey, initialSessionId])

  // Re-arms the one-shot anchor scroll when the drawer stays open but the
  // caller points it at a different anchor within the same sitting (e.g.
  // clicking another review row for the same session) — without this key,
  // anchorAppliedRef would still be `true` from the previous anchor and the
  // new scroll/highlight would silently never fire.
  useEffect(() => {
    anchorAppliedRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [`${initialSessionId}:${anchorIndex}`])

  function selectEntry(id: string) {
    setSelectedId(id)
    setLoadingTranscript(true)
    setTimeline(null)
    setExportStatus(null)
    window.engram.getTranscript(id).then((lines) => {
      setTimeline(buildHistoryTimeline(lines))
      setLoadingTranscript(false)
    })
  }

  async function handleExport(format: ExportSittingFormat) {
    if (!selectedEntry) return
    setExporting(format)
    setExportStatus(null)
    try {
      const result = await exportSittingTranscript(selectedEntry.sessionId, format, {
        title: title ?? historyKey,
        startedAt: selectedEntry.startedAt,
      })
      if (result.ok) setExportStatus({ text: `Saved to ${result.path}`, failed: false })
      else if (result.reason !== 'canceled') setExportStatus({ text: `Export failed: ${result.reason}`, failed: true })
    } finally {
      setExporting(null)
    }
  }

  // One-shot anchor scroll + highlight, once the anchored sitting's timeline
  // has painted. Every timeline item that can be jumped to carries a
  // `data-anchor-index` (see render below); we look for an exact match to
  // `anchorIndex` first (the common case — the anchor IS a grade card's own
  // tool_result entry), then fall back to the nearest EARLIER item, then give
  // up silently and leave the view at the top — anchor misses never error.
  useEffect(() => {
    if (!timeline || anchorAppliedRef.current) return
    if (anchorIndex === undefined || selectedId === null || selectedId !== initialSessionId) return
    anchorAppliedRef.current = true
    const raf = requestAnimationFrame(() => {
      const container = scrollRef.current
      if (!container) return
      let target: HTMLElement | null = null
      let bestIndex = -Infinity
      for (const node of container.querySelectorAll<HTMLElement>('[data-anchor-index]')) {
        const idx = Number(node.dataset.anchorIndex)
        if (Number.isNaN(idx)) continue
        if (idx === anchorIndex) {
          target = node
          break
        }
        if (idx < anchorIndex && idx > bestIndex) {
          bestIndex = idx
          target = node
        }
      }
      // The wrapper is `display:contents` (pure grouping, no box of its own)
      // so the actual scroll/highlight target is its rendered child.
      const el = target?.firstElementChild as HTMLElement | null
      if (!el) return
      el.scrollIntoView({ block: 'center' })
      el.classList.add('provenance-highlight')
      el.addEventListener('animationend', () => el.classList.remove('provenance-highlight'), { once: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [timeline, selectedId, initialSessionId, anchorIndex])

  const selectedEntry = entries?.find((e) => e.sessionId === selectedId) ?? null

  return (
    <Modal open={open} onClose={onClose} title="Session history" wide>
      {/* Modal itself has no entrance (see ui/Modal.tsx) — this fade-rise is the
       * drawer's own, and fires once per open since Modal unmounts the whole
       * subtree when `open` is false. */}
      <div className="flex gap-4 h-[65vh] drawer-enter">
        <div className="w-48 shrink-0 flex flex-col border-r border-[var(--color-hairline)] pr-3 overflow-y-auto">
          {entries === null && <div className="fig-caption px-1 py-2">reading past sittings…</div>}
          {entries !== null && entries.length === 0 && (
            <div className="px-1 py-2 text-sm text-[var(--color-text-faint)]">No past sessions yet.</div>
          )}
          {entries?.map((entry, i) => (
            <button
              key={entry.sessionId}
              onClick={() => selectEntry(entry.sessionId)}
              className={`focus-ring no-press w-full flex flex-col items-start gap-0.5 px-2.5 py-2.5 text-left rounded-lg hover:bg-[var(--color-surface-3)] ${
                entry.sessionId === selectedId ? 'bg-[var(--color-surface-3)]' : ''
              }`}
            >
              <span className="text-sm text-[var(--color-text-primary)]">{i === 0 ? 'Most recent' : `${i + 1} sessions ago`}</span>
              <span className="text-xs text-[var(--color-text-faint)] label-data">{formatWhen(entry.startedAt)}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {selectedEntry && (
            <div className="shrink-0 panel border-[var(--color-ink-cool-dim)] px-4 py-2 flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--color-ink-cool)]">read-only · sitting of {formatWhen(selectedEntry.startedAt)}</span>
              <div className="flex items-center gap-3 shrink-0">
                {exportStatus && (
                  <span
                    className={`text-xs truncate max-w-[16rem] ${exportStatus.failed ? 'text-[var(--color-ink-danger)]' : 'text-[var(--color-text-faint)]'}`}
                    title={exportStatus.text}
                  >
                    {exportStatus.text}
                  </span>
                )}
                <button
                  onClick={() => handleExport('md')}
                  disabled={exporting !== null}
                  className="focus-ring no-press text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  {exporting === 'md' ? 'Exporting…' : 'Export .md'}
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  disabled={exporting !== null}
                  className="focus-ring no-press text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  {exporting === 'pdf' ? 'Exporting…' : 'Export .pdf'}
                </button>
              </div>
            </div>
          )}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 pr-1">
            {selectedId === null && <div className="fig-caption px-1">Select a sitting to view its transcript.</div>}
            {loadingTranscript && <div className="fig-caption px-1">reading transcript…</div>}
            {timeline && (
              <>
                {timeline.grades
                  .filter((g) => g.atIndex === 0)
                  .map((g) => (
                    <div key={g.id} className="contents" data-anchor-index={g.sourceIndex}>
                      {g.results.map((r, j) => (
                        <GradeResultCard key={`${g.id}-${j}`} result={r} topic={ladderTopic} asOfDate={g.date ?? undefined} />
                      ))}
                    </div>
                  ))}
                {timeline.marks
                  .filter((k) => k.atIndex === 0)
                  .map((k) => (
                    <MarkView key={k.id} mark={k} />
                  ))}
                {timeline.messages.map((m, i) => (
                  <div key={m.id} className="contents">
                    <div className="contents" data-anchor-index={timeline.messageSourceIndex[i]}>
                      <ChatMessageView message={m} />
                    </div>
                    {timeline.grades
                      .filter((g) => g.atIndex === i + 1)
                      .map((g) => (
                        <div key={g.id} className="contents" data-anchor-index={g.sourceIndex}>
                          {g.results.map((r, j) => (
                            <GradeResultCard key={`${g.id}-${j}`} result={r} topic={ladderTopic} asOfDate={g.date ?? undefined} />
                          ))}
                        </div>
                      ))}
                    {timeline.marks
                      .filter((k) => k.atIndex === i + 1 || (i === timeline.messages.length - 1 && k.atIndex > timeline.messages.length))
                      .map((k) => (
                        <MarkView key={k.id} mark={k} />
                      ))}
                  </div>
                ))}
                {timeline.messages.length === 0 && !loadingTranscript && (
                  <div className="text-sm text-[var(--color-text-faint)] px-1">Empty transcript.</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
