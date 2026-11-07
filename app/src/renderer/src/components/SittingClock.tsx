import { memo, useEffect, useState } from 'react'

/** Addition D (chat refine round) — a quiet mm:ss elapsed indicator for a
 * LIVE session's own masthead (Learn's and Review's — never rendered in
 * SessionHistoryDrawer's replay, which has no "now" to count from and no
 * live session to time). Pure local timer, no engine call, no persistence:
 * `startedAt` is a plain `Date.now()` captured by the caller the moment its
 * own session actually starts (fresh) OR resumes (a resumed sitting has no
 * way to recover the true original start time, so it counts from the
 * resume instead — `label` says so honestly, e.g. "this sitting", rather
 * than implying a total the component can't actually know).
 *
 * No pressure copy, no goal, no color change as time passes — label-data
 * faint mono, same register as the masthead's other quiet numbers
 * (ContextGauge, the export status line). `running` stops the interval
 * (session ended/left) without unmounting the display — it freezes at
 * whatever it last read rather than disappearing. */
/** Time-blindness support (2026-11). Two optional additions, both quiet:
 *
 * - `budgetMinutes`: the clock also says how much of the declared budget is
 *   left, then "budget reached — a complete sitting" once it is spent. Time
 *   shown as remaining-of-budget is the accommodation; elapsed alone asks the
 *   learner to do the subtraction their sense of time is worst at. Reaching
 *   the budget is stated as completion, never as overrun.
 * - `breakEveryMinutes`: at each multiple, a one-line break suggestion with a
 *   dismiss. Micro-breaks restore vigour but only longer breaks helped
 *   performance on demanding tasks (Albulescu et al. 2022), so the copy asks
 *   for a real one. */
export function pacerState(
  elapsedSeconds: number,
  budgetMinutes: number | null | undefined,
  breakEveryMinutes: number | null | undefined,
): { leftMinutes: number | null; budgetReached: boolean; breakIndex: number } {
  const budget = budgetMinutes && budgetMinutes > 0 ? budgetMinutes * 60 : null
  const leftMinutes = budget === null ? null : Math.max(0, Math.ceil((budget - elapsedSeconds) / 60))
  const breakIndex =
    breakEveryMinutes && breakEveryMinutes > 0 ? Math.floor(elapsedSeconds / (breakEveryMinutes * 60)) : 0
  return { leftMinutes, budgetReached: budget !== null && elapsedSeconds >= budget, breakIndex }
}

export const SittingClock = memo(function SittingClock({
  startedAt,
  running,
  label,
  budgetMinutes = null,
  breakEveryMinutes = null,
}: {
  budgetMinutes?: number | null
  breakEveryMinutes?: number | null
  /** `Date.now()` at fresh-start or resume — never the engine's own record
   * of when a sitting FIRST began; see the doctrine comment above for why
   * that distinction matters for a resumed session. */
  startedAt: number
  /** False freezes the display at its last reading instead of continuing
   * to tick — used once a session leaves its live in-progress phase. */
  running: boolean
  label?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  const pace = pacerState(totalSeconds, budgetMinutes, breakEveryMinutes)
  const [dismissedBreak, setDismissedBreak] = useState(0)
  const showBreak = running && pace.breakIndex > 0 && pace.breakIndex > dismissedBreak
  return (
    <span className="inline-flex items-center gap-2 shrink-0">
      <span className="label-data text-[10px] font-mono text-[var(--color-text-faint)] tabular-nums">
        {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
        {label ? ` · ${label}` : ''}
        {pace.leftMinutes !== null &&
          (pace.budgetReached
            ? ' · budget reached — a complete sitting'
            : ` · ${pace.leftMinutes} min left of ${budgetMinutes}`)}
      </span>
      {showBreak && (
        <span
          role="status"
          className="label-data text-[10px] text-[var(--color-ink-cool)] inline-flex items-center gap-1.5 border border-[var(--color-ink-cool-dim)] px-1.5 py-0.5"
        >
          {pace.breakIndex * (breakEveryMinutes ?? 0)} min in · stand up for a few minutes, it helps the next hour
          <button
            onClick={() => setDismissedBreak(pace.breakIndex)}
            aria-label="Dismiss break suggestion"
            className="focus-ring no-press text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
          >
            ×
          </button>
        </span>
      )}
    </span>
  )
})
