import type { DayActivity } from '../../../../shared/types'
import { feltSure, confidenceRank, type ConfidencePick } from '../../shared/calibrationStore'
import { seeded } from '../graph3d/layout'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { useChartHover } from './useChartHover'
import { ChartTooltip } from './ChartTooltip'

/** X-axis tick labels by ascending confidence RANK (confidenceRank's own
 * order: 0 = Just guessing … 3 = Certain) — the picker's real band names,
 * not bare index numbers, so the axis states what a position means. */
const RANK_LABELS = ['just guessing', 'half unsure', 'pretty sure', 'certain'] as const

const WIDTH = 600
const HEIGHT = 150
const PAD_L = 60
const PAD_R = 16
const PAD_T = 14
const PAD_B = 24

export interface CalibrationScatterData {
  picks: ConfidencePick[]
  days: DayActivity[]
}

/** Confidence-pick vs. graded-outcome scatter — the only figure where a felt
 * sense (calibrationStore's picks) meets the assessor's own grade
 * (receiptsHistory). Joined by topic+node+LOCAL calendar date, mirroring the
 * identical join in DashboardView's Calibration section: picks carry a JS
 * timestamp, receipts are keyed by the engine's local `date.today()`, so this
 * must use getFullYear/Month/Date — never toISOString, which would silently
 * mis-bucket evening picks for any non-UTC user. Shared rule with that same
 * join: a matched receipt with a null grade (pending/ungraded) still counts —
 * as not recalled — rather than being dropped, so this figure's point count
 * and read never disagree with the StatBlocks above it. */
export function CalibrationScatter({ data }: { data: CalibrationScatterData }) {
  const { hover, showHover, hideHover } = useChartHover<{
    node: string
    topic: string
    label: string
    recalled: boolean
  }>()
  const itemsByDay = new Map(data.days.map((d) => [d.date, d.items]))

  const innerW = WIDTH - PAD_L - PAD_R
  const innerH = HEIGHT - PAD_T - PAD_B
  const rowY = { recalled: PAD_T + innerH * 0.22, lapsed: PAD_T + innerH * 0.78 }
  const slotW = innerW / 4
  const toX = (index: number) => PAD_L + (index + 0.5) * slotW

  const points: {
    x: number
    y: number
    recalled: boolean
    key: string
    node: string
    topic: string
    label: string
  }[] = []
  let overconfident = 0
  let underconfident = 0
  let calibrated = 0

  data.picks.forEach((pick, idx) => {
    if (pick.index === undefined) return
    // See the identical comment in DashboardView: local date, never toISOString.
    const d = new Date(pick.ts)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const items = itemsByDay.get(day)
    if (!items) return
    const match = items.find((it) => it.topic === pick.topic && it.node === pick.node)
    if (!match) return

    const recalled = match.grade === 'recalled'
    // Via the store's own classifier — the picker is most-confident-FIRST
    // (index 0 = Certain), so the raw `>= 2` this replaces both swapped the
    // over/underconfident tallies AND plotted Certain picks at the axis's
    // "low" end (the flipped x-axis caught live on Coach).
    const sure = feltSure(pick.index)
    if (sure && !recalled) overconfident++
    else if (!sure && recalled) underconfident++
    else calibrated++

    const key = `${pick.topic}:${pick.node}:${pick.ts}:${idx}`
    // Deterministic jitter (seeded by the pick's own key) so overlapping picks
    // fan out into a legible cloud instead of stacking exactly on the row line,
    // without the scatter reshuffling itself on every re-render.
    const jitterX = (seeded(key, 1) - 0.5) * slotW * 0.7
    const jitterY = (seeded(key, 2) - 0.5) * innerH * 0.22
    const baseY = recalled ? rowY.recalled : rowY.lapsed
    points.push({
      // confidenceRank, not the raw index — ascending confidence must move
      // RIGHT to match the "low → high" axis caption.
      x: toX(confidenceRank(pick.index)) + jitterX,
      y: baseY + jitterY,
      recalled,
      key,
      node: pick.node,
      topic: pick.topic,
      label: pick.label,
    })
  })

  if (points.length === 0) {
    return <div className="fig-caption">Fig. — no paired picks yet</div>
  }

  const total = overconfident + underconfident + calibrated
  const read =
    overconfident > underconfident * 1.3
      ? 'running overconfident — felt sure more often than the grade backed up'
      : underconfident > overconfident * 1.3
        ? 'running underconfident — graded recalled more often than it felt'
        : 'roughly well-calibrated'

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Confidence versus outcome, ${total} paired picks, ${read}`}
      >
        <line x1={PAD_L} y1={rowY.recalled} x2={WIDTH - PAD_R} y2={rowY.recalled} stroke="var(--color-hairline)" strokeWidth={1} strokeDasharray="2 3" />
        <line x1={PAD_L} y1={rowY.lapsed} x2={WIDTH - PAD_R} y2={rowY.lapsed} stroke="var(--color-hairline)" strokeWidth={1} strokeDasharray="2 3" />
        <text x={PAD_L - 8} y={rowY.recalled + 3} textAnchor="end" className="label-data" style={{ fontSize: 9, fill: 'var(--color-text-dim)' }}>
          recalled
        </text>
        <text x={PAD_L - 8} y={rowY.lapsed + 3} textAnchor="end" className="label-data" style={{ fontSize: 9, fill: 'var(--color-text-dim)' }}>
          lapsed
        </text>
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={HEIGHT - PAD_B} stroke="var(--color-hairline)" strokeWidth={1} />
        <line x1={PAD_L} y1={HEIGHT - PAD_B} x2={WIDTH - PAD_R} y2={HEIGHT - PAD_B} stroke="var(--color-hairline)" strokeWidth={1} />
        {RANK_LABELS.map((bandLabel, rank) => (
          <text
            key={bandLabel}
            x={toX(rank)}
            y={HEIGHT - PAD_B + 14}
            textAnchor="middle"
            className="label-data"
            style={{ fontSize: 9, fill: 'var(--color-text-dim)' }}
          >
            {bandLabel}
          </text>
        ))}
        <text x={(PAD_L + WIDTH - PAD_R) / 2} y={HEIGHT - 2} textAnchor="middle" style={{ fontSize: 9, fill: 'var(--color-text-faint)' }}>
          felt confidence, low → high
        </text>
        <g className="scatter-fade-in">
          {points.map((p) => (
            <circle
              key={p.key}
              cx={p.x}
              cy={p.y}
              r={2.6}
              fill={p.recalled ? 'var(--color-ink-warm)' : 'var(--color-ink-violet)'}
              fillOpacity={0.8}
              onMouseEnter={(e) => showHover(e, { node: p.node, topic: p.topic, label: p.label, recalled: p.recalled })}
              onMouseLeave={hideHover}
            />
          ))}
        </g>
      </svg>
      <div className="fig-caption">
        Fig. — confidence at pick time against graded outcome.{' '}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{total}</span> paired pick{total === 1 ? '' : 's'}, {read}
      </div>
      {hover && (
        <ChartTooltip x={hover.x} y={hover.y}>
          <div className="label-data text-[var(--color-text-faint)]">
            {humanizeNodeId(hover.node)} · {hover.topic}
          </div>
          <div className="text-[var(--color-text-dim)] mt-0.5">
            felt “{hover.label}” · {hover.recalled ? 'recalled' : 'lapsed'}
          </div>
        </ChartTooltip>
      )}
    </div>
  )
}
