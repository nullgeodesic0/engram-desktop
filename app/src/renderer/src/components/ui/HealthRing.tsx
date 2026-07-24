import { memo } from 'react'

/** A topic's state at a glance: warm arc = consolidated fraction, danger
 * notch = reviews due. The Ink Plate's progress readout miniaturized to
 * every place a topic is named. */
export const HealthRing = memo(function HealthRing({
  consolidated,
  total,
  due,
  size = 22,
}: {
  consolidated: number
  total: number
  due: number
  size?: number
}) {
  const r = size / 2 - 2.5
  const c = 2 * Math.PI * r
  const fraction = total > 0 ? Math.min(1, consolidated / total) : 0
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <title>{`${consolidated}/${total} consolidated · ${due} due`}</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-hairline)" strokeWidth="2" />
      {fraction > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-ink-warm)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${fraction * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          opacity="0.9"
        />
      )}
      {due > 0 && <circle cx={size / 2} cy="2.5" r="2" fill="var(--color-ink-danger)" />}
    </svg>
  )
})
