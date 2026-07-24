import { useEffect, useMemo, useRef, useState } from 'react'
import type { DueItem } from '../../../shared/types'
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
import { parseGradeResult, type GradeResult } from '../../../shared/gradeResult'
import { GradeResultCard } from '../components/GradeResultCard'
import { SkeletonBar } from '../components/Skeleton'
import { SessionCeremony } from '../components/ritual/Bookends'
import { SessionHistoryModal } from '../components/SessionHistoryModal'
import type { SessionIndexEntry } from '../../../shared/types'
import { Button } from '../components/ui/Button'
import { friendlyErrorText } from '../shared/friendlyError'
import { recordConfidence, latestPickFor } from '../shared/calibrationStore'
import { extractTicketFromMessages } from '../shared/ticketParser'
import { TicketCard } from '../components/ritual/TicketCard'
import { InkWell } from '../components/ritual/InkWell'
import { FlowChain } from '../components/ritual/FlowChain'
import { trailingRecalled } from '../../../shared/gradeResult'

type Phase = 'loading' | 'empty' | 'ready' | 'in-session' | 'done' | 'closed-unexpectedly'

function looksLikeRateCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  return command.includes(' rate ') && command.includes('--rating')
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
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<SessionIndexEntry[]>([])
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null)
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([])
  const [lastGrade, setLastGrade] = useState<GradeResult | null>(null)
  const [sessionGrades, setSessionGrades] = useState<GradeResult[]>([])
  const [streakDays, setStreakDays] = useState<number | null>(null)
  const [chamber, setChamber] = useState(false)
  const [momentumOn, setMomentumOn] = useState(true)

  const pendingRateToolUseId = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const abortedRef = useRef(false)

  function refreshQueue(): Promise<DueItem[]> {
    return window.engram.due(12).then((items) => {
      setQueue(items)
      return items
    })
  }

  useEffect(() => {
    refreshQueue().then((items) => setPhase(items.length > 0 ? 'ready' : 'empty'))
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
              setLastGrade(result)
              setSessionGrades((prev) => [...prev, result])
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
      }
    } else {
      setMessages([])
      setContextUsage(null)
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

  async function openHistory() {
    const entries = await window.engram.sessionHistoryFor('review')
    setHistoryEntries(entries)
    setHistoryOpen(true)
  }

  async function selectHistoryEntry(id: string) {
    const lines = await window.engram.getTranscript(id)
    setHistoryMessages(parseTranscriptToMessages(lines))
    setViewingHistoryId(id)
    setHistoryOpen(false)
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
          {phase !== 'loading' && (
            <button onClick={openHistory} className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]">
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
          <Button variant="ghost" onClick={() => setError(null)} className="shrink-0 px-2 py-1">
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
        <div className="panel px-4 py-3 text-sm text-[var(--color-ink-warm)]">Queue clear — nothing due right now.</div>
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
          {totalDue} reviews have piled up — nothing is owed, and that's not a debt to clear in one sitting. A normal
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

      {viewingHistoryId && (
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          <div className="shrink-0 panel border-[var(--color-ink-cool-dim)] px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs text-[var(--color-ink-cool)]">Viewing a past session, read-only</span>
            <button onClick={() => setViewingHistoryId(null)} className="focus-ring text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]">
              ← Back to current
            </button>
          </div>
          <ChatScrollRegion deps={[historyMessages]}>
            <div className="transcript-measure flex flex-col gap-5">
              {historyMessages.map((m) => (
                <ChatMessageView key={m.id} message={m} />
              ))}
            </div>
          </ChatScrollRegion>
        </div>
      )}

      {!viewingHistoryId && (phase === 'in-session' || phase === 'done') && (
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
                {messages.map((m) => (
                  <ChatMessageView
                    key={m.id}
                    message={m}
                    onEditResend={m.role === 'user' && m.id === lastUserMessageId && !busy ? editResend : undefined}
                  />
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
      {historyOpen && (
        <SessionHistoryModal
          entries={historyEntries}
          currentSessionId={sessionId}
          onSelect={selectHistoryEntry}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  )
}
