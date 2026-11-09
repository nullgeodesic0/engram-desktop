import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CheckOutcome, CheckRun, LabView, MilestoneView, SmokeResult, Submission } from '../../../../shared/labs'
import { CONFIDENCE_LEVELS, CONFIDENCE_QUESTION, tally, type Confidence } from '../../../../shared/labs'
import { EXPLAIN_BACK_MAX } from '../../../../shared/contentPack'
import { Button } from '../ui/Button'
import { ProseMarkdown } from '../ProseMarkdown'
import { Workbench, type WorkbenchSnapshot } from '../workbench/Workbench'
import { ResizeHandle } from '../ui/ResizeHandle'
import { usePane } from '../../shared/paneLayout'

/**
 * One pack lab: the milestone rail, the lab's workbench, and the milestone's
 * column (its brief, smoke checks, and the Submit flow). Submit runs in the
 * engine's order and main enforces it: the cells freeze and the hidden tests
 * start, the explain-back is written with no result in view, a confidence is
 * picked, and only then do the results and the signed report arrive.
 */

function cleanError(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
}

const STATUS_INK: Record<MilestoneView['status'], string> = {
  passed: 'var(--color-ink-warm)',
  open: 'var(--color-ink-cool)',
  submitted: 'var(--color-text-primary)',
  locked: 'var(--color-text-faint)',
  brief: 'var(--color-text-faint)',
}

function count(run: CheckRun, tier: 'smoke' | 'core' | 'slip'): string {
  const t = tally(run.tests, tier)
  return `${t.passed}/${t.total}`
}

