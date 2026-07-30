import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { PinTackIcon } from '../components/ui/PinTackIcon'
import type { DueItem, ExportSittingFormat } from '../../../shared/types'
import type { SessionEvent } from '../../../shared/sessionEvents'
import { RateLimitBanner } from '../components/RateLimitBanner'
import { isBlockingRateLimitStatus } from '../../../shared/rateLimit'
import { ChatMessageView } from '../components/ChatMessageView'
import { MessageComposer } from '../components/MessageComposer'
import { ContextGauge } from '../components/ContextGauge'
import { SittingClock } from '../components/SittingClock'
import { ActivityLine } from '../components/ActivityLine'
import { ChatScrollRegion } from '../components/ChatScrollRegion'
import { useEquationCopy } from '../components/useEquationCopy'
import { TranscriptMinimap } from '../components/TranscriptMinimap'
import { CheckpointAnchor } from '../components/CheckpointAnchor'
import { deriveInstrumentMoments } from '../shared/instrumentMoments'
import { jumpToCheckpoint } from '../shared/jumpToCheckpoint'
import type { InstrumentMoment } from '../shared/instrumentMoments'
import { useTutorActivity, composerDisabledReason } from '../shared/tutorActivity'
import { parseTranscriptToMessages, type ChatMessage } from '../../../shared/chatMessages'
import { extractLastUsageFromTranscript } from '../../../shared/sessionUsage'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { emitPulse } from '../../../shared/neuralFieldBus'
import {
  parseGradeResult,
  lapseReturnDate,
  isStabilityMilestone,
  type GradeResult,
  type StabilityMilestoneScale,
} from '../../../shared/gradeResult'
import { GradeResultCard } from '../components/GradeResultCard'
import { SkeletonBar } from '../components/Skeleton'
import { SessionCeremony } from '../components/ritual/Bookends'
import { ScheduleDelta } from '../components/ritual/ScheduleDelta'
import { SessionHistoryDrawer, exportSittingTranscript, buildHistoryTimeline, type GradeBatch } from '../components/SessionHistoryDrawer'
import { PageHeader } from '../components/ui/PageHeader'
import { SectionBanner } from '../components/ui/SectionBanner'
import { StatFraction } from '../components/ui/StatFraction'
import { ErrorPanel } from '../components/ErrorPanel'
import { recordConfidence, latestPickFor } from '../shared/calibrationStore'
import { extractTicketFromMessages } from '../shared/ticketParser'
import { TicketCard } from '../components/ritual/TicketCard'
import { ReadyRoomPlate } from '../components/ritual/ReadyRoomPlate'
import { ReviewHorizon } from '../components/ReviewHorizon'
import { InkWell } from '../components/ritual/InkWell'
import { FlowChain } from '../components/ritual/FlowChain'
import { ExportCommand } from '../components/ui/ExportCommand'
import { trailingRecalled } from '../../../shared/gradeResult'
import { invalidateSearchIndex } from '../shared/searchIndex'
import { computeDueBuckets } from '../shared/dueBuckets'
import { MarkView, type RitualMark } from '../components/ritual/Marks'
import type { ReviewDocketItem } from '../components/ritual/ReviewDocket'
import { deriveRitualMarks } from '../../../shared/ritualFromTranscript'
import { parseAuditNotification } from '../../../shared/taskNotification'
import {
  isReviewRateCommand,
  isAssessorAuditSpawnEvent,
  classifyEngramBashFailure,
  isMarkBoundaryToolUse,
  type ToolFailureKind,
} from '../../../shared/signals/tutorSignals'
import { QueueRail } from '../components/ritual/QueueRail'
import { NodeCrossingDivider } from '../components/ritual/Marks'
import { deriveReviewCrossings, latestProbeHeader, nextProbeHeaderAt, allProbeHeaders } from '../../../shared/reviewCrossing'
import { endsWithBareProbeHeader } from '../../../shared/probeHeader'
import {
  deriveVerdictRegions,
  verdictRegionMessageRenders,
  shouldSuppressSchedule,
  parseVerdictHint,
  type VerdictSegment,
  type ScheduleSegment,
  type VerdictHint,
} from '../../../shared/verdictSegments'

type Phase = 'loading' | 'empty' | 'ready' | 'in-session' | 'done' | 'closed-unexpectedly'

const HORIZON_DAYS = 14
const HOLDING_STABILITY_DAYS = 21

// due() only ever returns items already due (see readHandlers.ts's
// `engram:due`) — there's no "next due" query on the engine side. Both
// surfaces that have no queue to read from (`empty`, and `done` once the
// queue clears) instead read the shared `computeDueBuckets` walk (see
// shared/dueBuckets.ts — the same walk HomeView's 7-day forecast uses,
// extended here to 14 days), which also folds in the holding-count pass so
// there's still only one walk over the topic graphs, not two.

// isReviewRateCommand / isAssessorAuditSpawnEvent now live in
// shared/signals/tutorSignals.ts (imported above) — the single copies this
// view, LearnSessionView, and shared/ritualFromTranscript.ts's replay walk
// all share. Reconciled during that consolidation: this view's own prior
// local check (`looksLikeRateCall`) did not exclude Learn's pretest
// `--kind pretest` rate calls the way ritualFromTranscript.ts's version did —
// harmless in practice (pretest never runs inside a /review sitting), but the
// canonical version now carries the exclusion everywhere for safety.

// Local-date discipline (getFullYear/Month/Date — never toISOString, same
// pattern HomeView's 7-day due forecast uses) rather than trusting the
// engine's own `overdue_days`, which the opening docket never reads.
function daysOverdueLocal(due: string): number {
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const d = new Date(`${due}T00:00:00`)
  return Math.floor((dayStart.getTime() - d.getTime()) / 86400000)
}

/** The opening docket's rows — oldest (most overdue) first. ReviewDocket
 * itself caps the display at 8 with an "and N more…" tail; this just builds
 * and orders the full list from a fresh `due()` snapshot. */
