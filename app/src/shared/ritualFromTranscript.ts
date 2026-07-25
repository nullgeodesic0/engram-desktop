/** Reconstructs durable ritual marks (beat cards + node crossings) from a
 * resumed session's transcript, so a reopened sitting shows the same beat
 * cards and crossing dividers a live session would have accumulated instead
 * of a bare transcript. Lives alongside `bannerFromTranscript.ts`, which
 * reads the exact same `render_beat`/`beat_outcome` bridge tool calls to
 * rebuild the loop banner — both modules replay `walkBridgeToolUses` below
 * so "what counts as a bridge call" can never drift between the two.
 *
 * `atIndex` must land on the same message index `parseTranscriptToMessages`
 * (chatMessages.ts) would assign, since LearnSessionView interleaves marks
 * against that message list by `atIndex`. `walkTranscript` replays
 * chatMessages.ts's skip-first-user / merge-consecutive-assistant-text rules
 * block-by-block (kept in careful sync with that file — it stays the source
 * of truth for actual message text; this only needs the running COUNT) so a
 * mark's `atIndex` always equals "how many chat messages exist so far" at the
 * exact point in the transcript the underlying tool call landed, matching the
 * live path's `pushMark`, which stamps `atIndex: messagesRef.current.length`
 * synchronously when the bridge event arrives. */

interface TranscriptLine {
  type?: string
  message?: {
    content?: string | ContentBlock[]
  }
}

interface ContentBlock {
  type?: string
  text?: string
  name?: string
  input?: Record<string, unknown>
}

export const RENDER_BEAT = 'mcp__engram-ui-bridge__render_beat'
export const BEAT_OUTCOME = 'mcp__engram-ui-bridge__beat_outcome'

/** One bridge `tool_use` block, in true transcript emission order. */
export interface BridgeToolUse {
  name: string
  input: Record<string, unknown>
}

type WalkEvent =
  | { kind: 'user_message' }
  | { kind: 'assistant_text' }
  | { kind: 'tool_use'; name: string; input: Record<string, unknown> }

/** Single ordered pass over the transcript, block by block, yielding one
 * event per real chat message (post skip-first-user / merge-consecutive-
 * assistant-text) and one event per bridge tool call — true emission order,
 * so consumers can track "message count so far" and "which tool call just
 * fired" from a single walk, exactly the way the live IPC events arrive. */
function* walkTranscript(rawLines: unknown[]): Generator<WalkEvent> {
  const lines = rawLines as TranscriptLine[]
  let seenFirstUser = false

  for (const line of lines) {
    if (line?.type === 'user' && typeof line.message?.content === 'string') {
      if (!seenFirstUser) {
        seenFirstUser = true
        continue // the app's own synthetic kickoff — not a real human message
      }
      yield { kind: 'user_message' }
      continue
    }

    if (line?.type === 'assistant' && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (block?.type === 'text' && block.text) {
          yield { kind: 'assistant_text' }
          continue
        }
        if (block?.type === 'tool_use' && typeof block.name === 'string' && typeof block.input === 'object' && block.input !== null) {
          yield { kind: 'tool_use', name: block.name, input: block.input as Record<string, unknown> }
        }
      }
    }
  }
}

/** Every bridge `tool_use` block in the transcript, in emission order —
 * `bannerFromTranscript.ts` filters this for `RENDER_BEAT`/`BEAT_OUTCOME` to
 * rebuild the loop banner; it doesn't need message indexing, just the
 * ordered calls themselves. */
export function walkBridgeToolUses(lines: unknown[]): BridgeToolUse[] {
  const out: BridgeToolUse[] = []
  for (const event of walkTranscript(lines)) {
    if (event.kind === 'tool_use') out.push({ name: event.name, input: event.input })
  }
  return out
}

/** Structurally a subset of the `RitualMark` union (components/ritual/Marks.tsx)
 * — only the two kinds this module can derive after the fact. Kept as a local
 * type (rather than importing RitualMark) so shared/ doesn't reach into
 * renderer/components; every literal below is still assignable to
 * `RitualMark[]` at call sites since TS matches union members structurally. */
export type DerivedRitualMark =
  | { id: string; atIndex: number; kind: 'beat'; beat: string; content: string }
  | { id: string; atIndex: number; kind: 'crossing'; nodeId: string }

/** Rebuilds the durable subset of ritual marks (beat cards + node crossings)
 * from a transcript. Mirrors the live paths exactly:
 *  - `crossToNode` in LearnSessionView only logs a crossing when a node was
 *    already active and the new one differs — the very first node entered
 *    never gets a crossing card, live or replayed.
 *  - `onBridgeBeat` crosses the node (if named) BEFORE pushing the beat mark,
 *    so a crossing mark for a given atIndex always precedes its beat mark —
 *    replayed here in the same order.
 * Figure/atlas/stash marks are NOT derived here — they're one-time tutor
 * signals with no durable record in the transcript to replay from (see the
 * doctrine comment on `RitualMark` in Marks.tsx). */
export function deriveRitualMarks(entries: unknown[]): DerivedRitualMark[] {
  const marks: DerivedRitualMark[] = []
  let messageCount = 0
  let lastWasAssistantText = false
  let lastNodeId: string | null = null
  let seq = 0

  for (const event of walkTranscript(entries)) {
    if (event.kind === 'user_message') {
      messageCount++
      lastWasAssistantText = false
      continue
    }
    if (event.kind === 'assistant_text') {
      if (!lastWasAssistantText) {
        messageCount++
        lastWasAssistantText = true
      }
      continue
    }
    // tool_use
    if (event.name !== RENDER_BEAT) continue
    const input = event.input as { beat?: unknown; content?: unknown; node?: unknown }
    if (typeof input.beat !== 'string') continue
    const nextNode = typeof input.node === 'string' ? input.node : null
    if (nextNode) {
      if (lastNodeId !== null && lastNodeId !== nextNode) {
        marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'crossing', nodeId: nextNode })
      }
      lastNodeId = nextNode
    }
    marks.push({
      id: `dmark-${seq++}`,
      atIndex: messageCount,
      kind: 'beat',
      beat: input.beat,
      content: typeof input.content === 'string' ? input.content : '',
    })
  }

  return marks
}
