// The app's signature element: an actual FSRS retrievability curve, not a
// decorative sparkline. R(t) = (1 + 19/81 * t/s)^-0.5 is engram.py's own
// forgetting-curve formula (docs/`retrievability`) — this renders the real
// function for a node's current stability, not an invented visualization.

interface RetentionCurveProps {
  stabilityDays: number | null
  horizonDays?: number
  width?: number
  height?: number
  className?: string
}

function retrievability(tDays: number, sDays: number): number {
  if (sDays <= 0) return 0
  return Math.pow(1 + (19 / 81) * (tDays / sDays), -0.5)
}

export function RetentionCurve({
  stabilityDays,
  horizonDays,
  width = 120,
  height = 32,
  className = '',
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
  const samples = 24
  const points: [number, number][] = []
  for (let i = 0; i <= samples; i++) {
    const t = (horizon * i) / samples
    const r = retrievability(t, stabilityDays)
    points.push([t, r])
  }

  const pad = 2
  const toX = (t: number) => pad + (t / horizon) * (width - pad * 2)
  const toY = (r: number) => pad + (1 - r) * (height - pad * 2)

  const path = points.map(([t, r], i) => `${i === 0 ? 'M' : 'L'} ${toX(t).toFixed(1)} ${toY(r).toFixed(1)}`).join(' ')
  // The 90%-retention threshold (engram's desired_retention default) as a reference line.
  const thresholdY = toY(0.9)

  return (
    <svg width={width} height={height} className={className} role="img" aria-label={`Retention curve, stability ${stabilityDays.toFixed(1)} days`}>
      <line x1={0} y1={thresholdY} x2={width} y2={thresholdY} stroke="var(--color-surface-3)" strokeWidth={1} />
      <path d={path} fill="none" stroke="var(--color-ink-warm)" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}
