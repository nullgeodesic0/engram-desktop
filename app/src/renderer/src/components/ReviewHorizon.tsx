import { memo } from 'react'
import { useChartHover } from './charts/useChartHover'
import { ChartTooltip } from './charts/ChartTooltip'

/** 14-day tick figure of upcoming returns — Review's answer to `DueForecast`,
 * built beside it rather than by generalizing it: DueForecast's day labels
 * key off `Date.getDay()` (Sun–Sat), which is already index-agnostic and
 * would happily take 14 buckets, but its caption vocabulary ("this week",
 * weekday-name peak) and its two callers' purposes diverge — Home's forecast
 * previews a schedule that's about to start mattering; this one is the ONLY
 * content of an empty-queue or just-finished surface, so the caption has to
 * carry more (a plain "when does this become true again" reading, plus the
 * holding count) without borrowing HomeView's "peak weekday" framing, which
 * doesn't make sense two weeks out. Keeping them separate also means Home's
 * forecast can't regress if this one's caption logic changes.
 *
 * `buckets`/`holdingCount` are computed once, together, in a single walk
 * over the topic graphs (see `computeReviewHorizon` in ReviewSessionView) —
 * this component only renders what it's given. */
export const ReviewHorizon = memo(function ReviewHorizon({
  buckets,
  holdingCount,
}: {
  /** 14 entries, bucket 0 = today, built from non-new nodes' `fsrs.due`. */
  buckets: number[]
  /** Nodes at `fsrs.s >= 21` days of stability — standing, not scheduling. */
  holdingCount: number
}) {
  const { hover, showHover, hideHover } = useChartHover<{ label: string; count: number }>()
  const max = Math.max(...buckets, 1)
  const total = buckets.reduce((a, b) => a + b, 0)

  // The caption's date is read off the SAME buckets the bars draw, not a
  // separately-fetched "earliest due" value — a figure and its own caption
  // must never be able to disagree about what's inside the fortnight.
  let nextIdx = -1
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i] > 0) {
      nextIdx = i
      break
    }
  }
  const today = new Date()
  const nextDate =
    nextIdx >= 0 ? new Date(today.getFullYear(), today.getMonth(), today.getDate() + nextIdx) : null
  const caption =
    total === 0 || !nextDate
      ? 'nothing scheduled inside two weeks'
      : `Fig. — the next wave lands ${nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  // RetentionCurve figure-mode's tick-text language, ported to a plain div layout.
  const tickLabel = { fontSize: 9, fill: 'var(--color-text-faint)' } as const

  return (
    <div className="panel px-4 py-3 flex flex-col gap-2 max-w-md">
      <div className="relative flex items-end gap-[3px] h-10 pl-5">
        {/* Left-edge numeric axis — a hairline plus top/bottom count ticks, so bar
            heights read against a real scale instead of pure relative-to-max. */}
        <div className="absolute left-3 top-0 bottom-0 w-px" style={{ background: 'var(--color-hairline)' }} />
        <span className="absolute left-0 -top-1 label-data leading-none" style={tickLabel}>
          {max}
        </span>
        <span className="absolute left-0 -bottom-1 label-data leading-none" style={tickLabel}>
          0
        </span>
        {buckets.map((count, i) => (
          <div
            key={i}
            onMouseEnter={(e) => showHover(e, { label: i === 0 ? 'today' : `+${i}d`, count })}
            onMouseLeave={hideHover}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${Math.max(count > 0 ? 10 : 3, (count / max) * 100)}%`,
              background: i === 0 ? 'var(--color-ink-warm)' : 'var(--color-ink-cool)',
              opacity: count > 0 ? 0.85 : 0.2,
            }}
          />
        ))}
      </div>
      <div className="fig-caption">{caption}</div>
      <div className="label-data text-[10px] text-[var(--color-text-faint)]">
        {holdingCount} {holdingCount === 1 ? 'node' : 'nodes'} holding at stability ≥ 21d
      </div>
      {hover && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="label-data text-[var(--color-text-faint)]">
            {hover.label}: {hover.count} due
          </div>
        </ChartTooltip>
      )}
    </div>
  )
})
