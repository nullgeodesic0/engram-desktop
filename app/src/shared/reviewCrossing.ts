/** Review's node-crossing + grade-card anchoring, derived purely from the
 * tutor's own probe headers (`shared/probeHeader.ts`) rather than from
 * matching probe text against the due queue or from "however many messages
 * exist right now" at the moment a `rate` tool_result lands.
 *
 * Both bugs this replaces trace to the same root cause: a real /review reply
 * routinely narrates the FULL verdict (what was right, what to fix, the
 * interval change) and THEN announces the next probe — in one continuous
 * assistant turn, i.e. one `ChatMessage`. Anchoring the grade card / crossing
 * to "the message-array length when the `rate` tool_result arrived" pins them
 * to a point BEFORE that turn's text has even started streaming in, so they
 * render ahead of the very commentary they're the receipt for. And picking
 * the crossing's destination by matching probe text against `queue` (engram's
 * most-overdue-first due list, capped and reshuffled every grade) is a
 * different, unrelated signal from "what the tutor is actually asking next" —
 * confirmed to name the wrong node against a real 2026-07-27 sitting.
 *
 * The tutor's own `[N/M] · node` marker (probeHeader.ts) is ground truth for
 * both problems: it's the literal text of what got asked, so it can never
 * name the wrong node, and locating it lets a grade card be pinned to
 * "immediately before the NEXT such marker" — after the commentary that
 * precedes it in the same message, never before it. */

import type { ChatMessage } from './chatMessages'
import { parseProbeHeader, type ProbeHeader } from './probeHeader'

/** Every probe header in `messages`, in order, alongside the message index it
 * lives in. A message carries at most one — `parseProbeHeader` matches only
 * the first marker line, mirroring the dialogue grammar (one probe posed per
 * turn). Exported as `allProbeHeaders` — Chat Instruments Wave B reuses this
 * exact walk for both the transcript minimap (every probe is a "notable
 * moment," in Learn as much as Review — this function has never been
 * Review-specific, only its two callers below were) and the grade-card ↔
 * probe-card hover linkage (matching a message index to the node it probed,
 * without re-deriving `splitAroundProbeHeader` a second time). */
export function allProbeHeaders(messages: ChatMessage[]): Array<{ index: number; header: ProbeHeader }> {
  const out: Array<{ index: number; header: ProbeHeader }> = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== 'assistant') continue
    const header = parseProbeHeader(messages[i].text)
    if (header) out.push({ index: i, header })
  }
  return out
}

/** The tutor's own most-recently-posed probe — ground truth for "what's being
 * asked right now" (replaces matching `queue` probe text against recent
 * messages). Null before any probe header has appeared yet. */
export function latestProbeHeader(messages: ChatMessage[]): { index: number; header: ProbeHeader } | null {
  const headers = allProbeHeaders(messages)
  return headers.length > 0 ? headers[headers.length - 1] : null
}

/** One node-to-node sweep the transcript's own probe headers attest to —
 * Review's counterpart to Learn's `render_beat`-driven `crossToNode`. Never
 * fires on the very first probe of a sitting (nothing to move FROM), mirrors
 * `crossToNode`'s "only when the new node differs" rule otherwise. */
export interface ReviewCrossing {
  fromNode: string
  header: ProbeHeader
  /** Index into the SAME `messages` array this was derived from — the
   * message whose own text carries `header`, i.e. where this crossing (and
   * any grade card resolved to the same header via `nextProbeHeaderAt`)
   * render, immediately before that message's `ProbeCard` — never before the
   * message as a whole. */
  atMessageIndex: number
}

export function deriveReviewCrossings(messages: ChatMessage[]): ReviewCrossing[] {
  const headers = allProbeHeaders(messages)
  const out: ReviewCrossing[] = []
  for (let i = 1; i < headers.length; i++) {
    const prevNode = headers[i - 1].header.node
    const { index, header } = headers[i]
    if (prevNode !== header.node) out.push({ fromNode: prevNode, header, atMessageIndex: index })
  }
  return out
}

/** Where a grade that landed at `fromMessageIndex` (the message-array length
 * the moment its `rate` tool_result arrived — captured before any of the
 * verdict commentary that follows it exists yet, live or replayed) actually
 * belongs: the index of the next message at or after that point whose text
 * carries a probe header, i.e. "immediately before the next thing the tutor
 * asks." Returns null (the tail case — pin at the end) when no later header
 * exists yet: the sitting's last graded item, or a session that closed before
 * producing its next probe. */
export function nextProbeHeaderAt(messages: ChatMessage[], fromMessageIndex: number): number | null {
  for (let i = fromMessageIndex; i < messages.length; i++) {
    if (messages[i].role !== 'assistant') continue
    if (parseProbeHeader(messages[i].text)) return i
  }
  return null
}
