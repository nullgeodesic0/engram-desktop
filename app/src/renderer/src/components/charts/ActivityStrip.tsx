import type { DayActivity } from '../../../../shared/types'
import { useChartCursor } from './useChartCursor'

const WIDTH = 600
const HEIGHT = 50 // baseline + bars only; the month row is HTML beneath
const PAD_L = 4
const PAD_R = 4
const PAD_T = 6
const BAR_AREA = 36
const LABEL_STRIDE = 30 // ~30 days between month-initial labels, same cadence as StreakCalendar's month row

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

/** 180-day activity strip: one ink tick per day, height proportional to that
 * day's review count (capped to the run's own observed max, so a single
 * outlier day doesn't flatten every other tick to invisibility). Ticks parse
 * their date as UTC noon-anchored midnight, matching StreakCalendar/RetentionTrend's
 * existing convention for date-math on the `YYYY-MM-DD` receipt key — a
 * separate concern from the local-date pick↔grade join used elsewhere.
 *
 * Scrubbing, not hovering. Each tick used to carry its own mouseenter
 * tooltip, which at 180 ticks across 600 units means ~3 units of target per
 * day: a readout you had to aim for, floating in a popover, unreachable from
 * the keyboard. It is now one instrument in PlotCard's grammar (see
 * useChartCursor) — the pointer anywhere over the strip picks the nearest
 * day, a guide marks it, that tick goes hot, and the caption line beneath
 * becomes the readout. Arrow keys walk it day by day.
 */
export function ActivityStrip({ data }: { data: DayActivity[] }) {
  const { cursor, cursorProps } = useChartCursor(data.length, { left: PAD_L / WIDTH, right: PAD_R / WIDTH })

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

  const at = cursor === null ? null : data[cursor]
  const atLabel =
    at === null
      ? null
      : new Date(`${at.date}T00:00:00Z`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto focus-ring touch-none"
        role="img"
        aria-label={`${activeDays} active days, ${totalReviews} reviews over the last ${n} days`}
        {...cursorProps}
      >
        <line x1={PAD_L} y1={PAD_T + BAR_AREA} x2={WIDTH - PAD_R} y2={PAD_T + BAR_AREA} stroke="var(--color-hairline)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = d.count > 0 ? Math.max(2, (d.count / max) * BAR_AREA) : 1
          const x = PAD_L + i * tickW
          const y = PAD_T + BAR_AREA - h
          const hot = cursor === i
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={Math.max(1, tickW - 0.6)}
              height={h}
              fill={hot ? 'var(--color-ink-hot)' : d.count > 0 ? 'var(--color-ink-warm)' : 'var(--color-hairline)'}
              className="tick-fade-in"
              // Stagger capped at 250ms across every tick, plus --dur-fast's
              // own 120ms — 370ms total, under the 400ms ceiling regardless
              // of how many days are in `data`.
              style={{ ['--tick-delay' as string]: `${(i / Math.max(1, n - 1)) * 250}ms` }}
            />
          )
        })}
        {/* The guide, drawn over the ticks and under nothing — the same
            warm-dim hairline PlotCard's readout uses. */}
        {cursor !== null && (
          <path
            d={`M${(PAD_L + cursor * tickW + Math.max(1, tickW - 0.6) / 2).toFixed(2)} ${PAD_T - 3} V${PAD_T + BAR_AREA + 3}`}
            stroke="var(--color-ink-warm-dim)"
            strokeWidth="1"
            fill="none"
            pointerEvents="none"
          />
        )}
      </svg>
      {/* Month initials as HTML over the plot, not SVG <text>. The viewBox
          scales to the panel, so a 9-unit label renders around 21px in a wide
          window — larger than the fig-caption right beneath it. PlotCard
          established the overlay for its marker labels; same fix, same
          reason. */}
      <div className="relative h-3 -mt-1" aria-hidden="true">
        {data.map((d, i) => {
          if (i % LABEL_STRIDE !== 0) return null
          const dt = new Date(`${d.date}T00:00:00Z`)
          return (
            <span
              key={d.date}
              className="label-data absolute top-0 text-[9px] leading-none text-[var(--color-text-dim)]"
              style={{ left: `${(((PAD_L + i * tickW) / WIDTH) * 100).toFixed(3)}%` }}
            >
              {MONTH_INITIALS[dt.getUTCMonth()]}
            </span>
          )
        })}
      </div>
      {/* One caption slot, two jobs: the run's summary at rest, the scrubbed
          day while the cursor is on the strip. Never both — a readout that
          appears in a second line makes the block change height as the
          pointer crosses it. */}
      {at && atLabel ? (
        <div className="fig-caption text-[var(--color-ink-warm)]">
          Fig. — {atLabel}, <span style={{ fontVariantNumeric: 'tabular-nums' }}>{at.count}</span> review
          {at.count === 1 ? '' : 's'}
        </div>
      ) : (
        <div className="fig-caption">
          Fig. — <span style={{ fontVariantNumeric: 'tabular-nums' }}>{activeDays}</span> active day{activeDays === 1 ? '' : 's'},{' '}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalReviews}</span> review{totalReviews === 1 ? '' : 's'} over {n} day{n === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}
