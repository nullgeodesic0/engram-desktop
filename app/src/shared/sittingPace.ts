/** How long a review item actually takes THIS learner, per topic.
 *
 * The app has always answered "how many items fit in N minutes" from a fixed
 * table — `TIME_CAPS = {5: 5, 10: 12, 25: 24}`, i.e. about a minute an item,
 * the same for every subject. Measured against this learner's own 28 sittings
 * with rate calls, that is wrong by roughly 5×, and wrong by DIFFERENT amounts
 * per topic:
 *
 *     long-form-humanities        11.0 min/item   (n=4)
 *     grad-quantum-mechanics           7.7 min/item   (n=10)
 *     derivatives-product-mechanics    5.1 min/item   (n=8)
 *     grad-classical-mechanics         5.0 min/item   (n=41)
 *     smoke-test-topic                 0.9 min/item   (n=2)
 *     ── all ──                        5.0 min/item   (n=69)
 *
 * So "5 minutes" served five items and cost about twenty-five, and a single
 * Lenin item alone outran the whole budget. A graduate derivation and a
 * vocabulary fact are not the same unit of work, and pretending they are makes
 * the one number the learner is given for planning actively misleading.
 *
 * This module holds the arithmetic and none of the I/O: samples in, a model
 * and a plan out, so every rule below is testable without a transcript.
 *
 * MEDIAN, NOT MEAN. Wall-clock between two rate calls includes whatever the
 * learner did in between — a coffee, a phone call, a look out of the window.
 * Those land in the tail, and a mean chases them; a median ignores them. The
 * scanner also discards gaps over 20 minutes outright as breaks rather than
 * items. */

export interface PaceSample {
  topic: string
  seconds: number
}

export interface TopicPace {
  topic: string
  medianSeconds: number
  samples: number
}

export interface PaceModel {
  byTopic: Record<string, TopicPace>
  /** Median across every sample, whatever its topic — the fallback for a
   * topic with too little history of its own. */
  overallMedianSeconds: number | null
  totalSamples: number
}

/** Below this, a topic's own median is noise and the overall median is the
 * better estimate. Three is low, deliberately: waiting for statistical
 * comfort would mean months of a wrong number for a new topic, and the
 * overall median is itself only a fallback. */
const MIN_TOPIC_SAMPLES = 3

/** What to assume with no history at all. Kept at the app's historical
 * assumption so a first-run learner sees exactly today's behaviour rather
 * than a number invented here. */
export const DEFAULT_SECONDS_PER_ITEM = 60

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

export function buildPaceModel(samples: PaceSample[]): PaceModel {
  const grouped = new Map<string, number[]>()
  for (const s of samples) {
    if (!Number.isFinite(s.seconds) || s.seconds <= 0) continue
    const list = grouped.get(s.topic)
    if (list) list.push(s.seconds)
    else grouped.set(s.topic, [s.seconds])
  }
  const byTopic: Record<string, TopicPace> = {}
  for (const [topic, xs] of grouped) {
    byTopic[topic] = { topic, medianSeconds: median(xs), samples: xs.length }
  }
  const all = [...grouped.values()].flat()
  return {
    byTopic,
    overallMedianSeconds: all.length > 0 ? median(all) : null,
    totalSamples: all.length,
  }
}

/** The seconds to budget for one item of `topic`, and how that was arrived
 * at — the caller shows the basis, because a number the learner cannot
 * account for is one they cannot trust. */
export function secondsForTopic(
  model: PaceModel,
  topic: string,
): { seconds: number; basis: 'topic' | 'overall' | 'default' } {
  const t = model.byTopic[topic]
  if (t && t.samples >= MIN_TOPIC_SAMPLES) return { seconds: t.medianSeconds, basis: 'topic' }
  if (model.overallMedianSeconds !== null) return { seconds: model.overallMedianSeconds, basis: 'overall' }
  return { seconds: DEFAULT_SECONDS_PER_ITEM, basis: 'default' }
}

export interface FitPlan {
  /** How many of the given items fit the budget. Never zero — see below. */
  items: number
  /** What those items are predicted to cost, in seconds. */
  predictedSeconds: number
  /** True when even ONE item overruns the budget. The sitting still offers
   * that item: refusing to serve anything because the honest estimate is too
   * long would turn a good estimate into a locked door. The caller says so
   * instead. */
  overruns: boolean
}

/** Walk the due queue IN ENGINE ORDER, charging each item its own topic's
 * pace, and stop when the budget is spent.
 *
 * Order matters and is not ours to change: the engine sequences by savings,
 * and this only decides where to draw the line. A mixed queue therefore gets
 * a mixed estimate — three quantum items and one vocabulary item cost what
 * those four actually cost, not four times an average. */
export function planSitting(minutes: number, dueTopics: string[], model: PaceModel): FitPlan {
  const budget = minutes * 60
  let spent = 0
  let items = 0
  for (const topic of dueTopics) {
    const { seconds } = secondsForTopic(model, topic)
    if (items > 0 && spent + seconds > budget) break
    spent += seconds
    items++
  }
  if (items === 0 && dueTopics.length > 0) {
    // Budget smaller than the first item: still offer it, and be honest.
    const { seconds } = secondsForTopic(model, dueTopics[0])
    return { items: 1, predictedSeconds: seconds, overruns: true }
  }
  return { items, predictedSeconds: spent, overruns: spent > budget }
}

/** Round to something a person would say out loud. */
export function humanMinutes(seconds: number): string {
  const mins = seconds / 60
  if (mins < 1) return 'under a minute'
  if (mins < 10) return `${Math.round(mins)} min`
  return `${Math.round(mins / 5) * 5} min`
}


/** The three budgets to offer, derived from what THIS queue actually costs.
 *
 * Fixed 5/10/25 answered a question nobody asked. With 18 items due at ~4
 * minutes each, the real quantity is 70-odd minutes, and none of the three
 * options related to it: the largest cleared a third of the queue while
 * claiming to be the long one, and there was no "finish this" at all.
 *
 * So the options are a quarter, a half, and the whole thing — rounded to
 * five-minute steps, because nobody plans in 37s, and deduplicated so a short
 * queue offers two options or one rather than three that mean the same.
 * Ascending, always at least one.
 *
 * The largest is always the FULL clear. That is the number a learner most
 * needs and never had: what it would actually take to be done. */
export function sittingOptions(totalSeconds: number): number[] {
  const round5 = (mins: number): number => Math.max(5, Math.round(mins / 5) * 5)
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return [5, 10, 25]
  const full = round5(totalSeconds / 60)
  const opts = [round5(full / 4), round5(full / 2), full]
  return [...new Set(opts)].sort((a, b) => a - b)
}

/** Snap a remembered choice onto the offered set, so a budget stored before
 * the queue changed still shows as selected instead of silently selecting
 * nothing. */
export function nearestOption(mins: number, options: number[]): number {
  if (options.length === 0) return mins
  return options.reduce((a, b) => (Math.abs(b - mins) < Math.abs(a - mins) ? b : a))
}
