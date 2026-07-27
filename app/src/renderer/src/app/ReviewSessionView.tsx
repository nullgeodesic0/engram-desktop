import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { PinTackIcon } from '../components/ui/PinTackIcon'
import type { DueItem, ExportSittingFormat } from '../../../shared/types'
import type { SessionEvent } from '../../../shared/sessionEvents'
import type { BridgeAskRequest } from '../../../shared/bridgeProtocol'
import { AskDialog } from '../components/AskDialog'
import { RateLimitBanner } from '../components/RateLimitBanner'
import { isBlockingRateLimitStatus } from '../../../shared/rateLimit'
import { ChatMessageView } from '../components/ChatMessageView'
import { MessageComposer } from '../components/MessageComposer'
import { ContextGauge } from '../components/ContextGauge'
import { TypingIndicator } from '../components/TypingIndicator'
import { ChatScrollRegion } from '../components/ChatScrollRegion'
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
import { Button } from '../components/ui/Button'
import { friendlyErrorText } from '../shared/friendlyError'
import { recordConfidence, latestPickFor } from '../shared/calibrationStore'
import { extractTicketFromMessages } from '../shared/ticketParser'
import { TicketCard } from '../components/ritual/TicketCard'
import { ReadyRoomPlate } from '../components/ritual/ReadyRoomPlate'
import { ReviewHorizon } from '../components/ReviewHorizon'
import { InkWell } from '../components/ritual/InkWell'
import { FlowChain } from '../components/ritual/FlowChain'
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
  type ToolFailureKind,
} from '../../../shared/signals/tutorSignals'
import { QueueRail } from '../components/ritual/QueueRail'
import { NodeCrossingDivider } from '../components/ritual/Marks'
import { deriveReviewCrossings, latestProbeHeader, nextProbeHeaderAt } from '../../../shared/reviewCrossing'

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
}

