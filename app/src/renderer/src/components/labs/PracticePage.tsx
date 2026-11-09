import { useCallback, useEffect, useRef, useState } from 'react'
import type { PracticeAttempt, PracticeItem, PracticeQueue } from '../../../../shared/labs'
import { CONFIDENCE_LEVELS, CONFIDENCE_QUESTION, type Confidence } from '../../../../shared/labs'
import { Button } from '../ui/Button'
import { ProseMarkdown } from '../ProseMarkdown'
import { Workbench, type WorkbenchSnapshot } from '../workbench/Workbench'
import { ResizeHandle } from '../ui/ResizeHandle'
import { usePane } from '../../shared/paneLayout'
import { TestList, VERDICT_LINE, cleanError } from './LabPage'

/**
 * Spaced, interleaved practice across every pack lab. Once a milestone
 * passes, its variants come back on a growing interval: the same method on a
 * new instance, written again from memory in a practice notebook that starts
 * from the lab's starter, never from the learner's old code. Due items are
 * mixed across milestones and labs, so each one first asks which method fits.
 * As at Submit, the confidence comes before the result.
 */

function dueLine(iso: string, now: number): string {
  const d = Date.parse(iso)
  const days = Math.round((d - now) / 86_400_000)
  if (d <= now) return 'due now'
  if (days <= 0) return 'later today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

const key = (x: { packId: string; labId: string; milestoneId: string }) => `${x.packId}/${x.labId}/${x.milestoneId}`

export function PracticePage({
  layerOf,
  onOpenSettings,
  onChanged,
}: {
  /** The runtime layer of a pack's labs. */
  layerOf: (packId: string) => string
  onOpenSettings: () => void
  onChanged: () => void
}) {
  const [queue, setQueue] = useState<PracticeQueue | null>(null)
  const [active, setActive] = useState<{ item: PracticeItem; workbenchId: string; n: number } | null>(null)
  const [confidence, setConfidence] = useState<Confidence | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<PracticeAttempt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const snapshot = useRef<WorkbenchSnapshot | null>(null)
  const side = usePane('practice.side', 340, 240, 720)
  const now = Date.now()

  const refresh = useCallback(async () => {
    try {
      setQueue(await window.engram.practiceQueue())
    } catch (e) {
      setError(cleanError(e))
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  async function start(item: PracticeItem) {
    setError(null)
    setResult(null)
    setConfidence(null)
    try {
      const r = await window.engram.practiceStart(item.packId, item.labId, item.milestoneId)
      snapshot.current = null
      setActive((a) => ({ item: r.item, workbenchId: r.workbenchId, n: (a?.n ?? 0) + 1 }))
    } catch (e) {
      setError(cleanError(e))
    }
  }

  async function check() {
    if (!active || !confidence) return
    setChecking(true)
    setError(null)
    try {
      const a = await window.engram.practiceCheck(
        active.item.packId,
        active.item.labId,
        active.item.milestoneId,
        confidence,
        snapshot.current,
      )
      setResult(a)
      await refresh()
      onChanged()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setChecking(false)
    }
  }

  const due = queue?.due ?? []
  const later = queue?.later ?? []
  const next = active && result ? due.find((x) => key(x) !== key(active.item)) : null

  const toolbarExtra = active && !result && (
    <Button
      size="sm"
      variant="primary"
      disabled={!confidence || checking}
      onClick={() => void check()}
      title={confidence ? 'Run this variant’s tests' : 'Say how sure you are first'}
    >
      {checking ? 'Checking…' : 'Check'}
    </Button>
  )

  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="px-6 pt-5 pb-3 border-b border-[var(--color-hairline)] flex items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="label-data text-[11px] uppercase tracking-[0.14em] text-[var(--color-ink-warm)]">
            Practice · spaced and mixed
          </div>
          <h1 className="font-(family-name:--font-serif) text-2xl text-[var(--color-text-primary)] leading-tight truncate">
            {active ? active.item.variantTitle : 'Practice'}
          </h1>
          {active && (
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-dim)] mt-0.5">
              {active.item.labTitle}
            </div>
          )}
        </div>
        <div className="flex gap-2 pb-0.5">
          <Button
            size="sm"
            onClick={side.toggle}
            aria-pressed={!side.collapsed}
            title="Show or hide the queue and brief"
          >
            Queue
          </Button>
        </div>
      </header>
      <div className="flex-1 flex min-h-0">
        <section className="flex-1 min-w-0 min-h-0">
          {active ? (
            <Workbench
              key={`${active.workbenchId}-${active.n}`}
              workbenchId={active.workbenchId}
              layerId={layerOf(active.item.packId)}
              frozen={checking}
              titleEditable={false}
              toolbarExtra={toolbarExtra}
              onDocChange={(d) => {
                snapshot.current = d
              }}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            <div className="p-8 max-w-xl flex flex-col gap-3">
              <p className="text-sm text-[var(--color-text-dim)]">
                Each milestone you pass comes back here a day later as a variant: the same method on a new instance. You
                write it again from memory, in a notebook that starts from the lab’s starter cells. Get it right and it
                comes back after a longer gap; miss it and it comes back tomorrow, as a different variant.
              </p>
              <p className="text-sm text-[var(--color-text-dim)]">
                The queue mixes milestones and labs on purpose. Working out which method a problem needs is part of the
                skill, and a block of one kind hides it.
              </p>
              {queue && due.length === 0 && (
                <p className="text-sm text-[var(--color-text-primary)]">
                  {later.length
                    ? `Nothing is due. The next item comes back ${dueLine(later[0].due, now)}.`
                    : 'Nothing to practise yet: pass a milestone that has variants first.'}
                </p>
              )}
              {due.length > 0 && (
                <Button variant="primary" className="self-start" onClick={() => void start(due[0])}>
                  Start · {due.length} due
                </Button>
              )}
            </div>
          )}
        </section>

        {!side.collapsed && <ResizeHandle pane={side} edge="start" label="Queue width" />}
        {!side.collapsed && (
          <aside
            style={{ width: side.size }}
            className="shrink-0 border-l border-[var(--color-hairline)] overflow-y-auto px-4 py-4 flex flex-col gap-4"
          >
            {error && <div className="text-xs text-[var(--color-ink-danger)] break-words">{error}</div>}

            {active && (
              <div className="flex flex-col gap-2">
                <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
                  Brief
                </div>
                <div className="text-sm">
                  <ProseMarkdown text={active.item.brief} untrusted />
                </div>
                <div className="text-xs text-[var(--color-text-faint)]">
                  Write it from memory, and check it before you look back at the lab or your old code.
                </div>
              </div>
            )}

            {active && !result && (
              <div className="flex flex-col gap-1.5">
                <div className="font-(family-name:--font-serif) text-base text-[var(--color-text-primary)] leading-snug">
                  {CONFIDENCE_QUESTION}
                </div>
                {CONFIDENCE_LEVELS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setConfidence(c)}
                    aria-pressed={confidence === c}
                    className={`focus-ring flex items-center px-3 py-1.5 border text-sm text-[var(--color-text-primary)] ${
                      confidence === c
                        ? 'border-[var(--color-ink-warm)]'
                        : 'border-[var(--color-hairline)] hover:border-[var(--color-ink-warm)]'
                    }`}
                  >
                    {c}
                  </button>
                ))}
                <div className="text-xs text-[var(--color-text-faint)]">Pick before you check; then press Check.</div>
              </div>
            )}

            {result && (
              <div className="panel px-3 py-3 flex flex-col gap-2">
                <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
                  Result · you said {result.confidence}
                </div>
                <div className="text-sm text-[var(--color-text-primary)]">{VERDICT_LINE[result.verdict]}</div>
                {result.run.error && (
                  <div className="text-xs text-[var(--color-text-dim)] break-words">{result.run.error}</div>
                )}
                {result.run.tests.length > 0 && <TestList tests={result.run.tests} />}
                <div className="text-xs text-[var(--color-text-dim)]">
                  Back {dueLine(result.nextDue, now)}, as a different variant.
                </div>
                {next ? (
                  <Button size="sm" variant="primary" className="self-start" onClick={() => void start(next)}>
                    Next: {next.labTitle} · {next.milestoneTitle}
                  </Button>
                ) : (
                  <div className="text-xs text-[var(--color-text-faint)]">That was the last one due.</div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
                Due · {due.length}
              </div>
              {due.map((x) => (
                <button
                  key={key(x)}
                  onClick={() => void start(x)}
                  aria-current={active && key(active.item) === key(x) ? 'true' : undefined}
                  className={`focus-ring text-left px-2 py-1.5 border-l-2 ${
                    active && key(active.item) === key(x)
                      ? 'border-[var(--color-ink-warm)]'
                      : 'border-transparent hover:border-[var(--color-hairline)]'
                  }`}
                >
                  <div className="text-sm text-[var(--color-text-primary)] truncate">{x.milestoneTitle}</div>
                  <div className="label-data text-[11px] text-[var(--color-text-faint)] truncate">
                    {x.labTitle} · {x.attempts ? `${x.attempts} done` : 'first time'}
                  </div>
                </button>
              ))}
              {later.length > 0 && (
                <>
                  <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)] pt-3">
                    Later
                  </div>
                  {later.map((x) => (
                    <div key={key(x)} className="px-2 py-1">
                      <div className="text-sm text-[var(--color-text-dim)] truncate">{x.milestoneTitle}</div>
                      <div className="label-data text-[11px] text-[var(--color-text-faint)] truncate">
                        {x.labTitle} · {dueLine(x.due, now)}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
