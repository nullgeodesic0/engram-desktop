import type { RawReceipt, TopicGraph } from '../../../shared/types'
import { computePressure, PACE_WINDOW_DAYS } from '../shared/pressure'
import { StatBlock } from './ui/StatBlock'

/** Local YYYY-MM-DD → "Mon d, yyyy" — parsed without a `Z` suffix (local-date
 * discipline, same as nodeDisplay.ts's formatMonthDay). Year-INCLUDING,
 * unlike that helper: a target date is set once and read back who-knows-how-
 * far in the future, so the year is real information here, not clutter. */
function formatFullDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** F4: a rate that rounds to "0.0/day" at one decimal reads as "nothing to
 * do," even when the figure it's paired with (e.g. Unencoded) is nonzero —
 * a real case on this machine: 1 node outstanding over 1000+ days computes
 * to 0.001/day, which `.toFixed(1)` alone would print as "0.0/day" beside
 * "Unencoded: 1". Any strictly-positive rate that would round to zero here
 * prints as "<0.1/day" instead, so the panel never asserts work remains in
 * one cell and zero pace in the next. */
function formatPace(perDay: number): string {
  if (perDay > 0 && perDay < 0.05) return '<0.1/day'
  return `${perDay.toFixed(1)}/day`
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
  // F3: `!targetDate` only catches null/undefined/''. A non-empty but
  // unparseable value (hand-edited or legacy `topic-settings.json`) parses to
  // an Invalid Date, propagates as NaN through daysRemaining, and without
  // this guard falls through to the "passed" branch below with a caption
  // reading "Invalid Date — NaN days ago." Same "no wrapper tells" rule as
  // the missing-targetDate case above: an unparseable date renders nothing,
  // not garbage.
  if (!targetDate || Number.isNaN(new Date(`${targetDate}T00:00:00`).getTime())) return null
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
    <div className="panel p-3 flex flex-col gap-2">
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
          value={p.requiredPace !== null ? formatPace(p.requiredPace) : '—'}
          tone="neutral"
          caption={requiredCaption}
        />
        <StatBlock
          compact
          label="Pace observed"
          value={p.observedPace ? formatPace(p.observedPace.perDay) : 'not enough history'}
          tone="neutral"
          caption={
            p.observedPace
              ? // Tightened from a ~82-char version that spelled out the full
                // date range ("20 nodes over 16 calendar days, Jul 12,
                // 2026–Jul 27, 2026, including days with none") — too long for
                // this compact StatBlock's ~88px cell inside a w-52 panel.
                // Keeps the one disclosure that matters (the denominator
                // counts idle days too, so this isn't an active-days rate)
                // and drops the exact date span, which the window length
                // already implies. F3: "nodes", not a bare count — this used
                // to read e.g. "19 over last 16d" (raw `encode` receipts),
                // which a reader parses as 19 concepts; it's now the actual
                // count of distinct nodes that left `new` in the window (see
                // pressure.ts's own F3 note), matching what "Unencoded"
                // above counts in.
                `${p.observedPace.nodesAdvanced} nodes over last ${p.observedPace.windowDays}d, incl. idle days`
              : `fewer than 3 distinct days of encoding in the last ${PACE_WINDOW_DAYS} days`
          }
        />
      </div>
    </div>
  )
}
