import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CONFIDENCE_LEVELS, type Confidence } from '../../../../shared/labs'
import { problemHandoffMessage } from '../../../../shared/labHandoff'
import {
  AUDIT_CLASSES,
  type AuditClass,
  type AuditFlag,
  type FigureProblem,
  type ProblemAnswer,
  type ProblemAttempt,
  type ProblemResult,
  type ProblemVerdict,
  type ProblemView,
  type ProofStep,
  FLAG_NOTE_MAX,
  JUDGEMENT_MAX,
  MAX_FLAGS,
  MAX_PROOF_STEPS,
  QUOTE_MAX,
  STEP_TEXT_MAX,
  axisValue,
  confidenceQuestion,
} from '../../../../shared/problems'
import { Button } from '../ui/Button'
import { ProseMarkdown } from '../ProseMarkdown'
import { cleanError } from './LabPage'

/**
 * One pack problem: a proof, an audit or a figure reading. Submit runs in the
 * lab's order and main enforces it: the answer and the written judgement go
 * in together, a confidence is picked with nothing in view, and only then do
 * the result and the signed report arrive. The key never reaches this page
 * before that.
 */

const TYPE_LABEL = { proof: 'Proof', audit: 'Audit', figure: 'Figure reading', oral: 'Oral exam' } as const

const VERDICT_LINE: Record<ProblemVerdict, string> = {
  passed: 'Everything the key checks is right.',
  slip: 'The central part is right; details are off.',
  core: 'A central part is missing or wrong.',
  open: 'Recorded. A proof is graded by the tutor, step by step.',
}

const field =
  'focus-ring w-full bg-transparent border border-[var(--color-hairline)] px-3 py-2 text-sm text-[var(--color-text-primary)] resize-y placeholder:text-[var(--color-text-faint)]'

function emptyAnswer(view: ProblemView): ProblemAnswer {
  const p = view.problem
  if (p.type === 'proof') return { type: 'proof', steps: [{ statement: '', because: '' }] }
  if (p.type === 'audit') return { type: 'audit', flags: [] }
  if (p.type === 'oral') return { type: 'figure', values: {} }
  return { type: 'figure', values: Object.fromEntries(p.questions.map((q) => [q.id, null])) }
}

function sig(n: number): string {
  if (!Number.isFinite(n)) return ''
  const a = Math.abs(n)
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return n.toExponential(2)
  return Number(n.toPrecision(3)).toString()
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

function ProofComposer({ steps, onChange }: { steps: ProofStep[]; onChange: (s: ProofStep[]) => void }) {
  const set = (i: number, patch: Partial<ProofStep>) =>
    onChange(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <div key={i} className="panel px-3 py-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 label-data text-[11px] text-[var(--color-text-faint)]">
            <span>Step {i + 1}</span>
            <span className="ml-auto flex gap-2">
              <button
                className="focus-ring hover:text-[var(--color-text-primary)]"
                onClick={() => move(i, -1)}
                aria-label={`Move step ${i + 1} up`}
              >
                ↑
              </button>
              <button
                className="focus-ring hover:text-[var(--color-text-primary)]"
                onClick={() => move(i, 1)}
                aria-label={`Move step ${i + 1} down`}
              >
                ↓
              </button>
              <button
                className="focus-ring hover:text-[var(--color-text-primary)]"
                onClick={() =>
                  onChange(steps.length > 1 ? steps.filter((_, k) => k !== i) : [{ statement: '', because: '' }])
                }
                aria-label={`Remove step ${i + 1}`}
              >
                Remove
              </button>
            </span>
          </div>
          <textarea
            value={s.statement}
            onChange={(e) => set(i, { statement: e.target.value.slice(0, STEP_TEXT_MAX) })}
            rows={2}
            aria-label={`Step ${i + 1}: what follows`}
            placeholder="What this step establishes. Math in $…$ or $$…$$."
            className={field}
          />
          <textarea
            value={s.because}
            onChange={(e) => set(i, { because: e.target.value.slice(0, STEP_TEXT_MAX) })}
            rows={1}
            aria-label={`Step ${i + 1}: why`}
            placeholder="Because… (the definition, lemma or earlier step it rests on)"
            className={field}
          />
          {(s.statement.includes('$') || s.because.includes('$')) && (
            <div className="text-sm border-l-2 border-[var(--color-hairline)] pl-3">
              <ProseMarkdown text={s.statement + (s.because ? `\n\n*Because* ${s.because}` : '')} untrusted />
            </div>
          )}
        </div>
      ))}
      {steps.length < MAX_PROOF_STEPS && (
        <Button size="sm" className="self-start" onClick={() => onChange([...steps, { statement: '', because: '' }])}>
          Add a step
        </Button>
      )}
    </div>
  )
}

