import { useCallback, useEffect, useState } from 'react'
import { oralHandoffMessage } from '../../../../shared/labHandoff'
import { type OralExamRecord, type OralExamsView, formatSeconds } from '../../../../shared/oral'
import type { ProblemView } from '../../../../shared/problems'
import { ProseMarkdown } from '../ProseMarkdown'
import { Button } from '../ui/Button'
import { cleanError } from './LabPage'

/**
 * A pack's oral exam, in Labs. The exam itself runs in a Learn sitting with
 * the tutor as examiner (see OralExamCard); this page says what it is,
 * starts it, and keeps the record of each sitting's answers. The questions
 * are not shown here: an examiner's questions are heard in the room.
 */

const STATUS: Record<OralExamRecord['status'], string> = {
  running: 'running',
  done: 'handed to the tutor',
  abandoned: 'ended early, not graded',
}

function Exam({ e, questions }: { e: OralExamRecord; questions: { id: string; prompt: string }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="panel px-4 py-3 flex flex-col gap-2">
      <div className="flex items-baseline gap-3 label-data text-[11px] text-[var(--color-text-faint)]">
        <span>
          EXAM {e.seq} · {STATUS[e.status]}
        </span>
        <span>{new Date(e.startedAt).toLocaleString()}</span>
        {e.turns.length > 0 && (
          <button
            className="focus-ring ml-auto underline hover:text-[var(--color-text-primary)]"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Hide the answers' : 'Read the answers'}
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-3 text-sm">
          {e.turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="label-data text-[10.5px] text-[var(--color-text-faint)]">
                {t.followUpId ? 'FOLLOW-UP' : `QUESTION ${questions.findIndex((q) => q.id === t.questionId) + 1}`} ·{' '}
                {formatSeconds(t.seconds)}
                {t.timedOut ? ' · time ran out' : ''}
                {t.edited > 0 ? ` · ${Math.round(t.edited * 100)}% of words corrected` : ''}
                {e.confidences && !t.followUpId ? ` · you said ${e.confidences[t.questionId]}` : ''}
              </div>
              <ProseMarkdown text={t.prompt} untrusted className="text-[var(--color-text-dim)]" />
              <div className="text-[var(--color-text-primary)] whitespace-pre-wrap">
                {t.confirmed || '(no answer given)'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function OralPage({
  packId,
  problemId,
  onOpenSettings,
  onDiscuss,
}: {
  packId: string
  problemId: string
  onOpenSettings?: () => void
  onDiscuss?: (topicId: string, text: string) => void
}) {
  const [view, setView] = useState<ProblemView | null>(null)
  const [oral, setOral] = useState<OralExamsView | null>(null)
  const [topicKnown, setTopicKnown] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [v, o] = await Promise.all([
        window.engram.problemView(packId, problemId),
        window.engram.oralView(packId, problemId),
      ])
      setView(v)
      setOral(o)
      setError(null)
    } catch (e) {
      setError(cleanError(e))
    }
  }, [packId, problemId])

  useEffect(() => {
    void load()
  }, [load])

  const topic = view?.problem.topic ?? null
  useEffect(() => {
    if (!topic) return
    let live = true
    window.engram
      .topics()
      .then((list) => live && setTopicKnown(list.some((t) => t.topic === topic)))
      .catch(() => live && setTopicKnown(false))
    return () => {
      live = false
    }
  }, [topic])

  if (error && !view) return <div className="p-8 text-sm text-[var(--color-text-dim)]">{error}</div>
  if (!view || !oral) return <div className="p-8 text-sm text-[var(--color-text-faint)]">Opening…</div>
  const p = view.problem
  if (p.type !== 'oral') return null
  const total = p.questions.reduce((n, q) => n + q.seconds, 0)

  async function start() {
    if (p.type !== 'oral' || !p.topic || !onDiscuss) return
    setBusy(true)
    setError(null)
    try {
      const { title } = await window.engram.oralRequest(packId, problemId)
      onDiscuss(p.topic, oralHandoffMessage(packId, problemId, title))
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[860px] mx-auto px-8 py-8 flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] flex gap-3">
            <span>{view.packTitle}</span>
            <span>Oral exam</span>
            <span className="text-[var(--color-ink-warm)]">No notes</span>
          </div>
          <h1 className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)] leading-tight">
            {p.title}
          </h1>
        </header>
        <div className="text-sm">
          <ProseMarkdown text={p.prompt} untrusted />
        </div>
        <div className="text-sm text-[var(--color-text-dim)] flex flex-col gap-1.5">
          <div>
            {p.questions.length} question{p.questions.length === 1 ? '' : 's'}, up to {formatSeconds(total)} of
            answering in all, each with up to two follow-ups.
          </div>
          <div>
            The tutor asks each question in a sitting and you answer aloud. The lecture notes and the composer lock for
            the exam; each answer is transcribed on this machine and you correct the transcript before it counts. You
            get no feedback until the end, when you say how sure you are of each answer. Then the tutor grades them.
          </div>
        </div>
        {!oral.speechReady && (
          <div className="panel px-4 py-3 text-sm flex items-center gap-3">
            <span className="text-[var(--color-text-dim)]">
              Answers are transcribed on this machine by the Speech layer, which is not installed yet. Install it in
              Settings → Code runtime.
            </span>
            {onOpenSettings && (
              <Button size="sm" className="ml-auto shrink-0" onClick={onOpenSettings}>
                Open Settings
              </Button>
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={busy || !oral.speechReady || !p.topic || topicKnown !== true || !onDiscuss}
            onClick={() => void start()}
          >
            Start the exam with the tutor
          </Button>
          {p.topic && topicKnown === false && (
            <span className="text-xs text-[var(--color-text-dim)]">
              This exam belongs to the tutor topic "{p.topic}", which is not on this machine yet. Start it from Course
              first.
            </span>
          )}
          {oral.pending && (
            <span className="text-xs text-[var(--color-text-dim)]">Started: send the message in Learn to begin.</span>
          )}
        </div>
        {error && <div className="text-xs text-[var(--color-text-dim)]">{error}</div>}
        {oral.exams.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
              Your exams
            </div>
            {[...oral.exams].reverse().map((e) => (
              <Exam key={e.id} e={e} questions={p.questions} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
