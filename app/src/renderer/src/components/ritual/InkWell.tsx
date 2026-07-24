import { memo, useEffect, useRef, useState } from 'react'
import type { GradeResult } from '../../../../shared/gradeResult'
import { plink } from '../../shared/soundscape'

const CAPACITY = 6

/** The sitting's effort made liquid: a small vial that gains ink per honest
 * grade (recalled = a full drop, partial = half). Purely cosmetic, resets
 * with the session, and never rendered when the learner opted out of
 * momentum language — the app honors that choice beyond the dialogue. */
export const InkWell = memo(function InkWell({ results }: { results: GradeResult[] }) {
  const recalled = results.filter((r) => r.grade === 'recalled').length
  const partial = results.filter((r) => r.grade === 'partial').length
  const drops = Math.min(CAPACITY, recalled + 0.5 * partial)
  const fillFraction = drops / CAPACITY

  // A droplet plinks in whenever the level rises.
  const prevDrops = useRef(drops)
  const [plinking, setPlinking] = useState(false)
  useEffect(() => {
    if (drops > prevDrops.current) {
      setPlinking(true)
      plink()
      const t = setTimeout(() => setPlinking(false), 500)
      prevDrops.current = drops
      return () => clearTimeout(t)
    }
    prevDrops.current = drops
  }, [drops])

  // Vial interior: y from 4 (top) to 20 (bottom), height 16.
  const fillHeight = 16 * fillFraction
  const fillY = 20 - fillHeight

  return (
    <span title={`ink gathered this sitting — ${recalled} recalled, ${partial} partial`} className="inline-flex">
      <svg width="14" height="22" viewBox="0 0 14 22" aria-hidden="true">
        <path
          d="M4 1.5 H10 M5 1.5 V4 L3 7 V19 A1.5 1.5 0 0 0 4.5 20.5 H9.5 A1.5 1.5 0 0 0 11 19 V7 L9 4 V1.5"
          stroke="var(--color-text-faint)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
        />
        {fillFraction > 0 && (
          <rect
            x="3.6"
            y={fillY}
            width="6.8"
            height={fillHeight}
            rx="1"
            fill="var(--color-ink-warm)"
            opacity="0.8"
            style={{ transition: 'y 0.5s ease-out, height 0.5s ease-out' }}
          />
        )}
        {plinking && <circle cx="7" cy="3" r="1.4" fill="var(--color-ink-warm)" className="ink-plink" />}
      </svg>
    </span>
  )
})
