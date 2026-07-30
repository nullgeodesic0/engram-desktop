import { useLayoutEffect, useRef } from 'react'
import type { WeekRetention } from '../../../../shared/types'

const WIDTH = 600
const HEIGHT = 140
const PAD_L = 34
const PAD_R = 8
const PAD_T = 10
const PAD_B = 22

// Compact variant — the Grades screen's Recall Accuracy subgrade tile needs
// this chart as supporting evidence beside a letter, not a full figure: no
// axis text (no room reserved for it), no caption (the tile already prints
// its own raw stat + description below), much shorter.
const COMPACT_HEIGHT = 56
const COMPACT_PAD_L = 4
const COMPACT_PAD_R = 4
const COMPACT_PAD_T = 4
const COMPACT_PAD_B = 4

function toneOf(rate: number): string {
  if (rate >= 0.85) return 'var(--color-ink-warm)'
  if (rate < 0.6) return 'var(--color-ink-danger)'
  return 'var(--color-ink-cool)'
}

/** Weekly recall-rate as a hand-drawn ink line — the Coach figure counterpart
 * to RetentionTrend's bar chart. Null-rate weeks (no reviews that week) break
 * the polyline instead of interpolating through them, so a gap in practice
 * reads as a real gap in the line, never a smoothed-over dip.
 *
 * `compact` — no axis text, no caption, ~1/2 the height: for embedding
 * beside a letter grade (Grades' Recall Accuracy subgrade tile) as
 * supporting evidence, not a standalone figure. */
export function RetentionCurve({ data, compact = false }: { data: WeekRetention[]; compact?: boolean }) {
  // Draw the line in once on mount, imperatively (no React state) so this
  // never re-fires on a later re-render with the same data — StrictMode's
  // dev double-mount just re-measures on the fresh mount, it doesn't replay
  // mid-mount. Skipped entirely under reduced motion: the path renders at its
  // final, fully-drawn state with no dasharray manipulation at all. Declared
  // before the empty-data early return below to keep hook order fixed.
  const pathRefs = useRef<(SVGPathElement | null)[]>([])
  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const paths = pathRefs.current.filter((el): el is SVGPathElement => el !== null)
    if (reduced) return
    paths.forEach((el) => {
      const len = el.getTotalLength()
      el.style.transition = 'none'
      el.style.strokeDasharray = `${len}`
      el.style.strokeDashoffset = `${len}`
    })
    const raf = requestAnimationFrame(() => {
      paths.forEach((el) => {
        el.style.transition = `stroke-dashoffset calc(var(--dur-base) * 2) var(--ease-out-soft)`
        el.style.strokeDashoffset = '0'
      })
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const active = data.filter((w) => w.total > 0)
  if (active.length === 0) {
    return compact ? null : <div className="fig-caption">Fig. — not enough reviews yet to chart a retention trend</div>
  }

  const height = compact ? COMPACT_HEIGHT : HEIGHT
  const padL = compact ? COMPACT_PAD_L : PAD_L
  const padR = compact ? COMPACT_PAD_R : PAD_R
  const padT = compact ? COMPACT_PAD_T : PAD_T
  const padB = compact ? COMPACT_PAD_B : PAD_B
  const innerW = WIDTH - padL - padR
  const innerH = height - padT - padB
  const n = data.length
  const toX = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const toY = (rate: number) => padT + (1 - rate) * innerH

  const segments: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] = []
  data.forEach((w, i) => {
    if (w.rate == null) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    current.push({ x: toX(i), y: toY(w.rate) })
  })
  if (current.length) segments.push(current)

  const gridlines = [0.85, 0.5]
  const avgRate = active.reduce((s, w) => s + (w.rate ?? 0), 0) / active.length

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Weekly recall rate, averaging ${Math.round(avgRate * 100)} percent over ${active.length} active weeks`}
      >
        {gridlines.map((g) => (
          <g key={g}>
            <line x1={padL} y1={toY(g)} x2={WIDTH - padR} y2={toY(g)} stroke="var(--color-hairline)" strokeWidth={1} strokeDasharray="2 3" />
            {!compact && (
              <text
                x={padL - 6}
                y={toY(g) + 3}
                textAnchor="end"
                className="label-data"
                style={{ fontSize: 9, fill: 'var(--color-text-dim)' }}
              >
                {Math.round(g * 100)}%
              </text>
            )}
          </g>
        ))}
        <line x1={padL} y1={toY(0)} x2={WIDTH - padR} y2={toY(0)} stroke="var(--color-hairline)" strokeWidth={1} />
        {!compact && (
          <text
            x={padL - 6}
            y={toY(0) + 3}
            textAnchor="end"
            className="label-data"
            style={{ fontSize: 9, fill: 'var(--color-text-dim)' }}
          >
            0%
          </text>
        )}

        {segments.map((seg, si) => (
          <path
            key={si}
            ref={(el) => {
              pathRefs.current[si] = el
            }}
            d={seg.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--color-ink-cool)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {data.map((w, i) =>
          w.rate == null ? null : <circle key={w.weekStart} cx={toX(i)} cy={toY(w.rate)} r={2.2} fill={toneOf(w.rate)} />,
        )}
      </svg>
      {!compact && (
        <div className="fig-caption">
          Fig. — weekly recall rate, <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(avgRate * 100)}%</span> average
          over {active.length} active week{active.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}
