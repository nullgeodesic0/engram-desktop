import { secondsForTopic, type PaceModel } from '../../../shared/sittingPace'

/** Geometry for the sitting ruler — the queue laid out as a time axis.
 *
 * The Review landing page knew every fact needed to plan a sitting (each
 * item's measured cost at this learner's own per-topic pace, the overdue age,
 * the engine's triage order) and delivered all of it as five stacked prose
 * captions. You had to read them in sequence to answer one question: if I sit
 * for N minutes, what actually gets done? This turns that into a shape — every
 * item is a segment whose WIDTH is its real cost, so a 14-minute stat-mech
 * item is visibly seven times a 2-minute one, and the budget is a line you
 * move across them.
 *
 * NARROW INPUT BY DESIGN. `DueItem` carries `probe`, `claim` and `rubric` —
 * the three fields the D4 answer-leak gate watches — and this module takes a
 * structural subset that names none of them. Not a formality: the ready-room
 * must never see a probe before the learner has chosen to sit down (reading
 * the question early IS rehearsal), and a type that cannot express the answer
 * is a stronger guarantee than a rule saying don't look.
 *
 * Arithmetic only, no React and no I/O — same split as sittingPace.ts.
 */

export interface RulerItem {
  topic: string
  id: string
  overdue_days?: number
}

export interface RulerSegment {
  id: string
  topic: string
  /** Position along the ruler, as a fraction of the whole queue's cost. */
  start: number
  end: number
  /** This item's own predicted cost. */
  seconds: number
  /** Cumulative seconds through the END of this item — the budget you would
   * need for the sitting to include it. */
  throughSeconds: number
  overdueDays: number
  /** False when the pace came from the overall median or the bare default
   * rather than this topic's own history, so the caller can mark a width it
   * is less sure of. */
  measured: boolean
  /** Inside the current budget. */
  inside: boolean
}

export interface Ruler {
  segments: RulerSegment[]
  /** Total predicted cost of the whole queue, seconds. */
  totalSeconds: number
  /** Where the budget line sits, as a fraction of the ruler. */
  boundary: number
  /** How many items fall inside the budget. */
  items: number
  /** Predicted cost of just those items. */
  plannedSeconds: number
  /** True when even the first item alone overruns the budget — the sitting
   * still offers it (refusing to serve anything because the honest estimate
   * is too long would turn a good estimate into a locked door), and the
   * caller says so. */
  overruns: boolean
}

export function buildRuler(items: RulerItem[], pace: PaceModel | null, budgetMins: number): Ruler {
  const budget = Math.max(0, budgetMins) * 60
  const segments: RulerSegment[] = []
  let cursor = 0
  for (const item of items) {
    const cost = pace ? secondsForTopic(pace, item.topic) : null
    const seconds = cost?.seconds ?? 60
    cursor += seconds
    segments.push({
      id: item.id,
      topic: item.topic,
      start: 0,
      end: 0,
      seconds,
      throughSeconds: cursor,
      overdueDays: item.overdue_days ?? 0,
      measured: cost?.basis === 'topic',
      inside: false,
    })
  }
  const totalSeconds = cursor
  if (totalSeconds <= 0) {
    return { segments: [], totalSeconds: 0, boundary: 0, items: 0, plannedSeconds: 0, overruns: false }
  }

  // Second pass now that the total is known. `inside` mirrors planSitting's
  // own rule exactly — walk in engine order, stop when the budget is spent —
  // so the ruler and the estimate printed beside it can never disagree.
  let planned = 0
  let count = 0
  for (const s of segments) {
    s.start = (s.throughSeconds - s.seconds) / totalSeconds
    s.end = s.throughSeconds / totalSeconds
    if (count === 0 || planned + s.seconds <= budget) {
      planned += s.seconds
      count++
      s.inside = true
    }
  }
  // planSitting always serves at least one item; if that one already exceeds
  // the budget, the caller is told rather than the item being hidden.
  const overruns = planned > budget

  return {
    segments,
    totalSeconds,
    boundary: Math.min(1, budget / totalSeconds),
    items: count,
    plannedSeconds: planned,
    overruns,
  }
}

/** Snap a dragged position to the nearest item edge, and return the budget in
 * MINUTES that lands there.
 *
 * Snapping is not a nicety. A budget that stops halfway through an item is a
 * number that cannot happen — the sitting either serves that item or it does
 * not — so letting the handle rest there would show a boundary the sitting
 * would not honour. Edges only, and the returned minutes are exactly the cost
 * of everything up to that edge.
 */
export function snapToItem(ruler: Ruler, fraction: number): number {
  if (ruler.segments.length === 0 || ruler.totalSeconds <= 0) return 0
  const target = Math.max(0, Math.min(1, fraction)) * ruler.totalSeconds
  let best = ruler.segments[0]
  let bestDist = Math.abs(best.throughSeconds - target)
  for (const s of ruler.segments) {
    const d = Math.abs(s.throughSeconds - target)
    if (d < bestDist) {
      bestDist = d
      best = s
    }
  }
  return Math.max(1, Math.round(best.throughSeconds / 60))
}

/** The budget one item further in (`+1`) or back (`-1`) — the keyboard path,
 * so the ruler is not a pointer-only control. */
export function stepBudget(ruler: Ruler, direction: 1 | -1): number {
  if (ruler.segments.length === 0) return 0
  const next = Math.max(1, Math.min(ruler.segments.length, ruler.items + direction))
  return Math.max(1, Math.round(ruler.segments[next - 1].throughSeconds / 60))
}
