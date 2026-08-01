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
 * the doctrine boundary: it extracts strictly `node` and the item's agree
 * verdict and NOTHING else — never `rubric_notes`, `probe`, `production`,
 * `feedback_line`, `misconceptions`, `confidence`. The assessor's receipt
 * carries all of those because `agents/engram-assessor.md` documents a
 * richer contract than a ritual mark needs, but a UI surface that ever
 * rendered `rubric_notes` or `feedback_line` back at the learner would be
 * handing them exactly the graded-against material the loop's own
 * compartmentalization keeps behind the confidence pick — the same leak
 * `checkDoctrine.ts`'s D4 section guards against for `claim`/`rubric`/
 * `transfer_probe` on the tutor's own side. Widen this return type only with
 * the same scrutiny that would take.
 *
 * TWO REAL SHAPES, both honored (schema drift, engine 1.0.7 -> 1.10.1): every
 * historical transcript on disk was written under the plugin's 1.0.7 audit
 * contract, which nested the verdict as `item.audit.agree` (verified verbatim
 * against `~/.claude/projects/-Users-learner/6130a05d-...jsonl`, e.g.
 * `"audit": {"tutor_rating": "hard", "agree": true, "note": "..."}`). The
 * engine was updated to 1.10.1, whose `agents/engram-assessor.md` and
 * `engram.py`'s `apply_item`/`cmd_rate` now document and consume a FLAT
 * top-level shape instead: `"kind": "audit", "rating": "hard",
 * "audited_rating": "good", "agree": false` — no nested `audit` object at
 * all. Replay parity requires the old nested transcripts to parse exactly as
 * they always did, forever, while a fresh session run under 1.10.1 must also
 * resolve — so this function tries the flat top-level `agree` first, then
 * falls back to the nested `item.audit.agree`, and treats whichever is
 * present as authoritative for that item. Do not collapse this to one shape:
 * the other one is real, on disk, right now. */

/** Prefix check — true iff `content` is a background-agent completion
 * envelope rather than a genuine learner turn. Bare `string` content that
 * does NOT start with this prefix is ordinary chat text and must be left
 * alone (no event, no parsing) by every caller. */
export function isTaskNotificationContent(content: string): boolean {
  if (content.startsWith('<task-notification>')) return true
  // Harness-variant delivery, observed in the wild (2026-08): the same
  // envelope prefixed by a plain-text system preamble ("[SYSTEM NOTIFICATION
  // - NOT USER INPUT] ..."), which defeats a bare startsWith and would let
  // the raw envelope — result payload and all — fall through to the chat as
  // a learner bubble. The preamble check stays narrow (must be the very
  // first characters) so a genuine learner message that merely QUOTES an
  // envelope somewhere inside is still rendered as the real turn it is.
  return content.startsWith('[SYSTEM NOTIFICATION') && content.includes('<task-notification>')
}

/** Reads a completed notification whose `<result>` body is a curriculum
 * payload — the shape the curriculum-architect subagent returns for
 * `engram.py add-topic` ({topic, nodes, ...}) — and nothing else. Returns
 * the topic id and node count only: the pin this feeds says "the architect
 * came back and the atlas is being filed", it never re-renders the payload
 * (claims/probes/rubrics are exactly the graded-against material the loop
 * keeps out of the transcript — same discipline as
 * `parseAssessorAuditVerdict`'s closed return type above). Audit results
 * are arrays, not objects with `topic`+`nodes`, so the two parsers are
 * disjoint by shape and a notification resolves as at most one of them. */
export function parseCurriculumReturn(content: string): { topic: string; nodeCount: number } | null {
  const envelope = parseTaskNotificationEnvelope(content)
  if (!envelope?.completed || !envelope.resultText) return null
  let body = envelope.resultText.trim()
  const fence = body.match(/```json\s*([\s\S]*?)```/)
  if (fence) body = fence[1].trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const p = parsed as Record<string, unknown>
  if (typeof p.topic !== 'string' || p.topic.length === 0) return null
  if (typeof p.nodes !== 'object' || p.nodes === null || Array.isArray(p.nodes)) return null
  return { topic: p.topic, nodeCount: Object.keys(p.nodes).length }
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
 * block, invalid JSON, an empty array, an item missing `node` and missing
 * BOTH the flat top-level `agree` and the nested `audit.agree`): a mark stuck
 * at `pending` forever is honest; a fabricated verdict is not.
 *
 * Each item is checked for the flat 1.10.1 shape first (top-level `agree`
 * boolean, sitting alongside `kind: "audit"`), falling back to the nested
 * 1.0.7 shape (`item.audit.agree`) only when the flat field is absent — see
 * the module doctrine comment for the exact verbatim shapes of both. */
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
    if (typeof node !== 'string') return null
    const flatAgree = (item as Record<string, unknown>).agree
    let agree: unknown
    if (typeof flatAgree === 'boolean') {
      agree = flatAgree
    } else {
      const audit = (item as Record<string, unknown>).audit
      if (typeof audit !== 'object' || audit === null) return null
      agree = (audit as Record<string, unknown>).agree
    }
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
