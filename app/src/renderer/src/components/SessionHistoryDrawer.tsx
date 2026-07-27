import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExportSittingFormat, ExportSittingResult, SessionIndexEntry } from '../../../shared/types'
import type { ChatMessage } from '../../../shared/chatMessages'
import { parseGradeResult, parseGradeResults, type GradeResult } from '../../../shared/gradeResult'
import { deriveRitualMarks, type DerivedRitualMark } from '../../../shared/ritualFromTranscript'
import { deriveReviewCrossings, nextProbeHeaderAt } from '../../../shared/reviewCrossing'
import { isTaskNotificationContent } from '../../../shared/taskNotification'
import { sittingToMarkdown, sittingToPrintHtml, type SittingMeta } from '../shared/sittingToMarkdown'
import { recordView } from '../shared/recentlyViewed'
import { Modal } from './ui/Modal'
import { ChatMessageView } from './ChatMessageView'
import { GradeResultCard } from './GradeResultCard'
import { MarkView, NodeCrossingDivider } from './ritual/Marks'

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
      // A background-agent completion (e.g. the assessor audit — see
      // shared/taskNotification.ts's doctrine comment) also lands as an
      // ordinary `type: "user"` string-content line, but it is NOT a genuine
      // learner turn — it's the assessor's raw envelope, quoting the very
      // rubric the audited sitting is being graded against. Never render it
      // as a chat bubble, same discipline as chatMessages.ts.
      if (isTaskNotificationContent(line.message.content)) continue
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

/** The `historyKey` sentinel for the drawer's "everything" mode — every
 * sitting across every topic and both loops, newest first. Not a real topic
 * id or session key (nothing is ever recorded under it in the session
 * index), just a value `SessionHistoryDrawer` recognizes to switch into
 * aggregate mode instead of a single-key fetch. */
export const ALL_HISTORY_KEY = '*'

/** A `SessionIndexEntry` as shown in the drawer's "everything" list, tagged
 * with which loop it belongs to and (when known) which topic. Left
 * unpopulated (all three fields `undefined`) for the ordinary per-topic/
 * review modes — `HistoryRow` below is a strict superset of
 * `SessionIndexEntry` so those modes can keep handing the drawer plain
 * index entries, untouched. */
export interface AllHistoryEntry extends SessionIndexEntry {
  kind: 'learn' | 'review' | 'coach'
  /** The topic this sitting belongs to, when attributable — absent for
   * review sittings (the queue spans every topic, same as `ladderTopic`'s
   * existing 'review' special-case below), for coach sittings (never
   * topic-scoped — sessionIndex.ts's own key comment: 'review'/'coach' key
   * by kind, only 'learn' keys by topic), and for sittings recorded under
   * the legacy shared 'learn' key, from before per-topic keying existed
   * (see sessionScan.ts's module doc) — those carry no topic at all. */
  topicId?: string
  topicTitle?: string
}

type HistoryRow = SessionIndexEntry & Partial<Pick<AllHistoryEntry, 'kind' | 'topicId' | 'topicTitle'>>

/** Collapses raw session-index entries down to one row per distinct
 * sessionId. `recordSession` (sessionIndex.ts) appends a fresh entry on
 * every resume of the same session, so a key's raw list can carry many rows
 * for a handful of actual sittings — visible in real data as e.g. 66 raw
 * entries under a topic key for just 4 distinct sessionIds. Mirrors
 * `fetchAllHistory`'s own dedupe below: `list` must already be newest-first
 * (`sessionHistoryFor`'s contract), so "first occurrence wins" means the
 * surviving record for a given sessionId is deliberately the LATEST
 * resume — its `startedAt` is what "sitting of <date>" and the ordinal
 * "N sessions ago" ranking are measured from, since that's the most recent
 * time the learner was actually looking at that transcript. Never touches
 * which sessionIds survive, only which single record represents each one —
 * `initialSessionId` matching and the anchor-index walk (both keyed on
 * sessionId / the transcript itself, not on which raw record was kept)
 * still resolve exactly as before. */
function dedupeBySessionId<T extends SessionIndexEntry>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const e of list) {
    if (seen.has(e.sessionId)) continue
    seen.add(e.sessionId)
    out.push(e)
  }
  return out
}

/** The "everything" list's per-row tag — kind plus topic when attributable.
 * A legacy-key 'learn' sitting (see `fetchAllHistory`'s doc below) has no
 * topic to show, so it reads as plain "Learn" rather than fabricating an
 * attribution. Unused for the ordinary per-topic/review modes, whose rows
 * never carry a `kind`. */