export function ReviewSessionView({ onActivity }: ReviewSessionViewProps = {}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [queue, setQueue] = useState<DueItem[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [production, setProduction] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [contextUsage, setContextUsage] = useState<{ usedTokens: number; contextWindow: number } | null>(null)
  const [askRequest, setAskRequest] = useState<BridgeAskRequest | null>(null)
  const [rateLimit, setRateLimit] = useState<{ status: string; resetsAt: number | null } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [hasPriorSession, setHasPriorSession] = useState(false)
  const [totalDue, setTotalDue] = useState(0)
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
  // Two session cards, two edges, two tacks: the ticket slides in from the
  // LEFT, the probe collapses UPWARD (Learn's masthead grammar). Both float
  // free of the transcript's layout so the chat owns the column; pinning
  // either holds it out regardless of the cursor.
  const [probePinned, setProbePinned] = useState(false)
  const [probePeek, setProbePeek] = useState(false)
  const [ticketPinned, setTicketPinned] = useState(false)
  const [ticketPeek, setTicketPeek] = useState(false)
  const probeLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ticketLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      if (timer.current) return
      timer.current = setTimeout(() => {
        timer.current = null
        set(false)
      }, 250)
    },
  })
  const probeCtl = makePeek(probeLeaveTimer, setProbePeek)
  const ticketCtl = makePeek(ticketLeaveTimer, setTicketPeek)
  /** Pointer-position tracking at the device's own mousemove rate. Top strip
   * reveals the probe (and its own height holds it open); left strip reveals
   * the ticket (its own width holds it open). Pinned cards opt out. */
  const handleSessionPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!probePinned) {
      const y = e.clientY - rect.top
      if (y <= (probePeek ? 220 : 18)) probeCtl.peek()
      else probeCtl.tuck()
    }
    if (!ticketPinned) {
      const x = e.clientX - rect.left
      if (x <= (ticketPeek ? 320 : 28)) ticketCtl.peek()
      else ticketCtl.tuck()
    }
  }
  useEffect(() => () => {
    if (probeLeaveTimer.current) clearTimeout(probeLeaveTimer.current)
    if (ticketLeaveTimer.current) clearTimeout(ticketLeaveTimer.current)
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
  // 'lapse'`) — see the doctrine comment on RitualMark in Marks.tsx.
  const [marks, setMarks] = useState<RitualMark[]>([])

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
      if (items.length === 0) refreshHorizon()
    })
    // Uncapped, purely for the amnesty-banner heuristic below — `queue` itself
    // stays capped at 12 (the actual review cap /review would use).
    window.engram.due().then((all) => setTotalDue(all.length))
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
      setAskRequest(req)
    })
    return () => {
      offEvent()
      offAsk()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function appendLog(line: string) {
    setLog((prev) => [...prev.slice(-49), line])
  }

  function handleSessionEvent(event: SessionEvent) {
    switch (event.type) {
      case 'text':
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, text: last.text + event.text }]
          }
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', text: event.text }]
        })
        break
      case 'tool_use':
        appendLog(`→ ${event.name}(${JSON.stringify(event.input).slice(0, 80)})`)
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
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text, attachments: files }])
    setBusy(true)
    setProduction('')
    setAttachedFiles([])
    const sentText = files.length > 0 ? `${text}\n\n[Attached files — read these for context: ${files.join(', ')}]` : text
    await window.engram.sendMessage(sessionId, sentText)
  }

  async function answerAsk(chosen: string[] | null) {
    if (!askRequest) return
    // Mirror the confidence pick locally before forwarding — best-effort, never
    // blocks the real answer even if the current item isn't known yet.
    if (askRequest.header === 'Confidence' && chosen && chosen[0] && current) {
      const index = askRequest.options.findIndex((o) => o.label === chosen[0])
      recordConfidence(current.topic, current.id, chosen[0], index >= 0 ? index : undefined)
    }
    await window.engram.answerBridgeQuestion(askRequest.requestId, { chosen })
    setAskRequest(null)
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
  function renderGradeBatch(b: GradeBatch) {
    return b.results.map((r, ri) => (
      <GradeResultCard
        key={`${b.id}-${ri}`}
        result={r}
        confidenceLabel={latestPickFor(r.node)?.label ?? null}
        reveal={b.id === revealBatchId}
        topic={b.id === revealBatchId ? lastGradeTopic ?? undefined : undefined}
      />
    ))
  }
  /** Grade card(s) + crossing divider belonging INSIDE message `i`'s own
   * render — passed as ChatMessageView's `beforeProbeHeader` prop. Null (no
   * extra render) for the common case of a message resolving nothing. */
  function inlineForMessage(i: number) {
    const batches = resolvedGradeBatches.filter((g) => g.resolvedIndex === i)
    const crossing = crossings.find((c) => c.atMessageIndex === i)
    if (batches.length === 0 && !crossing) return null
    return (
      <Fragment>
        {batches.flatMap((g) => renderGradeBatch(g.batch))}
        {crossing && <NodeCrossingDivider nodeId={crossing.header.node} verb="moving to" />}
      </Fragment>
    )
  }
  /** Grade batches whose next probe header hasn't arrived (yet) — rendered
   * once, after the whole transcript, same tail convention `marks` still
   * uses for everything else. */
  const tailGradeBatches = resolvedGradeBatches.filter((g) => g.resolvedIndex === null)
  const lastUserMessageId = useMemo(() => [...messages].reverse().find((m) => m.role === 'user')?.id ?? null, [messages])
  const latestTicket = useMemo(() => extractTicketFromMessages(messages), [messages])

  return (
    // Tighter at the top than the standard p-8 so the header sits near the
    // window chrome and the transcript gets the reclaimed height; the gap
    // does the separating.
    <div className="h-full min-h-0 flex flex-col px-8 pt-3 pb-6 gap-3 w-full">
      <header className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-display)] text-2xl text-[var(--color-text-primary)]">Review</h1>
          <p className="text-sm text-[var(--color-text-dim)] mt-1">{queue.length} due</p>
        </div>
        <div className="flex items-center gap-3">
          {phase === 'in-session' && momentumOn && <FlowChain chain={trailingRecalled(sessionGrades)} />}
          {phase === 'in-session' && momentumOn && sessionGrades.length > 0 && <InkWell results={sessionGrades} />}
          {(phase === 'in-session' || phase === 'done') && contextUsage && (
            <ContextGauge usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
          )}
          {exportStatus && (
            <span
              className={`text-xs truncate max-w-[12rem] ${exportStatus.failed ? 'text-[var(--color-ink-danger)]' : 'text-[var(--color-text-faint)]'}`}
              title={exportStatus.text}
            >
              {exportStatus.text}
            </span>
          )}
          {sessionId && (phase === 'in-session' || phase === 'done') && (
            <button
              onClick={() => exportCurrentSitting('md')}
              disabled={exportingFormat !== null}
              title="Export this sitting as a Markdown file"
              className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              {exportingFormat === 'md' ? 'Exporting…' : 'Export .md'}
            </button>
          )}
          {sessionId && (phase === 'in-session' || phase === 'done') && (
            <button
              onClick={() => exportCurrentSitting('pdf')}
              disabled={exportingFormat !== null}
              title="Export this sitting as a PDF"
              className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
            >
              {exportingFormat === 'pdf' ? 'Exporting…' : 'Export .pdf'}
            </button>
          )}
          {phase !== 'loading' && (
            <button
              onClick={() => setHistoryDrawerOpen(true)}
              className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
            >
              History
            </button>
          )}
        </div>
      </header>

      {rateLimit && (
        <div className="shrink-0">
          <RateLimitBanner status={rateLimit.status} resetsAt={rateLimit.resetsAt} onRetry={() => setRateLimit(null)} />
        </div>
      )}
      {error && (() => {
        const fe = friendlyErrorText(error)
        return (
        <div className="shrink-0 panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)] flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div>{fe.headline}</div>
            {fe.detail && (
              <details className="mt-1 text-xs text-[var(--color-text-faint)]">
                <summary className="cursor-pointer">raw error</summary>
                <div className="mt-1">{fe.detail}</div>
              </details>
            )}
          </div>
          <Button variant="ghost" onClick={() => setError(null)} aria-label="Dismiss error" className="shrink-0 px-2 py-1">
            ×
          </Button>
        </div>
        )
      })()}

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

      {/* App-computed (Tier-1) amnesty framing — the skill itself narrates this too
          once a session starts, but that's prose the model may or may not lead
          with; this is a reliable pre-session beat instead of hoped-for from text.
          Heuristic mirrors the skill's own "due > 2x mode cap" (SKILL.md: standard
          cap ~12), shown before any grading pressure, not after. */}
      {phase === 'ready' && totalDue > 24 && (
        <div className="shrink-0 panel border-[var(--color-ink-warm-dim)] px-4 py-3 text-sm text-[var(--color-ink-warm)]">
          {totalDue} reviews have piled up — nothing is owed, and that’s not a debt to clear in one sitting. A normal
          session still only covers a capped set (most-overdue first); the rest just stays due, no guilt attached.
        </div>
      )}

      {phase === 'ready' && current && (
        <ReadyRoomPlate
          dueItems={queue}
          totalDue={totalDue}
          onStart={() => startSession(false)}
          onResume={() => startSession(true)}
          hasPriorSession={hasPriorSession}
          blocked={blocked}
        />
      )}

      {(phase === 'in-session' || phase === 'done') && (
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          {/* The only scrolling region — header and input stay anchored. */}
          {/* Must be a flex column: ChatScrollRegion sizes itself with
              flex-1/min-h-0 and loses its height bound (killing scrolling)
              inside a plain block wrapper. `relative` hosts the floating
              session drawer (ticket + probe), which renders OVER the
              transcript rather than claiming layout rows of its own. */}
          <div
            className={`relative flex-1 min-h-0 flex flex-col${chamber ? ' chamber-blur' : ''}`}
            onMouseMove={current || latestTicket ? handleSessionPointer : undefined}
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
                        className={`focus-ring no-press absolute bottom-1.5 right-1.5 h-5 w-5 rounded-full flex items-center justify-center transition-colors duration-[var(--dur-fast)] ${
                          ticketPinned
                            ? 'text-[var(--color-ink-warm)] bg-[var(--color-surface-3)]'
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
                    <div className="shrink-0 h-2 flex items-center justify-center group cursor-default" aria-hidden="true">
                      <span className="h-px w-12 rounded bg-[var(--color-hairline)] group-hover:bg-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-fast)]" />
                    </div>
                  )}
                  <div
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
                      <div key={current.id} className="relative panel px-5 py-4 flex flex-col gap-3 mb-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                              {humanizeNodeId(current.id)}
                            </div>
                            <div className="label-data text-xs text-[var(--color-text-faint)] mt-0.5 uppercase tracking-wider truncate">
                              {current.topic}
                            </div>
                          </div>
                          {sessionTotal > 1 && (
                            <QueueRail
                              total={sessionTotal}
                              completedGrades={sessionGrades}
                              hasCurrent
                              currentNodeId={current.id}
                            />
                          )}
                        </div>
                        <p className="text-sm text-[var(--color-text-primary)] pr-7">{current.probe}</p>
                        <button
                          onClick={() => setProbePinned((v) => !v)}
                          aria-label={probePinned ? 'Unpin probe' : 'Pin probe'}
                          title={probePinned ? 'Unpin — tuck away unless the cursor visits the top' : 'Pin — keep the probe out'}
                          className={`focus-ring no-press absolute bottom-1.5 right-1.5 h-5 w-5 rounded-full flex items-center justify-center transition-colors duration-[var(--dur-fast)] ${
                            probePinned
                              ? 'text-[var(--color-ink-warm)] bg-[var(--color-surface-3)]'
                              : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                          }`}
                        >
                          <PinTackIcon pinned={probePinned} size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )
            })()}
            <ChatScrollRegion deps={[messages, busy]}>
              <div className="transcript-measure flex flex-col gap-5">
                {marks.filter((k) => k.atIndex === 0).map((k) => (
                  <MarkView key={k.id} mark={k} />
                ))}
                {messages.map((m, i) => (
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
                    />
                    {marks
                      .filter((k) => k.atIndex === i + 1 || (i === messages.length - 1 && k.atIndex > messages.length))
                      .map((k) => (
                        <MarkView key={k.id} mark={k} />
                      ))}
                  </Fragment>
                ))}
                {/* Grade batches whose next probe header never arrived — the
                    tail case (the sitting's last graded item, or a session
                    that closed before producing its next probe). */}
                {tailGradeBatches.flatMap((g) => renderGradeBatch(g.batch))}
                {busy && (
                  <div className="flex items-center gap-2">
                    <TypingIndicator />
                    <button
                      onClick={stopSession}
                      className="focus-ring text-xs px-2.5 py-1 rounded-lg text-[var(--color-text-faint)] hover:text-[var(--color-ink-danger)] hover:bg-[var(--color-surface-3)]"
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
          </div>

          {current && !busy && phase !== 'done' && (
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
            />
          )}

          {phase === 'done' && (
            <div className="shrink-0 flex flex-col gap-4">
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
            </div>
          )}
        </div>
      )}

      {askRequest && <AskDialog request={askRequest} onAnswer={answerAsk} />}
      <SessionHistoryDrawer historyKey="review" title="Review" open={historyDrawerOpen} onClose={() => setHistoryDrawerOpen(false)} />
    </div>
  )
}
