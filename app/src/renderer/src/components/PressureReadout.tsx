import type { RawReceipt, TopicGraph } from '../../../shared/types'
import { computePressure } from '../shared/pressure'
import { StatBlock } from './ui/StatBlock'

/** Local YYYY-MM-DD → "Mon d, yyyy" — parsed without a `Z` suffix (local-date
 * discipline, same as nodeDisplay.ts's formatMonthDay). Year-INCLUDING,
 * unlike that helper: a target date is set once and read back who-knows-how-
 * far in the future, so the year is real information here, not clutter. */
function formatFullDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Exam / deadline mode's pressure figure — hidden entirely when the topic
 * has no `targetDate` set (no wrapper tells: nothing renders, not an empty
 * panel). Every number here is a fact about what remains and what's been
 * observed; see pressure.ts's own doc comments for the arithmetic and
 * shared/pressure.ts's module comment for why the denominator is calendar
 * days elapsed, not active days. No red, no "behind," no urging — a
 * deadline the learner set for themselves is information, not a lever.
 */
export function PressureReadout({
  graph,
  receipts,
  targetDate,
}: {
  graph: TopicGraph
  receipts: readonly RawReceipt[]
  targetDate: string | null | undefined
}) {
  if (!targetDate) return null
  const p = computePressure(graph, receipts, targetDate)

  const remainingCaption =
    p.daysRemaining > 0
      ? `until ${formatFullDate(p.targetDate)}`
      : p.daysRemaining === 0
        ? `${formatFullDate(p.targetDate)} is today`
        : `${formatFullDate(p.targetDate)} — ${Math.abs(p.daysRemaining)} day${Math.abs(p.daysRemaining) === 1 ? '' : 's'} ago`

  const requiredCaption =
    p.requiredPace !== null
      ? `${p.nodesRemaining} unencoded ÷ ${p.daysRemaining} day${p.daysRemaining === 1 ? '' : 's'} left`
      : p.nodesRemaining === 0
        ? 'nothing left to encode'
        : p.daysRemaining <= 0
          ? 'no days remain to spread it over'
          : undefined

  return (
    <div className="panel p-3 flex flex-col gap-2 bg-[var(--color-surface)]/90 backdrop-blur">
      <div className="fig-caption">Fig. — exam mode</div>
      <div className="grid grid-cols-2 gap-2">
        <StatBlock compact label="Unencoded" value={String(p.nodesRemaining)} tone="cool" />
        <StatBlock
          compact
          label="Days left"
          value={p.daysRemaining > 0 ? String(p.daysRemaining) : p.daysRemaining === 0 ? 'today' : 'passed'}
          tone="neutral"
          caption={remainingCaption}
        />
        <StatBlock
          compact
          label="Pace needed"
          value={p.requiredPace !== null ? `${p.requiredPace.toFixed(1)}/day` : '—'}
          tone="neutral"
          caption={requiredCaption}
        />
        <StatBlock
          compact
          label="Pace observed"
          value={p.observedPace ? `${p.observedPace.perDay.toFixed(1)}/day` : 'not enough history'}
          tone="neutral"
          caption={
            p.observedPace
              ? `${p.observedPace.totalEncodes} encoded over ${p.observedPace.windowDays} calendar days, ` +
                `${formatFullDate(p.observedPace.windowStart)}–${formatFullDate(p.observedPace.windowEnd)}, ` +
                `including days with none`
              : `fewer than 3 distinct days of encoding so far`
          }
        />
      </div>
    </div>
  )
}