function historyRowTag(entry: HistoryRow): string {
  if (entry.kind === 'review') return 'Review'
  if (entry.kind === 'coach') return 'Coach'
  return entry.topicTitle ? `Learn · ${entry.topicTitle}` : 'Learn'
}

/** Every sitting across every topic and all three loops, newest first — the
 * data behind the drawer's `ALL_HISTORY_KEY` mode (and hence what "Session
 * History…"/"All Sessions" actually promise). Walks the same source layers
 * sessionScan.ts's `nodeProvenance` already established for provenance
 * recovery, plus the topic-less 'coach' key: each topic's own 'learn' key,
 * the shared 'review' key, the shared 'coach' key, and the legacy shared
 * 'learn' key that early sittings (recorded before per-topic keying existed)
 * still live under. A sessionId can legitimately turn up more than once
 * across — or even within — those lists (a resumed session reappears in its
 * own key once per resume, sharing one transcript — see sessionIndex.ts's
 * `recordSession`), so this dedupes by sessionId across the whole combined
 * set with `dedupeBySessionId`'s same "first occurrence wins" rule
 * `nodeProvenance`'s own `seenSessionIds` walk already uses. Because each
 * source list already comes back newest-first (`sessionHistoryFor`'s own
 * contract), "first occurrence" here also means "latest resume" wins the
 * entry actually kept. Topic sittings are attributed before the legacy key,
 * so a topic-tagged occurrence always wins over an untagged legacy one for
 * the same sessionId. */
