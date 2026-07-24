import { useEffect, useState } from 'react'
import type { SessionIndexEntry } from '../../../shared/types'
import type { ChatMessage } from '../../../shared/chatMessages'
import { parseGradeResult, parseGradeResults, type GradeResult } from '../../../shared/gradeResult'
import { Modal } from './ui/Modal'
import { ChatMessageView } from './ChatMessageView'
import { GradeResultCard } from './GradeResultCard'

interface TranscriptLine {
  type?: string
  message?: {
    content?: string | { type?: string; text?: string; content?: unknown }[]
  }
}

interface GradeBatch {
  id: string
  /** Same convention as LearnSessionView's `marks` — the message-array length
   * at the moment the receipt/rate tool_result landed, so the card slots in
   * right after the turn that produced it. */
  atIndex: number
  results: GradeResult[]
}

/** Rebuilds both the chat transcript AND its grade-receipt cards from a raw
 * session transcript, read-only. Message shaping mirrors
 * `parseTranscriptToMessages` exactly (same merge rule, same synthetic-first-
 * turn skip) — kept as a local superset here rather than editing that shared
 * helper, so live-session hydration behavior is untouched. Grade cards are
 * recovered by attempting both the batch (Learn's `receipt`) and single
 * (Review's `rate`) parsers on every tool_result — both parsers already
 * validate shape strictly (a `rating` in a known enum, a string `node`), so
 * this doesn't require re-deriving which Bash command produced it. */
function buildHistoryTimeline(rawLines: unknown[]): { messages: ChatMessage[]; grades: GradeBatch[] } {
  const lines = rawLines as TranscriptLine[]
  const messages: ChatMessage[] = []
  const grades: GradeBatch[] = []
  let seenFirstUser = false
  let idCounter = 0
  let gradeSeq = 0

  for (const line of lines) {
    if (line.type === 'user' && typeof line.message?.content === 'string') {
      if (!seenFirstUser) {
        seenFirstUser = true
        continue // the app's own synthetic kickoff — not a real human message
      }
      messages.push({ id: `t${idCounter++}`, role: 'user', text: line.message.content })
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
          grades.push({ id: `g${gradeSeq++}`, atIndex: messages.length, results })
        }
      }
    }
  }

  return { messages, grades }
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
  open,
  onClose,
}: {
  /** A topic id for Learn history, or the literal string 'review' for Review
   * history — mirrors how `sessionHistoryFor`'s key space works server-side. */
  historyKey: string
  open: boolean
  onClose: () => void
}) {
  const [entries, setEntries] = useState<SessionIndexEntry[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<{ messages: ChatMessage[]; grades: GradeBatch[] } | null>(null)
  const [loadingTranscript, setLoadingTranscript] = useState(false)

  useEffect(() => {
    if (!open) return
    setEntries(null)
    setSelectedId(null)
    setTimeline(null)
    const fetchEntries =
      historyKey === 'review' ? window.engram.sessionHistoryFor('review') : window.engram.sessionHistoryFor('learn', historyKey)
    fetchEntries.then((list) => {
      setEntries(list)
      // Most-recent sitting selected by default — same "land on the latest"
      // convenience as any other history browser; nothing here touches the
      // live session that opened the drawer.
      if (list.length > 0) selectEntry(list[0].sessionId)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, historyKey])

  function selectEntry(id: string) {
    setSelectedId(id)
    setLoadingTranscript(true)
    setTimeline(null)
    window.engram.getTranscript(id).then((lines) => {
      setTimeline(buildHistoryTimeline(lines))
      setLoadingTranscript(false)
    })
  }

  const selectedEntry = entries?.find((e) => e.sessionId === selectedId) ?? null

  return (
    <Modal open={open} onClose={onClose} title="Session history" wide>
      <div className="flex gap-4 h-[65vh]">
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
            <div className="shrink-0 panel border-[var(--color-ink-cool-dim)] px-4 py-2 text-xs text-[var(--color-ink-cool)]">
              read-only · sitting of {formatWhen(selectedEntry.startedAt)}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 pr-1">
            {selectedId === null && <div className="fig-caption px-1">Select a sitting to view its transcript.</div>}
            {loadingTranscript && <div className="fig-caption px-1">reading transcript…</div>}
            {timeline && (
              <>
                {timeline.grades.filter((g) => g.atIndex === 0).flatMap((g) => g.results).map((r, i) => (
                  <GradeResultCard key={`g0-${i}`} result={r} />
                ))}
                {timeline.messages.map((m, i) => (
                  <div key={m.id} className="contents">
                    <ChatMessageView message={m} />
                    {timeline.grades
                      .filter((g) => g.atIndex === i + 1)
                      .flatMap((g) => g.results.map((r, j) => ({ key: `${g.id}-${j}`, result: r })))
                      .map(({ key, result }) => (
                        <GradeResultCard key={key} result={result} />
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
