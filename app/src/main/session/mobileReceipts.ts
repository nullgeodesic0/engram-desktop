import { readReceiptsHistory, type RawReceipt } from '../engramCli/receiptsHistory'
import { PHONE_SOURCE_STAMPS } from '../../shared/linkProtocol'
import { arcPrefixesOf, humanizeWithArcs } from '../../shared/humanizeId'
import { engramRead, readTopicGraph } from '../engramCli/readOnly'
import {
  computeTopicGrade,
  type GradeComponentKey,
} from '../../renderer/src/shared/topicGrade'
import type { Misconception, TopicListEntry } from '../../shared/types'

/**
 * The grades the phone is allowed to see coming back.
 *
 * ## Why this is not in `main/link/`
 *
 * Same boundary as `mobileOverview.ts`: the link directory is pinned inert by
 * checkDoctrine §D6 — nothing in it may name the engine, spawn a process, or
 * reach the learning home. This module reads the engine, so it lives outside
 * that fence and is handed to the server as a plain function.
 *
 * ## Why grades may cross when due items may not
 *
 * `mobileOverview` ships counts because a due item carries `probe`, `claim`
 * and `rubric` — shipping one would put the expected answer on the device
 * before the retrieval. A receipt is the opposite artifact. It is written
 * AFTER the production is graded and it records no content: engram.py's
 * receipt lines carry the rating, the interval, the source and a verdict, and
 * the learner's own words stay in the transcript on the Mac. So the sealing
 * rule is untouched here, and the projection below is a whitelist rather than
 * a redaction — a future engine field cannot leak by being forgotten about.
 *
 * ## What "provisional" means, and why it is derived rather than stored
 *
 * The plan called for an app-side `provisional` set keyed `topic:node`. It
 * does not need to exist. A node is provisional exactly when its most recent
 * receipt carries a recognition stamp, and the receipt log already says that
 * — with no second store to keep in sync, no write path to get wrong, and no
 * way for the mark to disagree with the engine's own record. Solidifying is
 * then not a state transition anyone has to remember to perform: a desk
 * sitting writes a `self` receipt and the node stops being provisional
 * because the newest fact about it changed.
 */

export interface MobileReceipt {
  node: string
  /** The node's own title, so the phone can name a grade without holding a
   * copy of the graph. Falls back to the id for a node the graph no longer
   * lists — a receipt outlives the node it was written about. */
  title: string
  ts: string
  /** learn | review | transfer — engram.py's own `kind`. */
  kind: string | null
  /** The blind assessor's verdict. */
  grade: string | null
  /** The FSRS rating actually committed. */
  rating: string | null
  source: string | null
  dueNext: string | null
  intervalDays: number | null
  /** engram.py's retry rows: recorded, reported, excluded from transitions. */
  relearn: boolean
  /** Recognition-grade evidence — see `PHONE_SOURCE_STAMPS`. */
  fromPhone: boolean
}

export interface MobileReceipts {
  topic: string
  /** Newest first, windowed to `MAX_RECEIPTS`. */
  receipts: MobileReceipt[]
  /** Nodes whose newest receipt is recognition-grade, computed over the FULL
   * log rather than the window — a node last touched a year ago on the phone
   * is still provisional today, and truncating first would quietly forget it. */
  provisional: string[]
  /** The topic's standing on the desktop's own S–F scale. Absent only when
   * the grade could not be computed at all. */
  grade?: MobileGrade
}

/** One screen of history, deep enough to scroll and shallow enough that a
 * topic with thousands of receipts does not become a slow request. */
const MAX_RECEIPTS = 60

/** Re-exported so the projection and its test agree by construction with the
 * wire's own stamp map instead of by a copied literal. */
export const PHONE_SOURCES = PHONE_SOURCE_STAMPS

/**
 * The pure part: receipts in, wire shape out. Separated from the I/O below so
 * the projection's rules are testable without a learning home on disk.
 */
export function projectTopicReceipts(
  topic: string,
  receipts: RawReceipt[],
  /** Every node id the topic HAS, for arc-prefix detection. Optional: without
   * it the prefixes are inferred from the graded nodes alone, which is honest
   * but under-informed — a topic where only one `ce-` node has ever been
   * graded never reaches the three-sibling threshold, so that node reads "Ce"
   * while its `fd-` neighbours read "FD ·". The arc vocabulary is a property
   * of the topic, not of how much of it has been marked. */
  allNodeIds: string[] = [],
): MobileReceipts {
  const mine = receipts
    .filter((r) => r.topic === topic)
    .slice()
    .sort((a, b) => b.ts.localeCompare(a.ts))

  const arcs = arcPrefixesOf(
    allNodeIds.length > 0 ? allNodeIds : mine.map((r) => r.node),
  )

  // Newest-first order means the FIRST row seen for a node is its latest.
  const latestSource = new Map<string, string | null>()
  for (const r of mine) {
    if (!latestSource.has(r.node)) latestSource.set(r.node, r.source)
  }
  const provisional = [...latestSource.entries()]
    .filter(([, source]) => isPhoneSource(source))
    .map(([node]) => node)
    .sort()

  return {
    topic,
    receipts: mine.slice(0, MAX_RECEIPTS).map((r) => ({
      node: r.node,
      title: humanizeWithArcs(r.node, arcs),
      ts: r.ts,
      kind: r.kind,
      grade: r.grade,
      rating: r.rating,
      source: r.source,
      dueNext: r.dueNext,
      intervalDays: r.intervalDays,
      relearn: r.relearn,
      fromPhone: isPhoneSource(r.source),
    })),
    provisional,
  }
}

