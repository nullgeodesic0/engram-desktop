import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { DayActivity } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'

function levelColor(count: number, max: number): string {
  if (count === 0) return 'var(--color-surface-2)'
  const t = max > 0 ? count / max : 0
  if (t < 0.25) return 'var(--color-ink-cool-dim)'
  if (t < 0.5) return 'var(--color-ink-cool)'
  if (t < 0.75) return 'var(--color-ink-warm-dim)'
  return 'var(--color-ink-warm)'
}

function gradeColor(grade: string | null): string {
  if (grade === 'recalled') return 'var(--color-ink-warm)'
  if (grade === 'partial') return 'var(--color-ink-cool)'
  if (grade === 'lapsed') return 'var(--color-ink-danger)'
  return 'var(--color-text-faint)'
}

interface HoverState {
  day: DayActivity
  x: number
  y: number
}

/** GitHub-style contribution heatmap over the last ~180 days of receipts —
 * makes the streak visible as a shape, not just a number. Columns are weeks
 * (Mon-first), left-padded so the grid aligns on real calendar weeks. Hovering
 * a day shows a real breakdown (topic/node/grade), not just a bare tooltip
 * count; clicking hands the day up to the parent for a persistent detail view. */
export function StreakCalendar({ days, onSelectDay }: { days: DayActivity[]; onSelectDay?: (day: DayActivity) => void }) {
  const [hover, setHover] = useState<HoverState | null>(null)

  if (days.length === 0) return null

  const firstDate = new Date(`${days[0].date}T00:00:00Z`)
  const leadingBlank = (firstDate.getUTCDay() + 6) % 7 // days since Monday

  const cells: (DayActivity | null)[] = [...Array(leadingBlank).fill(null), ...days]
  const columns: (DayActivity | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) columns.push(cells.slice(i, i + 7))

  const max = Math.max(1, ...days.map((d) => d.count))

  // Month labels above the columns where the month actually changes — same
  // convention as GitHub's own contribution graph, so the grid reads as a real
  // calendar without needing to hover anything.
  const monthLabels: { colIndex: number; label: string }[] = []
  let lastMonth = -1
  columns.forEach((col, i) => {
    const firstDay = col.find((d): d is DayActivity => d !== null)
    if (!firstDay) return
    const d = new Date(`${firstDay.date}T00:00:00Z`)
    const month = d.getUTCMonth()
    if (month !== lastMonth) {
      monthLabels.push({ colIndex: i, label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) })
      lastMonth = month
    }
  })

  const activeDays = days.filter((d) => d.count > 0).length
  const totalReviews = days.reduce((sum, d) => sum + d.count, 0)

  return (
    <div className="relative overflow-x-auto">
      <div className="flex gap-[3px] mb-1" style={{ width: 'max-content' }}>
        {columns.map((_, i) => {
          const label = monthLabels.find((m) => m.colIndex === i)
          return (
            <div key={i} className="w-2.5 text-[9px] label-data text-[var(--color-text-faint)] shrink-0 overflow-visible whitespace-nowrap">
              {label?.label}
            </div>
          )
        })}
      </div>
      <div className="flex gap-[3px]" style={{ width: 'max-content' }}>
        {columns.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {col.map((day, j) =>
              day ? (
                <button
                  key={j}
                  onMouseEnter={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setHover({ day, x: r.left + r.width / 2, y: r.top })
                  }}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => day.count > 0 && onSelectDay?.(day)}
                  className={`focus-ring no-press w-2.5 h-2.5 rounded-[2px] ${day.count > 0 ? 'cursor-pointer' : 'cursor-default'}`}
                  style={{ background: levelColor(day.count, max) }}
                  aria-label={`${day.date}: ${day.count} reviews`}
                />
              ) : (
                <div key={j} className="w-2.5 h-2.5" />
              ),
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 text-xs text-[var(--color-text-dim)]">
        <span className="text-[var(--color-ink-warm)] font-medium">{activeDays}</span> active day{activeDays === 1 ? '' : 's'} ·{' '}
        <span className="text-[var(--color-ink-warm)] font-medium">{totalReviews}</span> review{totalReviews === 1 ? '' : 's'} in the
        last 180 days
      </div>

      {hover &&
        createPortal(
          // Portaled straight to <body> — an ancestor .panel's backdrop-filter (see
          // index.css) creates a new containing block for `position: fixed`
          // descendants, which was clipping/mispositioning this popover against the
          // panel's own box instead of the real viewport. Escaping the DOM ancestor
          // chain entirely is the actual fix, not a z-index bump.
          <div
            className="fixed z-50 panel-raised px-3 py-2 text-xs pointer-events-none -translate-x-1/2 -translate-y-full -mt-2"
            style={{ left: hover.x, top: hover.y }}
          >
            <div className="label-data text-[var(--color-text-faint)]">
              {hover.day.date} · {hover.day.count} review{hover.day.count === 1 ? '' : 's'}
            </div>
            {hover.day.items.length > 0 && (
              <div className="flex flex-col gap-0.5 mt-1.5 max-w-56">
                {hover.day.items.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: gradeColor(item.grade) }} />
                    <span className="text-[var(--color-text-dim)] truncate">{humanizeNodeId(item.node)}</span>
                  </div>
                ))}
                {hover.day.items.length > 5 && (
                  <div className="text-[var(--color-text-faint)]">+{hover.day.items.length - 5} more</div>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