export async function fetchAllHistory(): Promise<AllHistoryEntry[]> {
  const topics = await window.engram.topics()
  const [perTopicLists, reviewList, coachList, legacyList] = await Promise.all([
    Promise.all(topics.map((t) => window.engram.sessionHistoryFor('learn', t.topic))),
    window.engram.sessionHistoryFor('review'),
    window.engram.sessionHistoryFor('coach'),
    window.engram.sessionHistoryFor('learn'),
  ])

  const seen = new Set<string>()
  const out: AllHistoryEntry[] = []
  function take(list: SessionIndexEntry[], tag: (e: SessionIndexEntry) => AllHistoryEntry) {
    for (const e of list) {
      if (seen.has(e.sessionId)) continue
      seen.add(e.sessionId)
      out.push(tag(e))
    }
  }

  topics.forEach((t, i) =>
    take(perTopicLists[i], (e) => ({ ...e, kind: 'learn', topicId: t.topic, topicTitle: t.title })),
  )
  take(reviewList, (e) => ({ ...e, kind: 'review' }))
  take(coachList, (e) => ({ ...e, kind: 'coach' }))
  take(legacyList, (e) => ({ ...e, kind: 'learn' }))

  // Newest first across the combined set — per-key ordering alone isn't
  // enough once lists from different keys are interleaved.
  out.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return out
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
  /** A topic id for Learn history, the literal string 'review' for Review
   * history — mirrors how `sessionHistoryFor`'s key space works server-side —
   * or `ALL_HISTORY_KEY` for the "everything" mode (every sitting across
   * every topic and both loops; see `fetchAllHistory`). */
  historyKey: string
  /** Display title for exported documents (a topic's real title for Learn,
   * "Review" for the review queue) — `historyKey` itself is a raw topic id,
   * not fit for a document header. Falls back to `historyKey` if omitted, or
   * (for `ALL_HISTORY_KEY`) to the selected row's own kind/topic tag, since
   * `historyKey` there is just the '*' sentinel. */
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
  const [entries, setEntries] = useState<HistoryRow[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // True exactly when the caller asked for a specific sitting (`initialSessionId`)
  // and it wasn't in the fetched list — a stale/CLI-run/pruned sessionId, most
  // often a sitting `nodeProvenance`'s disk sweep attributed from a transcript
  // this app's own session index never recorded (see ArtifactTile/TopicMapView's
  // ProvenanceBlock, the two callers that pass a real `initialSessionId`). The
  // drawer still opens (on `list[0]`, same as any other unmatched/absent
  // request) — it just says so instead of silently substituting a different
  // transcript for the one the reader actually asked to see.
  const [requestedNotFound, setRequestedNotFound] = useState(false)
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
    setRequestedNotFound(false)
    anchorAppliedRef.current = false
    // The per-topic/review branches dedupe here (fetchAllHistory does its own,
    // see dedupeBySessionId's doc) — without it a resumed sitting's repeat
    // recordSession appends would each surface as their own row.
    const fetchEntries: Promise<HistoryRow[]> =
      historyKey === ALL_HISTORY_KEY
        ? fetchAllHistory()
        : historyKey === 'review'
          ? window.engram.sessionHistoryFor('review').then(dedupeBySessionId)
          : window.engram.sessionHistoryFor('learn', historyKey).then(dedupeBySessionId)
    fetchEntries.then((list) => {
      setEntries(list)
      // Anchored open lands on the requested sitting; otherwise most-recent
      // sitting is selected by default — same "land on the latest"
      // convenience as any other history browser. Nothing here touches the
      // live session that opened the drawer.
      const matchedInitial = Boolean(initialSessionId) && list.some((e) => e.sessionId === initialSessionId)
      setRequestedNotFound(Boolean(initialSessionId) && !matchedInitial)
      const target = matchedInitial ? initialSessionId : (list[0]?.sessionId ?? null)
      // Only a genuine deep link (matchedInitial) is something the learner
      // actually chose to look at — the plain "land on most-recent" default,
      // and the fallback when a requested id isn't found, are the drawer's
      // own pick, not the learner's, so neither should get recorded.
      if (target) selectEntry(target, list, matchedInitial)
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

  // `rows` defaults to the current `entries` state for the ordinary click
  // path, but the auto-select-most-recent call in the effect above must pass
  // the freshly-fetched list explicitly: it fires synchronously inside the
  // same fetchEntries.then() that calls setEntries(list), so the component's
  // `entries` state (and this function's default-param closure over it) is
  // still the PREVIOUS value at that point — state updates aren't visible
  // until the next render. Without the explicit list, recording would
  // silently never fire for a default/anchored open, only for real clicks.
  // `shouldRecord` keeps this the single transcript-loading path while still
  // letting callers say whether landing here was something the learner
  // actually chose. The list is a jump-back convenience, not a log of
  // everywhere the drawer happened to land — so a row click and a genuine
  // `initialSessionId` deep link record, but the plain "nothing was
  // requested, default to list[0]" landing and the "requested id wasn't
  // found, fall back to list[0]" landing don't: neither is a sitting the
  // learner asked to see, and the effect that drives them fires before
  // `getTranscript` has even resolved.
  function selectEntry(id: string, rows: HistoryRow[] | null = entries, shouldRecord: boolean = true) {
    setSelectedId(id)
    setLoadingTranscript(true)
    setTimeline(null)
    setExportStatus(null)
    if (shouldRecord) {
      // Label mirrors historyRowTag's "Learn · <topic>" / "Review" shape so
      // it reads the same later in Home/the palette, outside this drawer's
      // own historyKey context.
      const entry = rows?.find((e) => e.sessionId === id)
      if (entry) {
        const label =
          historyKey === ALL_HISTORY_KEY ? historyRowTag(entry) : historyKey === 'review' ? 'Review' : `Learn · ${title ?? historyKey}`
        recordView({ kind: 'sitting', sessionId: id, label })
      }
    }
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
        title: title ?? (historyKey === ALL_HISTORY_KEY ? historyRowTag(selectedEntry) : historyKey),
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
  // Learn history's `historyKey` is a real topic id; Review history's is the
  // literal 'review' sentinel spanning every topic — only the former gives
  // the interval ladder a single topic to filter receipts by (see
  // GradeResultCard's optional `topic` prop). The "everything" mode has no
  // single topic for the whole drawer — it follows whichever sitting is
  // currently selected, same as its `kind`/`topicTitle` tag.
  const ladderTopic = historyKey === ALL_HISTORY_KEY ? selectedEntry?.topicId : historyKey !== 'review' ? historyKey : undefined
  // Review-only: the same probe-header-derived grade-card anchoring and node
  // crossing ReviewSessionView uses live (see shared/reviewCrossing.ts's
  // doctrine comment) — a reopened sitting must show the identical corrected
  // ordering a live one would have. Learn's `kind` never takes this branch:
  // its own crossings already come from `timeline.marks` (RENDER_BEAT,
  // reliable structured data, not text parsing) and its grades render as a
  // stack/tally outside the transcript rather than per-message, so it never
  // had this bug to begin with — see LearnSessionView's doctrine comment.
  const isReviewSitting = selectedEntry?.kind === 'review'
  const reviewCrossings = useMemo(
    () => (isReviewSitting && timeline ? deriveReviewCrossings(timeline.messages) : []),
    [isReviewSitting, timeline],
  )
  const resolvedGrades = useMemo(() => {
    if (!timeline) return []
    if (!isReviewSitting) return timeline.grades.map((g) => ({ batch: g, resolvedIndex: g.atIndex }))
    return timeline.grades.map((g) => ({ batch: g, resolvedIndex: nextProbeHeaderAt(timeline.messages, g.atIndex) }))
  }, [timeline, isReviewSitting])
  function renderGradeBatch(g: GradeBatch) {
    return g.results.map((r, j) => (
      <div key={`${g.id}-${j}`} className="contents" data-anchor-index={g.sourceIndex}>
        <GradeResultCard result={r} topic={ladderTopic} asOfDate={g.date ?? undefined} />
      </div>
    ))
  }

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
              <span className="text-sm text-[var(--color-text-primary)] truncate max-w-full">
                {historyKey === ALL_HISTORY_KEY ? historyRowTag(entry) : i === 0 ? 'Most recent' : `${i + 1} sessions ago`}
              </span>
              <span className="text-xs text-[var(--color-text-faint)] label-data">{formatWhen(entry.startedAt)}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {/* The requested sitting (a provenance/artifact deep link's own
              sessionId) isn't one this drawer's list actually contains — say
              so instead of quietly opening a different transcript in its
              place. Real today for CLI-run sittings `nodeProvenance`'s disk
              sweep attributes a node to, that this app's own session index
              never recorded (see ArtifactTile's "Encoded …" link and
              TopicMapView's ProvenanceBlock — both route through here). */}
          {requestedNotFound && (
            <div className="shrink-0 panel border-[var(--color-ink-cool-dim)] px-4 py-2 text-xs text-[var(--color-ink-cool)]">
              The sitting this points to isn’t in the app’s recorded history
              {entries && entries.length > 0
                ? ' — showing the most recent one instead. Pick any entry on the left to browse what is here.'
                : '.'}
            </div>
          )}
          {selectedEntry && (
            <div className="shrink-0 panel border-[var(--color-ink-cool-dim)] px-4 py-2 flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--color-ink-cool)]">
                read-only · {historyKey === ALL_HISTORY_KEY && `${historyRowTag(selectedEntry)} · `}sitting of {formatWhen(selectedEntry.startedAt)}
              </span>
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
                {!isReviewSitting &&
                  resolvedGrades
                    .filter((g) => g.resolvedIndex === 0)
                    .flatMap((g) => renderGradeBatch(g.batch))}
                {timeline.marks
                  .filter((k) => k.atIndex === 0)
                  .map((k) => (
                    <MarkView key={k.id} mark={k} />
                  ))}
                {timeline.messages.map((m, i) => (
                  <div key={m.id} className="contents">
                    <div className="contents" data-anchor-index={timeline.messageSourceIndex[i]}>
                      <ChatMessageView
                        message={m}
                        // Review only: the grade card(s) + crossing divider that
                        // belong INSIDE this message's own render, immediately
                        // before its probe header — see ReviewSessionView's
                        // identical `beforeProbeHeader` wiring and
                        // shared/reviewCrossing.ts's doctrine comment. Learn
                        // never sets this prop, so its rendering is untouched.
                        beforeProbeHeader={
                          isReviewSitting ? (
                            <>
                              {resolvedGrades
                                .filter((g) => g.resolvedIndex === i)
                                .flatMap((g) => renderGradeBatch(g.batch))}
                              {reviewCrossings
                                .filter((c) => c.atMessageIndex === i)
                                .map((c) => (
                                  <NodeCrossingDivider key={`${c.fromNode}-${c.header.node}-${i}`} nodeId={c.header.node} verb="moving to" />
                                ))}
                            </>
                          ) : undefined
                        }
                      />
                    </div>
                    {!isReviewSitting &&
                      resolvedGrades
                        .filter((g) => g.resolvedIndex === i + 1)
                        .flatMap((g) => renderGradeBatch(g.batch))}
                    {timeline.marks
                      .filter((k) => k.atIndex === i + 1 || (i === timeline.messages.length - 1 && k.atIndex > timeline.messages.length))
                      .map((k) => (
                        <MarkView key={k.id} mark={k} />
                      ))}
                  </div>
                ))}
                {/* Review only: grade batches whose next probe header never
                    arrived — the sitting's last graded item, or one that
                    closed before producing its next probe. */}
                {isReviewSitting &&
                  resolvedGrades
                    .filter((g) => g.resolvedIndex === null)
                    .flatMap((g) => renderGradeBatch(g.batch))}
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
