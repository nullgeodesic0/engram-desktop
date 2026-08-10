import { readReceiptsHistory, type RawReceipt } from '../engramCli/receiptsHistory'
import { readTopicGraph } from '../engramCli/readOnly'
import { PHONE_SOURCE_STAMPS } from '../../shared/linkProtocol'

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
  titles: Record<string, string>,
): MobileReceipts {
  const mine = receipts
    .filter((r) => r.topic === topic)
    .slice()
    .sort((a, b) => b.ts.localeCompare(a.ts))

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
      title: titles[r.node] ?? r.node,
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
  const [history, titles] = await Promise.all([readReceiptsHistory(), readNodeTitles(topic)])
  return projectTopicReceipts(topic, history.receipts, titles)
}

/**
 * Node id → title, and nothing else from the graph.
 *
 * The narrow read is deliberate and is the same discipline
 * `buildConstellationGraph` follows: a node object also carries `probe`,
 * `claim` and `rubric`, so a permissive read here would be the answer leak
 * the receipt projection above was careful not to be.
 *
 * `nodes` is a MAP keyed by id, not an array — the same shape
 * `buildConstellationGraph` reads a few lines away in mobileOverview.ts. An
 * earlier version here expected an array and, finding none, returned no
 * titles at all rather than failing: every grade on the phone was labelled
 * with a raw node id and nothing said why. Hence the explicit test.
 */
export function titlesFromGraph(graph: unknown): Record<string, string> {
  const nodes = (graph as { nodes?: unknown } | undefined)?.nodes
  if (typeof nodes !== 'object' || nodes === null || Array.isArray(nodes)) return {}
  const out: Record<string, string> = {}
  for (const [id, node] of Object.entries(nodes as Record<string, unknown>)) {
    const title = (node as { title?: unknown })?.title
    if (typeof title === 'string') out[id] = title
  }
  return out
}

async function readNodeTitles(topic: string): Promise<Record<string, string>> {
  try {
    return titlesFromGraph(await readTopicGraph(topic))
  } catch {
    return {}
  }
}