function isPhoneSource(source: string | null): boolean {
  return source !== null && PHONE_SOURCE_STAMPS.includes(source)
}

/** Reads the engine and projects. The composition root hands this to the
 * server as a function of one string, so the server never learns that a
 * learning home exists. */
export async function buildTopicReceipts(topic: string): Promise<MobileReceipts> {
  const [history, nodeIds] = await Promise.all([readReceiptsHistory(), readNodeIds(topic)])
  const projected = projectTopicReceipts(topic, history.receipts, nodeIds)
  // The grade rides along rather than taking a second round trip: the page
  // shows both at once, and two requests would let the letter and the
  // receipts it summarises arrive out of step.
  return { ...projected, grade: await buildTopicGrade(topic).catch(() => undefined) }
}

// ===========================================================================
// The letter grade
// ===========================================================================

/**
 * The topic's standing, on the desktop's own S–F scale.
 *
 * Imported rather than reimplemented. `computeTopicGrade` is the app's single
 * definition of what a grade means — the weights, the small-n floors, the
 * renormalisation, the fixed cutoffs — and a second copy in Swift would drift
 * the first time one of those constants was tuned. A grade that reads B at the
 * desk and C in your pocket is worse than no grade on the phone at all.
 *
 * ## The one component the phone cannot see
 *
 * Calibration is computed from confidence picks, which live in the renderer's
 * localStorage ring buffer and never reach the main process. Passing an empty
 * array means the model marks that component unavailable and renormalises the
 * remaining weights across what it does have — its own honest path for a
 * missing component, not a workaround bolted on here.
 *
 * It does mean the phone's composite can differ from the desk's when the desk
 * has calibration data. So the payload NAMES what was excluded and the phone
 * prints it. A number that quietly disagrees with the desk would be the bug;
 * a number that says what it is made of is a measurement.
 */
export interface MobileComponent {
  key: GradeComponentKey
  available: boolean
  n: number
  score: number | null
  letter: string | null
  weight: number
}

export interface MobileGrade {
  topic: string
  available: boolean
  score: number | null
  letter: string | null
  components: MobileComponent[]
  /** Components the phone could not compute, by key. Printed, never hidden. */
  excluded: GradeComponentKey[]
}

const COMPONENT_ORDER: GradeComponentKey[] = [
  'recall',
  'punctuality',
  'coverage',
  'conceptual',
  'calibration',
]

export async function buildTopicGrade(topic: string): Promise<MobileGrade> {
  const [history, topics, misconceptions] = await Promise.all([
    readReceiptsHistory(),
    engramRead<TopicListEntry[]>('topics').catch(() => [] as TopicListEntry[]),
    engramRead<unknown[]>('misconception', ['list']).catch(() => [] as unknown[]),
  ])

  const result = computeTopicGrade({
    receipts: history.receipts,
    topic,
    topicEntry: topics.find((entry) => entry.topic === topic),
    misconceptions: misconceptions as Misconception[],
    days: history.days,
    picks: [],
    // `completed` grades the work actually done. `total` folds in how much of
    // the curriculum is untouched, which on a phone would read as a scolding
    // for not having finished a course — and the coverage component is still
    // listed below either way, so nothing is hidden by the choice.
    mode: 'completed',
  })

  return {
    topic,
    available: result.overall.available,
    score: result.overall.score,
    letter: result.overall.letter,
    components: COMPONENT_ORDER.map((key) => ({
      key,
      available: result.components[key].available,
      n: result.components[key].n,
      score: result.components[key].score,
      letter: result.components[key].letter,
      weight: result.components[key].weight,
    })),
    excluded: COMPONENT_ORDER.filter((key) => key === 'calibration'),
  }
}

/**
 * The topic's node ids, and nothing else.
 *
 * `Object.keys` — the keys are read and no node object is ever dereferenced,
 * so unlike the title lookup this replaced there is no field here to widen
 * into. That narrowness is the whole reason it is safe to reach for the graph
 * again on this path.
 */
async function readNodeIds(topic: string): Promise<string[]> {
  try {
    const graph = (await readTopicGraph(topic)) as { nodes?: Record<string, unknown> }
    return Object.keys(graph?.nodes ?? {})
  } catch {
    return []
  }
}

/**
 * Has the engine written a receipt for this node since the given moment?
 *
 * The drain's definition of done. Lives here rather than in main/link/ for the
 * same §D6 reason as everything else: the server layer gets an ANSWER about
 * the record and never a way to read it.
 *
 * Compared as strings because both sides are ISO-8601 and engram.py also
 * writes date-only stamps for some rows; lexical order is correct for both,
 * and a date-only receipt sorts to that day's start, which is the
 * conservative direction — it can only fail to settle something, never settle
 * something that has not happened.
 */
export async function receiptSince(
  topic: string,
  node: string,
  since: string,
): Promise<boolean> {
  const history = await readReceiptsHistory().catch(() => null)
  if (!history) return false
  return history.receipts.some((r) => r.topic === topic && r.node === node && r.ts >= since)
}
