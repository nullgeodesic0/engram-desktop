import { parseGradeResults } from './gradeResult'
import { walkBridgeToolUses, RENDER_BEAT, BEAT_OUTCOME } from './ritualFromTranscript'

/** Rebuild the session banner (current beat, node, position, beat trail) from
 * a resumed session's transcript, so the loop indicator populates instantly on
 * reopen instead of sitting gray until the next live render_beat call.
 *
 * The transcript is the same JSONL the app replays for chat history: assistant
 * entries carry `message.content` arrays whose tool_use blocks include every
 * `mcp__engram-ui-bridge__render_beat` / `beat_outcome` call the tutor made —
 * a durable record of exactly the signals that drive the live banner. Walks
 * those calls via `ritualFromTranscript.ts`'s `walkBridgeToolUses`, the same
 * ordered extraction `deriveRitualMarks` replays for durable beat marks, so
 * the two can never disagree about what a bridge call is. */

export type BeatOutcome = 'visited' | 'confirmed' | 'partial' | 'missed'

export interface ResumedBanner {
  beat: string | null
  node: string | null
  position: string | null
  trail: Map<string, BeatOutcome>
}

const OUTCOMES = new Set(['confirmed', 'partial', 'missed'])

export function extractBannerFromTranscript(lines: unknown[]): ResumedBanner {
  let beat: string | null = null
  let node: string | null = null
  let position: string | null = null
  let trail = new Map<string, BeatOutcome>()

  for (const { name, input } of walkBridgeToolUses(lines)) {
    if (name === RENDER_BEAT) {
      const beatInput = input as { beat?: unknown; node?: unknown; position?: unknown }
      if (typeof beatInput.beat !== 'string') continue
      const nextNode = typeof beatInput.node === 'string' ? beatInput.node : null
      // A new node starts a fresh walk — same reset the live path performs.
      if (nextNode && node && nextNode !== node) {
        trail = new Map()
        position = null
        beat = null
      }
      // The beat we're leaving becomes part of the walked trail (never
      // downgrading an outcome the tutor already reported for it).
      if (beat && !trail.has(beat)) trail.set(beat, 'visited')
      beat = beatInput.beat
      if (nextNode) node = nextNode
      if (typeof beatInput.position === 'string') position = beatInput.position
    } else if (name === BEAT_OUTCOME) {
      const outcomeInput = input as { beat?: unknown; outcome?: unknown }
      if (typeof outcomeInput.beat === 'string' && typeof outcomeInput.outcome === 'string' && OUTCOMES.has(outcomeInput.outcome)) {
        trail.set(outcomeInput.beat, outcomeInput.outcome as BeatOutcome)
      }
    }
  }

  return { beat, node, position, trail }
}


/** The previous sitting's outcome, recovered from the resumed transcript's
 * LAST receipt-style tool_result (an array of grade objects). Fuels the
 * opening plate's "last walk: N graded, one shaky" line. Null when the
 * transcript carries no grade batches (e.g. first sitting on the topic). */
export function extractLastWalkFromTranscript(lines: unknown[]): { graded: number; shaky: string[] } | null {
  let last: { graded: number; shaky: string[] } | null = null
  for (const raw of lines) {
    const line = raw as {
      type?: string
      message?: { content?: string | { type?: string; content?: unknown }[] }
    }
    if (line?.type !== 'user' || !Array.isArray(line.message?.content)) continue
    for (const block of line.message.content) {
      if (block?.type !== 'tool_result') continue
      const results = parseGradeResults(block.content)
      if (results.length > 0) {
        last = {
          graded: results.length,
          shaky: results.filter((r) => r.grade !== 'recalled').map((r) => r.node),
        }
      }
    }
  }
  return last
}
