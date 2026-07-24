import type { WeekRetention } from '../../../../shared/types'

const WIDTH = 600
const HEIGHT = 140
const PAD_L = 34
const PAD_R = 8
const PAD_T = 10
const PAD_B = 22

function toneOf(rate: number): string {
  if (rate >= 0.85) return 'var(--color-ink-warm)'
  if (rate < 0.6) return 'var(--color-ink-danger)'
  return 'var(--color-ink-cool)'
}

/** Weekly recall-rate as a hand-drawn ink line — the Coach figure counterpart
 * to RetentionTrend's bar chart. Null-rate weeks (no reviews that week) break
 * the polyline instead of interpolating through them, so a gap in practice
 * reads as a real gap in the line, never a smoothed-over dip. */
export function RetentionCurve({ data }: { data: WeekRetention[] }) {
  const active = data.filter((w) => w.total > 0)
  if (active.length === 0) {
    return <div className="fig-caption">Fig. — not enough reviews yet to chart a retention trend</div>
  }

  const innerW = WIDTH - PAD_L - PAD_R
  const innerH = HEIGHT - PAD_T - PAD_B
  const n = data.length
  const toX = (i: number) => PAD_L + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const toY = (rate: number) => PAD_T + (1 - rate) * innerH

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
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Weekly recall rate, averaging ${Math.round(avgRate * 100)} percent over ${active.length} active weeks`}
      >
        {gridlines.map((g) => (
          <g key={g}>
            <line x1={PAD_L} y1={toY(g)} x2={WIDTH - PAD_R} y2={toY(g)} stroke="var(--color-hairline)" strokeWidth={1} strokeDasharray="2 3" />
            <text
              x={PAD_L - 6}
              y={toY(g) + 3}
              textAnchor="end"
              className="label-data"
              style={{ fontSize: 9, fill: 'var(--color-text-dim)' }}
            >
              {Math.round(g * 100)}%
            </text>
          </g>
        ))}
        <line x1={PAD_L} y1={toY(0)} x2={WIDTH - PAD_R} y2={toY(0)} stroke="var(--color-hairline)" strokeWidth={1} />
        <text
          x={PAD_L - 6}
          y={toY(0) + 3}
          textAnchor="end"
          className="label-data"
          style={{ fontSize: 9, fontVariantNumeric: 'tabular-nums', fill: 'var(--color-text-dim)' }}
        >
          0%
        </text>

        {segments.map((seg, si) => (
          <path
            key={si}
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
      <div className="fig-caption">
        Fig. — weekly recall rate, <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(avgRate * 100)}%</span> average
        over {active.length} active week{active.length === 1 ? '' : 's'}
      </div>
    </div>
  )
}
