import { useEffect, useRef, useState } from 'react'

/** Full 0→1 sweep duration for the play button — a partial sweep (starting
 * mid-scrub) takes proportionally less time, so the *rate* stays constant
 * rather than every play press taking a fixed 6s regardless of where it
 * starts. */
const PLAY_DURATION_MS = 6000

interface GrowthScrubberProps {
  /** Scrub position, 0 (earliest dated node) to 1 (today, plus every node
   * with no encode date at all — see TopicMapView's visibleNodes calc). */
  t: number
  onChangeT: (t: number) => void
  /** "<Month d>" for the date at the current `t` — TopicMapView owns the
   * date math (LOCAL date discipline) since it already has provenance. */
  dateLabel: string
  inked: number
  total: number
}

/** Bottom-center overlay strip for the topic map's growth time-lapse —
 * play/pause, a Night Atlas-styled scrub track, and a fig-caption date
 * readout. Mirrors the legend's own panel styling so it reads as part of
 * the same instrument cluster rather than a bolted-on control. */
export function GrowthScrubber({ t, onChangeT, dateLabel, inked, total }: GrowthScrubberProps) {
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef<number | null>(null)

  // Play loop — captures the starting t once per play press (not on every
  // scrub tick) so the sweep rate stays smooth; matchMedia reduced-motion
  // skips the animation entirely and jumps straight to the end.
  useEffect(() => {
    if (!playing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onChangeT(1)
      setPlaying(false)
      return
    }
    const startT = t >= 1 ? 0 : t
    if (t >= 1) onChangeT(0)
    const startTime = performance.now()
    const remainingMs = Math.max(1, (1 - startT) * PLAY_DURATION_MS)
    function step(now: number) {
      const progress = Math.min(1, (now - startTime) / remainingMs)
      onChangeT(startT + progress * (1 - startT))
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        setPlaying(false)
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // Deliberately only re-runs when `playing` flips — startT is captured
    // once at the top of the effect, not tracked as a live dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    if (playing) setPlaying(false)
    onChangeT(Number(e.target.value))
  }

  return (
    <div
      role="group"
      aria-label="Growth time-lapse"
      className="absolute bottom-3 left-1/2 -translate-x-1/2 panel px-3 py-2 flex items-center gap-3 w-[min(420px,90%)]"
    >
      <button
        onClick={() => setPlaying((v) => !v)}
        aria-label={playing ? 'Pause growth time-lapse' : 'Play growth time-lapse'}
        aria-pressed={playing}
        className="focus-ring shrink-0 w-7 h-7 flex items-center justify-center text-[var(--color-ink-warm)] hover:text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-surface-3)_78%,transparent)]"
      >
        {playing ? (
          <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden="true">
            <rect x={0} y={0} width={3.5} height={11} fill="currentColor" />
            <rect x={7.5} y={0} width={3.5} height={11} fill="currentColor" />
          </svg>
        ) : (
          <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden="true">
            <path d="M0 0 L11 5.5 L0 11 Z" fill="currentColor" />
          </svg>
        )}
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={t}
        onChange={handleScrub}
        aria-label="Scrub through growth history"
        aria-valuetext={dateLabel}
        className="scrubber-range flex-1 min-w-0"
      />

      <span className="fig-caption shrink-0 whitespace-nowrap">
        {dateLabel} — {inked} of {total} nodes inked
      </span>
    </div>
  )
}
