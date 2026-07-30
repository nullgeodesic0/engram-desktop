import { isTaskNotificationContent } from './taskNotification'
import { isMarkBoundaryToolUse } from './signals/tutorSignals'
import { endsWithBareProbeHeader } from './probeHeader'

export interface ChatMessage {
  id: string
  role: 'assistant' | 'user'
  text: string
  /** Absolute paths attached to this message (display only — the actual reference
   * that gets the model to read them lives in the message text itself, see
   * LearnSessionView's submitProduction). Never populated on transcript replay. */
  attachments?: string[]
  /** Epoch ms this bubble was first created — never updated by later merges
   * into the same bubble (see the SPLIT RULE doctrine comment below: a
   * merged bubble keeps the timestamp of whichever block started it).
   * Replay: parsed from the transcript line's own `timestamp` field (Claude
   * Code stamps every `user`/`assistant` line — confirmed against real
   * transcripts on this machine). Live: stamped at append time with
   * `Date.now()` by the caller (LearnSessionView/ReviewSessionView) — honest
   * because that IS when the app received it; SessionManager's own
   * `SessionEvent` shape carries no timestamp of its own (see
   * shared/sessionEvents.ts) and this file never invents one for it.
   * `undefined` when a line/event carried nothing usable — never fabricated;
   * a message with `undefined` here renders with no clock at all. */
  timestamp?: number
}

interface TranscriptLine {
  type?: string
  /** ISO timestamp on the raw transcript entry. Same field
   * SessionHistoryDrawer.tsx's `buildHistoryTimeline`/`localDateFromIso` and
   * ritualFromTranscript.ts's `walkTranscript` read off the identical raw
   * line shape — three independent call sites relying on the same Claude
   * Code guarantee. */
  timestamp?: string
  message?: {
    role?: string
    content?: string | { type?: string; text?: string; name?: string; input?: Record<string, unknown> }[]
  }
}

/** Local-date discipline (getFullYear/Month/Date — never toISOString) lives
 * downstream of this, in ChatMessageView's clock formatting — this function
 * only ever hands back an epoch ms instant, never a calendar day. `undefined`
 * for a missing or unparseable timestamp, never `NaN` or a fabricated "now".
 * Exported so SessionHistoryDrawer.tsx's `buildHistoryTimeline` (a deliberate
 * local superset of this file's own merge rule — see that function's own
 * doctrine comment) parses the identical raw field the identical way. */
export function parseLineTimestamp(ts: string | undefined): number | undefined {
  if (!ts) return undefined
  const parsed = Date.parse(ts)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Reconstructs the chat-bubble history from a Claude Code session transcript
 * (`~/.claude/projects/<flattened-cwd>/<sessionId>.jsonl`), using the exact same
 * merge rule the live renderer uses (see LearnSessionView's 'text' handler) so a
 * resumed session's history looks identical to one that streamed in live.
 *
 * Genuine human turns (the app's own synthetic kickoff message, or a real typed
 * production) always have `message.content` as a plain string — that's how
 * SessionManager.sendUserMessage writes them. Tool-result plumbing turns have
 * `message.content` as an array of tool_result blocks and are skipped. The very
 * first user entry in every transcript is the app's own synthetic "continue this
 * topic" kickoff, never something the human typed — skipped unconditionally.
 *
 * THE SPLIT RULE (the interleave fix — see isMarkBoundaryToolUse's doctrine
 * comment in signals/tutorSignals.ts): consecutive assistant text blocks
 * merge into one bubble UNLESS a mark-producing tool_use sits between them
 * in the transcript's own block order. Ritual marks are pinned between
 * messages by `atIndex`, so without the split a mid-turn ask/phase/beat
 * signal's mark would render before prose that chronologically preceded it.
 * The transcript preserves true block order (text and tool_use blocks arrive
 * as separate entries), so replay can break the merge at exactly the same
 * boundaries the live views' own text handlers do — same shared predicate,
 * agreement by construction. Splitting changes SEGMENTATION only, never
 * content: the concatenation of all assistant text is byte-identical with or
 * without any split.
 */
export function parseTranscriptToMessages(rawLines: unknown[]): ChatMessage[] {
  const lines = rawLines as TranscriptLine[]
  const messages: ChatMessage[] = []
  let seenFirstUser = false
  let idCounter = 0
  // True once a mark-boundary tool_use has fired since the last assistant
  // text block — the next text block then starts a NEW bubble instead of
  // merging, so the mark pinned at that boundary renders between the prose
  // that preceded it and the prose that followed.
  let boundarySinceLastText = false

  for (const line of lines) {
    if (line.type === 'user' && typeof line.message?.content === 'string') {
      if (!seenFirstUser) {
        seenFirstUser = true
        continue // the app's own synthetic kickoff — not a real human message
      }
      // A background-agent completion (e.g. the assessor audit — see
      // shared/taskNotification.ts's doctrine comment) also lands as an
      // ordinary `type: "user"` string-content line, but it is NOT a genuine
      // learner turn — it's the assessor's raw envelope, quoting the very
      // rubric the sitting is being graded against. Never render it as a
      // chat bubble.
      if (isTaskNotificationContent(line.message.content)) continue
      messages.push({ id: `t${idCounter++}`, role: 'user', text: line.message.content, timestamp: parseLineTimestamp(line.timestamp) })
      continue
    }

    if (line.type === 'assistant' && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (
          block.type === 'tool_use' &&
          typeof block.name === 'string' &&
          typeof block.input === 'object' &&
          block.input !== null &&
          isMarkBoundaryToolUse(block.name, block.input)
        ) {
          boundarySinceLastText = true
          continue
        }
        if (block.type !== 'text' || !block.text) continue
        const last = messages[messages.length - 1]
        // Bare-probe-header exception (see `endsWithBareProbeHeader`'s own
        // doctrine comment): a header-only bubble immediately followed by a
        // mark-boundary tool call (typically `render_beat` posting the probe
        // itself) still absorbs the next text block into the SAME bubble —
        // the split rule exists for genuine mid-turn interleaving, not for a
        // single probe utterance that a bridge call happens to interrupt.
        if (last && last.role === 'assistant' && (!boundarySinceLastText || endsWithBareProbeHeader(last.text))) {
          // Timestamp intentionally untouched — a merged bubble keeps the
          // instant it STARTED at, same rule the live append path uses.
          last.text += block.text
        } else {
          messages.push({ id: `t${idCounter++}`, role: 'assistant', text: block.text, timestamp: parseLineTimestamp(line.timestamp) })
        }
        boundarySinceLastText = false
      }
    }
  }

  return messages
}
