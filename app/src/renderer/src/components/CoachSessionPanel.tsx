import { useEffect, useRef, useState } from 'react'
import type { SessionEvent } from '../../../shared/sessionEvents'
import type { BridgeAskRequest } from '../../../shared/bridgeProtocol'
import { AskDialog } from './AskDialog'
import { ProseMarkdown } from './ProseMarkdown'
import { Button } from './ui/Button'
import { TypingIndicator } from './TypingIndicator'
import { friendlyErrorText } from '../shared/friendlyError'
import { useEquationCopy } from './useEquationCopy'

const QUICK_ACTIONS = [
  { label: 'Check-in', message: '/engram:coach' },
  { label: 'Audit grader', message: '/engram:coach audit' },
  { label: 'Refit schedule', message: '/engram:coach refit' },
  { label: 'Generate dashboard', message: '/engram:coach dashboard' },
]

/**
 * A compact, session-driven /coach panel — reuses the same SessionManager/bridge
 * plumbing as Learn/Review, trimmed down (no beat parsing, no queue) since
 * /coach's sub-behaviors are a menu, not a per-node loop.
 */
export function CoachSessionPanel() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [streamText, setStreamText] = useState('')
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [askRequest, setAskRequest] = useState<BridgeAskRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasPriorSession, setHasPriorSession] = useState(false)

  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    window.engram.lastSessionFor('coach').then((id) => setHasPriorSession(id !== null))
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

  function handleSessionEvent(event: SessionEvent) {
    switch (event.type) {
      case 'text':
        setStreamText((prev) => prev + event.text)
        break
      case 'turn_ended':
        setBusy(false)
        if (event.isError && event.resultText) setError(event.resultText)
        break
      case 'error':
        setError(event.message)
        setBusy(false)
        break
    }
  }

  async function run(message: string, resume = false) {
    setStreamText('')
    setError(null)
    if (sessionId) {
      setBusy(true)
      await window.engram.sendMessage(sessionId, message)
      return
    }
    // Resuming sends no kickoff turn (SessionManager skips it on --resume — the model
    // already has full context), so there's nothing to wait on.
    setBusy(!resume)
    const { sessionId: sid } = resume
      ? await window.engram.resumeSession(message, 'coach')
      : await window.engram.startSession(message, 'coach')
    sessionIdRef.current = sid
    setSessionId(sid)
  }

  async function submitInput() {
    if (!input.trim() || busy) return
    const text = input.trim()
    setInput('')
    await run(text)
  }

  async function answerAsk(chosen: string[] | null) {
    if (!askRequest) return
    await window.engram.answerBridgeQuestion(askRequest.requestId, { chosen })
    setAskRequest(null)
  }

  // Chat Instruments Wave A — covers the streamed prose below AND
  // AskDialog's own MathRenderer output (Modal is a plain in-place div, not
  // a portal — see ui/Modal.tsx — so it's a real DOM descendant of this
  // panel, not out of a delegated listener's reach).
  const equationCopyRef = useEquationCopy()

  return (
    <div ref={equationCopyRef} className="tilt-card panel px-5 py-5 flex flex-col gap-4">
      <div className="text-sm text-[var(--color-text-primary)]">Coach actions</div>
      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            onClick={() => run(a.message)}
            disabled={busy}
            className="focus-ring px-3 py-1.5 rounded-lg text-xs bg-[color-mix(in_srgb,var(--color-surface-2)_78%,transparent)] text-[var(--color-text-dim)] hover:text-[var(--color-ink-warm)] disabled:opacity-40"
          >
            {a.label}
          </button>
        ))}
        {hasPriorSession && !sessionId && (
          <button
            onClick={() => run('/engram:coach', true)}
            disabled={busy}
            className="focus-ring px-3 py-1.5 rounded-lg text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] disabled:opacity-40"
          >
            Resume last session
          </button>
        )}
      </div>

      {error && (() => {
        const fe = friendlyErrorText(error)
        return (
        <div className="panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)] flex items-start justify-between gap-3">
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

      {streamText && (
        <div className="panel-raised px-4 py-3 max-h-80 overflow-y-auto">
          <ProseMarkdown text={streamText} className="voice-serif text-[var(--color-text-primary)]" />
        </div>
      )}
      {busy && <TypingIndicator label="the coach is thinking…" />}

      {sessionId && (
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitInput()}
            placeholder="Reply, or ask something else…"
            disabled={busy}
            className="focus-ring flex-1 panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_78%,transparent)] text-[var(--color-text-primary)] disabled:opacity-50"
          />
          <button
            onClick={submitInput}
            disabled={!input.trim() || busy}
            className="focus-ring px-4 py-2 rounded-lg text-sm bg-[color-mix(in_srgb,var(--color-surface-3)_78%,transparent)] text-[var(--color-ink-warm)] disabled:opacity-40"
          >
            Send
          </button>
        </div>
      )}

      {askRequest && <AskDialog request={askRequest} onAnswer={answerAsk} />}
    </div>
  )
}
