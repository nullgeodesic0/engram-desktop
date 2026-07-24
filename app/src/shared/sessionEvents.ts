// Events forwarded main -> renderer over `session:<id>:event`. Deliberately
// narrow — only what the UI actually reacts to, not a raw NDJSON firehose.

export interface SessionTextEvent {
  type: 'text'
  text: string
}

export interface SessionToolUseEvent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface SessionToolResultEvent {
  type: 'tool_result'
  toolUseId: string
  isError: boolean
  content: unknown
}

export interface SessionRateLimitEvent {
  type: 'rate_limit'
  status: string
  resetsAt: number | null
}

/** One `result` NDJSON line = end of the current conversational turn — the
 * process stays alive, ready for the next stdin message (that's the whole
 * point of stream-json input/output for a multi-turn headless session). */
export interface SessionTurnEndedEvent {
  type: 'turn_ended'
  isError: boolean
  resultText: string | null
}

/** The child process itself has actually exited — no further turns possible. */
export interface SessionClosedEvent {
  type: 'closed'
  exitCode: number | null
}

export interface SessionErrorEvent {
  type: 'error'
  message: string
}

/** Context-window consumption as of the latest turn — from the `result` message's
 * own `usage`/`modelUsage` fields (the engine's real accounting, not an estimate we compute). */
export interface SessionUsageEvent {
  type: 'usage'
  usedTokens: number
  contextWindow: number
}

export type SessionEvent =
  | SessionTextEvent
  | SessionToolUseEvent
  | SessionToolResultEvent
  | SessionRateLimitEvent
  | SessionTurnEndedEvent
  | SessionClosedEvent
  | SessionErrorEvent
  | SessionUsageEvent
