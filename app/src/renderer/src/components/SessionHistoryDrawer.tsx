import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExportSittingFormat, ExportSittingResult, SessionIndexEntry } from '../../../shared/types'
import { parseLineTimestamp, type ChatMessage } from '../../../shared/chatMessages'
import { parseGradeResult, parseGradeResults, type GradeResult } from '../../../shared/gradeResult'
import { deriveRitualMarks, type DerivedRitualMark } from '../../../shared/ritualFromTranscript'
import { deriveReviewCrossings, nextProbeHeaderAt, allProbeHeaders } from '../../../shared/reviewCrossing'
import {
  deriveVerdictRegions,
  verdictRegionMessageRenders,
  shouldSuppressSchedule,
  type VerdictSegment,
  type ScheduleSegment,
} from '../../../shared/verdictSegments'
import { isTaskNotificationContent } from '../../../shared/taskNotification'
import { isMarkBoundaryToolUse } from '../../../shared/signals/tutorSignals'
import { endsWithBareProbeHeader } from '../../../shared/probeHeader'
import { sittingToMarkdown, sittingToPrintHtml, type SittingMeta } from '../shared/sittingToMarkdown'
import { recordView } from '../shared/recentlyViewed'
import { Modal } from './ui/Modal'
import { ChatMessageView } from './ChatMessageView'
import { useEquationCopy } from './useEquationCopy'
import { TranscriptMinimap } from './TranscriptMinimap'
import { deriveInstrumentMoments, type InstrumentMoment } from '../shared/instrumentMoments'
import { jumpToCheckpoint } from '../shared/jumpToCheckpoint'
import { GradeResultCard } from './GradeResultCard'
import { MarkView, NodeCrossingDivider } from './ritual/Marks'
import { CheckpointAnchor } from './CheckpointAnchor'

interface TranscriptLine {
  type?: string
  /** ISO timestamp on the raw transcript entry — same field
   * ritualFromTranscript.ts's `walkTranscript` reads for the lapse rite's
   * date anchor. Needed here so a replayed grade card's interval ladder can
   * time-bound itself to the sitting it belongs to (see GradeBatch.date)
   * instead of reading receipts up through today. */
  timestamp?: string
  message?: {
    content?: string | { type?: string; text?: string; content?: unknown; name?: string; input?: Record<string, unknown> }[]
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

/** The inverse of `localDateFromIso` above — GradeBatch.date's own
 * 'YYYY-MM-DD' shape parsed back into a local-midnight Date, same local-date
 * discipline as `lapseReturnDate` (shared/gradeResult.ts). `null` on
 * anything that doesn't match — never a fabricated fallback to wall-clock
 * "now". Feeds Verdict Anatomy's replay wiring below (`shouldSuppressSchedule`'s
 * `anchorDate` argument) — a reopened sitting must anchor its dedupe check to
 * the date the sitting actually happened on, never to today. */
function isoLocalDateToAnchor(iso: string | null): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
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
  // The bubble-split boundary (the interleave fix) — same flag, same shared
  // predicate as `parseTranscriptToMessages`; see that function's SPLIT RULE
  // doctrine comment in shared/chatMessages.ts.
  let boundarySinceLastText = false

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
      messages.push({ id: `t${idCounter++}`, role: 'user', text: line.message.content, timestamp: parseLineTimestamp(line.timestamp) })
      messageSourceIndex.push(idx)
      continue
    }