function buildDocketItems(due: DueItem[]): ReviewDocketItem[] {
  return due
    .map((item) => ({ id: item.id, topic: item.topic, daysOverdue: daysOverdueLocal(item.due) }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
}

interface ReviewSessionViewProps {
  /** Reports live-session state up to App.tsx so the sidebar nav can show an
   * ink-dot ("a session is alive in there") while this view isn't the active tab. */
  onActivity?: (a: { active: boolean; busy: boolean }) => void
  /** Masthead "← Home" — leaves this view for the main page (the session, if
   * one is live, keeps running; this view stays mounted via KeepMounted). */
  onGoHome?: () => void
}

export function ReviewSessionView({ onActivity, onGoHome }: ReviewSessionViewProps = {}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [queue, setQueue] = useState<DueItem[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Addition D (chat refine round) — see LearnSessionView.tsx's own
  // identical field/doctrine comment; set alongside `setSessionId(sid)`
  // below (fresh start or resume — Review has exactly one such call site).
  const [sittingStartedAt, setSittingStartedAt] = useState<number | null>(null)
  const [production, setProduction] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [contextUsage, setContextUsage] = useState<{ usedTokens: number; contextWindow: number } | null>(null)
  const [rateLimit, setRateLimit] = useState<{ status: string; resetsAt: number | null } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hasPriorSession, setHasPriorSession] = useState(false)
  const [totalDue, setTotalDue] = useState(0)
  // Topic id -> real title for the ready plate's per-topic rows — fetched
  // once, non-blocking (the plate renders raw topic slugs until this
  // resolves; see ReadyRoomPlate's `topicTitles` prop doc comment).
  const [topicTitles, setTopicTitles] = useState<Record<string, string>>({})
  // Captured once when a session starts — the denominator for "Item N of M".
  // `queue` itself shrinks as items get graded, so it can't serve as both.
  const [sessionTotal, setSessionTotal] = useState(0)
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<ExportSittingFormat | null>(null)
  const [exportStatus, setExportStatus] = useState<{ text: string; failed: boolean } | null>(null)
  // The topic of whichever item `lastGrade` graded — GradeResult itself only
  // carries `node` (see shared/gradeResult.ts), and the interval ladder
  // needs topic+node to filter receipts (SessionHistoryDrawer's ladders do
  // the same via `historyKey`). Captured off `queueRef.current[0]` at the
  // rate call's own tool_use (see `pendingRateTopic` below), not read at
  // tool_result time — by then `refreshQueue()` may already have shifted
  // the queue past the item that was just graded.
  const [lastGradeTopic, setLastGradeTopic] = useState<string | null>(null)
  /** Every verdict this sitting has produced, each pinned to the message index
   * it landed on — the same convention the ritual marks use, so a grade keeps
   * its chronological place above the crossing that follows it.
   *
   * A list rather than a single card because these are DURABLE: a receipt's
   * tool_result is in the transcript, so reopening a sitting rebuilds all of
   * them (see the resume branch below) exactly as the history drawer does.
   * The previous single-card version showed only the newest and lost the rest
   * on reopen. */
  const [gradeBatches, setGradeBatches] = useState<GradeBatch[]>([])
  /** Only the freshly-landed card performs "the turn" (face-down → flip);
   * replayed ones render revealed, since their reveal already happened. */
  const [revealBatchId, setRevealBatchId] = useState<string | null>(null)
  const gradeSeq = useRef(0)
  const [sessionGrades, setSessionGrades] = useState<GradeResult[]>([])
  const [streakDays, setStreakDays] = useState<number | null>(null)
  const [chamber, setChamber] = useState(false)
  // Three session cards, three edges, three tacks: the ticket slides in from
  // the LEFT, the probe collapses UPWARD (Learn's masthead grammar), and the
  // closing summary collapses DOWNWARD off the bottom edge (the same grammar,
  // mirrored). All three float free of the transcript's layout so the chat
  // owns the column; pinning any one holds it out regardless of the cursor.
  const [probePinned, setProbePinned] = useState(false)
  const [probePeek, setProbePeek] = useState(false)
  const [ticketPinned, setTicketPinned] = useState(false)
  const [ticketPeek, setTicketPeek] = useState(false)
  // The closing summary (SessionCeremony/ScheduleDelta/ReviewHorizon) — see
  // handleSessionPointer's bottom-edge branch and the `phase === 'done'`
  // render below.
  const [summaryPinned, setSummaryPinned] = useState(false)
  const [summaryPeek, setSummaryPeek] = useState(false)
  const probeLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ticketLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const summaryLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Shared peek/tuck pair — `armed` guards against continuous motion pushing
   * the tuck deadline forward forever. */
  const makePeek = (
    timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    set: (v: boolean) => void,
  ) => ({
    peek: () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      set(true)
    },
    tuck: () => {
      // Clear + rearm: motion defers the deadline, so a card can only tuck
      // once the pointer has genuinely settled away from it. The previous
      // "armed deadline stands" variant let the tuck fire while the cursor
      // was mid-flight toward the card (mousemove sampling has holes at the
      // edges), folding the target under the very click aimed at it — the
      // same disease as Learn's masthead back button.
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        set(false)
      }, 400)
    },
  })
  const probeCtl = makePeek(probeLeaveTimer, setProbePeek)
  const ticketCtl = makePeek(ticketLeaveTimer, setTicketPeek)
  const summaryCtl = makePeek(summaryLeaveTimer, setSummaryPeek)
  /** Pointer-position tracking at the device's own mousemove rate. Top strip
   * reveals the probe (and its own height holds it open); left strip reveals
   * the ticket (its own width holds it open); bottom strip reveals the
   * closing summary (its own height holds it open) once the sitting is
   * `done`. Pinned cards opt out. */
  const handleSessionPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!probePinned) {
      const y = e.clientY - rect.top
      if (y <= (probePeek ? 220 : 28)) probeCtl.peek()
      else probeCtl.tuck()
    }
    if (!ticketPinned) {
      const x = e.clientX - rect.left
      if (x <= (ticketPeek ? 320 : 28)) ticketCtl.peek()
      else ticketCtl.tuck()
    }
    if (phase === 'done' && !summaryPinned) {
      // Mirror of the probe's top-edge check, off the container's BOTTOM
      // edge instead — the summary tucks downward and reveals upward.
      const yFromBottom = rect.bottom - e.clientY
      if (yFromBottom <= (summaryPeek ? 360 : 28)) summaryCtl.peek()
      else summaryCtl.tuck()
    }
  }
  useEffect(() => () => {
    if (probeLeaveTimer.current) clearTimeout(probeLeaveTimer.current)
    if (ticketLeaveTimer.current) clearTimeout(ticketLeaveTimer.current)
    if (summaryLeaveTimer.current) clearTimeout(summaryLeaveTimer.current)
  }, [])
  // The honest-blank affordance's readiness — true once the current item has sat
  // unanswered for 45s. See the effect keyed on `current?.id` below for the timer
  // itself; this just tracks whether it has fired.
  const [honestBlankReady, setHonestBlankReady] = useState(false)
  const [momentumOn, setMomentumOn] = useState(true)
  // The 14-day horizon figure + holding count — fetched whenever the queue
  // empties (both `empty` and `done`, the two phases with no queue left to
  // read from), null until the first refreshHorizon() resolves so the
  // panel can skeleton rather than flash a false "nothing scheduled".
  const [horizonBuckets, setHorizonBuckets] = useState<number[] | null>(null)
  const [holdingCount, setHoldingCount] = useState(0)
  // Ritual marks — Review's own minimal slice of Learn's atIndex-interleave
  // plumbing (LearnSessionView), needed here only for the opening docket
  // (one-time, `kind: 'docket'`) and the lapse rite (derivable, `kind:
  // 'lapse'`) — see the doctrine comment on RitualMark in Marks.tsx. Review's
  // one `onBridgeUi` listener (added for report_verdict, below) is scoped to
  // exactly that tool — every OTHER bridge tool (session_phase, show_figure,
  // render_ticket, etc) stays Learn-only for now: `render_ticket` in
  // particular is deliberately not wired here, since Review's ticket already
  // renders correctly through the existing text-fence path (BeatCard's
  // `splitAroundTicket`) and adding a second generic listener for tools no
  // installed skill calls yet isn't worth the structural change — extend if/
  // when it's needed.
  const [marks, setMarks] = useState<RitualMark[]>([])
  // Chat Presence Wave D — renderer-local, live-only "what's the tutor doing
  // right now" (shared/tutorActivity.ts's doctrine comment has the full
  // rationale). Additive alongside `busy` above: nothing here replaces it.
  const tutorActivity = useTutorActivity()

  const pendingRateToolUseId = useRef<string | null>(null)
  // The topic of the rate call currently in flight — read from `queueRef`
  // (not `queue` directly) at the moment its tool_use fires, since the
  // session-event listener effect below is registered once with `[]` deps
  // and would otherwise close over a stale `queue`.
  const pendingRateTopic = useRef<string | null>(null)
  const queueRef = useRef<DueItem[]>([])
  queueRef.current = queue
  const sessionIdRef = useRef<string | null>(null)
  const abortedRef = useRef(false)
  const messagesRef = useRef<ChatMessage[]>([])
  messagesRef.current = messages
  // report_verdict hints (Phase 2), keyed by the message index they apply
  // to — same `messagesRef.current.length`-at-call-time convention as every
  // atIndex above, captured in the onBridgeUi handler below. A ref, not
  // state: the useMemo that reads it (verdictRenderByMessage) is already
  // recomputed by the `messages` state update the following text always
  // triggers, so no separate re-render is needed for this to take effect —
  // same reasoning LearnSessionView's pushMark-based marks rely on.
  const verdictHintsRef = useRef<Map<number, VerdictHint[]>>(new Map())
  const markSeq = useRef(0)
  // Live-session audit spawns awaiting their `<task-notification>` verdict —
  // matched by tool-use-id, same FIFO-by-arrival-then-match discipline as
  // deriveRitualMarks's own `pendingAudits` (shared/ritualFromTranscript.ts),
  // so live and replay resolve the identical sitting identically. A ref (not
  // state) because it's pure bookkeeping the render never reads directly —
  // only `marks` state itself is rendered.
  const pendingAuditsRef = useRef<Array<{ toolUseId: string; markId: string }>>([])
  // Task 7's claimed-tool-use registry — same discipline as LearnSessionView's
  // own ref: every Bash tool_use `classifyEngramBashFailure` recognizes (here,
  // in practice, almost always Review's own `rate --rating` call, or the
  // generic `engram-bash` bucket for anything else engram.py-shaped) gets its
  // id claimed at dispatch time, so a later `isError` tool_result can push
  // the matching specific `tool-failure` mark.
  const toolFailureRegistry = useRef<Map<string, ToolFailureKind>>(new Map())
  // The bubble-split boundary (the interleave fix) — identical wiring to
  // LearnSessionView's own assistantBoundaryRef; see that ref's doctrine
  // comment and isMarkBoundaryToolUse in shared/signals/tutorSignals.ts.
  // Review's probe-header mechanism (beforeProbeHeader + nextProbeHeaderAt,
  // shared/reviewCrossing.ts) is untouched: it resolves grade cards INSIDE a
  // message at a parsed text anchor, which the split can only make more
  // precise (a mid-turn rate call now also ends the bubble, so commentary
  // and next-probe prose separated by the call become separate messages —
  // the header resolution walks the same messages array either way). Mid-
  // turn asks/phases here had the exact same disease Learn did; the same
  // split fixes both.
  const assistantBoundaryRef = useRef(false)

  function pushLapseMark(node: string, returnDate: string | null) {
    setMarks((prev) => [
      ...prev,
      { id: `mark-${markSeq.current++}`, atIndex: messagesRef.current.length, kind: 'lapse', node, returnDate },
    ])
  }

  // Task 6 — same shared `isStabilityMilestone` predicate LearnSessionView and
  // deriveRitualMarks use; Review only ever grades one node per `rate` call,
  // so this fires at most once per tool_result (unlike Learn's per-batch loop).
  function pushMilestoneMark(node: string, scale: StabilityMilestoneScale, sBefore: number, sAfter: number) {
    setMarks((prev) => [
      ...prev,
      { id: `mark-${markSeq.current++}`, atIndex: messagesRef.current.length, kind: 'milestone', node, scale, sBefore, sAfter },
    ])
  }

  // Task 7 — same claimed-tool-use-registry discipline as LearnSessionView's
  // own pushMark-adjacent helper; pushes the specific tool-failure card for
  // whichever engram call classifyEngramBashFailure recognized.
  function pushToolFailureMark(failureKind: ToolFailureKind) {
    setMarks((prev) => [
      ...prev,
      { id: `mark-${markSeq.current++}`, atIndex: messagesRef.current.length, kind: 'tool-failure', failureKind },
    ])
  }

  function refreshQueue(): Promise<DueItem[]> {
    return window.engram.due(12).then((items) => {
      setQueue(items)
      return items
    })
  }

  function refreshHorizon() {
    computeDueBuckets(HORIZON_DAYS, HOLDING_STABILITY_DAYS).then(({ buckets, holdingCount: holding }) => {
      setHorizonBuckets(buckets)
      setHoldingCount(holding)
    })
  }

  useEffect(() => {
    refreshQueue().then((items) => {
      setPhase(items.length > 0 ? 'ready' : 'empty')
    })
    // The horizon now renders at `ready` too (the plate, below), not just
    // `empty`/`done` — fetch it unconditionally on mount rather than only
    // when the queue is empty.
    refreshHorizon()
    // Uncapped, purely for the amnesty paragraph folded into the ready plate
    // — `queue` itself stays capped at 12 (the actual review cap /review
    // would use).
    window.engram.due().then((all) => setTotalDue(all.length))
    // Real topic titles for the ready plate's per-topic rows — non-blocking,
    // same discipline as HomeView/LearnSessionView's own topics() fetches;
    // the plate falls back to the raw topic slug until this resolves.
    window.engram.topics().then((list) => {
      setTopicTitles(Object.fromEntries(list.map((t) => [t.topic, t.title])))
    })
    // Momentum opt-out gates the cosmetic inkwell (dialogue-grammar.md's
    // opt-out, honored beyond the dialogue itself).
    window.engram
      .model()
      .then((m) => setMomentumOn(m.settings.momentum !== 'off'))
      .catch(() => setMomentumOn(true))
  }, [])

  useEffect(() => {
    onActivity?.({ active: phase === 'in-session', busy })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, busy])

  // Honest-blank timer (Task 2) — starts fresh whenever the current item changes,
  // clears on item change/unmount via the effect cleanup, and never fires outside
  // `in-session` (a fresh item queued up while `ready`/`done` shouldn't arm it).
  useEffect(() => {
    setHonestBlankReady(false)
    const itemId = queue[0]?.id
    if (phase !== 'in-session' || !itemId) return
    const t = setTimeout(() => setHonestBlankReady(true), 45000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue[0]?.id, phase])

  useEffect(() => {
    window.engram.lastSessionFor('review').then((id) => setHasPriorSession(id !== null))
    const offEvent = window.engram.onSessionEvent((sid, event) => {
      if (sid !== sessionIdRef.current) return
      handleSessionEvent(event)
    })
    const offAsk = window.engram.onBridgeAsk((req) => {
      if (req.sessionId !== sessionIdRef.current) return
      // Wave E, Task 11 — inline transcript mark instead of the AskDialog
      // modal; same atIndex convention every other live mark here uses
      // (pushLapseMark/pushMilestoneMark/pushToolFailureMark above).
      // `answerAsk` below resolves it in place by `requestId`.
      setMarks((prev) => [
        ...prev,
        {
          id: `mark-${markSeq.current++}`,
          atIndex: messagesRef.current.length,
          kind: 'ask',
          requestId: req.requestId,
          header: req.header,
          question: req.question,
          options: req.options,
          multiSelect: req.multiSelect,
          answer: null,
          live: true,
        },
      ])
      tutorActivity.dispatchAskOpened()
    })
    // report_verdict (Phase 2) — Review's first onBridgeUi listener; every
    // other bridge tool (session_phase, show_figure, etc) is Learn-only
    // today (see the verdictHintsRef doctrine comment above and the
    // `marks` state's own comment for why Review never needed this
    // generic channel before). Payload shape-guarded via the same
    // `parseVerdictHint` replay's `buildHistoryTimeline` uses, so live and
    // replay can never disagree about what counts as a well-formed hint.
    const offUi = window.engram.onBridgeUi((req) => {
      if (req.sessionId !== sessionIdRef.current) return
      if (req.tool !== 'report_verdict') return
      const hint = parseVerdictHint(req.payload)
      if (!hint) return
      const idx = messagesRef.current.length
      const list = verdictHintsRef.current.get(idx) ?? []
      list.push(hint)
      verdictHintsRef.current.set(idx, list)
    })
    return () => {
      offEvent()
      offAsk()
      offUi()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function appendLog(line: string) {
    setLog((prev) => [...prev.slice(-49), line])
  }

  function handleSessionEvent(event: SessionEvent) {
    // Chat Presence Wave D — fed every SessionEvent this handler sees, same
    // as `deriveRitualMarks` gets every walked transcript event; unlike that
    // function, this one is live-only and has no replay counterpart.
    tutorActivity.dispatchSessionEvent(event)
    switch (event.type) {
      case 'text': {
        // The interleave fix — a mark-producing tool_use since the last delta
        // ends the growing bubble, so the mark pinned at that boundary renders
        // between the prose that preceded it and the prose now arriving.
        const breakBubble = assistantBoundaryRef.current
        assistantBoundaryRef.current = false
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          // Bare-probe-header exception (see `endsWithBareProbeHeader`'s own
          // doctrine comment) — a header-only bubble absorbs the text that
          // follows a mark-boundary tool call (typically `render_beat`
          // posting the probe itself) instead of starting a new bubble.
          if (last && last.role === 'assistant' && (!breakBubble || endsWithBareProbeHeader(last.text))) {
            return [...prev.slice(0, -1), { ...last, text: last.text + event.text }]
          }
          // `Date.now()` at append time — SessionEvent carries no timestamp
          // of its own; see ChatMessage's own doctrine comment.
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', text: event.text, timestamp: Date.now() }]
        })
        break
      }
      case 'tool_use':
        appendLog(`→ ${event.name}(${JSON.stringify(event.input).slice(0, 80)})`)
        // The interleave fix — flag the bubble split FIRST, before any of the
        // specific-signal branches below; same shared predicate replay uses.
        if (isMarkBoundaryToolUse(event.name, event.input)) {
          assistantBoundaryRef.current = true
        }
        // Task 7 — claim this Bash call's id for tool-failure purposes before
        // the rate-specific branch below (same registry, same classifier
        // LearnSessionView and deriveRitualMarks share).
        if (event.name === 'Bash') {
          const failureKind = classifyEngramBashFailure(String((event.input as { command?: unknown }).command ?? ''))
          if (failureKind) toolFailureRegistry.current.set(event.id, failureKind)
        }
        if (event.name === 'Bash' && isReviewRateCommand(String((event.input as { command?: unknown }).command ?? ''))) {
          pendingRateToolUseId.current = event.id
          // Read the topic off the rate command's own `--topic` flag rather
          // than guessing from `queue[0]`: the tutor works in its own order
          // (it interleaves topics — see `current` above), so the queue head
          // is frequently a different item, and its topic would mislabel the
          // grade card's interval ladder. Falls back to the head only if the
          // flag is somehow absent.
          const cmd = typeof (event.input as { command?: unknown })?.command === 'string'
            ? ((event.input as { command: string }).command)
            : ''
          pendingRateTopic.current =
            /--topic\s+["']?([a-z0-9-]+)/.exec(cmd)?.[1] ?? queueRef.current[0]?.topic ?? null
        }
        if (isAssessorAuditSpawnEvent(event.name, event.input)) {
          // The spawn itself is a real SessionEvent, so it can push a
          // `pending` mark immediately. Its verdict CAN now resolve live too
          // (see the `task_notification` case below) — SessionManager.ts
          // forwards the background agent's eventual `<task-notification>`
          // completion as its own event, matched back to this spawn by
          // tool-use-id via `pendingAuditsRef`. If that notification never
          // arrives before the view unmounts, a transcript replay
          // (deriveRitualMarks, the `resume` branch of startSession below)
          // still resolves it the same way on next open.
          const markId = `mark-${markSeq.current++}`
          setMarks((prev) => [
            ...prev,
            { id: markId, atIndex: messagesRef.current.length, kind: 'audit', itemCount: null, verdict: 'pending', disputedNodes: [] },
          ])
          pendingAuditsRef.current.push({ toolUseId: event.id, markId })
        }
        break
      case 'tool_result': {
        appendLog(`← ${event.isError ? 'error' : 'ok'}`)
        // Task 7 — resolve any claimed tool-failure. Order relative to the
        // rate-specific branch below doesn't affect correctness (that branch
        // already gates on `!event.isError` itself), only render order
        // within the same atIndex.
        const failureKind = toolFailureRegistry.current.get(event.toolUseId)
        if (failureKind !== undefined) {
          toolFailureRegistry.current.delete(event.toolUseId)
          if (event.isError) pushToolFailureMark(failureKind)
        }
        if (event.toolUseId === pendingRateToolUseId.current) {
          pendingRateToolUseId.current = null
          if (!event.isError) {
            emitPulse('recalled')
            const result = parseGradeResult(event.content)
            if (result) {
              // A receipt just landed — the node's state (and the palette's
              // stale-cached view of it) has changed.
              invalidateSearchIndex()

              setLastGradeTopic(pendingRateTopic.current)
              // Pin the verdict where it landed. Rendering at the transcript's
              // tail put it BELOW the "moving to …" crossing that follows
              // moments later — the wrong order: you're graded on the item you
              // just finished, then the tutor moves on.
              const batchId = `live-g${gradeSeq.current++}`
              setRevealBatchId(batchId)
              setGradeBatches((prev) => [
                ...prev,
                { id: batchId, atIndex: messagesRef.current.length, results: [result], sourceIndex: -1, date: null },
              ])
              setSessionGrades((prev) => [...prev, result])
              // The lapse rite — a quiet marker, not the danger-styled grade
              // card's alarm (see LapseRite's doctrine comment in Marks.tsx).
              if (result.grade === 'lapsed') {
                pushLapseMark(result.node, lapseReturnDate(result.intervalDays))
              }
              // Task 6 — same shared predicate; a lapse and a milestone can
              // never co-occur (isStabilityMilestone excludes grade==='lapsed'),
              // so these two marks never both fire for the same result.
              const scale = isStabilityMilestone(result)
              if (scale) pushMilestoneMark(result.node, scale, result.sBefore as number, result.sAfter as number)
            }
          }
          refreshQueue().then((items) => {
            setBusy(false)
            if (items.length === 0) {
              setPhase('done')
              setChamber(false)
              window.engram.stats().then((s) => setStreakDays(s.streak_days))
              refreshHorizon()
            }
          })
        }
        break
      }
      case 'task_notification': {
        // Resolve a pending audit spawn's verdict in place, live — see
        // pendingAuditsRef's doctrine comment above and the module-level
        // `parseAuditNotification` doctrine comment in
        // shared/taskNotification.ts. Never stores or renders `event.content`
        // itself: it's parsed synchronously right here and only the closed
        // verdict shape (itemCount/verdict/disputedNodes — identical to what
        // deriveRitualMarks would derive for the same notification) ever
        // reaches `marks` state.
        const pending = pendingAuditsRef.current
        for (let i = 0; i < pending.length; i++) {
          const verdict = parseAuditNotification(event.content, pending[i].toolUseId)
          if (verdict) {
            const markId = pending[i].markId
            setMarks((prev) =>
              prev.map((m) =>
                m.id === markId && m.kind === 'audit'
                  ? {
                      ...m,
                      itemCount: verdict.itemCount,
                      verdict: verdict.disputedNodes.length === 0 ? 'agreed' : 'disputed',
                      disputedNodes: verdict.disputedNodes,
                    }
                  : m,
              ),
            )
            pending.splice(i, 1)
            break
          }
        }
        break
      }
      case 'rate_limit':
        setRateLimit(event.status === 'allowed' ? null : { status: event.status, resetsAt: event.resetsAt })
        break
      case 'usage':
        setContextUsage({ usedTokens: event.usedTokens, contextWindow: event.contextWindow })
        break
      case 'turn_ended':
        setBusy(false)
        if (event.isError && event.resultText) setError(event.resultText)
        break
      case 'closed':
        // The process behind any still-open live ask just died — a deliberate
        // stop, a crash, or a natural exit all route through here (this is the
        // child process's own 'close' event, SessionManager.ts's only call to
        // handleClose). Its bridge request died with it (bridgeServer.ts's
        // `pendingAsks` entry for it is now stale), so the mark must stop
        // rendering as a live, clickable, pulsing question. Flip `live` to
        // false and leave `answer: null` — that's the exact shape
        // deriveRitualMarks already produces for a replayed dead ask, and
        // AskCard already renders it honestly ("no answer was given"); see
        // that doctrine comment in shared/ritualFromTranscript.ts. Never
        // touches an already-answered ask (`answer !== null`).
        setMarks((prev) =>
          prev.map((m) => (m.kind === 'ask' && m.live && m.answer === null ? { ...m, live: false } : m)),
        )
        if (abortedRef.current) {
          abortedRef.current = false
          setBusy(false)
          setPhase('ready') // a deliberate stop, not a crash — back to "start/resume" rather than the crash-styled panel
        } else if (phase !== 'done') {
          setPhase('closed-unexpectedly')
          setChamber(false)
        }
        break
      case 'error':
        setError(event.message)
        break
    }
  }

  async function startSession(resume: boolean) {
    // Chat Presence Wave D — live-only, no replay obligation: a resumed
    // session's activity starts fresh at `idle` here, same as a brand-new
    // one, regardless of how much history the transcript hydration below
    // rebuilds. See shared/tutorActivity.ts's doctrine comment.
    tutorActivity.reset()
    // A fresh spawn's first text delta always starts its own bubble — never
    // inherit a stale split flag from a previous sitting's last tool call.
    assistantBoundaryRef.current = false
    setPhase('in-session')
    // A resume keeps its already-earned grades (below), so the total has to
    // stay session-absolute or the queue rail mixes a fragment denominator
    // with an absolute numerator — past the halfway point that renders a
    // fully-complete rail mid-sitting. Invariant the rail documents and
    // depends on: sessionTotal - queue.length === sessionGrades.length.
    setSessionTotal(resume ? queue.length + sessionGrades.length : queue.length)
    setChamber(false)
    setProbePinned(false)
    setProbePeek(false)
    setSummaryPinned(false)
    setSummaryPeek(false)
    // The queue was last read at mount (or after the previous grade) — a
    // resume especially can be minutes or days later, and a stale head makes
    // the probe card describe work that's already done. Re-read on every
    // session start; `current` narrows it further from the transcript.
    refreshQueue()
    if (!resume) {
      setLastGradeTopic(null)
      setSessionGrades([])
      setMarks([])
      setGradeBatches([])
      setRevealBatchId(null)
    }

    // Hydrate prior chat history before spawning, same as Learn — resume continues the
    // same session id, so its transcript file is the right one to replay from.
    if (resume) {
      const priorId = await window.engram.lastSessionFor('review')
      if (priorId) {
        const lines = await window.engram.getTranscript(priorId)
        setMessages(parseTranscriptToMessages(lines))
        // Initialize the gauge from history immediately, same as Learn — otherwise it
        // stays blank until the next turn completes despite a resumed session already
        // having real usage.
        setContextUsage(extractLastUsageFromTranscript(lines))
        // Replay the lapse rite(s) a resumed sitting's history already carries — same
        // "only when empty" guard Learn uses, so a live session's marks are never
        // clobbered by a stray re-hydration. The opening docket never replays here
        // (it's one-time — see deriveRitualMarks's doctrine comment).
        //
        // This guard is deliberately per-mount, not per-transcript-content: within
        // one mounted view, Stop→Resume calls startSession(true) again with `marks`
        // already holding this same sitting's live-accumulated cards (grades, beats,
        // the now-orphaned ask fixed above) — those are already correct, so skipping
        // a fresh disk replay here is intentional, not a bug. It used to be the thing
        // that let a stale `live:true` ask leak across Stop→Resume; that's fixed at
        // the source now (the `closed` handler above orphans it the moment the
        // process dies), so this guard preserving leftover marks is safe again. It
        // does mean a genuinely different resumed sitting mounted fresh (marks === [])
        // still gets the real replay, which is the only case that matters for
        // correctness — a re-resume of the SAME still-mounted sitting has nothing
        // fresher on disk than what's already in `marks`.
        setMarks((prev) => (prev.length === 0 ? deriveRitualMarks(lines) : prev))
        // Rebuild every verdict this sitting already produced, from the same
        // receipt tool_results the history drawer reads — so reopening shows
        // the grades in place rather than a transcript with the verdicts
        // silently missing. Same "only when empty" guard as the marks.
        const derived = buildHistoryTimeline(lines).grades
        setGradeBatches((prev) => (prev.length === 0 ? derived : prev))
        // The same receipts also tell the rail (and the inkwell, the flow
        // chain, the closing ceremony) how much of this sitting is already
        // done. Without this a reopened sitting reported zero completed and
        // sized its rail to the remaining fragment — the queue rail's stated
        // invariant, sessionTotal - queue.length === sessionGrades.length,
        // only holds once BOTH sides are rebuilt, so they're set together
        // off the same fresh queue read.
        const already = derived.flatMap((b) => b.results)
        if (already.length > 0) {
          setSessionGrades((prev) => (prev.length === 0 ? already : prev))
          refreshQueue().then((items) => {
            setSessionTotal((prev) => Math.max(prev, items.length + already.length))
          })
        }
      }
    } else {
      setMessages([])
      setContextUsage(null)
      // The opening docket — a one-time snapshot of what's due, staged above
      // the transcript before any turns happen. Fresh sittings only: a
      // resumed session has no fresh due() read to stage, and the docket
      // doesn't replay from the transcript either way (see the doctrine
      // comment on RitualMark in Marks.tsx).
      window.engram
        .due()
        .then((due) => {
          const items = buildDocketItems(due)
          if (items.length === 0) return
          setMarks((prev) => [...prev, { id: `mark-${markSeq.current++}`, atIndex: 0, kind: 'docket', items }])
        })
        .catch(() => {
          // Read failure — the docket just doesn't show; nothing else in the
          // sitting depends on it.
        })
    }

    const { sessionId: sid } = resume
      ? await window.engram.resumeSession('/engram:review', 'review')
      : await window.engram.startSession('/engram:review', 'review')
    sessionIdRef.current = sid
    setSessionId(sid)
    setSittingStartedAt(Date.now())
    // Resuming sends no kickoff turn (SessionManager skips it on --resume — the model
    // already has full context), so there's nothing to wait on.
    setBusy(!resume)
  }

  async function attachFiles() {
    const picked = await window.engram.pickFiles()
    setAttachedFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  async function submitProduction() {
    if (!sessionId || !production.trim() || busy) return
    const text = production.trim()
    const files = attachedFiles
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text, attachments: files, timestamp: Date.now() }])
    setBusy(true)
    setProduction('')
    setAttachedFiles([])
    const sentText = files.length > 0 ? `${text}\n\n[Attached files — read these for context: ${files.join(', ')}]` : text
    await window.engram.sendMessage(sessionId, sentText)
  }

  async function answerAsk(requestId: string, chosen: string[] | null) {
    const mark = marks.find((m): m is Extract<RitualMark, { kind: 'ask' }> => m.kind === 'ask' && m.requestId === requestId)
    if (!mark) return
    // Mirror the confidence pick locally before forwarding — best-effort, never
    // blocks the real answer even if the current item isn't known yet.
    if (mark.header === 'Confidence' && chosen && chosen[0] && current) {
      const index = mark.options.findIndex((o) => o.label === chosen[0])
      recordConfidence(current.topic, current.id, chosen[0], index >= 0 ? index : undefined)
    }
    await window.engram.answerBridgeQuestion(requestId, { chosen })
    // `chosen ?? []` — see LearnSessionView's identical answerAsk for why a
    // real Skip must never be stored as `null` on this mark.
    setMarks((prev) => prev.map((m) => (m.kind === 'ask' && m.requestId === requestId ? { ...m, answer: chosen ?? [] } : m)))
    tutorActivity.dispatchAskAnswered()
  }

  // Pulls a prior answer back into the composer to revise and send as a new follow-up —
  // the original bubble stays in history untouched, so anything already rated server-side
  // is unaffected. Only offered on your own latest message.
  function editResend(text: string, attachments: string[]) {
    if (busy) return
    setProduction(text)
    setAttachedFiles(attachments)
  }

  function stopSession() {
    if (!sessionId) return
    abortedRef.current = true
    tutorActivity.dispatchStopped()
    window.engram.abortSession(sessionId)
  }

  // Same reused path as LearnSessionView's own export — see
  // exportSittingTranscript's doc comment in SessionHistoryDrawer.tsx.
  async function exportCurrentSitting(format: ExportSittingFormat) {
    if (!sessionId) return
    setExportingFormat(format)
    setExportStatus(null)
    try {
      const history = await window.engram.sessionHistoryFor('review')
      const startedAt = history.find((e) => e.sessionId === sessionId)?.startedAt ?? new Date().toISOString()
      const result = await exportSittingTranscript(sessionId, format, { title: 'Review', startedAt })
      if (result.ok) setExportStatus({ text: `Saved to ${result.path}`, failed: false })
      else if (result.reason !== 'canceled') setExportStatus({ text: `Export failed: ${result.reason}`, failed: true })
    } finally {
      setExportingFormat(null)
    }
  }

  /** What the tutor is ACTUALLY probing right now — read straight off its
   * own most recent probe-header marker (shared/reviewCrossing.ts), never by
   * matching probe TEXT against the due queue. `queue[0]` is engram's
   * most-overdue-first head, which is not the tutor's working order (a real
   * sitting interleaves topics), and the previous text-matching approach
   * could — and, against a real 2026-07-27 sitting, DID — land on the WRONG
   * queued item entirely (a crossing named "Legendre Transform Hamiltonian"
   * while the tutor's own header, right there in the same message, named
   * "economism-tendency"). The header is ground truth: it's the literal
   * text of what got asked, so it can never disagree with itself. */
  const latestProbe = useMemo(() => latestProbeHeader(messages), [messages])
  /** Only the fields the probe card / QueueRail / confidence recording
   * actually read — `id`, `topic`, `probe` — never the full `DueItem` shape,
   * so this stays out of scripts/checkDoctrine.ts's D4 answer-leak scan
   * (which flags any file spelling out `claim`/`rubric`/`transfer_probe`,
   * the expected-answer fields Review must never surface before a
   * production lands — this view has no legitimate reason to touch them and
   * shouldn't need a pin here). Matched to the queue by node id (never by
   * fuzzy probe-text substring, the previous approach) for the topic slug;
   * falls back to the header's own body text when the queue (capped at 12,
   * reshuffling every grade) no longer carries this node — so the probe card
   * still shows the tutor's own words rather than going blank. */
  const current = useMemo(() => {
    if (!latestProbe) {
      const head = queue[0]
      return head ? { id: head.id, topic: head.topic, probe: head.probe } : null
    }
    const { header } = latestProbe
    const queued = queue.find((it) => it.id === header.node)
    return queued
      ? { id: queued.id, topic: queued.topic, probe: queued.probe }
      : { id: header.node, topic: header.topic ?? '', probe: header.body }
  }, [latestProbe, queue])
  // The sweep between items — Review's counterpart to Learn's node crossing —
  // derived purely from the transcript's own probe headers (never an
  // imperative "did current.id just change" effect keyed off queue-matched
  // text). Each crossing's `atMessageIndex` is the header's OWN message, so it
  // renders INLINE within that message (see ChatMessageView's
  // `beforeProbeHeader` prop below) — after that message's own leading verdict
  // commentary, immediately before its probe card — never before the message
  // as a whole, which would land it ahead of the very commentary it follows.
  const crossings = useMemo(() => deriveReviewCrossings(messages), [messages])
  // Chat Instruments Wave B — every probe header, reused by BOTH the
  // transcript minimap (a "notable moment" per probe) and the grade-card ↔
  // probe-card hover linkage (`probeNodeByMessageIndex` below) — one walk,
  // not two, of the same `allProbeHeaders` this file's own `latestProbeHeader`
  // (imported above) is itself built from.
  const reviewProbes = useMemo(() => allProbeHeaders(messages), [messages])
  /** This message index's own probe header node, if it has one — the SAME
   * lookup `ChatMessageView` performs internally off `message.text` via
   * `splitAroundProbeHeader` (see that component), read here instead of
   * re-parsed, purely so the hover-linkage wiring below can ask "does this
   * message's ProbeCard answer to node X" without a second parse. */
  const probeNodeByMessageIndex = useMemo(() => {
    const map = new Map<number, string>()
    for (const { index, header } of reviewProbes) map.set(index, header.node)
    return map
  }, [reviewProbes])
  /** Chat Instruments Wave B — the grade-card ↔ probe-card hover linkage.
   * Node id of whichever card (either side) is currently hovered, or null.
   * Matched purely by node id — the same field the verdict-region/crossing
   * machinery above already keys grade batches and probe headers on — never
   * re-derived, just read straight off `GradeResult.node` / `ProbeHeader.node`.
   * A soft ring/wash only (see index.css's `.pair-linked`); never auto-scrolls
   * a partner into view. */
  const [hoveredPairNode, setHoveredPairNode] = useState<string | null>(null)

  const blocked = rateLimit !== null && isBlockingRateLimitStatus(rateLimit.status)
  /** Every grade batch's resolved render position — the index of the next
   * message (at or after where its `rate` tool_result landed) that carries a
   * probe header, i.e. immediately before whatever the tutor asks next.
   * `null` is the tail case: no later header exists yet (the sitting's last
   * graded item, or a session that closed before producing its next probe).
   * Recomputed from `messages` on every change (never baked in at
   * tool_result time) so a batch's card always lands after the FULL verdict
   * commentary that names it — live or replayed alike. See
   * shared/reviewCrossing.ts's doctrine comment for why anchoring to
   * "however many messages exist right now" was the bug. */
  const resolvedGradeBatches = useMemo(
    () => gradeBatches.map((b) => ({ batch: b, resolvedIndex: nextProbeHeaderAt(messages, b.atIndex) })),
    [gradeBatches, messages],
  )
  /** Carried-over fix (chat-ordering-fix-report.md's own follow-up list) —
   * `lapse`/`milestone` marks shared the exact anchoring bug the grade card
   * and crossing were fixed for: `pushLapseMark`/`pushMilestoneMark` still
   * pin `atIndex` to "however many messages exist right now" at tool_result
   * time (unchanged, same "landed at" bookkeeping `gradeBatches.atIndex`
   * keeps), but rendering now resolves that through the SAME
   * `nextProbeHeaderAt` used above, so a lapse rite or milestone card lands
   * after the full verdict commentary that names it, immediately before the
   * next probe — never ahead of it. Only these two kinds get pulled out of
   * the generic `marks` bucket below; every other mark kind (`docket`,
   * `audit`, `tool-failure`, …) keeps the old boundary convention untouched. */
  const resolvedOtherMarks = useMemo(
    () =>
      marks
        .filter((m) => m.kind === 'lapse' || m.kind === 'milestone')
        .map((m) => ({ mark: m, resolvedIndex: nextProbeHeaderAt(messages, m.atIndex) })),
    [marks, messages],
  )
  /** Verdict Anatomy (Wave 2) — the message-index range each grade batch's
   * own verdict commentary occupies (shared/verdictSegments.ts's doctrine
   * comment has the full boundary-algorithm rationale). `gradeBatches`
   * (GradeBatch[], imported from SessionHistoryDrawer.tsx) is structurally a
   * superset of the `VerdictRegionBatch{id,atIndex}` shape this expects —
   * the same "assignable as-is, never a renderer import into shared/"
   * convention `deriveVerdictRegions`'s own doctrine comment documents.
   * Recomputed from `messages`/`gradeBatches` on every change, same "never
   * baked in at tool_result time" discipline `resolvedGradeBatches` above
   * already follows. */
  const verdictRegions = useMemo(() => deriveVerdictRegions(messages, gradeBatches), [messages, gradeBatches])
  /** Per-message render input (this message's own segmented text, plus
   * which single segment — across the WHOLE region, never per-message — is
   * the VERDICT eyebrow anchor), keyed by message index for O(1) lookup
   * while rendering the transcript below, alongside which batch each
   * region's messages belong to (needed for `shouldSuppressSchedule`'s own
   * `batchResults` argument). `verdictRegionMessageRenders` is the SAME
   * derivation SessionHistoryDrawer's replay wiring calls, so a resumed or
   * later-reopened sitting can never disagree with what rendered live. */
  const verdictRenderByMessage = useMemo(() => {
    const map = new Map<number, { segments: VerdictSegment[]; eyebrowIndex: number | null; batchId: string }>()
    for (const region of verdictRegions) {
      for (const render of verdictRegionMessageRenders(messages, region, verdictHintsRef.current)) {
        map.set(render.messageIndex, { segments: render.segments, eyebrowIndex: render.eyebrowSegmentIndex, batchId: region.batchId })
      }
    }
    return map
  }, [verdictRegions, messages])
  const gradeBatchById = useMemo(() => new Map(gradeBatches.map((b) => [b.id, b] as const)), [gradeBatches])
  /** Review's LIVE view always anchors `shouldSuppressSchedule`'s date check
   * to TODAY's local calendar date (getFullYear/Month/Date — never
   * `toISOString`, same discipline `daysOverdueLocal` above already uses),
   * never a batch's own `date` field — freshly-graded batches never set one
   * (see the `setGradeBatches` call in the `tool_result` handler above,
   * `date: null` always) and a RESUMED sitting's earlier batches carry a
   * historical one from `buildHistoryTimeline`, but this view is still being
   * looked at live, today. Same "now is correct for the live push" split
   * `shared/gradeResult.ts`'s `lapseReturnDate` doctrine comment establishes
   * elsewhere in this codebase; SessionHistoryDrawer's replay wiring is the
   * one that anchors to each batch's own recorded date instead. Computed
   * once per mount rather than on every render — a live session spanning
   * local midnight mid-sitting is a real but vanishingly rare edge case, not
   * worth re-deriving on every keystroke for. */
  const todayLocal = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])
  /** This message's own Verdict Anatomy render props, or `undefined` for
   * the common case of a message no region claims (byte-identical current
   * behavior — see ChatMessageView's own prop doctrine comment). The
   * streaming-tail flag mirrors `trailingCaret`'s own condition below
   * (`busy && i === messages.length - 1`) — a still-growing message's last
   * paragraph hasn't finished, so `shouldSuppressSchedule` must never
   * suppress it out from under the reader mid-stream. */
  function verdictPropsForMessage(i: number) {
    const entry = verdictRenderByMessage.get(i)
    if (!entry) return undefined
    const batch = gradeBatchById.get(entry.batchId)
    const isLiveStreamingTail = busy && i === messages.length - 1
    return {
      segments: entry.segments,
      eyebrowIndex: entry.eyebrowIndex,
      suppressSchedule: (seg: ScheduleSegment) =>
        batch ? shouldSuppressSchedule(seg, batch.results, todayLocal, isLiveStreamingTail) : false,
    }
  }
  function renderGradeBatch(b: GradeBatch) {
    // Minimap Precision fix — `grade-${b.id}-${ri}`, matching
    // `deriveInstrumentMoments`'s own grade-batch loop id exactly, so the
    // minimap can jump straight to THIS result card (these render nested
    // inside a message's own `beforeProbeHeader` flow, or after the whole
    // transcript for the tail case — never the message's own root).
    return b.results.map((r, ri) => (
      <CheckpointAnchor key={`${b.id}-${ri}`} id={`grade-${b.id}-${ri}`}>
        <GradeResultCard
          result={r}
          confidenceLabel={latestPickFor(r.node)?.label ?? null}
          reveal={b.id === revealBatchId}
          topic={b.id === revealBatchId ? lastGradeTopic ?? undefined : undefined}
          highlighted={hoveredPairNode === r.node}
          onHoverChange={(hovering) => setHoveredPairNode(hovering ? r.node : null)}
        />
      </CheckpointAnchor>
    ))
  }
  /** Grade card(s) + crossing divider belonging INSIDE message `i`'s own
   * render — passed as ChatMessageView's `beforeProbeHeader` prop. Null (no
   * extra render) for the common case of a message resolving nothing. */
  function inlineForMessage(i: number) {
    const batches = resolvedGradeBatches.filter((g) => g.resolvedIndex === i)
    const otherMarks = resolvedOtherMarks.filter((g) => g.resolvedIndex === i)
    const crossing = crossings.find((c) => c.atMessageIndex === i)
    if (batches.length === 0 && otherMarks.length === 0 && !crossing) return null
    // Fix 2 — a milestone at this SAME resolved position whose own `node`
    // also appears in a grade batch resolved here is the "adjacent to its
    // own grade card" case MilestoneCard's doctrine comment describes; see
    // that comment for why the numbers line then drops in favor of it.
    const gradedNodesHere = new Set(batches.flatMap((g) => g.batch.results.map((r) => r.node)))
    return (
      <Fragment>
        {batches.flatMap((g) => renderGradeBatch(g.batch))}
        {otherMarks.map((g) => (
          <MarkView
            key={g.mark.id}
            mark={g.mark}
            milestonePairedWithGradeCard={g.mark.kind === 'milestone' && gradedNodesHere.has(g.mark.node)}
          />
        ))}
        {crossing && (
          // Minimap Precision fix — `crossing-${messageIndex}-${node}`,
          // matching `deriveInstrumentMoments`'s own `input.crossings` loop id
          // exactly (Review's crossings, unlike Learn's, don't come through
          // `marks` — see that function's doctrine comment).
          <CheckpointAnchor id={`crossing-${i}-${crossing.header.node}`}>
            <NodeCrossingDivider nodeId={crossing.header.node} verb="moving to" topicCrossing={crossing.topicCrossing} />
          </CheckpointAnchor>
        )}
      </Fragment>
    )
  }
  /** Grade batches whose next probe header hasn't arrived (yet) — rendered
   * once, after the whole transcript, same tail convention `marks` still
   * uses for everything else. */
  const tailGradeBatches = resolvedGradeBatches.filter((g) => g.resolvedIndex === null)
  /** Same tail case for the re-anchored lapse/milestone marks below. */
  const tailOtherMarks = resolvedOtherMarks.filter((g) => g.resolvedIndex === null)
  const lastUserMessageId = useMemo(() => [...messages].reverse().find((m) => m.role === 'user')?.id ?? null, [messages])
  const latestTicket = useMemo(() => extractTicketFromMessages(messages), [messages])

  // Chat Instruments Wave A — wired at the whole session pane's own root
  // below (not just the transcript's ChatScrollRegion), so it also covers
  // SessionCeremony's closing card and the composer's MarkdownPreview
  // (separately wired at its own root too — safe to nest, see
  // useEquationCopy's own doctrine comment). A callback ref: this pane's
  // root is behind the `phase === 'in-session' || phase === 'done'`
  // conditional below, which unmounts/remounts across a session's own
  // lifecycle — exactly the case the callback-ref design exists for.
  const equationCopyRef = useEquationCopy()

  // Chat Instruments Wave B — the transcript minimap. Grade batches and
  // crossings are the SAME `resolvedGradeBatches`/`crossings` this view
  // already computed above for inline rendering, just reshaped to the
  // structural input `deriveInstrumentMoments` expects — no second
  // resolution pass. `resolvedIndex ?? messages.length` mirrors the tail
  // convention every other resolved position in this file already uses
  // (render at the very end when no later probe header exists yet).
  const minimapMoments = useMemo(
    () =>
      deriveInstrumentMoments({
        marks,
        probes: reviewProbes,
        gradeBatches: resolvedGradeBatches.map((g) => ({
          id: g.batch.id,
          atIndex: g.resolvedIndex ?? messages.length,
          results: g.batch.results,
        })),
        crossings: crossings.map((c) => ({ atIndex: c.atMessageIndex, node: c.header.node })),
      }),
    [marks, reviewProbes, resolvedGradeBatches, crossings, messages.length],
  )
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // Minimap Precision fix (second report on the same bug) — jumps straight to
  // the checkpoint's OWN `CheckpointAnchor`, never the host message; see
  // shared/jumpToCheckpoint.ts's doctrine comment for the full root-cause
  // (H1: no per-checkpoint DOM anchor existed at all; H2: `content-visibility`
  // layout settling drifts the landing spot after the first scroll).
  function jumpToCheckpointMoment(moment: InstrumentMoment) {
    if (!scrollEl || messages.length === 0) return undefined
    const fallbackIndex = Math.min(Math.max(moment.atIndex, 0), messages.length - 1)
    // Returned (not fire-and-forget) so TranscriptMinimap can re-measure
    // glyph positions once the jump has actually settled — see that
    // component's own doctrine comment.
    return jumpToCheckpoint(scrollEl, moment.id, fallbackIndex)
  }

  return (
    // Tighter at the top than the standard p-8 so the header sits near the
    // window chrome and the transcript gets the reclaimed height; the gap
    // does the separating.
    <div className="h-full min-h-0 flex flex-col px-8 pt-3 pb-6 gap-3 w-full">
      <PageHeader
        // Command-bar band: the hairline underline runs the full view width
        // (-mx-8 bleeds it past the container padding).
        className="shrink-0 -mx-8 px-8 pb-3 border-b border-[var(--color-hairline)]"
        title="Review"
        // Identity sub-line, one compact mono lockup under the title: in a
        // sitting (and at its close) it's the session's own position —
        // "N of M · K topics", off the same sessionGrades/sessionTotal pair
        // the queue rail's invariant guarantees; otherwise the due count.
        // The ready plate below says the due count once, big — the header
        // repeating it there would be the exact "three due counts"
        // redundancy an earlier wave fixed, so `ready` shows nothing.
        subtitle={(() => {
          if (phase === 'in-session' || phase === 'done') {
            // Topics still represented in the live queue — honest and cheap
            // (GradeResult carries no topic, so already-cleared topics drop
            // out of the count as the sitting narrows).
            const topicCount = new Set(queue.map((q) => q.topic)).size
            return (
              <span className="label-data text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-faint)]">
                {sessionGrades.length} of {sessionTotal}
                {topicCount > 0 && ` · ${topicCount} ${topicCount === 1 ? 'topic' : 'topics'}`}
              </span>
            )
          }
          if (phase === 'ready') return undefined
          return (
            <span className="label-data text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-faint)]">
              {queue.length} due
            </span>
          )
        })()}
        right={
          <>
            {/* Nav cluster: tracked uppercase command items — History,
                Export (one item, disclosing .md/.pdf), Home — then the
                hairline-separated glyph/instrument cluster. */}
            {phase !== 'loading' && (
              <button
                onClick={() => setHistoryDrawerOpen(true)}
                className="focus-ring cmd-item label-data text-[10px] uppercase tracking-[0.16em] shrink-0"
              >
                History
              </button>
            )}
            {sessionId && (phase === 'in-session' || phase === 'done') && (
              <ExportCommand exporting={exportingFormat} onExport={exportCurrentSitting} />
            )}
            {onGoHome && (
              <button
                onClick={onGoHome}
                title="Back to the main page (a live sitting keeps running)"
                className="focus-ring cmd-item label-data text-[10px] uppercase tracking-[0.16em] shrink-0"
              >
                Home
              </button>
            )}
            {(phase === 'in-session' || phase === 'done') && (
              <span className="h-4 w-px bg-[var(--color-hairline)] shrink-0" aria-hidden="true" />
            )}
            {/* Addition D (chat refine round) — live only; freezes (stops
                ticking, stays on screen) once the sitting reaches 'done'
                rather than disappearing — see SittingClock's own doctrine
                comment for why a resumed sitting is labeled "this sitting",
                never a recovered original start time. */}
            {(phase === 'in-session' || phase === 'done') && sittingStartedAt !== null && (
              <SittingClock startedAt={sittingStartedAt} running={phase === 'in-session'} label="this sitting" />
            )}
            {phase === 'in-session' && momentumOn && <FlowChain chain={trailingRecalled(sessionGrades)} />}
            {phase === 'in-session' && momentumOn && sessionGrades.length > 0 && <InkWell results={sessionGrades} />}
            {(phase === 'in-session' || phase === 'done') && contextUsage && (
              <ContextGauge usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
            )}
          </>
        }
      />
      {/* Export outcome on its own transient caption line under the command
          bar, never inside it — the row-1 cluster's width is a fixed cost
          that must fit at the app's narrowest, and a saved-path string is
          the one item that can't be given a fixed cost. */}
      {exportStatus && (
        <div
          className={`shrink-0 -mt-1 text-xs truncate text-right ${exportStatus.failed ? 'text-[var(--color-ink-danger)]' : 'text-[var(--color-text-faint)]'}`}
          title={exportStatus.text}
        >
          {exportStatus.text}
        </div>
      )}

      {rateLimit && (
        <div className="shrink-0">
          <RateLimitBanner status={rateLimit.status} resetsAt={rateLimit.resetsAt} onRetry={() => setRateLimit(null)} />
        </div>
      )}
      {error && <ErrorPanel error={error} onDismiss={() => setError(null)} />}

      {phase === 'loading' && (
        <div className="panel px-5 py-4 flex flex-col gap-3">
          <SkeletonBar width="35%" height={10} />
          <SkeletonBar width="80%" height={14} />
          <div className="flex gap-2 items-center">
            <SkeletonBar width={148} height={32} />
          </div>
        </div>
      )}
      {phase === 'empty' && (
        horizonBuckets ? (
          <ReviewHorizon buckets={horizonBuckets} holdingCount={holdingCount} />
        ) : (
          <div className="panel px-4 py-3 max-w-md flex flex-col gap-2">
            <SkeletonBar height={40} />
            <SkeletonBar width="60%" height={10} />
          </div>
        )
      )}
      {phase === 'closed-unexpectedly' && (
        <div className="panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)]">
          The session process ended unexpectedly. {queue.length} item(s) still due — safe to start a new session.
        </div>
      )}

      {/* The amnesty framing (App-computed, Tier-1 — the skill itself narrates
          this too once a session starts, but that's prose the model may or
          may not lead with) now folds INTO the plate itself as a warm-ink
          paragraph between the figure and the rows, a register shift inside
          one document rather than a sibling panel repeating "reviews" a
          second time above it. See ReadyRoomPlate's own totalDue>24 branch. */}
      {phase === 'ready' && current && (
        <>
          {/* "REVIEWS — n/m": this sitting's capped queue (`queue`, already
              `due(12)`) over the true uncapped backlog (`totalDue`) — the same
              honest-subset framing ReadyRoomPlate's own caption states in
              prose ("a normal sitting covers about 12"), read here as a
              readout instead. */}
          <SectionBanner label="REVIEWS" count={<StatFraction n={queue.length} d={totalDue} />} />
          <ReadyRoomPlate
            dueItems={queue}
            totalDue={totalDue}
            topicTitles={topicTitles}
            onStart={() => startSession(false)}
            onResume={() => startSession(true)}
            hasPriorSession={hasPriorSession}
            blocked={blocked}
          />
          {/* Reuses the same computeDueBuckets fetch the empty/done phases
              already read from (refreshHorizon, fetched unconditionally on
              mount now) — no second walk of the topic graphs. */}
          {horizonBuckets && <ReviewHorizon buckets={horizonBuckets} holdingCount={holdingCount} />}
        </>
      )}

      {(phase === 'in-session' || phase === 'done') && (
        <div ref={equationCopyRef} className="flex-1 min-h-0 flex flex-col gap-4">
          {/* The only scrolling region — header and input stay anchored. */}
          {/* Must be a flex column: ChatScrollRegion sizes itself with
              flex-1/min-h-0 and loses its height bound (killing scrolling)
              inside a plain block wrapper. `relative` hosts the floating
              session drawer (ticket + probe), which renders OVER the
              transcript rather than claiming layout rows of its own. */}
          <div
            className={`relative flex-1 min-h-0 flex flex-col${chamber ? ' chamber-blur' : ''}`}
            onMouseMove={current || latestTicket || phase === 'done' ? handleSessionPointer : undefined}
          >
            {/* Session ticket — floats over the transcript on the LEFT edge,
                tucking away unless the cursor visits that edge or its tack is
                driven in. */}
            {latestTicket && phase === 'in-session' && (() => {
              const ticketOut = ticketPinned || ticketPeek
              return (
                <>
                  {!ticketOut && (
                    <div className="absolute left-0 top-10 z-10 h-16 w-3.5 flex items-center justify-start" aria-hidden="true">
                      <span className="w-px h-12 rounded bg-[var(--color-hairline)]" />
                    </div>
                  )}
                  {/* Unfolds left→right (see the twin in LearnSessionView):
                      grid 0fr↔1fr animates to true width, the inner fixed
                      layer holds the content still so it unclips rather than
                      squeezes. */}
                  <div
                    className={`absolute top-9 left-0 z-10 grid transition-[grid-template-columns,opacity] ${
                      ticketOut
                        ? 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)] opacity-100'
                        : 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)] opacity-0'
                    }`}
                    style={{ gridTemplateColumns: ticketOut ? '1fr' : '0fr' }}
                  >
                    <div className="min-w-0 overflow-hidden">
                    <div className="relative w-72">
                      <TicketCard ticket={latestTicket} compact />
                      <button
                        onClick={() => setTicketPinned((v) => !v)}
                        aria-label={ticketPinned ? 'Unpin session ticket' : 'Pin session ticket'}
                        title={ticketPinned ? 'Unpin — tuck away unless the cursor visits the left edge' : 'Pin — keep the ticket out'}
                        className={`focus-ring no-press absolute bottom-1.5 right-1.5 h-5 w-5 flex items-center justify-center transition-colors duration-[var(--dur-fast)] ${
                          ticketPinned
                            ? 'text-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]'
                            : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                        }`}
                      >
                        <PinTackIcon pinned={ticketPinned} size={14} />
                      </button>
                    </div>
                    </div>
                  </div>
                </>
              )
            })()}

            {/* Probe card — collapses UPWARD like Learn's masthead: grid
                0fr↔1fr animates to its true height, so a tucked probe costs
                the transcript nothing. Cursor near the top edge (or the tack)
                brings it back. */}
            {current && (() => {
              const probeCollapsed = !probePinned && !probePeek
              return (
                <>
                  {probeCollapsed && (
                    <div
                      className="shrink-0 h-2 flex items-center justify-center group cursor-default"
                      onMouseEnter={probeCtl.peek}
                      aria-hidden="true"
                    >
                      <span className="h-px w-12 rounded bg-[var(--color-hairline)] group-hover:bg-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-fast)]" />
                    </div>
                  )}
                  <div
                    // Direct hover claims the probe open — authoritative over
                    // the sampled container-mousemove geometry (see Learn's
                    // masthead: sampling has holes at the top edge).
                    onMouseEnter={probeCtl.peek}
                    className={`shrink-0 grid transition-[grid-template-rows] ${
                      probeCollapsed
                        ? 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)]'
                        : 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)]'
                    }`}
                    style={{ gridTemplateRows: probeCollapsed ? '0fr' : '1fr' }}
                  >
                    <div
                      className={`min-h-0 overflow-hidden transition-[opacity] ${
                        probeCollapsed
                          ? 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)] opacity-0'
                          : 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)] opacity-100'
                      }`}
                    >
                      {/* `.dogear` — the PINNED card only (the pin is the
                          active claim on this probe); a replayed/history probe
                          card (ChatMessageView's own `ProbeCard`, past turns
                          in this same transcript or in SessionHistoryDrawer)
                          never carries it — scarcity by decree, see
                          index.css's dogear doctrine comment. */}
                      <div key={current.id} className={`relative panel ${probePinned ? 'dogear' : ''} flex flex-col mb-2`}>
                        <div className="detail-title-band flex items-center justify-between gap-3 px-5 py-2">
                          <span className="label-data text-[10px] tracking-[0.22em] uppercase text-[var(--color-ink-warm)] inline-flex items-baseline gap-1.5">
                            review ·{' '}
                            <StatFraction n={sessionGrades.length + 1} d={sessionTotal} className="text-[10px]" />
                          </span>
                          {sessionTotal > 1 && (
                            <QueueRail
                              total={sessionTotal}
                              completedGrades={sessionGrades}
                              hasCurrent
                              currentNodeId={current.id}
                            />
                          )}
                        </div>
                        <div className="px-5 py-3 flex flex-col gap-2">
                          <div className="min-w-0">
                            <div className="font-(family-name:--font-display) font-semibold text-base text-[var(--color-text-primary)] truncate">
                              {humanizeNodeId(current.id)}
                            </div>
                            <div className="detail-subtitle text-xs mt-0.5 truncate">{current.topic}</div>
                          </div>
                          <p className="text-sm text-[var(--color-text-primary)]">{current.probe}</p>
                        </div>
                        <div className="detail-footer px-5 py-1.5">
                          <span className="label-data text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider">
                            probe
                          </span>
                          <button
                            onClick={() => setProbePinned((v) => !v)}
                            aria-label={probePinned ? 'Unpin probe' : 'Pin probe'}
                            title={probePinned ? 'Unpin — tuck away unless the cursor visits the top' : 'Pin — keep the probe out'}
                            className={`focus-ring no-press h-5 w-5 flex items-center justify-center transition-colors duration-[var(--dur-fast)] ${
                              probePinned
                                ? 'text-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]'
                                : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                            }`}
                          >
                            <PinTackIcon pinned={probePinned} size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )
            })()}
            <ChatScrollRegion
              deps={[messages, busy, marks]}
              onContainerRef={setScrollEl}
              railSlot={
                <TranscriptMinimap
                  moments={minimapMoments}
                  totalMessages={messages.length}
                  containerEl={scrollEl}
                  onJump={jumpToCheckpointMoment}
                />
              }
            >
              <div className="transcript-measure flex flex-col gap-5">
                {/* lapse/milestone excluded here — re-anchored via
                    inlineForMessage/tailOtherMarks below (the carried-over
                    ordering fix); every other kind keeps this boundary
                    convention untouched. */}
                {marks
                  .filter((k) => k.atIndex === 0 && k.kind !== 'lapse' && k.kind !== 'milestone')
                  .map((k) => (
                    <MarkView key={k.id} mark={k} onAnswerAsk={answerAsk} suppressBeatExcerpt={messages[k.atIndex]?.role === 'assistant'} />
                  ))}
                {messages.map((m, i) => {
                  // Verdict Anatomy (Wave 2) — undefined for the common case
                  // of a message no region claims, which renders byte-
                  // identically to before this wave (see ChatMessageView's
                  // own prop doctrine comment).
                  const verdictProps = verdictPropsForMessage(i)
                  return (
                  <Fragment key={m.id}>
                    <ChatMessageView
                      message={m}
                      onEditResend={m.role === 'user' && m.id === lastUserMessageId && !busy ? editResend : undefined}
                      // The grade card(s) + crossing divider for whatever this
                      // message's OWN probe header follows — rendered inline,
                      // after this message's leading commentary and immediately
                      // before its ProbeCard (see ChatMessageView's prop
                      // doctrine comment). `undefined` for the common case of a
                      // message that resolves nothing, which is most messages.
                      beforeProbeHeader={inlineForMessage(i) ?? undefined}
                      // Chat Presence Wave D Task 9 — only the transcript's
                      // very last message, only while it's the live growing
                      // assistant bubble.
                      trailingCaret={busy && i === messages.length - 1 && m.role === 'assistant' && tutorActivity.activity.kind === 'streaming'}
                      verdictSegments={verdictProps?.segments}
                      verdictEyebrowIndex={verdictProps?.eyebrowIndex}
                      suppressSchedule={verdictProps?.suppressSchedule}
                      previousTimestamp={messages[i - 1]?.timestamp}
                      dataIndex={i}
                      probeHighlighted={
                        hoveredPairNode !== null && probeNodeByMessageIndex.get(i) === hoveredPairNode
                      }
                      onProbeHoverChange={(hovering) => {
                        const node = probeNodeByMessageIndex.get(i)
                        if (node) setHoveredPairNode(hovering ? node : null)
                      }}
                    />
                    {marks
                      .filter(
                        (k) =>
                          (k.atIndex === i + 1 || (i === messages.length - 1 && k.atIndex > messages.length)) &&
                          k.kind !== 'lapse' &&
                          k.kind !== 'milestone',
                      )
                      .map((k) => (
                        <MarkView key={k.id} mark={k} onAnswerAsk={answerAsk} suppressBeatExcerpt={messages[k.atIndex]?.role === 'assistant'} />
                      ))}
                  </Fragment>
                  )
                })}
                {/* Grade batches, and the re-anchored lapse/milestone marks,
                    whose next probe header never arrived — the tail case
                    (the sitting's last graded item, or a session that closed
                    before producing its next probe). */}
                {tailGradeBatches.flatMap((g) => renderGradeBatch(g.batch))}
                {tailOtherMarks.map((g) => {
                  const milestoneNode = g.mark.kind === 'milestone' ? g.mark.node : null
                  return (
                    <MarkView
                      key={g.mark.id}
                      mark={g.mark}
                      milestonePairedWithGradeCard={
                        milestoneNode !== null &&
                        tailGradeBatches.some((tb) => tb.batch.results.some((r) => r.node === milestoneNode))
                      }
                    />
                  )
                })}
                {busy && (
                  <div className="flex items-center gap-2">
                    <ActivityLine activity={tutorActivity.activity} />
                    <button
                      onClick={stopSession}
                      className="focus-ring text-xs px-2.5 py-1 rounded-lg text-[var(--color-text-faint)] hover:text-[var(--color-ink-danger)] hover:bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]"
                    >
                      Stop
                    </button>
                  </div>
                )}
                {log.length > 0 && (
                  <details className="fig-caption">
                    <summary className="cursor-pointer">session details</summary>
                    <div className="label-data text-[10px] mt-2 flex flex-col gap-0.5 max-h-40 overflow-y-auto not-italic">
                      {log.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </ChatScrollRegion>

            {/* Closing summary — floats OVER the transcript on the BOTTOM
                edge, mirroring the probe's grid-collapse grammar (same 0fr↔1fr
                technique, same clear+rearm 400ms tuck / 28px reveal band, same
                direct onMouseEnter claim) but anchored at the bottom instead
                of the top: `bottom-0` with no `top` pins the box's bottom
                edge and lets its height (driven by the grid row) shrink from
                there, so the content clips from its OWN top down as it tucks
                — the mirror image of the probe's "collapses upward". This
                never participates in the flex column above (it's `absolute`,
                pulled out of flow), so the transcript keeps its full height
                whether the sitting just finished or not — the previous
                inline `shrink-0` block below the pane used to steal that
                height instead. Content is unchanged (same three cards, same
                props) — only where and how they're revealed changed. */}
            {phase === 'done' && (() => {
              const summaryOut = summaryPinned || summaryPeek
              return (
                <>
                  {!summaryOut && (
                    <div
                      className="absolute bottom-0 left-0 right-0 z-20 h-2 flex items-center justify-center group cursor-default"
                      onMouseEnter={summaryCtl.peek}
                      aria-hidden="true"
                    >
                      <span className="h-px w-12 rounded bg-[var(--color-hairline)] group-hover:bg-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-fast)]" />
                    </div>
                  )}
                  <div
                    // Direct hover claims the summary open — authoritative
                    // over the sampled container-mousemove geometry, same
                    // discipline as the probe's own onMouseEnter above.
                    onMouseEnter={summaryCtl.peek}
                    className={`absolute bottom-0 left-0 right-0 z-20 grid transition-[grid-template-rows] ${
                      summaryOut
                        ? 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)]'
                        : 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)]'
                    }`}
                    style={{ gridTemplateRows: summaryOut ? '1fr' : '0fr' }}
                  >
                    <div
                      className={`min-h-0 overflow-hidden transition-[opacity] ${
                        summaryOut
                          ? 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)] opacity-100'
                          : 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)] opacity-0'
                      }`}
                    >
                      <div className="relative flex flex-col gap-4 max-h-[65vh] overflow-y-auto pt-7 pb-2">
                        <SessionCeremony
                          results={sessionGrades}
                          streakDays={streakDays}
                          commitment={null}
                          heading="Queue clear"
                          label="items"
                        />
                        {/* Review's queue is mixed-topic, so ScheduleDelta (like IntervalLadder)
                            matches by node id alone rather than a single topic prop; it renders
                            its own panel only when at least one row (or the all-lapsed line)
                            survives, so nothing empty ever shows up here. */}
                        <ScheduleDelta results={sessionGrades} />
                        {horizonBuckets && <ReviewHorizon buckets={horizonBuckets} holdingCount={holdingCount} />}
                        <button
                          onClick={() => setSummaryPinned((v) => !v)}
                          aria-label={summaryPinned ? 'Unpin session summary' : 'Pin session summary'}
                          title={summaryPinned ? 'Unpin — tuck away unless the cursor visits the bottom edge' : 'Pin — keep the summary out'}
                          className={`focus-ring no-press absolute top-0 right-1 h-5 w-5 flex items-center justify-center transition-colors duration-[var(--dur-fast)] ${
                            summaryPinned
                              ? 'text-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]'
                              : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                          }`}
                        >
                          <PinTackIcon pinned={summaryPinned} size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )
            })()}
          </div>

          {/* Chat Presence Wave D Task 10 — the generic 90s idle cue. Gated on
              `!honestBlankReady` so it never double-fires alongside Review's
              OWN, earlier (45s) honest-blank affordance below: that one is
              already this view's "you've been quiet" signal, and this is the
              barely-there GENERIC variant Learn also gets (no honest-blank
              equivalent there). */}
          {tutorActivity.activity.kind === 'awaiting-learner' && !busy && !honestBlankReady && (
            <div className="shrink-0 fig-caption px-1">still here — whenever you're ready</div>
          )}
          {/* A persistent, factual end-of-sitting line — distinct from the
              idle cue above (that one invites you back; this one states what
              happened and where the record lives). */}
          {tutorActivity.activity.kind === 'ended' && (
            <div className="shrink-0 fig-caption px-1">this sitting has closed · session history holds the record</div>
          )}

          {/* Chat Presence Wave E, Task 11 — stays mounted (disabled via
              disabledReason) alongside an open inline AskCard, instead of
              vanishing the way it did under the old modal. */}
          {current && (!busy || tutorActivity.activity.kind === 'awaiting-ask') && phase !== 'done' && (
            <MessageComposer
              production={production}
              onProductionChange={setProduction}
              attachedFiles={attachedFiles}
              onRemoveAttachment={(path) => setAttachedFiles((prev) => prev.filter((p) => p !== path))}
              onAttach={attachFiles}
              markdownPreview={markdownPreview}
              onToggleMarkdownPreview={() => setMarkdownPreview((v) => !v)}
              onSubmit={submitProduction}
              placeholder="Free recall — type your answer cold, no looking back…"
              chamber={chamber}
              onChamberChange={setChamber}
              inviteChamber={false}
              assist={
                honestBlankReady && !production.trim()
                  ? { label: "I can't retrieve this", onUse: () => setProduction("I can't retrieve this one.") }
                  : null
              }
              disabledReason={composerDisabledReason(tutorActivity.activity)}
            />
          )}
        </div>
      )}

      <SessionHistoryDrawer historyKey="review" title="Review" open={historyDrawerOpen} onClose={() => setHistoryDrawerOpen(false)} />
    </div>
  )
}
