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

/** A background-agent completion envelope (`<task-notification>...
 * </task-notification>`) arriving live on the wire — e.g. a `/review`
 * sitting's assessor-audit spawn finishing in the background (see
 * `ritualFromTranscript.ts`'s AUDIT doctrine comment for the full real-
 * transcript shape this reads). `content` is RAW AND UNPARSED: this event
 * carries the bytes exactly as `SessionManager` observed them on stdin, with
 * no interpretation applied. Its meaning is extracted ONLY by
 * `shared/taskNotification.ts` (`parseTaskNotificationEnvelope` /
 * `parseAssessorAuditVerdict` / `parseAuditNotification`) — NEVER render this
 * string verbatim anywhere; it is not a chat message, and its JSON body may
 * carry the assessor's rubric/production text that the loop's own
 * compartmentalization keeps off the learner's screen. */
export interface SessionTaskNotificationEvent {
  type: 'task_notification'
  content: string
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

/** Phase 3 watchdog — fired once when the `claude` child process has gone
 * quiet (no stdout at all, not even a partial-message delta) for longer than
 * SessionManager's stall threshold while a turn is still outstanding. Purely
 * informational: nothing here kills the process or changes its behavior —
 * it exists so a hung session shows "still working" instead of the same
 * silent nothing a genuinely-thinking-hard turn also looks like. Cleared by
 * the next real activity (any other SessionEvent) or by `closed`; the
 * renderer doesn't need a dedicated "un-stall" event; it just stops
 * showing the affordance once something else arrives. */
export interface SessionStallEvent {
  type: 'stall'
  seconds: number
}

export type SessionEvent =
  | SessionTextEvent
  | SessionToolUseEvent
  | SessionToolResultEvent
  | SessionRateLimitEvent
  | SessionTaskNotificationEvent
  | SessionTurnEndedEvent
  | SessionClosedEvent
  | SessionErrorEvent
  | SessionUsageEvent
  | SessionStallEvent
