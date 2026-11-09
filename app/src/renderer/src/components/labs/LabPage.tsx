import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CheckOutcome, CheckRun, LabView, MilestoneView, SmokeResult, Submission } from '../../../../shared/labs'
import { CONFIDENCE_LEVELS, tally, type Confidence } from '../../../../shared/labs'
import { EXPLAIN_BACK_MAX } from '../../../../shared/contentPack'
import { Button } from '../ui/Button'
import { ProseMarkdown } from '../ProseMarkdown'
import { Workbench, type WorkbenchSnapshot } from '../workbench/Workbench'

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
      {tests.map((t) => (
        <li key={t.name} className="text-xs">
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
          <span className="label-data text-[var(--color-text-primary)]">{t.name.replace(/^test_/, '')}</span>
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

function Receipt({ sub, onCopy }: { sub: Submission; onCopy: () => void }) {
  const run = sub.run
  if (!run) return null
  return (
    <div className="panel px-3 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
        <span>Submission {sub.seq}</span>
        <span className="ml-auto normal-case tracking-normal">signed report</span>
      </div>
      <div className="flex flex-wrap gap-1.5 label-data text-[11px]">
        <span className="px-1.5 py-0.5 border border-[var(--color-hairline)]">core {count(run, 'core')}</span>
        <span className="px-1.5 py-0.5 border border-[var(--color-hairline)]">slip {count(run, 'slip')}</span>
        <span className="px-1.5 py-0.5 border border-[var(--color-hairline)]">{Math.round(run.seconds)} s</span>
        {sub.confidence && (
          <span className="px-1.5 py-0.5 text-[var(--color-text-dim)]">you said {sub.confidence}</span>
        )}
      </div>
      <div className="text-sm text-[var(--color-text-primary)]">{VERDICT_LINE[sub.verdict ?? 'broken']}</div>
      {run.error && <div className="text-xs text-[var(--color-text-dim)] break-words">{run.error}</div>}
      {run.tests.length > 0 && <TestList tests={run.tests} />}
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={onCopy} title="The signed report and your explain-back, ready for the tutor">
          Copy for the tutor
        </Button>
      </div>
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
  const snapshot = useRef<WorkbenchSnapshot | null>(null)

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

  async function copyProduction(sub: Submission) {
    const text = await window.engram.labProduction(packId, labId, sub.id)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (error && !view) return <div className="p-8 text-sm text-[var(--color-text-dim)]">{error}</div>
  if (!view) return <div className="p-8 text-sm text-[var(--color-text-faint)]">Opening…</div>

  const smokeHere = milestone ? smoke[milestone.id] : undefined
  const canSubmit = !!milestone?.hasHidden && milestone.status !== 'locked' && !sealed && !submitting

  const toolbarExtra = milestone && (
    <>
      {milestone.hasSmoke && (
        <Button
          size="sm"
          onClick={() => void runSmoke()}
          disabled={smoking || !!sealed}
          title="Visible checks: shape and type, never the physics"
        >
          {smoking ? 'Checking…' : smokeHere ? `Smoke ${count(smokeHere.run, 'smoke')}` : 'Smoke checks'}
        </Button>
      )}
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
      </header>
      <div className="flex-1 flex min-h-0">
        <aside className="w-56 shrink-0 border-r border-[var(--color-hairline)] flex flex-col min-h-0">
          <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] px-4 pt-4 pb-2">
            Milestones
          </div>
          <nav className="flex flex-col overflow-y-auto" aria-label="Milestones">
            {view.milestones.map((m, i) => {
              const subs = view.submissions.filter((s) => s.milestoneId === m.id && !s.sealed && s.run)
              const last = subs[subs.length - 1]
              const sub =
                m.status === 'passed' && last?.run
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

        <section className="flex-1 min-w-0 min-h-0">
          <Workbench
            key={view.workbenchId}
            workbenchId={view.workbenchId}
            layerId={view.layer}
            frozen={!!sealed}
            titleEditable={false}
            toolbarExtra={toolbarExtra}
            onDocChange={onDocChange}
            onOpenSettings={onOpenSettings}
          />
        </section>

        <aside className="w-80 shrink-0 border-l border-[var(--color-hairline)] overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {error && <div className="text-xs text-[var(--color-ink-danger)] break-words">{error}</div>}

          {sealed && (
            <div className="panel px-3 py-3 flex flex-col gap-3 border-[var(--color-ink-warm)]">
              <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink-warm)]">
                {sealed.milestoneId.toUpperCase()} submitted · cells frozen at{' '}
                {new Date(sealed.submittedAt).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                · {sealed.finished ? 'hidden tests done' : 'hidden tests running'}
              </div>
              <div className="text-xs text-[var(--color-text-dim)]">
                Results stay sealed until you have explained your work and said how sure you are.
              </div>
              {sealed.explainBack === null ? (
                <>
                  <div className="font-(family-name:--font-serif) text-lg text-[var(--color-text-primary)] leading-snug">
                    {view.milestones.find((m) => m.id === sealed.milestoneId)?.explainBack}
                  </div>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, EXPLAIN_BACK_MAX))}
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
                    Before anything else: how sure are you that this milestone is right?
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
                      {sealed.finished ? 'Unsealing…' : 'Waiting for the hidden tests to finish…'}
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
                  <ProseMarkdown text={milestone.brief} />
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

          {latest && <Receipt sub={latest} onCopy={() => void copyProduction(latest)} />}
          {copied && (
            <div className="text-xs text-[var(--color-text-dim)]">Copied the signed report and your explain-back.</div>
          )}
          {latest?.explainBack && (
            <div className="flex flex-col gap-1">
              <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
                Your explain-back
              </div>
              <div className="text-xs text-[var(--color-text-dim)] whitespace-pre-wrap">{latest.explainBack}</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
