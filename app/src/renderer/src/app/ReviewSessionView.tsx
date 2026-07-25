import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
import { parseGradeResult, lapseReturnDate, type GradeResult } from '../../../shared/gradeResult'
import { GradeResultCard } from '../components/GradeResultCard'
import { SkeletonBar } from '../components/Skeleton'
import { SessionCeremony } from '../components/ritual/Bookends'
import { SessionHistoryDrawer, exportSittingTranscript } from '../components/SessionHistoryDrawer'
import { Button } from '../components/ui/Button'
import { friendlyErrorText } from '../shared/friendlyError'
import { recordConfidence, latestPickFor } from '../shared/calibrationStore'
import { extractTicketFromMessages } from '../shared/ticketParser'
import { TicketCard } from '../components/ritual/TicketCard'
import { InkWell } from '../components/ritual/InkWell'
import { FlowChain } from '../components/ritual/FlowChain'
import { trailingRecalled } from '../../../shared/gradeResult'
import { invalidateSearchIndex } from '../shared/searchIndex'
import { MarkView, type RitualMark } from '../components/ritual/Marks'
import type { ReviewDocketItem } from '../components/ritual/ReviewDocket'
import { deriveRitualMarks } from '../../../shared/ritualFromTranscript'

type Phase = 'loading' | 'empty' | 'ready' | 'in-session' | 'done' | 'closed-unexpectedly'

// due() only ever returns items already due (see readHandlers.ts's `engram:due`) — there's
// no "next due" query on the engine side. The earliest future date lives in each topic
// graph's own fsrs.due (same source Home's 7-day forecast reads), so an empty queue looks
// there instead, across every topic, for the single soonest date among non-new nodes.
async function earliestUpcomingDue(): Promise<string | null> {
  const topics = await window.engram.topics()
  let earliest: string | null = null
  await Promise.all(
    topics.map(async (t) => {
      try {
        const g = (await window.engram.topicGraph(t.topic)) as {
          nodes?: Record<string, { state?: string; fsrs?: { due?: string | null } }>
        }
        if (!g?.nodes) return
        for (const node of Object.values(g.nodes)) {
          const due = node?.fsrs?.due
          if (typeof due !== 'string' || node?.state === 'new') continue
          if (earliest === null || due < earliest) earliest = due
        }
      } catch {
        // A topic with an unreadable graph just doesn't contribute a candidate date.
      }
    }),
  )
  return earliest
}

function formatDueDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function looksLikeRateCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  return command.includes(' rate ') && command.includes('--rating')
}

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
  const [lastGrade, setLastGrade] = useState<GradeResult | null>(null)
  const [sessionGrades, setSessionGrades] = useState<GradeResult[]>([])
  const [streakDays, setStreakDays] = useState<number | null>(null)
  const [chamber, setChamber] = useState(false)
  const [momentumOn, setMomentumOn] = useState(true)
  // Only fetched/shown for the empty-queue state — the earliest date any topic's
  // node next comes due, so "nothing due" says when to come back rather than
  // just sitting blank.
  const [earliestDue, setEarliestDue] = useState<string | null>(null)
  // Ritual marks — Review's own minimal slice of Learn's atIndex-interleave
  // plumbing (LearnSessionView), needed here only for the opening docket
  // (one-time, `kind: 'docket'`) and the lapse rite (derivable, `kind:
  // 'lapse'`) — see the doctrine comment on RitualMark in Marks.tsx.
  const [marks, setMarks] = useState<RitualMark[]>([])

  const pendingRateToolUseId = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const abortedRef = useRef(false)
  const messagesRef = useRef<ChatMessage[]>([])
  messagesRef.current = messages
  const markSeq = useRef(0)

  function pushLapseMark(node: string, returnDate: string | null) {
    setMarks((prev) => [
      ...prev,
      { id: `mark-${markSeq.current++}`, atIndex: messagesRef.current.length, kind: 'lapse', node, returnDate },
    ])
  }

  function refreshQueue(): Promise<DueItem[]> {
    return window.engram.due(12).then((items) => {
      setQueue(items)
      return items
    })
  }

  useEffect(() => {
    refreshQueue().then((items) => {
      setPhase(items.length > 0 ? 'ready' : 'empty')
      if (items.length === 0) earliestUpcomingDue().then(setEarliestDue)
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
        if (event.name === 'Bash' && looksLikeRateCall(event.input)) {
          pendingRateToolUseId.current = event.id
        }
        break
      case 'tool_result':
        appendLog(`← ${event.isError ? 'error' : 'ok'}`)
        if (event.toolUseId === pendingRateToolUseId.current) {
          pendingRateToolUseId.current = null
          if (!event.isError) {
            emitPulse('recalled')
            const result = parseGradeResult(event.content)
            if (result) {
              // A receipt just landed — the node's state (and the palette's
              // stale-cached view of it) has changed.
              invalidateSearchIndex()
              setLastGrade(result)
              setSessionGrades((prev) => [...prev, result])
              // The lapse rite — a quiet marker, not the danger-styled grade
              // card's alarm (see LapseRite's doctrine comment in Marks.tsx).
              if (result.grade === 'lapsed') {
                pushLapseMark(result.node, lapseReturnDate(result.intervalDays))
              }
            }
          }
          refreshQueue().then((items) => {
            setBusy(false)
            if (items.length === 0) {
              setPhase('done')
              setChamber(false)
              window.engram.stats().then((s) => setStreakDays(s.streak_days))
            }
          })
        }
        break
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
    setSessionTotal(queue.length)
    setChamber(false)
    if (!resume) {
      setLastGrade(null)
      setSessionGrades([])
      setMarks([])
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

  const current = queue[0] ?? null
  const lastUserMessageId = useMemo(() => [...messages].reverse().find((m) => m.role === 'user')?.id ?? null, [messages])
  const latestTicket = useMemo(() => extractTicketFromMessages(messages), [messages])

  return (
    <div className="h-full min-h-0 flex flex-col p-8 gap-4 w-full">
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
        <div className="panel px-4 py-3 text-sm text-[var(--color-ink-warm)]">
          Nothing due{earliestDue ? ` — earliest return ${formatDueDate(earliestDue)}` : ' right now.'}
        </div>
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
        <div className="panel px-5 py-4 flex flex-col gap-3">
          <div className="label-data text-xs text-[var(--color-text-faint)] uppercase tracking-wider">{current.topic}</div>
          <p className="text-sm text-[var(--color-text-primary)]">{current.probe}</p>
          <div className="flex gap-2 items-center">
            <button
              onClick={() => startSession(false)}
              disabled={rateLimit !== null && isBlockingRateLimitStatus(rateLimit.status)}
              className="focus-ring self-start px-4 py-2 rounded-lg text-sm bg-[var(--color-surface-3)] text-[var(--color-ink-warm)] hover:bg-[var(--color-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start review session
            </button>
            {hasPriorSession && (
              <button
                onClick={() => startSession(true)}
                disabled={rateLimit !== null && isBlockingRateLimitStatus(rateLimit.status)}
                className="focus-ring self-start px-3 py-2 rounded-lg text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
              >
                Resume last session
              </button>
            )}
          </div>
        </div>
      )}

      {(phase === 'in-session' || phase === 'done') && (
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          {latestTicket && phase === 'in-session' && (
            <div className="shrink-0 max-w-sm">
              <TicketCard ticket={latestTicket} compact />
            </div>
          )}
          {current && (
            <div
              key={current.id}
              className="shrink-0 panel px-5 py-4 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{humanizeNodeId(current.id)}</div>
                  <div className="label-data text-xs text-[var(--color-text-faint)] mt-0.5 uppercase tracking-wider">{current.topic}</div>
                </div>
                {sessionTotal > 0 && (
                  <span className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0">
                    Item {sessionTotal - queue.length + 1} of {sessionTotal}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--color-text-primary)]">{current.probe}</p>
            </div>
          )}
          {lastGrade && phase !== 'done' && (
            <GradeResultCard
              key={`${lastGrade.node}-${sessionGrades.length}`}
              result={lastGrade}
              confidenceLabel={latestPickFor(lastGrade.node)?.label ?? null}
              reveal
            />
          )}

          {/* The only scrolling region — header, probe card, and input stay anchored. */}
          {/* Must be a flex column: ChatScrollRegion sizes itself with
              flex-1/min-h-0 and loses its height bound (killing scrolling)
              inside a plain block wrapper. */}
          <div className={`flex-1 min-h-0 flex flex-col${chamber ? ' chamber-blur' : ''}`}>
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
                    />
                    {marks
                      .filter((k) => k.atIndex === i + 1 || (i === messages.length - 1 && k.atIndex > messages.length))
                      .map((k) => (
                        <MarkView key={k.id} mark={k} />
                      ))}
                  </Fragment>
                ))}
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
            />
          )}

          {phase === 'done' && (
            <div className="shrink-0">
              <SessionCeremony
                results={sessionGrades}
                streakDays={streakDays}
                commitment={null}
                heading="Queue clear"
                label="items"
              />
            </div>
          )}
        </div>
      )}

      {askRequest && <AskDialog request={askRequest} onAnswer={answerAsk} />}
      <SessionHistoryDrawer historyKey="review" title="Review" open={historyDrawerOpen} onClose={() => setHistoryDrawerOpen(false)} />
    </div>
  )
}
