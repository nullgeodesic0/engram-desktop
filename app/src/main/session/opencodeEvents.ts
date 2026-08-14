/** Maps OpenCode's `/event` SSE stream into the same `SessionEvent` union
 * `SessionManager` (Claude) emits, so nothing downstream of `sessionHandlers.ts`
 * — the renderer, the mark-derivation pipeline, replay — needs to know or
 * care which provider actually ran a sitting.
 *
 * Every mapping decision here is measured against a real `opencode serve`
 * (0.32.9/1.18.18) driving a real `cursor-acp/auto` turn, not guessed from
 * documentation:
 *
 *   session.idle                          -> turn_ended (once per turn, the
 *                                             LAST event of the turn, arriving
 *                                             after the final step-finish part)
 *   message.part.delta  (field:'text')    -> text (a TRUE incremental delta,
 *                                             field name confirmed live —
 *                                             prefer this over diffing
 *                                             message.part.updated's
 *                                             cumulative text by hand)
 *   message.part.updated (part.type:'tool')-> tool_use while pending/running
 *                                             (has parsed `input`), tool_result
 *                                             once completed/error
 *   session.error                         -> error, and also ends the turn
 *
 * Everything else on the bus (session.status, session.updated, session.diff,
 * catalog.updated, plugin.added, server.heartbeat, ...) is bookkeeping this
 * app has no use for and is dropped.
 */

import type { SessionEvent } from '../../shared/sessionEvents'

interface OpencodeRawEvent {
  id?: string
  type?: string
  properties?: Record<string, unknown>
}

/** One SSE `data:` line -> zero or more raw events. OpenCode's stream is
 * standard `text/event-stream` (`data: {json}\n\n`), confirmed live — no
 * multi-line data fields observed in practice, but the split handles them
 * per spec anyway (data: lines within one event are newline-joined). */
export function parseOpencodeSseChunk(buffered: string): { events: OpencodeRawEvent[]; rest: string } {
  const events: OpencodeRawEvent[] = []
  const blocks = buffered.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    const dataLines = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
    if (dataLines.length === 0) continue
    try {
      events.push(JSON.parse(dataLines.join('\n')))
    } catch {
      // A malformed/partial block — drop it rather than throw; the next
      // well-formed event still gets through.
    }
  }
  return { events, rest }
}

interface ToolPartState {
  status?: string
  input?: Record<string, unknown>
  output?: unknown
  error?: unknown
}

interface Part {
  id?: string
  type?: string
  text?: string
  tool?: string
  callID?: string
  state?: ToolPartState
}

/** Tracks per-session mapping state — one instance per sitting, discarded
 * with the OpencodeSessionManager it belongs to. Not module-level/shared:
 * a second concurrent sitting must never see the first's part IDs. */
export class OpencodeEventMapper {
  // Which tool parts we've already emitted a tool_use for, keyed by callID —
  // a tool part is re-sent on every state transition (pending -> running ->
  // completed), and Claude's own SessionManager re-emits tool_use on every
  // sighting of a block too (confirmed in permissionConfig's sibling,
  // SessionManager.handleRawEvent), so downstream is already expected to
  // treat repeated tool_use events for the same id as idempotent/overwriting.
  // This set only prevents emitting a SECOND tool_use for the exact same
  // (callID, status) pair, not repeats across different statuses.
  private seenToolStatus = new Map<string, string>()

  /** `undefined` events (a line this app has no mapping for) are filtered
   * out here so callers never have to. */
  map(raw: OpencodeRawEvent): SessionEvent[] {
    switch (raw.type) {
      case 'message.part.delta': {
        const p = raw.properties as { field?: string; delta?: string } | undefined
        if (p?.field !== 'text' || typeof p.delta !== 'string' || p.delta === '') return []
        return [{ type: 'text', text: p.delta }]
      }
      case 'message.part.updated': {
        const part = (raw.properties as { part?: Part } | undefined)?.part
        if (!part || part.type !== 'tool' || !part.callID || !part.tool) return []
        return this.mapToolPart(part)
      }
      case 'session.idle':
        return [{ type: 'turn_ended', isError: false, resultText: null }]
      case 'session.error': {
        const message = extractErrorMessage(raw.properties)
        return [
          { type: 'error', message },
          { type: 'turn_ended', isError: true, resultText: message },
        ]
      }
      default:
        return []
    }
  }

  private mapToolPart(part: Part): SessionEvent[] {
    const callID = part.callID as string
    const tool = part.tool as string
    const status = part.state?.status ?? 'pending'
    const key = `${callID}:${status}`
    if (this.seenToolStatus.get(callID) === status) return [] // exact repeat, e.g. a delta ping with no real change
    this.seenToolStatus.set(callID, status)
    void key

    if (status === 'completed' || status === 'error') {
      const isError = status === 'error'
      const content = isError ? (part.state?.error ?? 'unknown error') : (part.state?.output ?? '')
      return [{ type: 'tool_result', toolUseId: callID, isError, content }]
    }
    // pending or running — input may still be partially-parsed JSON on
    // 'pending' (OpenCode's own ToolStatePending carries a `raw` string
    // alongside `input`), but downstream only reads `input` as an object, so
    // an empty/partial object is the correct value until it's 'running'.
    return [{ type: 'tool_use', id: callID, name: tool, input: part.state?.input ?? {} }]
  }
}

function extractErrorMessage(properties: Record<string, unknown> | undefined): string {
  const err = properties?.error as { message?: string; name?: string } | string | undefined
  if (typeof err === 'string') return err
  if (err?.message) return err.message
  if (err?.name) return err.name
  return 'OpenCode session error'
}
