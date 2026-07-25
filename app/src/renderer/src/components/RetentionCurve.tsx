// The app's signature element: an actual FSRS retrievability curve, not a
// decorative sparkline. R(t) = (1 + 19/81 * t/s)^-0.5 is engram.py's own
// forgetting-curve formula (docs/`retrievability`) — this renders the real
// function for a node's current stability, not an invented visualization.
//
// Two renderings: the bare sparkline (default, inline contexts) and the
// `figure` mode — axes, gridlines, and tick labels in the Night Atlas
// scientific-plate style, for the map drawer/modal where the curve is a
// figure the reader studies rather than an accent.

interface RetentionCurveProps {
  stabilityDays: number | null
  horizonDays?: number
  width?: number
  height?: number
  className?: string
  /** Scientific-figure treatment: axes, grid, ticks, labels. */
  figure?: boolean
}

function retrievability(tDays: number, sDays: number): number {
  if (sDays <= 0) return 0
  return Math.pow(1 + (19 / 81) * (tDays / sDays), -0.5)
}

/** A tick-friendly round number ≈ n/3 (1/2/5 ladder) so the x-axis lands on
 * readable day counts regardless of the horizon. */
function niceStep(n: number): number {
  const raw = n / 3
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
  for (const m of [5, 2, 1]) {
    if (mag * m <= raw) return mag * m
  }
  return mag
}

export function RetentionCurve({
  stabilityDays,
  horizonDays,
  width = 120,
  height = 32,
  className = '',
  figure = false,
}: RetentionCurveProps) {
  if (stabilityDays == null || stabilityDays <= 0) {
    return (
      <svg width={width} height={height} className={className} aria-hidden="true">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--color-text-faint)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    )
  }

  const horizon = horizonDays ?? Math.max(stabilityDays * 3, 14)
  const samples = 36
  const points: [number, number][] = []
  for (let i = 0; i <= samples; i++) {
    const t = (horizon * i) / samples
    const r = retrievability(t, stabilityDays)
    points.push([t, r])
  }

  // Figure mode reserves margins for the axes and their labels.
  const padL = figure ? 26 : 2
  const padB = figure ? 14 : 2
  const padT = figure ? 4 : 2
  const padR = figure ? 6 : 2
  const toX = (t: number) => padL + (t / horizon) * (width - padL - padR)
  const toY = (r: number) => padT + (1 - r) * (height - padT - padB)

  const path = points.map(([t, r], i) => `${i === 0 ? 'M' : 'L'} ${toX(t).toFixed(1)} ${toY(r).toFixed(1)}`).join(' ')
  // The 90%-retention threshold (engram's desired_retention default) as a reference line.
  const thresholdY = toY(0.9)

  if (!figure) {
    return (
      <svg width={width} height={height} className={className} role="img" aria-label={`Retention curve, stability ${stabilityDays.toFixed(1)} days`}>
        <line x1={0} y1={thresholdY} x2={width} y2={thresholdY} stroke="var(--color-surface-3)" strokeWidth={1} />
        <path d={path} fill="none" stroke="var(--color-ink-warm)" strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    )
  }

  const axisX = padL
  const axisY = height - padB
  const xStep = niceStep(horizon)
  const xTicks: number[] = []
  for (let t = xStep; t <= horizon + 1e-6; t += xStep) xTicks.push(t)
  const yTicks = [0.5, 0.9, 1.0]
  const label = { fontSize: 7.5, fill: 'var(--color-text-faint)' } as const

  return (
    <svg
      width={width}
      height={height}
      className={`label-data ${className}`}
      role="img"
      aria-label={`Retention curve, stability ${stabilityDays.toFixed(1)} days over ${Math.round(horizon)} days`}
    >
      {/* Grid — horizontal at each R tick, vertical at each day tick. */}
      {yTicks.map((r) => (
        <line key={`gy${r}`} x1={axisX} y1={toY(r)} x2={width - padR} y2={toY(r)} stroke="var(--color-surface-2)" strokeWidth={1} />
      ))}
      {xTicks.map((t) => (
        <line key={`gx${t}`} x1={toX(t)} y1={padT} x2={toX(t)} y2={axisY} stroke="var(--color-surface-2)" strokeWidth={1} />
      ))}
      {/* The 90% desired-retention reference, distinct from plain grid. */}
      <line x1={axisX} y1={thresholdY} x2={width - padR} y2={thresholdY} stroke="var(--color-ink-warm-dim)" strokeWidth={1} strokeDasharray="3 3" />

      {/* Axes */}
      <line x1={axisX} y1={padT} x2={axisX} y2={axisY} stroke="var(--color-hairline)" strokeWidth={1} />
      <line x1={axisX} y1={axisY} x2={width - padR} y2={axisY} stroke="var(--color-hairline)" strokeWidth={1} />

      {/* Ticks + labels */}
      {yTicks.map((r) => (
        <g key={`ty${r}`}>
          <line x1={axisX - 3} y1={toY(r)} x2={axisX} y2={toY(r)} stroke="var(--color-hairline)" strokeWidth={1} />
          <text x={axisX - 5} y={toY(r) + 2.5} textAnchor="end" style={label}>
            {Math.round(r * 100)}%
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={`tx${t}`}>
          <line x1={toX(t)} y1={axisY} x2={toX(t)} y2={axisY + 3} stroke="var(--color-hairline)" strokeWidth={1} />
          <text x={toX(t)} y={axisY + 11} textAnchor="middle" style={label}>
            {Math.round(t)}d
          </text>
        </g>
      ))}

      <path d={path} fill="none" stroke="var(--color-ink-warm)" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}
