import { memo } from 'react'
import { useChartCursor } from './charts/useChartCursor'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const WIDTH = 600
const HEIGHT = 52
const PAD_L = 16 // the numeric axis gutter
const PAD_R = 4
const PAD_T = 6
const BAR_AREA = HEIGHT - PAD_T - 6
/** Bars occupy this much of their slot; the rest is air. At `flex-1` the bars
 * were ~190px blocks in a wide panel — "seven thin ink bars", as this file
 * has always described them, needs a bar that stays a stroke. Seven buckets
 * can never be the 3px tick the 180-day strip above draws, but a third of the
 * slot keeps them reading as ink on a scale rather than as tiles. */
const BAR_FILL = 0.32

/** Tomorrow's pull, visible today: seven ink bars of due counts over the
 * coming week (bucket 0 = today, overdue folded in). Computed renderer-side
 * from the topic graphs' own fsrs.due dates — the engine's `due` command has
 * no future horizon, but the graphs on disk already know.
 *
 * Drawn in ActivityStrip's grammar on purpose. These two charts sit stacked
 * inside one plate on Home, and they used to speak different languages: a
 * fine SVG tick strip on a hairline baseline above, chunky full-width HTML
 * divs below. Same viewBox idiom, same baseline, same caption register, so
 * the register reads as one instrument with two ranges.
 *
 * Axis labels are HTML positioned over the plot, never SVG `<text>`: the
 * viewBox scales to the panel, so a 9-unit label renders around 21px in a
 * wide window — bigger than the body copy beside it. PlotCard established
 * the overlay for its own marker labels; this is the same fix for the same
 * reason.
 *
 * The bars used to be anonymous — no axis labels at all, so which bar was
 * which could only be learned by hovering, and the line beneath was a fixed
 * "today N · peak Fri M" that never answered the day you were pointing at.
 * Now the plot is one scrubbing instrument (see useChartCursor): a guide
 * follows the pointer, the bar under it goes hot, the caption becomes the
 * readout for that day, and arrow keys do the same from the keyboard.
 */
export const DueForecast = memo(function DueForecast({ buckets }: { buckets: number[] }) {
  const n = buckets.length
  // Gutter as a fraction of the scaling viewBox — see useChartCursor.
  const { cursor, cursorProps } = useChartCursor(n, { left: PAD_L / WIDTH, right: PAD_R / WIDTH })
  const max = Math.max(...buckets, 1)
  const total = buckets.reduce((a, b) => a + b, 0)
  const today = new Date()
  const dayAt = (i: number): Date => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)

  if (total === 0) {
    return <div className="fig-caption">nothing scheduled this week — the frontier awaits</div>
  }

  let peakIdx = 0
  for (let i = 1; i < n; i++) if (buckets[i] > buckets[peakIdx]) peakIdx = i
  const flat = buckets.every((b) => b === buckets[0])

  const innerW = WIDTH - PAD_L - PAD_R
  const slotW = innerW / n
  const barW = slotW * BAR_FILL
  const centerOf = (i: number): number => PAD_L + i * slotW + slotW / 2
  // Percent of the box, so the HTML label row lands on the same centres the
  // SVG bars do at any panel width.
  const centerPct = (i: number): string => `${((centerOf(i) / WIDTH) * 100).toFixed(3)}%`

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto focus-ring touch-none"
          role="img"
          aria-label={`due over the coming week: ${buckets
            .map((c, i) => `${i === 0 ? 'today' : DAY_LABELS[dayAt(i).getDay()]} ${c}`)
            .join(', ')}`}
          {...cursorProps}
        >
          {/* Baseline and left scale — the same two hairlines the strip above
              draws, plus a vertical for the count axis. */}
          <line x1={PAD_L} y1={PAD_T + BAR_AREA} x2={WIDTH - PAD_R} y2={PAD_T + BAR_AREA} stroke="var(--color-hairline)" strokeWidth={1} />
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + BAR_AREA} stroke="var(--color-hairline)" strokeWidth={1} />

          {cursor !== null && (
            <path
              d={`M${centerOf(cursor).toFixed(2)} ${PAD_T - 3} V${PAD_T + BAR_AREA + 3}`}
              stroke="var(--color-ink-warm-dim)"
              strokeWidth="1"
              fill="none"
              pointerEvents="none"
            />
          )}

          {buckets.map((count, i) => {
            const h = count > 0 ? Math.max(2, (count / max) * BAR_AREA) : 1
            const hot = cursor === i
            return (
              <rect
                key={i}
                x={centerOf(i) - barW / 2}
                y={PAD_T + BAR_AREA - h}
                width={barW}
                height={h}
                fill={
                  hot
                    ? 'var(--color-ink-hot)'
                    : i === 0
                      ? 'var(--color-ink-warm)'
                      : count > 0
                        ? 'var(--color-ink-cool-dim)'
                        : 'var(--color-hairline)'
                }
              />
            )
          })}
        </svg>

        {/* Count ticks, as HTML for the same scaling reason as the day row. */}
        <span
          className="label-data absolute left-0 top-0 text-[9px] leading-none text-[var(--color-text-faint)] pointer-events-none"
          aria-hidden="true"
        >
          {max}
        </span>
        <span
          className="label-data absolute left-0 bottom-2 text-[9px] leading-none text-[var(--color-text-faint)] pointer-events-none"
          aria-hidden="true"
        >
          0
        </span>
      </div>

      {/* Day letters on the bars' own centres. Today stays inked so "you are
          here" survives without a second device. */}
      <div className="relative h-3" aria-hidden="true">
        {buckets.map((_, i) => (
          <span
            key={i}
            className="label-data absolute top-0 -translate-x-1/2 text-[9px] leading-none transition-colors duration-[var(--dur-fast)]"
            style={{
              left: centerPct(i),
              color: cursor === i || i === 0 ? 'var(--color-ink-warm)' : 'var(--color-text-faint)',
            }}
          >
            {DAY_INITIALS[dayAt(i).getDay()]}
          </span>
        ))}
      </div>

      {/* One caption slot, two jobs — summary at rest, the scrubbed day while
          the cursor is on the plot. Never both: a second line appearing would
          make the block change height as the pointer crosses it. */}
      {cursor === null ? (
        <div className="fig-caption">
          Fig. — today {buckets[0]}
          {!flat && peakIdx > 0 && ` · peak ${DAY_LABELS[dayAt(peakIdx).getDay()]} ${buckets[peakIdx]}`}
        </div>
      ) : (
        <div className="fig-caption text-[var(--color-ink-warm)]">
          Fig. — {cursor === 0 ? 'today' : DAY_LABELS[dayAt(cursor).getDay()]},{' '}
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{buckets[cursor]}</span> due
        </div>
      )}
    </div>
  )
})
