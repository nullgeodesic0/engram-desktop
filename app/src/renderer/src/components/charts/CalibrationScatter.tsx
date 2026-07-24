import type { DayActivity } from '../../../../shared/types'
import type { ConfidencePick } from '../../shared/calibrationStore'
import { seeded } from '../graph3d/layout'

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
 * mis-bucket evening picks for any non-UTC user. */
export function CalibrationScatter({ data }: { data: CalibrationScatterData }) {
  const itemsByDay = new Map(data.days.map((d) => [d.date, d.items]))

  const innerW = WIDTH - PAD_L - PAD_R
  const innerH = HEIGHT - PAD_T - PAD_B
  const rowY = { recalled: PAD_T + innerH * 0.22, lapsed: PAD_T + innerH * 0.78 }
  const slotW = innerW / 4
  const toX = (index: number) => PAD_L + (index + 0.5) * slotW

  const points: { x: number; y: number; recalled: boolean; key: string }[] = []
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
    if (!match || match.grade == null) return

    const recalled = match.grade === 'recalled'
    const feltSure = pick.index >= 2
    if (feltSure && !recalled) overconfident++
    else if (!feltSure && recalled) underconfident++
    else calibrated++

    const key = `${pick.topic}:${pick.node}:${pick.ts}:${idx}`
    // Deterministic jitter (seeded by the pick's own key) so overlapping picks
    // fan out into a legible cloud instead of stacking exactly on the row line,
    // without the scatter reshuffling itself on every re-render.
    const jitterX = (seeded(key, 1) - 0.5) * slotW * 0.7
    const jitterY = (seeded(key, 2) - 0.5) * innerH * 0.22
    const baseY = recalled ? rowY.recalled : rowY.lapsed
    points.push({ x: toX(pick.index) + jitterX, y: baseY + jitterY, recalled, key })
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
        {[0, 1, 2, 3].map((i) => (
          <text
            key={i}
            x={toX(i)}
            y={HEIGHT - PAD_B + 14}
            textAnchor="middle"
            className="label-data"
            style={{ fontSize: 9, fontVariantNumeric: 'tabular-nums', fill: 'var(--color-text-dim)' }}
          >
            {i}
          </text>
        ))}
        <text x={(PAD_L + WIDTH - PAD_R) / 2} y={HEIGHT - 2} textAnchor="middle" style={{ fontSize: 9, fill: 'var(--color-text-faint)' }}>
          felt confidence, low → high
        </text>
        {points.map((p) => (
          <circle
            key={p.key}
            cx={p.x}
            cy={p.y}
            r={2.6}
            fill={p.recalled ? 'var(--color-ink-warm)' : 'var(--color-ink-violet)'}
            fillOpacity={0.8}
          />
        ))}
      </svg>
      <div className="fig-caption">
        Fig. — confidence at pick time against graded outcome.{' '}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{total}</span> paired pick{total === 1 ? '' : 's'}, {read}
      </div>
    </div>
  )
}