function AuditAnnotator({
  text,
  flags,
  onChange,
}: {
  text: string
  flags: AuditFlag[]
  onChange: (f: AuditFlag[]) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState(false)
  const [pending, setPending] = useState<string>('')
  const [cls, setCls] = useState<AuditClass | ''>('')
  const [note, setNote] = useState('')

  function capture() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !box.current) return
    if (!box.current.contains(sel.anchorNode) || !box.current.contains(sel.focusNode)) return
    const q = sel.toString().replace(/\s+/g, ' ').trim()
    if (q) setPending(q.slice(0, QUOTE_MAX))
  }

  function add() {
    if (!pending || !cls || !note.trim()) return
    onChange([...flags, { quote: pending, cls, note: note.trim() }])
    setPending('')
    setCls('')
    setNote('')
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 label-data text-[11px] text-[var(--color-text-faint)]">
        <span>Select a passage to flag it.</span>
        <button
          className="focus-ring ml-auto underline hover:text-[var(--color-text-primary)]"
          onClick={() => setSource((s) => !s)}
        >
          {source ? 'Show it typeset' : 'Show the source text'}
        </button>
      </div>
      <div ref={box} onMouseUp={capture} onKeyUp={capture} className="panel px-4 py-3 text-sm select-text">
        {source ? (
          <pre className="whitespace-pre-wrap font-(family-name:--font-mono) text-[12.5px] text-[var(--color-text-primary)]">
            {text}
          </pre>
        ) : (
          <ProseMarkdown text={text} untrusted />
        )}
      </div>
      {pending && (
        <div className="panel px-3 py-3 flex flex-col gap-2" aria-label="New flag">
          <div className="text-xs text-[var(--color-text-dim)]">
            Flagging: <span className="text-[var(--color-text-primary)]">“{pending}”</span>
          </div>
          <select
            value={cls}
            onChange={(e) => setCls(e.target.value as AuditClass)}
            aria-label="What kind of error"
            className="focus-ring bg-transparent border border-[var(--color-hairline)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
          >
            <option value="">What kind of error is it?</option>
            {AUDIT_CLASSES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, FLAG_NOTE_MAX))}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="One line: what is wrong, and what is right"
            aria-label="What is wrong"
            className="focus-ring bg-transparent border border-[var(--color-hairline)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)]"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!cls || !note.trim() || flags.length >= MAX_FLAGS}
              onClick={add}
            >
              Add flag
            </Button>
            <Button size="sm" onClick={() => setPending('')}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
          Your flags · {flags.length}
        </div>
        {flags.length === 0 && <div className="text-xs text-[var(--color-text-faint)]">None yet.</div>}
        {flags.map((f, i) => (
          <div key={i} className="flex gap-2 items-start text-sm">
            <span className="label-data text-[11px] text-[var(--color-text-faint)] w-4 shrink-0 text-right leading-5">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[var(--color-text-primary)]">“{f.quote}”</div>
              <div className="text-xs text-[var(--color-text-dim)]">
                {AUDIT_CLASSES.find((c) => c.id === f.cls)?.label}: {f.note}
              </div>
            </div>
            <button
              className="focus-ring label-data text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
              onClick={() => onChange(flags.filter((_, k) => k !== i))}
              aria-label={`Remove flag ${i + 1}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function FigureReader({
  problem,
  imageUrl,
  values,
  onChange,
}: {
  problem: FigureProblem
  imageUrl: string | null
  values: Record<string, number | null>
  onChange: (v: Record<string, number | null>) => void
}) {
  const img = useRef<HTMLImageElement>(null)
  const [hover, setHover] = useState<{ left: number; top: number; x: number; y: number } | null>(null)
  const [pinned, setPinned] = useState<{ x: number; y: number } | null>(null)
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      problem.questions.map((q) => [
        q.id,
        values[q.id] === null || values[q.id] === undefined ? '' : String(values[q.id]),
      ]),
    ),
  )

  function read(e: React.MouseEvent) {
    const el = img.current
    if (!el || !el.naturalWidth) return null
    const r = el.getBoundingClientRect()
    const left = e.clientX - r.left
    const top = e.clientY - r.top
    const px = (left * el.naturalWidth) / r.width
    const py = (top * el.naturalHeight) / r.height
    const x = problem.axes ? axisValue(problem.axes.x, px) : px
    const y = problem.axes ? axisValue(problem.axes.y, py) : py
    return { left, top, x, y }
  }

  function setValue(id: string, text: string) {
    setTyped((t) => ({ ...t, [id]: text }))
    const n = text.trim() === '' ? null : Number(text)
    onChange({ ...values, [id]: n !== null && Number.isFinite(n) ? n : null })
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative self-start max-w-full cursor-crosshair select-none"
        onMouseMove={(e) => setHover(read(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const r = read(e)
          if (r) setPinned({ x: r.x, y: r.y })
        }}
      >
        {imageUrl ? (
          <img
            ref={img}
            src={imageUrl}
            alt={problem.title}
            className="block max-w-full h-auto border border-[var(--color-hairline)]"
            draggable={false}
          />
        ) : (
          <div className="text-xs text-[var(--color-text-faint)]">The figure could not be loaded.</div>
        )}
        {hover && (
          <>
            <div
              className="absolute top-0 bottom-0 w-px bg-[var(--color-ink-cool)] opacity-70 pointer-events-none"
              style={{ left: hover.left }}
            />
            <div
              className="absolute left-0 right-0 h-px bg-[var(--color-ink-cool)] opacity-70 pointer-events-none"
              style={{ top: hover.top }}
            />
            <div
              className="absolute pointer-events-none label-data text-[10.5px] px-1 py-0.5 bg-[var(--color-surface)] border border-[var(--color-hairline)] text-[var(--color-text-primary)]"
              style={{ left: hover.left + 8, top: hover.top + 8 }}
            >
              x {sig(hover.x)} · y {sig(hover.y)}
            </div>
          </>
        )}
      </div>
      <div className="label-data text-[11px] text-[var(--color-text-faint)]">
        {problem.axes
          ? 'The crosshair reads the axes. Click to pin a reading.'
          : 'The crosshair reads image pixels. Click to pin a reading.'}
        {pinned && (
          <span className="text-[var(--color-text-primary)]">
            {' '}
            Pinned: x {sig(pinned.x)} · y {sig(pinned.y)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {problem.questions.map((q) => (
          <label key={q.id} className="flex flex-col gap-1">
            <span className="text-sm text-[var(--color-text-primary)]">{q.prompt}</span>
            <span className="flex items-center gap-2">
              <input
                value={typed[q.id] ?? ''}
                onChange={(e) => setValue(q.id, e.target.value)}
                inputMode="decimal"
                aria-label={q.prompt}
                className="focus-ring w-40 bg-transparent border border-[var(--color-hairline)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
              />
              {q.unit && <span className="text-sm text-[var(--color-text-dim)]">{q.unit}</span>}
              {pinned && (
                <>
                  <button
                    className="focus-ring label-data text-[11px] text-[var(--color-ink-cool)] hover:underline"
                    onClick={(e) => (e.preventDefault(), setValue(q.id, sig(pinned.x)))}
                  >
                    use pinned x
                  </button>
                  <button
                    className="focus-ring label-data text-[11px] text-[var(--color-ink-cool)] hover:underline"
                    onClick={(e) => (e.preventDefault(), setValue(q.id, sig(pinned.y)))}
                  >
                    use pinned y
                  </button>
                </>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function Result({ result, answer }: { result: ProblemResult; answer: ProblemAnswer }) {
  const [showRef, setShowRef] = useState(false)
  if (result.type === 'proof')
    return (
      <div className="flex flex-col gap-2">
        <button
          className="focus-ring self-start label-data text-[11px] underline text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
          onClick={() => setShowRef((s) => !s)}
        >
          {showRef ? 'Hide the reference proof' : 'Compare with the reference proof'}
        </button>
        {showRef && (
          <ol className="flex flex-col gap-2 text-sm">
            {result.reference.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="label-data text-[11px] text-[var(--color-text-faint)] w-4 shrink-0 text-right leading-5">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <ProseMarkdown text={s.statement} untrusted className="min-w-0" />
                    {s.central && (
                      <span className="label-data text-[10.5px] text-[var(--color-ink-warm)] shrink-0">central</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2 text-xs text-[var(--color-text-dim)]">
                    <span className="label-data text-[10.5px] text-[var(--color-text-faint)] shrink-0">because</span>
                    <ProseMarkdown text={s.because} untrusted className="min-w-0" />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    )
  if (result.type === 'audit') {
    const flags = answer.type === 'audit' ? answer.flags : []
    return (
      <div className="flex flex-col gap-2 text-sm">
        {result.errors.map((e) => (
          <div key={e.id} className="flex gap-2 items-start">
            <span
              className={`mt-1 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${e.foundBy !== null ? 'bg-[var(--color-ink-warm)]' : 'border border-[var(--color-text-faint)]'}`}
              aria-label={e.foundBy !== null ? 'found' : 'missed'}
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 text-[var(--color-text-primary)]">
                <ProseMarkdown text={`“${e.quote}”`} untrusted className="min-w-0" />
                {e.central && <span className="label-data text-[10.5px] text-[var(--color-ink-warm)]">central</span>}
              </div>
              <ProseMarkdown
                text={`${AUDIT_CLASSES.find((c) => c.id === e.cls)?.label ?? e.cls}. ${e.why}`}
                untrusted
                className="text-xs text-[var(--color-text-dim)]"
              />
              <div className="label-data text-[10.5px] text-[var(--color-text-faint)]">
                {e.foundBy === null
                  ? 'missed'
                  : `found by your flag ${e.foundBy + 1}${e.classRight ? '' : `, but you called it ${AUDIT_CLASSES.find((c) => c.id === flags[e.foundBy!]?.cls)?.label?.toLowerCase()}`}`}
              </div>
            </div>
          </div>
        ))}
        {result.falseFlags.length > 0 && (
          <div className="text-xs text-[var(--color-text-dim)]">
            No planted error under your flag{result.falseFlags.length === 1 ? '' : 's'}{' '}
            {result.falseFlags.map((i) => i + 1).join(', ')}. If you still think{' '}
            {result.falseFlags.length === 1 ? 'it is' : 'they are'} wrong, take it to the tutor: the key lists what was
            planted, not everything that could be.
          </div>
        )}
        {result.judgement.length > 0 && (
          <ProseMarkdown
            text={`A good judgement says: ${result.judgement.join(' ')}`}
            untrusted
            className="text-xs text-[var(--color-text-dim)]"
          />
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      {result.answers.map((a) => (
        <div key={a.id} className="flex gap-2 items-baseline">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${a.ok ? 'bg-[var(--color-ink-warm)]' : 'border border-[var(--color-text-faint)]'}`}
            aria-label={a.ok ? 'within tolerance' : 'outside tolerance'}
          />
          <span className="text-[var(--color-text-primary)]">{a.id}</span>
          <span className="label-data text-[11px] text-[var(--color-text-dim)]">
            yours {a.got === null ? '—' : sig(a.got)} · key {sig(a.expected)} {a.tolerance}
            {a.tier === 'slip' ? ' · detail' : ''}
          </span>
        </div>
      ))}
      {result.judgement.length > 0 && (
        <ProseMarkdown
          text={`A good judgement says: ${result.judgement.join(' ')}`}
          untrusted
          className="text-xs text-[var(--color-text-dim)]"
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

interface Props {
  packId: string
  problemId: string
  onChanged: () => void
  onDiscuss?: (topicId: string, text: string) => void
}

export function ProblemPage({ packId, problemId, onChanged, onDiscuss }: Props) {
  const [view, setView] = useState<ProblemView | null>(null)
  const [answer, setAnswer] = useState<ProblemAnswer | null>(null)
  const [judgement, setJudgement] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [topicKnown, setTopicKnown] = useState<boolean | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const v = await window.engram.problemView(packId, problemId)
      setView(v)
      setAnswer(v.draft.answer && v.draft.answer.type === v.problem.type ? v.draft.answer : emptyAnswer(v))
      setJudgement(v.draft.explainBack)
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

  // Drafts save quietly, so leaving the page keeps the work.
  const queueSave = useCallback(
    (a: ProblemAnswer | null, j: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void window.engram.problemSaveDraft(packId, problemId, a, j).catch(() => {})
      }, 700)
    },
    [packId, problemId],
  )
  useEffect(() => () => void (saveTimer.current && clearTimeout(saveTimer.current)), [])

  function editAnswer(a: ProblemAnswer) {
    setAnswer(a)
    queueSave(a, judgement)
  }
  function editJudgement(j: string) {
    setJudgement(j)
    queueSave(answer, j)
  }

  const sealed = useMemo(() => view?.attempts.find((a) => a.sealed) ?? null, [view])
  const latest = useMemo(() => (view ? ([...view.attempts].reverse().find((a) => !a.sealed) ?? null) : null), [view])

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = () =>
    act(async () => {
      if (!answer) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      await window.engram.problemSubmit(packId, problemId, answer, judgement)
      await load()
      onChanged()
    })

  const pick = (c: Confidence) =>
    act(async () => {
      if (!sealed) return
      await window.engram.problemConfidence(packId, problemId, sealed.id, c)
      await load()
      onChanged()
    })

  const hint = () =>
    act(async () => {
      const v = await window.engram.problemHint(packId, problemId)
      setView(v)
    })

  useEffect(() => {
    if (!sealed) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const i = Number(e.key) - 1
      if (i >= 0 && i < CONFIDENCE_LEVELS.length) void pick(CONFIDENCE_LEVELS[i])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sealed?.id])

  async function production(a: ProblemAttempt) {
    return window.engram.problemProduction(packId, problemId, a.id)
  }

  if (error && !view) return <div className="p-8 text-sm text-[var(--color-text-dim)]">{error}</div>
  if (!view || !answer) return <div className="p-8 text-sm text-[var(--color-text-faint)]">Opening…</div>
  const p = view.problem

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[860px] mx-auto px-8 py-8 flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] flex gap-3">
            <span>{view.packTitle}</span>
            <span>{TYPE_LABEL[p.type]}</span>
            {p.unaided && <span className="text-[var(--color-ink-warm)]">Unaided</span>}
          </div>
          <h1 className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)] leading-tight">
            {p.title}
          </h1>
          {p.unaided && (
            <p className="text-xs text-[var(--color-text-dim)]">
              From a blank page: no notes, no hints, nothing looked up.
            </p>
          )}
        </header>

        <div className="text-sm">
          <ProseMarkdown text={p.prompt} untrusted />
        </div>
        {p.type === 'proof' && p.steps && (
          <div className="label-data text-[11px] text-[var(--color-text-faint)]">
            The reference proof takes about {p.steps} steps.
          </div>
        )}

        {view.hints.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {view.hints.map((h, i) => (
              <div key={i} className="text-sm border-l-2 border-[var(--color-ink-cool)] pl-3">
                <ProseMarkdown text={h} untrusted />
              </div>
            ))}
          </div>
        )}

        {sealed ? (
          <div className="panel px-4 py-4 flex flex-col gap-3" aria-live="polite">
            <div className="text-xs text-[var(--color-text-dim)]">
              Attempt {sealed.seq} is in. The result stays sealed until you say how sure you are.
            </div>
            <div className="font-(family-name:--font-serif) text-lg text-[var(--color-text-primary)] leading-snug">
              {confidenceQuestion(p.type)}
            </div>
            <div className="flex flex-col gap-1.5">
              {CONFIDENCE_LEVELS.map((c, i) => (
                <button
                  key={c}
                  disabled={busy}
                  onClick={() => void pick(c)}
                  className="focus-ring flex items-center px-3 py-2 border border-[var(--color-hairline)] text-sm text-[var(--color-text-primary)] hover:border-[var(--color-ink-warm)] disabled:opacity-60"
                >
                  {c}
                  <span className="ml-auto label-data text-[11px] text-[var(--color-text-faint)]">{i + 1}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {answer.type === 'proof' && (
              <ProofComposer steps={answer.steps} onChange={(steps) => editAnswer({ type: 'proof', steps })} />
            )}
            {answer.type === 'audit' && p.type === 'audit' && (
              <AuditAnnotator
                text={p.text}
                flags={answer.flags}
                onChange={(flags) => editAnswer({ type: 'audit', flags })}
              />
            )}
            {answer.type === 'figure' && p.type === 'figure' && (
              <FigureReader
                problem={p}
                imageUrl={view.imageUrl}
                values={answer.values}
                onChange={(values) => editAnswer({ type: 'figure', values })}
              />
            )}
            {p.explainBack && (
              <div className="flex flex-col gap-1.5">
                <div className="font-(family-name:--font-serif) text-base text-[var(--color-text-primary)] leading-snug">
                  {p.explainBack}
                </div>
                <textarea
                  value={judgement}
                  onChange={(e) => editJudgement(e.target.value.slice(0, JUDGEMENT_MAX))}
                  rows={4}
                  aria-label="Your judgement"
                  placeholder="In your own words."
                  className={field}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              {!p.unaided && view.hints.length < view.hintCount && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void hint()}
                  title="Each hint you open is recorded with your next Submit."
                >
                  Open a hint ({view.hintCount - view.hints.length} left)
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                className="ml-auto"
                disabled={busy || (!!p.explainBack && !judgement.trim())}
                onClick={() => void submit()}
              >
                Submit
              </Button>
            </div>
            <div className="text-xs text-[var(--color-text-faint)]">
              Submit freezes this answer{p.explainBack ? ' and your judgement' : ''}. You then say how sure you are, and
              only then see the result.
            </div>
          </>
        )}
        {error && <div className="text-sm text-[var(--color-danger,#b4463c)]">{error}</div>}

        {latest && latest.result && latest.verdict && (
          <div className="panel px-4 py-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
              <span>Attempt {latest.seq}</span>
              {latest.score && latest.score !== '-' && <span>· {latest.score}</span>}
              {latest.confidence && <span className="normal-case tracking-normal">· you said {latest.confidence}</span>}
              <span className="ml-auto normal-case tracking-normal">
                {latest.help ? `${latest.help} hint${latest.help === 1 ? '' : 's'} open` : 'no hints'}
              </span>
            </div>
            <div className="text-sm text-[var(--color-text-primary)]">{VERDICT_LINE[latest.verdict]}</div>
            <Result result={latest.result} answer={latest.answer} />
            <div className="flex flex-wrap gap-2 pt-1">
              {onDiscuss && topic && topicKnown && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    void production(latest).then(
                      (text) => onDiscuss(topic, problemHandoffMessage(text)),
                      (e) => setError(cleanError(e)),
                    )
                  }
                  title="Opens the tutor on this problem's topic with your hand-in ready to send. Nothing is sent until you press Send."
                >
                  Hand in to the tutor
                </Button>
              )}
              <Button
                size="sm"
                onClick={() =>
                  void production(latest).then(async (text) => {
                    await navigator.clipboard.writeText(problemHandoffMessage(text))
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  })
                }
              >
                Copy for the tutor
              </Button>
            </div>
            {topic && topicKnown === false && (
              <div className="text-xs text-[var(--color-text-faint)]">
                This problem belongs to the tutor topic "{topic}", which is not on this machine yet. Start it from
                Course, or copy the hand-in and paste it into the topic once it exists.
              </div>
            )}
            {copied && (
              <div className="text-xs text-[var(--color-text-dim)]">Copied the signed report and your answer.</div>
            )}
          </div>
        )}

        {view.attempts.filter((a) => !a.sealed).length > 1 && (
          <div className="flex flex-col gap-1">
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
              Earlier attempts
            </div>
            {view.attempts
              .filter((a) => !a.sealed && a.id !== latest?.id)
              .reverse()
              .map((a) => (
                <div key={a.id} className="label-data text-[11px] text-[var(--color-text-dim)]">
                  Attempt {a.seq} · {a.verdict}
                  {a.score && a.score !== '-' ? ` · ${a.score}` : ''} · {new Date(a.submittedAt).toLocaleDateString()}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
