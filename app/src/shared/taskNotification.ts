/** Composable pieces for reading a background-agent completion envelope — the
 * `<task-notification>...</task-notification>` string that lands as a bare
 * STRING `message.content` on an ordinary `type: "user"` transcript line
 * whenever a spawned subagent (e.g. the assessor audit — see
 * `ritualFromTranscript.ts`'s AUDIT doctrine comment for the full real-
 * transcript shape) finishes running in the background.
 *
 * This module exists so BOTH replay (`ritualFromTranscript.ts`'s
 * `parseAuditNotification`, now a thin wrapper over the pieces below) and the
 * live wire (`SessionManager.ts` emitting `SessionTaskNotificationEvent`,
 * `ReviewSessionView.tsx`/`LearnSessionView.tsx` resolving a pending audit
 * mark from it) share exactly one parser for "what does this string mean" —
 * so replay and live can never quietly disagree about the same bytes.
 *
 * `parseAssessorAuditVerdict` is the ONLY function anywhere in this codebase
 * permitted to parse the assessor's JSON body, and its closed return type IS
 * the doctrine boundary: it extracts strictly `node` and `audit.agree` and
 * NOTHING else — never `rubric_notes`, `probe`, `production`, `feedback_line`,
 * `misconceptions`, `confidence`. The assessor's receipt carries all of those
 * because `agents/engram-assessor.md` documents a richer contract than a
 * ritual mark needs, but a UI surface that ever rendered `rubric_notes` or
 * `feedback_line` back at the learner would be handing them exactly the
 * graded-against material the loop's own compartmentalization keeps behind
 * the confidence pick — the same leak `checkDoctrine.ts`'s D4 section guards
 * against for `claim`/`rubric`/`transfer_probe` on the tutor's own side. Widen
 * this return type only with the same scrutiny that would take. */

/** Prefix check — true iff `content` is a background-agent completion
 * envelope rather than a genuine learner turn. Bare `string` content that
 * does NOT start with this prefix is ordinary chat text and must be left
 * alone (no event, no parsing) by every caller. */
export function isTaskNotificationContent(content: string): boolean {
  return content.startsWith('<task-notification>')
}

/** Tag extraction only — no interpretation of what's inside `<result>`. Returns
 * null on ANY structural mismatch (missing `<tool-use-id>` or `<status>`):
 * a notification this codebase can't even parse the shape of is not one any
 * caller should act on. `resultText` is the raw `<result>...</result>` inner
 * text, unparsed — callers that care what it MEANS (e.g. an audit verdict)
 * hand it to a dedicated parser like `parseAssessorAuditVerdict` below,
 * never inspect it directly. */
export function parseTaskNotificationEnvelope(
  content: string,
): { toolUseId: string; completed: boolean; resultText: string | null } | null {
  const toolUseId = content.match(/<tool-use-id>([^<]*)<\/tool-use-id>/)?.[1]
  if (typeof toolUseId !== 'string') return null
  const status = content.match(/<status>([^<]*)<\/status>/)?.[1]
  if (typeof status !== 'string') return null
  const resultText = content.match(/<result>([\s\S]*?)<\/result>/)?.[1] ?? null
  return { toolUseId, completed: status === 'completed', resultText }
}

/** Parses an assessor audit's `<result>` body — see the module doctrine
 * comment above for exactly why this is the one and only place that touches
 * the assessor's JSON, and exactly what it is and isn't allowed to extract.
 * Returns null on ANY parse failure or shape mismatch (no fenced ```json
 * block, invalid JSON, an empty array, an item missing the documented
 * `node`/`audit.agree` fields): a mark stuck at `pending` forever is honest;
 * a fabricated verdict is not. */
export function parseAssessorAuditVerdict(
  resultText: string,
): { itemCount: number; disputedNodes: string[] } | null {
  const fence = resultText.match(/```json\s*([\s\S]*?)```/)
  if (!fence) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fence[1])
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const disputedNodes: string[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return null
    const node = (item as Record<string, unknown>).node
    const audit = (item as Record<string, unknown>).audit
    if (typeof node !== 'string' || typeof audit !== 'object' || audit === null) return null
    const agree = (audit as Record<string, unknown>).agree
    if (typeof agree !== 'boolean') return null
    if (!agree) disputedNodes.push(node)
  }
  return { itemCount: parsed.length, disputedNodes }
}

/** Resolves a pending audit's verdict from a `<task-notification>` string —
 * thin composition of the pieces above, kept for exact backward-compatible
 * signature/behavior with the pre-extraction inline version in
 * `ritualFromTranscript.ts`. Returns null on ANY mismatch (wrong
 * tool-use-id, not yet `completed`, unparseable body) — same "never
 * fabricate" discipline as `parseAssessorAuditVerdict`. */
export function parseAuditNotification(
  content: string,
  expectedToolUseId: string,
): { itemCount: number; disputedNodes: string[] } | null {
  const envelope = parseTaskNotificationEnvelope(content)
  if (!envelope) return null
  if (envelope.toolUseId !== expectedToolUseId) return null
  if (!envelope.completed) return null
  if (!envelope.resultText) return null
  return parseAssessorAuditVerdict(envelope.resultText)
}
