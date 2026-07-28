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
export const SittingClock = memo(function SittingClock({
  startedAt,
  running,
  label,
}: {
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
  return (
    <span className="label-data text-[10px] font-mono text-[var(--color-text-faint)] tabular-nums shrink-0">
      {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
      {label ? ` · ${label}` : ''}
    </span>
  )
})
