import { useEffect, useState } from 'react'

const MIN_VISIBLE_MS = 500
const FADE_OUT_MS = 300

/** A conventional native-app launch splash — the same consolidation-pulse mark +
 * wordmark used in the sidebar (App.tsx), just bigger and centered, fading/scaling
 * in on mount and fading out after a floor duration. No WebGL, no simulation —
 * this is the thing most desktop apps actually do at launch (Slack, VS Code, …).
 * Held for at least MIN_VISIBLE_MS even if the app underneath is ready sooner, so
 * it never reads as a flash. */
export function BootSplash() {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out' | 'gone'>('in')

  useEffect(() => {
    const toHold = setTimeout(() => setPhase('hold'), 50)
    const toOut = setTimeout(() => setPhase('out'), MIN_VISIBLE_MS)
    const toGone = setTimeout(() => setPhase('gone'), MIN_VISIBLE_MS + FADE_OUT_MS)
    return () => {
      clearTimeout(toHold)
      clearTimeout(toOut)
      clearTimeout(toGone)
    }
  }, [])

  if (phase === 'gone') return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-void)] transition-opacity"
      style={{ opacity: phase === 'out' ? 0 : 1, transitionDuration: `${FADE_OUT_MS}ms`, pointerEvents: phase === 'out' ? 'none' : 'auto' }}
      aria-hidden
    >
      <div
        className="flex flex-col items-center gap-3 transition-all ease-out"
        style={{
          opacity: phase === 'in' ? 0 : 1,
          transform: phase === 'in' ? 'scale(0.92)' : 'scale(1)',
          transitionDuration: '400ms',
        }}
      >
        <span className="relative inline-flex h-4 w-4">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)] animate-consolidate-ping" />
          <span className="relative inline-flex h-4 w-4 rounded-full bg-[var(--color-ink-warm)]" />
        </span>
        <div className="font-[var(--font-display)] text-2xl tracking-tight text-[var(--color-text-primary)] leading-none">
          Engram
        </div>
        <div className="text-xs text-[var(--color-text-dim)] label-data leading-none">desktop</div>
      </div>
    </div>
  )
}