function TestList({ tests }: { tests: CheckOutcome[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {tests.map((t, i) => (
        <li key={t.id || `${t.name}-${i}`} className="text-xs">
          <span
            className="label-data"
            style={{
              color:
                t.outcome === 'passed'
                  ? 'var(--color-ink-cool)'
                  : t.outcome === 'skipped'
                    ? 'var(--color-text-faint)'
                    : 'var(--color-ink-danger)',
            }}
          >
            {t.outcome === 'passed' ? '✓' : t.outcome === 'skipped' ? '–' : '✗'}{' '}
          </span>
          {t.tier !== 'smoke' && t.tier !== 'core' && (
            <span className="label-data text-[var(--color-ink-warm)]">{t.tier} · </span>
          )}
          <span className="label-data text-[var(--color-text-primary)]">
            {t.name.replace(/^test_/, '').replace(/_/g, ' ')}
          </span>
          {t.about && <div className="ml-4 text-[var(--color-text-dim)]">{t.about}</div>}
          {t.message && (
            <pre className="cell-output-pre text-[11px] text-[var(--color-text-dim)] mt-0.5 ml-4 whitespace-pre-wrap">
              {t.message}
            </pre>
          )}
        </li>
      ))}
    </ul>
  )
}

const VERDICT_LINE: Record<string, string> = {
  passed: 'Every core and slip test passed.',
  slip: 'The core tests passed; a slip test caught an execution detail.',
  core: 'A core test failed: the method needs another look.',
  broken: 'The run did not complete.',
}

function Receipt({
  sub,
  onCopy,
  onReflect,
}: {
  sub: Submission
  onCopy: () => void
  onReflect: (text: string) => Promise<void>
}) {
  const [reflection, setReflection] = useState('')
  const run = sub.run
  if (!run) return null
  const coreHidden = run.tests.some((t) => t.tier === 'core' && t.outcome !== 'passed' && !t.message)
  return (
    <div className="panel px-3 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
        <span>Submission {sub.seq}</span>
        <span className="ml-auto normal-case tracking-normal">tests only · explain-back not yet graded</span>
      </div>
      <div className="flex flex-wrap gap-1.5 label-data text-[11px]">
        <span className="px-1.5 py-0.5 border border-[var(--color-hairline)]">core {count(run, 'core')}</span>
        <span className="px-1.5 py-0.5 border border-[var(--color-hairline)]">slip {count(run, 'slip')}</span>
        <span className="px-1.5 py-0.5 border border-[var(--color-hairline)]">{Math.round(run.seconds)} s</span>
        {sub.confidence && (
          <span className="px-1.5 py-0.5 text-[var(--color-text-dim)]">you said {sub.confidence}</span>
        )}
      </div>
      <div className="label-data text-[11px] text-[var(--color-text-faint)]">
        try {sub.seq} ·{' '}
        {sub.rung === 'full' && sub.help === 0
          ? 'unaided'
          : [
              sub.rung === 'completion' ? 'from the partial solution' : null,
              sub.help ? `${sub.help} worked step${sub.help === 1 ? '' : 's'} open` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
      </div>
      <div className="text-sm text-[var(--color-text-primary)]">{VERDICT_LINE[sub.verdict ?? 'broken']}</div>
      {run.error && <div className="text-xs text-[var(--color-text-dim)] break-words">{run.error}</div>}
      {run.tests.length > 0 && <TestList tests={run.tests} />}
      {coreHidden && (
        <div className="text-xs text-[var(--color-text-faint)]">
          A failed core test says which behaviour broke, not what it expected. Work out why; the details open once this
          milestone passes.
        </div>
      )}
      {sub.reflectionPrompt && (
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="font-(family-name:--font-serif) text-base text-[var(--color-text-primary)] leading-snug">
            {sub.reflectionPrompt}
          </div>
          {sub.reflection !== null ? (
            <div className="text-xs text-[var(--color-text-dim)] whitespace-pre-wrap">{sub.reflection}</div>
          ) : (
            <>
              <textarea
                value={reflection}
                onChange={(e) => setReflection(e.target.value.slice(0, EXPLAIN_BACK_MAX))}
                rows={3}
                aria-label="Which assumption broke"
                className="focus-ring w-full bg-transparent border border-[var(--color-hairline)] px-3 py-2 text-sm text-[var(--color-text-primary)] resize-y"
              />
              <Button
                size="sm"
                className="self-end"
                disabled={!reflection.trim()}
                onClick={() => void onReflect(reflection)}
              >
                Save
              </Button>
            </>
          )}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={onCopy}
          title="The signed report and your written answers, ready for the tutor to grade"
        >
          Copy for the tutor
        </Button>
      </div>
    </div>
  )
}

/**
 * The milestone's ladder, every rung the learner's choice: a worked example of
 * a sibling problem to study, the pack's partial solution to finish, and
 * worked steps of this milestone opened one at a time. The last two are
 * noted on every Submit after them, so a first unaided pass stays legible.
 */
function Ladder({
  milestone,
  sealed,
  onStep,
  onCompletion,
}: {
  milestone: MilestoneView
  sealed: boolean
  onStep: () => Promise<void>
  onCompletion: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [confirmCompletion, setConfirmCompletion] = useState(false)
  if (!milestone.worked && !milestone.hasCompletion && milestone.stepsTotal === 0) return null
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
        If you need a way in
      </div>
      {milestone.worked && (
        <details className="panel px-3 py-2">
          <summary className="focus-ring cursor-pointer text-sm text-[var(--color-text-primary)]">
            Worked example · a sibling problem
          </summary>
          <div className="text-sm pt-2">
            <ProseMarkdown text={milestone.worked} untrusted />
          </div>
        </details>
      )}
      {milestone.hasCompletion &&
        (milestone.completionUsed ? (
          <div className="text-xs text-[var(--color-text-dim)]">
            The partial solution is in your cells. Submits from here say you started from it.
          </div>
        ) : confirmCompletion ? (
          <div className="panel px-3 py-2 flex flex-col gap-2">
            <div className="text-xs text-[var(--color-text-dim)]">
              This adds cells with parts of this milestone done, for you to finish. Every Submit from here says you
              started from them.
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={busy || sealed} onClick={() => void act(onCompletion)}>
                Add the partial solution
              </Button>
              <Button size="sm" onClick={() => setConfirmCompletion(false)}>
                Not yet
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" className="self-start" disabled={sealed} onClick={() => setConfirmCompletion(true)}>
            Start from a partial solution
          </Button>
        ))}
      {milestone.stepsTotal > 0 && (
        <div className="flex flex-col gap-2">
          {milestone.steps.map((step, i) => (
            <div key={i} className="panel px-3 py-2">
              <div className="label-data text-[11px] text-[var(--color-ink-warm)]">
                Step {i + 1} of {milestone.stepsTotal}
              </div>
              <div className="text-sm">
                <ProseMarkdown text={step} untrusted />
              </div>
            </div>
          ))}
          {milestone.steps.length < milestone.stepsTotal && (
            <>
              <Button size="sm" className="self-start" disabled={busy || sealed} onClick={() => void act(onStep)}>
                {milestone.steps.length === 0 ? "I'm stuck: show a worked step" : 'Show the next step'}
              </Button>
              {milestone.steps.length === 0 && (
                <div className="text-xs text-[var(--color-text-faint)]">
                  Struggle with it a while first; that effort is where most of the learning happens. Each step you open
                  is noted on your next Submit.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  packId: string
  labId: string
  onOpenSettings: () => void
  onChanged: () => void
}

export function LabPage({ packId, labId, onOpenSettings, onChanged }: Props) {
  const [view, setView] = useState<LabView | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [smoke, setSmoke] = useState<Record<string, SmokeResult>>({})
  const [smoking, setSmoking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [draft, setDraft] = useState('')
  const [unsealing, setUnsealing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [wbKey, setWbKey] = useState(0)
  // The milestone rail and the brief column: widths the learner drags, hidden on a click.
  const rail = usePane('lab.rail', 224, 160, 420)
  const side = usePane('lab.side', 320, 240, 720)
  const [reloading, setReloading] = useState(false)
  const snapshot = useRef<WorkbenchSnapshot | null>(null)
  const draftKey = (subId: string) => `engram.lab.explainBack.${packId}/${labId}/${subId}`

  const refresh = useCallback(async () => {
    try {
      const v = await window.engram.labView(packId, labId)
      setView(v)
      setSelected((cur) => {
        if (cur && v.milestones.some((m) => m.id === cur)) return cur
        const sealed = v.submissions.find((s) => s.sealed)
        if (sealed) return sealed.milestoneId
        return (
          (v.milestones.find((m) => m.status === 'open' || m.status === 'submitted') ?? v.milestones[0])?.id ?? null
        )
      })
    } catch (e) {
      setError(cleanError(e))
    }
  }, [packId, labId])

  useEffect(() => {
    setView(null)
    setSmoke({})
    setDraft('')
    void refresh()
  }, [refresh])

  const sealedId = view?.submissions.find((s) => s.sealed)?.id ?? null
  // An explain-back in progress survives leaving the lab or closing the app.
  useEffect(() => {
    if (!sealedId) return
    try {
      setDraft(localStorage.getItem(draftKey(sealedId)) ?? '')
    } catch {
      // Storage unavailable: start empty.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sealedId])
  const editDraft = (text: string) => {
    setDraft(text)
    if (!sealedId) return
    try {
      localStorage.setItem(draftKey(sealedId), text)
    } catch {
      // Storage unavailable: the draft lives only in memory.
    }
  }

  const onDocChange = useCallback((d: WorkbenchSnapshot) => {
    snapshot.current = d
  }, [])

  const milestone = view?.milestones.find((m) => m.id === selected) ?? null
  const sealed = view?.submissions.find((s) => s.sealed) ?? null
  const latest = useMemo(
    () =>
      view && milestone
        ? ([...view.submissions].reverse().find((s) => s.milestoneId === milestone.id && !s.sealed) ?? null)
        : null,
    [view, milestone],
  )

  async function runSmoke() {
    if (!milestone) return
    setError(null)
    setSmoking(true)
    try {
      const r = await window.engram.labSmoke(packId, labId, milestone.id, snapshot.current)
      setSmoke((s) => ({ ...s, [milestone.id]: r }))
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setSmoking(false)
    }
  }

  async function submit() {
    if (!milestone) return
    setError(null)
    setSubmitting(true)
    try {
      await window.engram.labSubmit(packId, labId, milestone.id, snapshot.current)
      setDraft('')
      await refresh()
      onChanged()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function sendExplainBack() {
    if (!sealed) return
    setError(null)
    try {
      await window.engram.labExplainBack(packId, labId, sealed.id, draft)
      try {
        localStorage.removeItem(draftKey(sealed.id))
      } catch {
        // Nothing to clear.
      }
      await refresh()
    } catch (e) {
      setError(cleanError(e))
    }
  }

  async function pick(c: Confidence) {
    if (!sealed) return
    setError(null)
    setUnsealing(true)
    try {
      await window.engram.labConfidence(packId, labId, sealed.id, c)
      await refresh()
      onChanged()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setUnsealing(false)
    }
  }

  async function openStep() {
    if (!milestone) return
    setError(null)
    try {
      setView(await window.engram.labRevealStep(packId, labId, milestone.id))
    } catch (e) {
      setError(cleanError(e))
    }
  }

  async function addCompletion() {
    if (!milestone) return
    setError(null)
    const doc = snapshot.current
    // Unmount the workbench first, so its own last save cannot land on top of the added cells.
    setReloading(true)
    try {
      await new Promise((r) => setTimeout(r, 0))
      await window.engram.labAddCompletion(packId, labId, milestone.id, doc)
      await refresh()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setWbKey((k) => k + 1)
      setReloading(false)
    }
  }

  async function reflect(sub: Submission, text: string) {
    setError(null)
    try {
      await window.engram.labReflect(packId, labId, sub.id, text)
      await refresh()
    } catch (e) {
      setError(cleanError(e))
    }
  }

  // 1 to 4 pick a confidence, once the explain-back is in.
  useEffect(() => {
    if (!sealed || sealed.explainBack === null || unsealing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const i = Number(e.key) - 1
      if (i >= 0 && i < CONFIDENCE_LEVELS.length) {
        e.preventDefault()
        void pick(CONFIDENCE_LEVELS[i])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sealed?.id, sealed?.explainBack, unsealing])

  async function copyProduction(sub: Submission) {
    const text = await window.engram.labProduction(packId, labId, sub.id)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (error && !view) return <div className="p-8 text-sm text-[var(--color-text-dim)]">{error}</div>
  if (!view) return <div className="p-8 text-sm text-[var(--color-text-faint)]">Opening…</div>

  // A sealed submission's explain-back lives in this column, so it cannot be hidden then.
  const sideOpen = !side.collapsed || !!sealed
  const smokeHere = milestone ? smoke[milestone.id] : undefined
  const canSubmit = !!milestone?.hasHidden && milestone.status !== 'locked' && !sealed && !submitting

  const toolbarExtra = milestone && (
    <>
      {milestone.hasSmoke &&
        (smoking ? (
          <Button size="sm" onClick={() => void window.engram.labCancelSmoke(packId, labId)} title="Stop the smoke run">
            Checking… Stop
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void runSmoke()}
            disabled={!!sealed}
            title="Visible checks: shape and type, never whether the method is right"
          >
            {smokeHere ? `Smoke ${count(smokeHere.run, 'smoke')}` : 'Smoke checks'}
          </Button>
        ))}
      {milestone.hasHidden && (
        <Button size="sm" variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? 'Freezing…' : `Submit ${milestone.id.toUpperCase()}`}
        </Button>
      )}
    </>
  )

  let lockedBy: string | null = null
  if (milestone?.status === 'locked') {
    const idx = view.milestones.findIndex((m) => m.id === milestone.id)
    lockedBy =
      view.milestones
        .slice(0, idx)
        .find((m) => m.hasHidden && m.status !== 'passed')
        ?.id.toUpperCase() ?? null
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="px-6 pt-5 pb-3 border-b border-[var(--color-hairline)] flex items-end gap-4">
        <div className="min-w-0 flex-1">
          {view.kicker && (
            <div className="label-data text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-warm)]">
              {view.kicker}
            </div>
          )}
          <h1 className="font-(family-name:--font-serif) text-2xl text-[var(--color-text-primary)] leading-tight truncate">
            {view.title}
          </h1>
          {milestone && (
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-dim)] mt-0.5">
              <span className="text-[var(--color-ink-warm)]">
                {milestone.id.toUpperCase()} · {milestone.title}
              </span>{' '}
              · {view.packTitle}
            </div>
          )}
        </div>
        <div className="flex gap-2 pb-0.5">
          <Button size="sm" onClick={rail.toggle} aria-pressed={!rail.collapsed} title="Show or hide the milestones">
            Milestones
          </Button>
          <Button
            size="sm"
            onClick={side.toggle}
            aria-pressed={!side.collapsed}
            title="Show or hide the brief and results"
          >
            Brief
          </Button>
        </div>
      </header>
      <div className="flex-1 flex min-h-0">
        {!rail.collapsed && (
          <aside
            style={{ width: rail.size }}
            className="shrink-0 border-r border-[var(--color-hairline)] flex flex-col min-h-0"
          >
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] px-4 pt-4 pb-2">
              Milestones
            </div>
            <nav className="flex flex-col overflow-y-auto" aria-label="Milestones">
              {view.milestones.map((m, i) => {
                const subs = view.submissions.filter((s) => s.milestoneId === m.id && !s.sealed && s.run)
                const last = subs[subs.length - 1]
                const sub =
                  m.status === 'passed' && m.passedOn
                    ? m.passedOn.seq === 1 && m.passedOn.unaided
                      ? 'passed first try'
                      : `passed on try ${m.passedOn.seq}${m.passedOn.unaided ? '' : ' · with help'}`
                    : m.status === 'passed' && last?.run
                      ? `passed · core ${count(last.run, 'core')}`
                      : m.status === 'submitted'
                        ? 'sealed'
                        : m.status === 'locked'
                          ? `opens after ${
                              view.milestones
                                .slice(0, i)
                                .reverse()
                                .find((x) => x.hasHidden)
                                ?.id.toUpperCase() ?? 'the last'
                            }`
                          : m.status === 'brief'
                            ? 'brief only'
                            : smoke[m.id]
                              ? `open · smoke ${count(smoke[m.id].run, 'smoke')}`
                              : 'open'
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelected(m.id)}
                    aria-current={m.id === selected ? 'true' : undefined}
                    className={`focus-ring text-left px-4 py-2 border-l-2 flex gap-2.5 ${
                      m.id === selected
                        ? 'border-[var(--color-ink-warm)] bg-[var(--color-hairline)]/30'
                        : 'border-transparent'
                    }`}
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 h-2 w-2 rounded-full shrink-0"
                      style={{
                        background:
                          m.status === 'passed' || m.status === 'submitted' ? STATUS_INK[m.status] : 'transparent',
                        border: `1px ${m.status === 'locked' || m.status === 'brief' ? 'dashed' : 'solid'} ${STATUS_INK[m.status]}`,
                      }}
                    />
                    <span className="min-w-0">
                      <span
                        className={`block text-sm truncate ${m.status === 'locked' ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-text-primary)]'}`}
                      >
                        {m.id.toUpperCase()} · {m.title}
                      </span>
                      <span className="block label-data text-[11px] text-[var(--color-text-faint)]">{sub}</span>
                    </span>
                  </button>
                )
              })}
            </nav>
            <div className="mt-auto px-4 py-3 border-t border-[var(--color-hairline)]">
              <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
                Environment
              </div>
              <button
                onClick={onOpenSettings}
                className="focus-ring label-data text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] mt-1"
              >
                {view.layer}
              </button>
            </div>
          </aside>
        )}
        {!rail.collapsed && <ResizeHandle pane={rail} edge="end" label="Milestones width" />}

        <section className="flex-1 min-w-0 min-h-0">
          {reloading ? (
            <div className="p-8 text-sm text-[var(--color-text-faint)]">Adding the partial solution…</div>
          ) : (
            <Workbench
              key={`${view.workbenchId}-${wbKey}`}
              workbenchId={view.workbenchId}
              layerId={view.layer}
              frozen={!!sealed}
              titleEditable={false}
              toolbarExtra={toolbarExtra}
              onDocChange={onDocChange}
              onOpenSettings={onOpenSettings}
            />
          )}
        </section>

        {sideOpen && <ResizeHandle pane={side} edge="start" label="Brief width" />}
        {sideOpen && (
          <aside
            style={{ width: side.size }}
            className="shrink-0 border-l border-[var(--color-hairline)] overflow-y-auto px-4 py-4 flex flex-col gap-4"
          >
            {error && <div className="text-xs text-[var(--color-ink-danger)] break-words">{error}</div>}

            {sealed && (
              <div className="panel px-3 py-3 flex flex-col gap-3 border-[var(--color-ink-warm)]">
                <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink-warm)]">
                  {sealed.milestoneId.toUpperCase()} submitted · cells frozen at{' '}
                  {new Date(sealed.submittedAt).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                <div className="text-xs text-[var(--color-text-dim)]">
                  Results stay sealed until you have explained your work and said how sure you are.
                </div>
                {sealed.explainBack === null ? (
                  <>
                    <div className="font-(family-name:--font-serif) text-lg text-[var(--color-text-primary)] leading-snug">
                      {sealed.explainBackPrompt ||
                        view.milestones.find((m) => m.id === sealed.milestoneId)?.explainBack}
                    </div>
                    <textarea
                      value={draft}
                      onChange={(e) => editDraft(e.target.value.slice(0, EXPLAIN_BACK_MAX))}
                      rows={9}
                      aria-label="Explain-back"
                      placeholder="In your own words, without looking anything up."
                      className="focus-ring w-full bg-transparent border border-[var(--color-hairline)] px-3 py-2 text-sm text-[var(--color-text-primary)] resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <span className="label-data text-[11px] text-[var(--color-text-faint)]">
                        {draft.length.toLocaleString()} / {EXPLAIN_BACK_MAX.toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        variant="primary"
                        className="ml-auto"
                        disabled={!draft.trim()}
                        onClick={() => void sendExplainBack()}
                      >
                        Send explain-back
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-(family-name:--font-serif) text-lg text-[var(--color-text-primary)] leading-snug">
                      {CONFIDENCE_QUESTION}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {CONFIDENCE_LEVELS.map((c, i) => (
                        <button
                          key={c}
                          disabled={unsealing}
                          onClick={() => void pick(c)}
                          className="focus-ring flex items-center px-3 py-2 border border-[var(--color-hairline)] text-sm text-[var(--color-text-primary)] hover:border-[var(--color-ink-warm)] disabled:opacity-60"
                        >
                          {c}
                          <span className="ml-auto label-data text-[11px] text-[var(--color-text-faint)]">{i + 1}</span>
                        </button>
                      ))}
                    </div>
                    {unsealing && (
                      <div className="text-xs text-[var(--color-text-dim)]" aria-live="polite">
                        Unsealing…
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {milestone && (
              <div className="flex flex-col gap-2">
                <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
                  {milestone.id.toUpperCase()} · brief
                </div>
                {milestone.brief ? (
                  <div className="text-sm">
                    <ProseMarkdown text={milestone.brief} untrusted />
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-text-faint)]">This milestone has no brief.</div>
                )}
                {milestone.status === 'locked' && (
                  <div className="text-xs text-[var(--color-text-dim)]">
                    Opens once {lockedBy ?? 'the milestone before it'} passes. You can read ahead and work in the cells
                    meanwhile.
                  </div>
                )}
                {milestone.status === 'brief' && (
                  <div className="text-xs text-[var(--color-text-dim)]">
                    This milestone has no tests yet, so there is nothing to submit.
                  </div>
                )}
              </div>
            )}

            {milestone && (
              <Ladder milestone={milestone} sealed={!!sealed} onStep={openStep} onCompletion={addCompletion} />
            )}

            {smokeHere && (
              <div className="flex flex-col gap-2">
                <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
                  Smoke checks · {count(smokeHere.run, 'smoke')}
                </div>
                <div className="text-xs text-[var(--color-text-faint)]">
                  They catch shape and type mistakes and never say whether the method is right.
                </div>
                {smokeHere.run.error && (
                  <div className="text-xs text-[var(--color-text-dim)] break-words">{smokeHere.run.error}</div>
                )}
                <TestList tests={smokeHere.run.tests} />
              </div>
            )}

            {latest && (
              <Receipt
                key={latest.id}
                sub={latest}
                onCopy={() => void copyProduction(latest)}
                onReflect={(t) => reflect(latest, t)}
              />
            )}
            {copied && (
              <div className="text-xs text-[var(--color-text-dim)]">Copied the signed report and your answers.</div>
            )}
            {latest?.explainBack && (
              <div className="flex flex-col gap-1">
                <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
                  Your explain-back
                </div>
                {latest.explainBackPrompt && (
                  <div className="text-xs text-[var(--color-text-faint)] italic">{latest.explainBackPrompt}</div>
                )}
                <div className="text-xs text-[var(--color-text-dim)] whitespace-pre-wrap">{latest.explainBack}</div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
