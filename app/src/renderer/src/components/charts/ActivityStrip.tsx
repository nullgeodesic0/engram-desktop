import type { DayActivity } from '../../../../shared/types'

const WIDTH = 600
const HEIGHT = 66
const PAD_L = 4
const PAD_R = 4
const PAD_T = 6
const BAR_AREA = 36
const LABEL_Y = HEIGHT - 4
const LABEL_STRIDE = 30 // ~30 days between month-initial labels, same cadence as StreakCalendar's month row

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

/** 180-day activity strip: one ink tick per day, height proportional to that
 * day's review count (capped to the run's own observed max, so a single
 * outlier day doesn't flatten every other tick to invisibility). Ticks parse
 * their date as UTC noon-anchored midnight, matching StreakCalendar/RetentionTrend's
 * existing convention for date-math on the `YYYY-MM-DD` receipt key — a
 * separate concern from the local-date pick↔grade join used elsewhere. */
export function ActivityStrip({ data }: { data: DayActivity[] }) {
  if (data.length === 0 || !data.some((d) => d.count > 0)) {
    // `data.length` is however many days the caller actually passed — the
    // full 180 by default, or a date-range control's narrower slice (Task 4).
    // Never a hardcoded "180" here: that would keep claiming the full window
    // even when a caller filtered it, exactly the "control that appears to
    // filter a number it doesn't" failure the range control exists to avoid.
    return <div className="fig-caption">Fig. — no activity in the last {data.length || 0} day{data.length === 1 ? '' : 's'}</div>
  }

  const n = data.length
  const innerW = WIDTH - PAD_L - PAD_R
  const tickW = innerW / n
  const max = Math.max(1, ...data.map((d) => d.count))
  const activeDays = data.filter((d) => d.count > 0).length
  const totalReviews = data.reduce((sum, d) => sum + d.count, 0)

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label={`${activeDays} active days, ${totalReviews} reviews over the last 180 days`}
      >
        <line x1={PAD_L} y1={PAD_T + BAR_AREA} x2={WIDTH - PAD_R} y2={PAD_T + BAR_AREA} stroke="var(--color-hairline)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = d.count > 0 ? Math.max(2, (d.count / max) * BAR_AREA) : 1
          const x = PAD_L + i * tickW
          const y = PAD_T + BAR_AREA - h
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={Math.max(1, tickW - 0.6)}
              height={h}
              fill={d.count > 0 ? 'var(--color-ink-warm)' : 'var(--color-hairline)'}
              className="tick-fade-in"
              // Stagger capped at 250ms across every tick, plus --dur-fast's
              // own 120ms — 370ms total, under the 400ms ceiling regardless
              // of how many days are in `data`.
              style={{ ['--tick-delay' as string]: `${(i / Math.max(1, n - 1)) * 250}ms` }}
            />
          )
        })}
        {data.map((d, i) => {
          if (i % LABEL_STRIDE !== 0) return null
          const dt = new Date(`${d.date}T00:00:00Z`)
          return (
            <text
              key={d.date}
              x={PAD_L + i * tickW}
              y={LABEL_Y}
              textAnchor="start"
              className="label-data"
              style={{ fontSize: 9, fill: 'var(--color-text-dim)' }}
            >
              {MONTH_INITIALS[dt.getUTCMonth()]}
            </text>
          )
        })}
      </svg>
      <div className="fig-caption">
        Fig. — <span style={{ fontVariantNumeric: 'tabular-nums' }}>{activeDays}</span> active day{activeDays === 1 ? '' : 's'},{' '}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalReviews}</span> review{totalReviews === 1 ? '' : 's'} over {n} day{n === 1 ? '' : 's'}
      </div>
    </div>
  )
}