    if (line.type === 'assistant' && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (
          block.type === 'tool_use' &&
          typeof block.name === 'string' &&
          typeof block.input === 'object' &&
          block.input !== null &&
          isMarkBoundaryToolUse(block.name, block.input)
        ) {
          boundarySinceLastText = true
          continue
        }
        if (block.type !== 'text' || !block.text) continue
        const last = messages[messages.length - 1]
        // Bare-probe-header exception — same as chatMessages.ts's own merge
        // branch (see `endsWithBareProbeHeader`'s doctrine comment): a
        // header-only bubble absorbs the text that follows a mark-boundary
        // tool call instead of starting a new bubble, so replay agrees with
        // the live views' fix for the same corpus bug.
        if (last && last.role === 'assistant' && (!boundarySinceLastText || endsWithBareProbeHeader(last.text))) {
          // Timestamp intentionally untouched — same "keeps the instant it
          // started at" rule as chatMessages.ts's own merge branch.
          last.text += block.text
        } else {
          messages.push({ id: `t${idCounter++}`, role: 'assistant', text: block.text, timestamp: parseLineTimestamp(line.timestamp) })
          messageSourceIndex.push(idx)
        }
        boundarySinceLastText = false
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
 * entries under a topic key for just 4 distinct sessionIds. The surviving
 * row's `startedAt` is the sitting's FIRST-recorded one: "sitting of
 * <date>" (and the export header, and the "N sessions ago" ranking) must
 * name the day the sitting began — which is also the day provenance/
 * artifact deep links advertise before opening this drawer. This function's
 * original choice (the LATEST resume's record survives, over a newest-first
 * list) made a link that says "First encoded — Jul 19" open a drawer
 * captioned "sitting of Jul 23" whenever the sitting had since been
 * resumed — a resume re-records with a fresh wall-clock `startedAt`, which
 * is a fact about the resume, not about the sitting. The output is
 * re-sorted newest-first by that same first-recorded `startedAt`, so
 * display order and displayed dates agree. Never touches which sessionIds
 * survive — `initialSessionId` matching and the anchor-index walk (both
 * keyed on sessionId / the transcript itself, not on which raw record was
 * kept) still resolve exactly as before. */
function dedupeBySessionId<T extends SessionIndexEntry>(list: T[]): T[] {
  const earliest = new Map<string, string>()
  for (const e of list) {
    const cur = earliest.get(e.sessionId)
    if (cur === undefined || e.startedAt < cur) earliest.set(e.sessionId, e.startedAt)
  }
  const seen = new Set<string>()
  const out: T[] = []
  for (const e of list) {
    if (seen.has(e.sessionId)) continue
    seen.add(e.sessionId)
    const startedAt = earliest.get(e.sessionId)!
    out.push(e.startedAt === startedAt ? e : { ...e, startedAt })
  }
  out.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
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
 * `recordSession`), so each source list goes through `dedupeBySessionId`
 * first (one row per sitting, carrying the sitting's FIRST-recorded
 * `startedAt` — see that function's doc for why the date shown must be the
 * day the sitting began, not the latest resume's), and `take()` then keeps
 * the first occurrence across keys. Topic sittings are attributed before
 * the legacy key, so a topic-tagged occurrence always wins over an untagged
 * legacy one for the same sessionId. */
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
    take(dedupeBySessionId(perTopicLists[i]), (e) => ({ ...e, kind: 'learn', topicId: t.topic, topicTitle: t.title })),
  )
  take(dedupeBySessionId(reviewList), (e) => ({ ...e, kind: 'review' }))
  take(dedupeBySessionId(coachList), (e) => ({ ...e, kind: 'coach' }))
  take(dedupeBySessionId(legacyList), (e) => ({ ...e, kind: 'learn' }))

  // Newest first across the combined set — per-key ordering alone isn't
  // enough once lists from different keys are interleaved.
  out.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return out
}

/** A provenance/artifact deep link can name a sitting this drawer's own
 * fetched list doesn't contain without the link being wrong — the event it
 * points at is real (provenance is a disk sweep over actual transcripts;
 * see sessionScan.ts's three coverage layers). Two of those cases are still
 * honestly openable, resolved in order:
 *
 *  1. Recorded under a DIFFERENT index key than the one this drawer
 *     fetched — e.g. an encode from before per-topic keying lives under the
 *     legacy shared 'learn' key, not the topic's own (sessionScan.ts layer
 *     2). `fetchAllHistory` already spans every key, so its entry — real
 *     recorded `startedAt`, kind/topic tag — is reused as-is. Skipped when
 *     the drawer is already in `ALL_HISTORY_KEY` mode (that list IS the
 *     whole recorded index).
 *  2. Never recorded by this app at all — a CLI-run sitting the provenance
 *     disk sweep attributed (layer 3). `session:transcript` already reads
 *     across every project dir (transcriptReader.ts's findTranscriptPath),
 *     so when the transcript exists the sitting is shown from it directly,
 *     `startedAt` taken from the transcript's own first timestamped line —
 *     the sitting's real start, never a fabricated date. `kind` is left
 *     unset deliberately: the app never recorded what kind of sitting this
 *     was, and the default rendering (grade cards at their chronological
 *     positions) is the honest one for an unknown. The entry's `key` IS
 *     fabricated (from `historyKey` — the type requires one), which is why
 *     `isReviewSitting` below excludes this row via the `unrecorded` flag
 *     instead of trusting its `key`.
 *
 * Returns null when neither applies — the transcript is gone or empty — and
 * the caller keeps the "isn't in the app's recorded history" banner plus
 * most-recent fallback exactly as before. Nothing here ever substitutes a
 * different transcript for the requested one: the returned entry's
 * sessionId is always the one asked for. */
async function resolveLinkedSitting(
  sessionId: string,
  historyKey: string,
): Promise<{ entry: HistoryRow; unrecorded: boolean } | null> {
  if (historyKey !== ALL_HISTORY_KEY) {
    const recorded = (await fetchAllHistory()).find((e) => e.sessionId === sessionId)
    if (recorded) return { entry: recorded, unrecorded: false }
  }
  const lines = (await window.engram.getTranscript(sessionId)) as ({ timestamp?: string } | null)[]
  for (const line of lines) {
    if (typeof line?.timestamp !== 'string') continue
    if (Number.isNaN(new Date(line.timestamp).getTime())) continue
    return { entry: { sessionId, key: historyKey, startedAt: line.timestamp }, unrecorded: true }
  }
  return null
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
   * deep-links pass the sessionId a ProvenanceEvent came from. An id that
   * isn't in this history's entry list is still opened when it's recorded
   * under another index key or its transcript exists on disk (see
   * resolveLinkedSitting); only when the transcript is genuinely gone does
   * the drawer fall back to "most recent" with the not-in-history banner. */
  initialSessionId?: string
  /** The transcript-line index (ProvenanceEvent.anchor) to scroll to and
   * warm-highlight, once, on the initial open of `initialSessionId`. Has no
   * effect without `initialSessionId`; a miss (no timeline item at or before
   * this index) just leaves the view at the top of the sitting. */
  anchorIndex?: number
}) {
  const [entries, setEntries] = useState<HistoryRow[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // True exactly when the caller asked for a specific sitting (`initialSessionId`),
  // it wasn't in the fetched list, AND `resolveLinkedSitting` couldn't open it
  // either — the transcript is genuinely gone (pruned/deleted), not merely
  // filed elsewhere. The drawer still opens (on `list[0]`, same as any other
  // unmatched/absent request) — it just says so instead of silently
  // substituting a different transcript for the one the reader asked to see.
  const [requestedNotFound, setRequestedNotFound] = useState(false)
  // The deep-linked sitting this drawer's own list doesn't contain but that
  // could still be honestly opened — see resolveLinkedSitting's doc for the
  // two cases (recorded under another key / CLI-run, straight from the
  // transcript). Rendered as its own pinned "Linked sitting" row above the
  // recorded list (never spliced into it: the list's "N sessions ago"
  // ordinals count THIS history's recorded sittings only), plus an inline
  // note naming which case it is.
  const [linkedSitting, setLinkedSitting] = useState<{ entry: HistoryRow; unrecorded: boolean } | null>(null)
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
  // Chat Instruments Wave A — the replay transcript's own equation-copy
  // wiring. Merged onto the SAME node `scrollRef` already tracks (Modal
  // unmounts this whole pane every time the drawer closes, which is exactly
  // the remount case `useEquationCopy`'s callback-ref design exists for —
  // see its own doctrine comment), via a small composed callback rather
  // than a second `ref` prop (a DOM node only accepts one).
  const equationCopyRef = useEquationCopy()
  // Chat Instruments Wave B — the transcript minimap needs the container as
  // REACT STATE, not just `scrollRef.current` — a plain ref mutation doesn't
  // trigger a re-render, so TranscriptMinimap's own effect (keyed on this
  // value) would never see it become available. Set from the same merged
  // callback ref below, once per Modal open (this whole pane unmounts on
  // close — see `equationCopyRef`'s own doctrine comment just above).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const setScrollAndCopyRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      equationCopyRef(node)
      setScrollEl(node)
    },
    [equationCopyRef],
  )

  useEffect(() => {
    if (!open) return
    setEntries(null)
    setSelectedId(null)
    setTimeline(null)
    setRequestedNotFound(false)
    setLinkedSitting(null)
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
    fetchEntries.then(async (list) => {
      setEntries(list)
      // Anchored open lands on the requested sitting; otherwise most-recent
      // sitting is selected by default — same "land on the latest"
      // convenience as any other history browser. Nothing here touches the
      // live session that opened the drawer.
      const matchedInitial = Boolean(initialSessionId) && list.some((e) => e.sessionId === initialSessionId)
      if (initialSessionId && !matchedInitial) {
        // Not in this history's own list — but a provenance/artifact link's
        // sitting can still be honestly opened when it's recorded under a
        // different key, or when its CLI-run transcript exists on disk (see
        // resolveLinkedSitting). Only when both miss does the "isn't in the
        // app's recorded history" banner + most-recent fallback fire.
        const linked = await resolveLinkedSitting(initialSessionId, historyKey)
        if (linked) {
          setLinkedSitting(linked)
          // A deep link the learner actually followed — record it, same as
          // the matchedInitial path below.
          selectEntry(initialSessionId, [linked.entry], true)
          return
        }
        setRequestedNotFound(true)
      }
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

  // The linked (deep-linked, not-in-list) sitting is selectable too — its
  // row lives outside `entries` by design (see the linkedSitting state doc).
  const selectedEntry =
    entries?.find((e) => e.sessionId === selectedId) ??
    (linkedSitting && linkedSitting.entry.sessionId === selectedId ? linkedSitting.entry : null)
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
  //
  // Review-ness is the ROW's, never the drawer mode's. `kind` is only tagged
  // on ALL_HISTORY_KEY rows and linked rows resolved through fetchAllHistory;
  // the plain review-key list (`historyKey === 'review'`) hands over raw
  // index entries, whose recorded `key` IS 'review' (recordSession files them
  // under exactly that key), so either recorded field attests the same fact —
  // checking `kind` alone left every row of the review-key drawer on the
  // default rendering, i.e. the same sitting rendered differently there than
  // in "everything" mode. Deriving from the row (never from `historyKey`)
  // keeps one sitting rendering identically through every door it can be
  // opened from. The one `key` that attests nothing is the unrecorded linked
  // sitting's — resolveLinkedSitting fabricates it from `historyKey` (case 2
  // of its doc) — so that row is excluded, staying on the default rendering
  // its doctrine promises for an unknown, in review mode and everywhere else
  // alike.
  const isUnrecordedLinked = linkedSitting?.unrecorded === true && linkedSitting.entry.sessionId === selectedId
  const isReviewSitting = !isUnrecordedLinked && (selectedEntry?.kind === 'review' || selectedEntry?.key === 'review')
  const reviewCrossings = useMemo(
    () => (isReviewSitting && timeline ? deriveReviewCrossings(timeline.messages) : []),
    [isReviewSitting, timeline],
  )
  // Chat Instruments Wave B — every probe header this sitting's transcript
  // carries (Learn's own `[N/M] · node` markers as much as Review's — see
  // allProbeHeaders' own doctrine comment), reused by both the minimap and
  // the grade-card ↔ probe-card hover linkage below.
  const drawerProbes = useMemo(() => (timeline ? allProbeHeaders(timeline.messages) : []), [timeline])
  const probeNodeByMessageIndex = useMemo(() => {
    const map = new Map<number, string>()
    for (const { index, header } of drawerProbes) map.set(index, header.node)
    return map
  }, [drawerProbes])
  /** Same linkage as ReviewSessionView's live wiring (see that state's own
   * doctrine comment) — a separate instance here since this is a wholly
   * separate mounted component tree, reset implicitly every time the drawer
   * is reopened or a different sitting is selected (new render, fresh state). */
  const [hoveredPairNode, setHoveredPairNode] = useState<string | null>(null)
  const resolvedGrades = useMemo(() => {
    if (!timeline) return []
    if (!isReviewSitting) return timeline.grades.map((g) => ({ batch: g, resolvedIndex: g.atIndex }))
    return timeline.grades.map((g) => ({ batch: g, resolvedIndex: nextProbeHeaderAt(timeline.messages, g.atIndex) }))
  }, [timeline, isReviewSitting])
  /** Carried-over fix (chat-ordering-fix-report.md's follow-up list) — Review
   * only: `lapse`/`milestone` marks re-anchored through the identical
   * `nextProbeHeaderAt` resolution `resolvedGrades` already gets, so a
   * reopened sitting shows them after the verdict commentary that names
   * them, immediately before the next probe — matching ReviewSessionView's
   * live rendering exactly. Learn's `kind !== 'review'` path is untouched:
   * its `atIndex` boundary convention never had this bug (see the
   * `isReviewSitting` doctrine comment above). */
  const resolvedOtherMarks = useMemo(() => {
    if (!timeline || !isReviewSitting) return []
    return timeline.marks
      .filter((m) => m.kind === 'lapse' || m.kind === 'milestone')
      .map((m) => ({ mark: m, resolvedIndex: nextProbeHeaderAt(timeline.messages, m.atIndex) }))
  }, [timeline, isReviewSitting])
  /** Verdict Anatomy (Wave 2), replay — review sittings only, the same gate
   * `reviewCrossings`/`resolvedGrades`/`resolvedOtherMarks` above use: a
   * Learn transcript never carries a verdict region to begin with (its
   * grades render as a stack/tally outside the transcript, not per-message
   * — see the `isReviewSitting` doctrine comment above), so this is always
   * `[]` for any other `kind`. `timeline.grades` (GradeBatch[]) is
   * structurally a superset of the `VerdictRegionBatch{id,atIndex}` shape
   * `deriveVerdictRegions` expects — same convention its own doctrine
   * comment documents. */
  const verdictRegions = useMemo(
    () => (isReviewSitting && timeline ? deriveVerdictRegions(timeline.messages, timeline.grades) : []),
    [isReviewSitting, timeline],
  )
  /** Per-message render input, keyed by message index — the SAME
   * derivation (`verdictRegionMessageRenders`) ReviewSessionView's live
   * wiring calls, so a reopened sitting can never disagree with how it
   * rendered live (or with a different open of this same drawer). */
  const verdictRenderByMessage = useMemo(() => {
    const map = new Map<number, { segments: VerdictSegment[]; eyebrowIndex: number | null; batchId: string }>()
    if (!timeline) return map
    for (const region of verdictRegions) {
      for (const render of verdictRegionMessageRenders(timeline.messages, region)) {
        map.set(render.messageIndex, { segments: render.segments, eyebrowIndex: render.eyebrowSegmentIndex, batchId: region.batchId })
      }
    }
    return map
  }, [verdictRegions, timeline])
  const gradeBatchById = useMemo(() => new Map((timeline?.grades ?? []).map((b) => [b.id, b] as const)), [timeline])
  /** This message's own Verdict Anatomy render props, or `undefined` for a
   * message no region claims (byte-identical current behavior — see
   * ChatMessageView's own prop doctrine comment). Anchored to the batch's
   * OWN recorded `date` (never wall-clock "now" — a replayed sitting from
   * months ago must never fabricate a today-relative date; see
   * `isoLocalDateToAnchor` above), and `isLiveStreamingTail` is always
   * `false` — a replayed transcript is never still growing. */
  function verdictPropsForMessage(i: number) {
    const entry = verdictRenderByMessage.get(i)
    if (!entry) return undefined
    const batch = gradeBatchById.get(entry.batchId)
    const anchorDate = isoLocalDateToAnchor(batch?.date ?? null)
    return {
      segments: entry.segments,
      eyebrowIndex: entry.eyebrowIndex,
      suppressSchedule: (seg: ScheduleSegment) => (batch ? shouldSuppressSchedule(seg, batch.results, anchorDate, false) : false),
    }
  }
  function renderGradeBatch(g: GradeBatch) {
    // Minimap Precision fix — `grade-${g.id}-${j}` matches
    // `deriveInstrumentMoments`'s grade-batch loop id exactly (same id
    // convention ReviewSessionView's live `renderGradeBatch` uses); nested
    // inside the existing `data-anchor-index` wrapper (an unrelated export
    // anchor this drawer already had), never replacing it.
    return g.results.map((r, j) => (
      <div key={`${g.id}-${j}`} className="contents" data-anchor-index={g.sourceIndex}>
        <CheckpointAnchor id={`grade-${g.id}-${j}`}>
          <GradeResultCard
            result={r}
            topic={ladderTopic}
            asOfDate={g.date ?? undefined}
            highlighted={hoveredPairNode === r.node}
            onHoverChange={(hovering) => setHoveredPairNode(hovering ? r.node : null)}
          />
        </CheckpointAnchor>
      </div>
    ))
  }

  // Chat Instruments Wave B — the transcript minimap, replay side. Reuses
  // the SAME `resolvedGrades`/`reviewCrossings`/`timeline.marks` this view
  // already computed for inline rendering — no second resolution pass, same
  // reshape-only pattern as ReviewSessionView's live `minimapMoments`.
  const minimapMoments = useMemo(
    () =>
      timeline
        ? deriveInstrumentMoments({
            marks: timeline.marks,
            probes: drawerProbes,
            gradeBatches: resolvedGrades.map((g) => ({
              id: g.batch.id,
              atIndex: g.resolvedIndex ?? timeline.messages.length,
              results: g.batch.results,
            })),
            crossings: reviewCrossings.map((c) => ({ atIndex: c.atMessageIndex, node: c.header.node })),
          })
        : [],
    [timeline, drawerProbes, resolvedGrades, reviewCrossings],
  )
  // Minimap Precision fix (second report on the same bug) — see
  // shared/jumpToCheckpoint.ts's doctrine comment for the full root-cause.
  function jumpToCheckpointMoment(moment: InstrumentMoment) {
    if (!scrollEl || !timeline || timeline.messages.length === 0) return undefined
    const fallbackIndex = Math.min(Math.max(moment.atIndex, 0), timeline.messages.length - 1)
    // Returned (not fire-and-forget) so TranscriptMinimap can re-measure
    // glyph positions once the jump has actually settled — see that
    // component's own doctrine comment.
    return jumpToCheckpoint(scrollEl, moment.id, fallbackIndex)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Session history"
      wide
      // Guardian anatomy (T3): the "read-only · sitting of …" line moves
      // in-band as the title's subtitle, and the export actions + their
      // status message move to the hairline-topped footer — both were
      // previously crammed into one `panel` row above the transcript.
      subtitle={
        selectedEntry && (
          <>
            read-only · {historyKey === ALL_HISTORY_KEY && `${historyRowTag(selectedEntry)} · `}
            sitting of {formatWhen(selectedEntry.startedAt)}
          </>
        )
      }
      footer={
        selectedEntry ? (
          <>
            <div className="flex items-center gap-3">
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
            {exportStatus && (
              <span
                className={`text-xs truncate max-w-[16rem] ${exportStatus.failed ? 'text-[var(--color-ink-danger)]' : 'text-[var(--color-text-faint)]'}`}
                title={exportStatus.text}
              >
                {exportStatus.text}
              </span>
            )}
          </>
        ) : undefined
      }
    >
      {/* Modal itself has no entrance (see ui/Modal.tsx) — this fade-rise is the
       * drawer's own, and fires once per open since Modal unmounts the whole
       * subtree when `open` is false. */}
      <div className="flex gap-4 h-[65vh] drawer-enter">
        <div className="w-48 shrink-0 flex flex-col border-r border-[var(--color-hairline)] pr-3 overflow-y-auto">
          {entries === null && <div className="fig-caption px-1 py-2">reading past sittings…</div>}
          {/* The deep-linked sitting this history's list doesn't contain —
              pinned above the recorded rows, never spliced in (the ordinals
              below count recorded sittings only). */}
          {linkedSitting && (
            <div className="border-b border-[var(--color-hairline)] mb-1 pb-1">
              <button
                onClick={() => selectEntry(linkedSitting.entry.sessionId, [linkedSitting.entry])}
                className={`focus-ring no-press tilt-card w-full flex flex-col items-start gap-0.5 px-2.5 py-2.5 text-left rounded-lg hover:bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] ${
                  linkedSitting.entry.sessionId === selectedId ? 'bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]' : ''
                }`}
              >
                <span className="text-sm text-[var(--color-text-primary)] truncate max-w-full">Linked sitting</span>
                <span className="text-xs text-[var(--color-text-faint)] label-data">{formatWhen(linkedSitting.entry.startedAt)}</span>
              </button>
            </div>
          )}
          {entries !== null && entries.length === 0 && !linkedSitting && (
            <div className="px-1 py-2 text-sm text-[var(--color-text-faint)]">No past sessions yet.</div>
          )}
          {entries?.map((entry, i) => (
            <button
              key={entry.sessionId}
              onClick={() => selectEntry(entry.sessionId)}
              className={`focus-ring no-press tilt-card w-full flex flex-col items-start gap-0.5 px-2.5 py-2.5 text-left rounded-lg hover:bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] ${
                entry.sessionId === selectedId ? 'bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]' : ''
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
          {/* The deep-linked sitting was opened, but from outside this
              history's own list — say which way (see resolveLinkedSitting).
              Quiet ink, not a warning: the right transcript IS on screen. */}
          {linkedSitting && (
            <div className="shrink-0 panel border-[var(--color-ink-cool-dim)] px-4 py-2 text-xs text-[var(--color-ink-cool)]">
              {linkedSitting.unrecorded
                ? 'This sitting ran outside this app — showing its transcript directly. It isn’t part of the recorded list on the left.'
                : 'This sitting is in the app’s recorded history, but not under this list — showing it directly.'}
            </div>
          )}
          {/* The requested sitting (a provenance/artifact deep link's own
              sessionId) isn't one this drawer's list contains, isn't recorded
              under any other key, and its transcript is gone from disk — say
              so instead of quietly opening a different transcript in its
              place (see resolveLinkedSitting for the two cases that DO still
              open; ArtifactTile's "Encoded …" link and TopicMapView's
              ProvenanceBlock both route through here). */}
          {requestedNotFound && (
            <div className="shrink-0 panel border-[var(--color-ink-cool-dim)] px-4 py-2 text-xs text-[var(--color-ink-cool)]">
              The sitting this points to isn’t in the app’s recorded history
              {entries && entries.length > 0
                ? ' — showing the most recent one instead. Pick any entry on the left to browse what is here.'
                : '.'}
            </div>
          )}
          {/* Chat Instruments Wave B — `relative` wrapper purely so the
              minimap (an `absolute` sibling of the scroll div, not a child of
              it) can sit at the scroll region's own right edge without
              scrolling away with the content it indexes — the drawer never
              used ChatScrollRegion (it has always hand-rolled this div; see
              its own file-level doctrine comment), so this wrapper is new
              here rather than ChatScrollRegion's existing `railSlot` prop. */}
          <div className="relative flex-1 min-h-0">
          <div ref={setScrollAndCopyRef} className="h-full overflow-y-auto flex flex-col gap-5 pr-1">
            {selectedId === null && <div className="fig-caption px-1">Select a sitting to view its transcript.</div>}
            {loadingTranscript && <div className="fig-caption px-1">reading transcript…</div>}
            {timeline && (
              <>
                {!isReviewSitting &&
                  resolvedGrades
                    .filter((g) => g.resolvedIndex === 0)
                    .flatMap((g) => renderGradeBatch(g.batch))}
                {timeline.marks
                  .filter((k) => k.atIndex === 0 && k.kind !== 'lapse' && k.kind !== 'milestone')
                  .map((k) => (
                    <MarkView key={k.id} mark={k} suppressBeatExcerpt={timeline.messages[k.atIndex]?.role === 'assistant'} />
                  ))}
                {timeline.messages.map((m, i) => {
                  // Verdict Anatomy (Wave 2), replay — undefined for the
                  // common case of a message no region claims (or any Learn
                  // sitting, always), which renders byte-identically to
                  // before this wave.
                  const verdictProps = verdictPropsForMessage(i)
                  return (
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
                              {(() => {
                                const batchesHere = resolvedGrades.filter((g) => g.resolvedIndex === i)
                                // Fix 2 — same "same resolved position, same
                                // node" pairing ReviewSessionView's live
                                // `inlineForMessage` computes; see
                                // MilestoneCard's own doctrine comment.
                                const gradedNodesHere = new Set(batchesHere.flatMap((g) => g.batch.results.map((r) => r.node)))
                                return (
                                  <>
                                    {batchesHere.flatMap((g) => renderGradeBatch(g.batch))}
                                    {resolvedOtherMarks
                                      .filter((g) => g.resolvedIndex === i)
                                      .map((g) => (
                                        <MarkView
                                          key={g.mark.id}
                                          mark={g.mark}
                                          milestonePairedWithGradeCard={g.mark.kind === 'milestone' && gradedNodesHere.has(g.mark.node)}
                                        />
                                      ))}
                                  </>
                                )
                              })()}
                              {reviewCrossings
                                .filter((c) => c.atMessageIndex === i)
                                .map((c) => (
                                  // Minimap Precision fix — `crossing-${i}-${node}`,
                                  // matching `deriveInstrumentMoments`'s
                                  // `input.crossings` loop id exactly.
                                  <CheckpointAnchor key={`${c.fromNode}-${c.header.node}-${i}`} id={`crossing-${i}-${c.header.node}`}>
                                    <NodeCrossingDivider nodeId={c.header.node} verb="moving to" topicCrossing={c.topicCrossing} />
                                  </CheckpointAnchor>
                                ))}
                            </>
                          ) : undefined
                        }
                        verdictSegments={verdictProps?.segments}
                        verdictEyebrowIndex={verdictProps?.eyebrowIndex}
                        suppressSchedule={verdictProps?.suppressSchedule}
                        previousTimestamp={timeline.messages[i - 1]?.timestamp}
                        dataIndex={i}
                        probeHighlighted={
                          hoveredPairNode !== null && probeNodeByMessageIndex.get(i) === hoveredPairNode
                        }
                        onProbeHoverChange={(hovering) => {
                          const node = probeNodeByMessageIndex.get(i)
                          if (node) setHoveredPairNode(hovering ? node : null)
                        }}
                      />
                    </div>
                    {!isReviewSitting &&
                      resolvedGrades
                        .filter((g) => g.resolvedIndex === i + 1)
                        .flatMap((g) => renderGradeBatch(g.batch))}
                    {timeline.marks
                      .filter(
                        (k) =>
                          (k.atIndex === i + 1 || (i === timeline.messages.length - 1 && k.atIndex > timeline.messages.length)) &&
                          k.kind !== 'lapse' &&
                          k.kind !== 'milestone',
                      )
                      .map((k) => (
                        // suppressBeatExcerpt — same rule as the live views:
                        // the message this mark renders immediately before is
                        // the beat's own prose, so the marker's one-line
                        // excerpt would repeat it (see MarkView's prop
                        // doctrine comment in ritual/Marks.tsx).
                        <MarkView key={k.id} mark={k} suppressBeatExcerpt={timeline.messages[k.atIndex]?.role === 'assistant'} />
                      ))}
                  </div>
                  )
                })}
                {/* Review only: grade batches, and the re-anchored lapse/
                    milestone marks, whose next probe header never arrived —
                    the sitting's last graded item, or one that closed before
                    producing its next probe. */}
                {isReviewSitting &&
                  resolvedGrades
                    .filter((g) => g.resolvedIndex === null)
                    .flatMap((g) => renderGradeBatch(g.batch))}
                {isReviewSitting &&
                  (() => {
                    const tailBatches = resolvedGrades.filter((g) => g.resolvedIndex === null)
                    const tailGradedNodes = new Set(tailBatches.flatMap((g) => g.batch.results.map((r) => r.node)))
                    return resolvedOtherMarks
                      .filter((g) => g.resolvedIndex === null)
                      .map((g) => (
                        <MarkView
                          key={g.mark.id}
                          mark={g.mark}
                          milestonePairedWithGradeCard={g.mark.kind === 'milestone' && tailGradedNodes.has(g.mark.node)}
                        />
                      ))
                  })()}
                {timeline.messages.length === 0 && !loadingTranscript && (
                  <div className="text-sm text-[var(--color-text-faint)] px-1">Empty transcript.</div>
                )}
              </>
            )}
          </div>
          <TranscriptMinimap
            moments={minimapMoments}
            totalMessages={timeline?.messages.length ?? 0}
            containerEl={scrollEl}
            onJump={jumpToCheckpointMoment}
          />
          </div>
        </div>
      </div>
    </Modal>
  )
}
