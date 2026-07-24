import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WeekRetention, DayActivity, ReceiptItem } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'

function barColor(rate: number | null): string {
  if (rate == null) return 'var(--color-surface-3)'
  if (rate >= 0.85) return 'var(--color-ink-warm)'
  if (rate < 0.6) return 'var(--color-ink-danger)'
  return 'var(--color-ink-cool)'
}

function gradeColor(grade: string | null): string {
  if (grade === 'recalled') return 'var(--color-ink-warm)'
  if (grade === 'partial') return 'var(--color-ink-cool)'
  if (grade === 'lapsed') return 'var(--color-ink-danger)'
  return 'var(--color-text-faint)'
}

/** Monday of the ISO week containing this date — mirrors main/engramCli/receiptsHistory.ts's
 * mondayOf() exactly, so a week bar's items line up with the week it actually represents. */
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = d.getUTCDay()
  const diff = (day + 6) % 7
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

interface HoverState {
  week: WeekRetention
  items: ReceiptItem[]
  x: number
  y: number
}

/** Weekly recall-rate rollup as a simple bar chart — a trend where the dashboard
 * previously only had a single point-in-time snapshot (stats.retention.buckets).
 * Hovering a bar shows the real items behind that week's rate; clicking hands the
 * week up to the parent for a persistent detail view. */
export function RetentionTrend({
  weeks,
  days,
  onSelectWeek,
}: {
  weeks: WeekRetention[]
  days: DayActivity[]
  onSelectWeek?: (weekStart: string, items: ReceiptItem[]) => void
}) {
  const [hover, setHover] = useState<HoverState | null>(null)

  const itemsByWeek = useMemo(() => {
    const m = new Map<string, ReceiptItem[]>()
    for (const day of days) {
      if (day.items.length === 0) continue
      const week = mondayOf(day.date)
      const list = m.get(week) ?? []
      list.push(...day.items)
      m.set(week, list)
    }
    return m
  }, [days])

  const active = weeks.filter((w) => w.total > 0)
  if (active.length === 0) {
    return <div className="text-xs text-[var(--color-text-faint)]">Not enough reviews yet to chart a trend.</div>
  }

  const avgRate = active.reduce((sum, w) => sum + (w.rate ?? 0), 0) / active.length
  const totalReviewed = active.reduce((sum, w) => sum + w.total, 0)

  // Sparse x-axis labels — every 4th week plus the last one, not all 26 (would be unreadable).
  const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-[var(--color-text-dim)]">
        <span className="font-medium" style={{ color: barColor(avgRate) }}>
          {Math.round(avgRate * 100)}%
        </span>{' '}
        avg recall · <span className="text-[var(--color-text-primary)] font-medium">{totalReviewed}</span> reviewed over{' '}
        {active.length} active week{active.length === 1 ? '' : 's'}
      </div>

      <div className="relative flex items-end gap-1 h-20">
        {/* Reference lines at the same 60%/85% thresholds that drive bar color, so the
            palette's meaning is legible without hovering anything. */}
        <div className="absolute inset-x-0 border-t border-dashed border-[var(--color-hairline)]" style={{ bottom: '85%' }}>
          <span className="absolute right-0 -top-3 text-[9px] label-data text-[var(--color-text-faint)]">85%</span>
        </div>
        <div className="absolute inset-x-0 border-t border-dashed border-[var(--color-hairline)]" style={{ bottom: '60%' }}>
          <span className="absolute right-0 -top-3 text-[9px] label-data text-[var(--color-text-faint)]">60%</span>
        </div>

        {weeks.map((w) => {
          const heightPct = w.rate != null ? Math.max(6, w.rate * 100) : 0
          const items = itemsByWeek.get(w.weekStart) ?? []
          return (
            <div key={w.weekStart} className="flex-1 flex flex-col justify-end h-full group relative">
              {w.total > 0 && (
                <button
                  onMouseEnter={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setHover({ week: w, items, x: r.left + r.width / 2, y: r.top })
                  }}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelectWeek?.(w.weekStart, items)}
                  className="focus-ring no-press w-full rounded-t-sm cursor-pointer transition-opacity group-hover:opacity-80"
                  style={{ height: `${heightPct}%`, background: barColor(w.rate), minHeight: 3 }}
                  aria-label={`Week of ${w.weekStart}: ${Math.round((w.rate ?? 0) * 100)}% recall`}
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-1">
        {weeks.map((w, i) => (
          <div key={w.weekStart} className="flex-1 text-center text-[9px] label-data text-[var(--color-text-faint)] whitespace-nowrap overflow-visible">
            {(i % 4 === 0 || i === weeks.length - 1) && shortDate(w.weekStart)}
          </div>
        ))}
      </div>

      {hover &&
        createPortal(
          // Portaled straight to <body> — same reasoning as StreakCalendar's popover:
          // an ancestor .panel's backdrop-filter creates a new containing block for
          // `position: fixed` descendants, clipping/mispositioning this against the
          // panel's own box instead of the real viewport.
          <div
            className="fixed z-50 panel-raised px-3 py-2 text-xs pointer-events-none -translate-x-1/2 -translate-y-full -mt-2"
            style={{ left: hover.x, top: hover.y }}
          >
            <div className="label-data text-[var(--color-text-faint)]">
              Week of {hover.week.weekStart} · {Math.round((hover.week.rate ?? 0) * 100)}% recall (n={hover.week.total})
            </div>
            {hover.items.length > 0 && (
              <div className="flex flex-col gap-0.5 mt-1.5 max-w-56">
                {hover.items.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: gradeColor(item.grade) }} />
                    <span className="text-[var(--color-text-dim)] truncate">{humanizeNodeId(item.node)}</span>
                  </div>
                ))}
                {hover.items.length > 5 && <div className="text-[var(--color-text-faint)]">+{hover.items.length - 5} more</div>}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
