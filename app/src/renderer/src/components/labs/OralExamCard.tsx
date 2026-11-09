import { useEffect, useRef, useState } from 'react'
import { CONFIDENCE_LEVELS, type Confidence } from '../../../../shared/labs'
import {
  ORAL_ANSWER_MAX,
  ORAL_EDIT_LIMIT,
  type OralAskRequest,
  type OralFinishRequest,
  type OralState,
  editShare,
  formatSeconds,
} from '../../../../shared/oral'
import { ProseMarkdown } from '../ProseMarkdown'
import { Button } from '../ui/Button'

/**
 * The exam card a Learn sitting shows while a pack's oral exam runs. The
 * tutor asks through the oral_exam bridge tool; this card puts the question
 * up with its clock, records the spoken answer, has the speech layer
 * transcribe it on the device, and lets the learner correct the transcript
 * before confirming. At the end it collects a confidence for every question,
 * still before any grading.
 *
 * One recording per turn, as in an exam room. The clock runs from the moment
 * the question appears; recording stops itself at the limit.
 */

type Phase = 'ready' | 'recording' | 'transcribing' | 'confirm'

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function AskTurn({ req, onDone }: { req: OralAskRequest; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>('ready')
  const [now, setNow] = useState(Date.now())
  const shownAt = useRef(Date.now())
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const audio = useRef<Uint8Array | null>(null)
  const stoppedAt = useRef<number | null>(null)
  const timedOut = useRef(false)
  const [heard, setHeard] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const elapsed = ((stoppedAt.current ?? now) - shownAt.current) / 1000
  const left = Math.max(0, req.seconds - elapsed)

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'recording') return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [phase])

  // The clock runs out: a recording stops itself; an answer never begun is recorded as none.
  useEffect(() => {
    if (left > 0) return
    if (phase === 'recording') {
      timedOut.current = true
      recorder.current?.stop()
    } else if (phase === 'ready' && !stoppedAt.current) {
      timedOut.current = true
      stoppedAt.current = Date.now()
      setPhase('confirm')
    }
  }, [left, phase])

  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop()
      recorder.current?.stream.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  async function runTranscription() {
    if (!audio.current) return
    setPhase('transcribing')
    setError(null)
    try {
      const r = await window.engram.oralTranscribe(req.requestId, audio.current)
      setHeard(r.text)
      setText(r.text)
    } catch (e) {
      setError(errText(e))
    }
    setPhase('confirm')
  }

  async function startRecording() {
    setError(null)
    try {
      if (!(await window.engram.oralMicAccess()))
        throw new Error(
          'The microphone is blocked. Allow Engram Desktop in System Settings → Privacy & Security → Microphone.',
        )
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      chunks.current = []
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.current.push(ev.data)
      }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        stoppedAt.current = Date.now()
        void new Blob(chunks.current, { type: mime }).arrayBuffer().then((buf) => {
          audio.current = new Uint8Array(buf)
          void runTranscription()
        })
      }
      recorder.current = rec
      rec.start(1000)
      setPhase('recording')
    } catch (e) {
      setError(errText(e))
    }
  }

  async function confirm() {
    setSending(true)
    setError(null)
    try {
      const seconds = ((stoppedAt.current ?? Date.now()) - shownAt.current) / 1000
      await window.engram.oralAnswer(req.requestId, text, seconds, timedOut.current)
      onDone()
    } catch (e) {
      setError(errText(e))
      setSending(false)
    }
  }

  const share = editShare(heard, text)
  const rewritten = heard ? share > ORAL_EDIT_LIMIT : text.trim().length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
        <span>
          {req.kind === 'question' ? `Question ${req.index} of ${req.total}` : `Follow-up on question ${req.index}`}
        </span>
        <span className="ml-auto normal-case tracking-normal" aria-live="off">
          {phase === 'ready' || phase === 'recording'
            ? `${formatSeconds(left)} left`
            : `answered in ${formatSeconds(elapsed)}${timedOut.current ? ' · time ran out' : ''}`}
        </span>
      </div>
      <ProseMarkdown text={req.prompt} untrusted className="text-[15px]" />
      {!req.speechReady && phase === 'ready' && (
        <div className="text-xs text-[var(--color-text-dim)]">
          The Speech layer is not installed, so this answer cannot be transcribed. Install it in Settings → Code
          runtime, or type the answer below: a typed answer counts as written, not spoken.
        </div>
      )}
      {phase === 'ready' && (
        <div className="flex gap-2 items-center">
          {req.speechReady && (
            <Button variant="primary" onClick={() => void startRecording()}>
              Start answering
            </Button>
          )}
          {!req.speechReady && (
            <Button
              onClick={() => {
                stoppedAt.current = Date.now()
                setPhase('confirm')
              }}
            >
              Type the answer
            </Button>
          )}
          <span className="text-xs text-[var(--color-text-faint)]">
            One recording. Speak as you would to an examiner; stop when you are done.
          </span>
        </div>
      )}
      {phase === 'recording' && (
        <div className="flex gap-3 items-center">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--color-ink-warm)] animate-pulse"
            aria-hidden
          />
          <span className="text-sm text-[var(--color-text-primary)]">Recording</span>
          <Button variant="primary" onClick={() => recorder.current?.stop()}>
            Stop
          </Button>
        </div>
      )}
      {phase === 'transcribing' && (
        <div className="text-sm text-[var(--color-text-dim)]" aria-live="polite">
          Transcribing on this machine… The first time, the speech model (about 480 MB) downloads first.
        </div>
      )}
      {phase === 'confirm' && (
        <div className="flex flex-col gap-2">
          {heard || !audio.current ? (
            <div className="text-xs text-[var(--color-text-dim)]">
              {audio.current
                ? 'Correct what the transcription misheard, then confirm. Fix words, not the answer: the tutor sees how much changed.'
                : 'No recording was made.'}
            </div>
          ) : null}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, ORAL_ANSWER_MAX))}
            aria-label="Your answer"
            rows={6}
            className="focus-ring w-full bg-transparent border border-[var(--color-hairline)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
          />
          {rewritten && (
            <div className="text-xs text-[var(--color-ink-warm)]">
              {heard
                ? `About ${Math.round(share * 100)}% of the words differ from what was heard. Past a quarter, the answer counts as rewritten rather than spoken.`
                : 'This answer was not transcribed from speech, so it counts as written.'}
            </div>
          )}
          <div className="flex gap-2 items-center">
            <Button variant="primary" disabled={sending} onClick={() => void confirm()}>
              Confirm answer
            </Button>
            {error && audio.current && !heard && (
              <Button onClick={() => void runTranscription()} disabled={sending}>
                Transcribe again
              </Button>
            )}
          </div>
        </div>
      )}
      {error && <div className="text-xs text-[var(--color-text-dim)]">{error}</div>}
    </div>
  )
}

