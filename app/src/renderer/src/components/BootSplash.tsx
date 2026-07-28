import { useEffect, useState } from 'react'
import { NeuronMark } from './BrandMark'

const MIN_VISIBLE_MS = 500
const FADE_OUT_MS = 300

/** A conventional native-app launch splash — the same neuron mark the sidebar
 * wears (via BrandMark.tsx), bigger and centered. The WORDMARK treatments
 * deliberately differ: this splash wears the hero banner's lockup (serif
 * ENGRAM + "learn anything. keep it.") while the sidebar carries the app's
 * own face (Space Grotesk "Engram" + night-atlas tagline) — the shared mark
 * is what keeps the two surfaces from drifting apart. Fades/scales in on
 * mount and out after a floor duration; no WebGL, no simulation — this is
 * the thing most desktop apps actually do at launch (Slack, VS Code, …).
 * Held for at least MIN_VISIBLE_MS even if the app underneath is ready
 * sooner, so it never reads as a flash. */
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
        <NeuronMark size={48} />
        <div className="font-serif-display font-semibold text-2xl tracking-[0.18em] text-[var(--color-text-primary)] leading-none">
          ENGRAM
        </div>
        <div className="text-xs text-[var(--color-ink-lavender-dim)] label-data leading-none">learn anything. keep it.</div>
      </div>
    </div>
  )
}