function FinishRound({ req, onDone }: { req: OralFinishRequest; onDone: () => void }) {
  const [picks, setPicks] = useState<Record<string, Confidence>>({})
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const all = req.questions.every((q) => picks[q.id])
  return (
    <div className="flex flex-col gap-3">
      <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
        The exam is over · before any grade
      </div>
      <div className="text-sm text-[var(--color-text-primary)]">
        For each question: how sure are you that your answer covered what it asked?
      </div>
      {req.questions.map((q, i) => (
        <div key={q.id} className="flex flex-col gap-1.5">
          <div className="flex gap-2 text-sm">
            <span className="label-data text-[11px] text-[var(--color-text-faint)] w-4 shrink-0 text-right leading-5">
              {i + 1}
            </span>
            <ProseMarkdown text={q.prompt} untrusted className="min-w-0" />
          </div>
          <div className="flex flex-wrap gap-1.5 pl-6">
            {CONFIDENCE_LEVELS.map((c) => (
              <button
                key={c}
                onClick={() => setPicks((p) => ({ ...p, [q.id]: c }))}
                aria-pressed={picks[q.id] === c}
                className={`focus-ring border px-2.5 py-1 text-xs ${picks[q.id] === c ? 'border-[var(--color-text-primary)] text-[var(--color-text-primary)]' : 'border-[var(--color-hairline)] text-[var(--color-text-dim)]'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex gap-2 items-center">
        <Button
          variant="primary"
          disabled={!all || sending}
          onClick={() => {
            setSending(true)
            window.engram
              .oralConfidence(req.requestId, picks)
              .then(onDone)
              .catch((e) => {
                setError(errText(e))
                setSending(false)
              })
          }}
        >
          Send to the tutor
        </Button>
        {error && <span className="text-xs text-[var(--color-text-dim)]">{error}</span>}
      </div>
    </div>
  )
}

/** Follows the exam in one sitting. `onActive` tells the view to lock notes and the composer. */
export function OralExamCard({
  sessionId,
  onActive,
}: {
  sessionId: string | null
  onActive: (active: boolean) => void
}) {
  const [state, setState] = useState<OralState | null>(null)
  const [ask, setAsk] = useState<OralAskRequest | null>(null)
  const [finish, setFinish] = useState<OralFinishRequest | null>(null)
  const [ending, setEnding] = useState(false)
  const sid = useRef(sessionId)
  sid.current = sessionId

  useEffect(() => {
    const offState = window.engram.onOralState((s) => {
      if (s.sessionId !== sid.current) return
      setState(s.exam ? s : null)
      if (!s.exam) {
        setAsk(null)
        setFinish(null)
        setEnding(false)
      }
    })
    const offAsk = window.engram.onOralAsk((r) => {
      if (r.sessionId === sid.current) setAsk(r)
    })
    const offFinish = window.engram.onOralFinish((r) => {
      if (r.sessionId === sid.current) setFinish(r)
    })
    const offDrop = window.engram.onOralDropped((r) => {
      if (r.sessionId !== sid.current) return
      setAsk((a) => (a?.requestId === r.requestId ? null : a))
      setFinish((f) => (f?.requestId === r.requestId ? null : f))
    })
    return () => {
      offState()
      offAsk()
      offFinish()
      offDrop()
    }
  }, [])

  // A different sitting: whatever was on screen belonged to the last one.
  useEffect(() => {
    setState(null)
    setAsk(null)
    setFinish(null)
  }, [sessionId])

  useEffect(() => onActive(state !== null), [state, onActive])

  if (!state) return null
  return (
    <div className="panel shrink-0 px-4 py-3 flex flex-col gap-3" aria-label="Oral exam">
      <div className="flex items-baseline gap-3">
        <span className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink-warm)]">
          Oral exam
        </span>
        <span className="text-sm text-[var(--color-text-primary)]">{state.title}</span>
        <span className="text-xs text-[var(--color-text-faint)]">no notes · answer aloud</span>
        {ending ? (
          <span className="ml-auto flex gap-2 items-center text-xs text-[var(--color-text-dim)]">
            End it? Nothing will be graded.
            <Button size="sm" variant="danger" onClick={() => void window.engram.oralAbandon(state.exam!)}>
              End the exam
            </Button>
            <Button size="sm" onClick={() => setEnding(false)}>
              Keep going
            </Button>
          </span>
        ) : (
          <button
            className="focus-ring ml-auto label-data text-[11px] text-[var(--color-text-faint)] underline hover:text-[var(--color-text-primary)]"
            onClick={() => setEnding(true)}
          >
            End the exam
          </button>
        )}
      </div>
      {ask ? (
        <AskTurn key={ask.requestId} req={ask} onDone={() => setAsk(null)} />
      ) : finish ? (
        <FinishRound key={finish.requestId} req={finish} onDone={() => setFinish(null)} />
      ) : (
        <div className="text-xs text-[var(--color-text-faint)]">The examiner is preparing the next question…</div>
      )}
      {!ask && !finish && (
        <div className="text-[11px] text-[var(--color-text-faint)]">
          Your answers stay with the examiner until the end, when you say how sure you are of each.
        </div>
      )}
    </div>
  )
}
