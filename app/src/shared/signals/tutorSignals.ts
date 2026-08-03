/** Canonical home for the pure predicates that read a tool_use's raw `input`
 * (a Bash command string, or a subagent spawn's `name`/`input`) and answer
 * "does this look like <real signal X>" — the same question `LearnSessionView.tsx`
 * needs to answer live (streaming SessionEvents) and `ritualFromTranscript.ts`
 * needs to answer in replay (walking a saved transcript). Before this module,
 * both call sites carried their own copy of each check — this consolidates
 * them into one, so live and replay can never quietly drift apart on what
 * counts as, say, a pretest `rate` call or an artifact-smith spawn.
 *
 * Zero React, zero session/component state — every export here is a pure
 * `(input) => T` function operating only on its arguments. Callers own all
 * state (refs, `useState`, the replay walk's local vars); this module never
 * does.
 *
 * `shared/` must not reach into `renderer/` (see `ritualFromTranscript.ts`'s
 * doctrine comment) — this module lives in `shared/` precisely so both
 * `renderer/src/app/*SessionView.tsx` and `shared/ritualFromTranscript.ts` can
 * import from it without either reaching into the other.
 */

// ---------------------------------------------------------------------------
// Bash-command signals (Learn + Review both drive their own Bash tool_use
// stream through these; ritualFromTranscript.ts replays the same commands out
// of a saved transcript).
// ---------------------------------------------------------------------------

/** `python3 "$ENGRAM" next --topic <topic>` — the node-boundary call
 * (SKILL.md §3) that fires exactly once per real teaching node, and never
 * during pretest. See LearnSessionView's original doctrine comment (still
 * true, just relocated): /learn's VERIFY step stashes the production and only
 * grades in a batch at session end via the assessor, so a `rate` call
 * essentially never happens mid-session — `next --topic` is the real
 * node-boundary signal instead. */
export function isNextNodeCommand(command: string): boolean {
  return command.includes(' next ') && command.includes('--topic')
}

/** Pretest (SKILL.md §2, new topics only) is the one place /learn calls
 * `rate` directly rather than stash-then-batch-grade — `--kind pretest` is a
 * real, distinct Tier-1 signal, not a guess. */
export function isPretestRateCommand(command: string): boolean {
  return command.includes(' rate ') && command.includes('--kind pretest')
}

/** The pretested node id, if `command` is a pretest `rate` call AND its
 * `--node` flag parses cleanly; null on either failure — never guesses a node
 * id out of a command this isn't confident is even a pretest call. */
export function pretestRateNode(command: string): string | null {
  if (!isPretestRateCommand(command)) return null
  const m = command.match(/--node\s+"?([^"\s]+)"?/)
  return m ? m[1] : null
}

/** A live Review sitting's per-item grading call (`rate --rating <r>`),
 * excluding Learn's own pretest `rate --kind pretest` calls — the two share
 * the ` rate ` substring, but only a genuine review grading call carries
 * `--rating` without `--kind pretest`. The exclusion is a no-op for a
 * Review-only view (pretest never runs there — SKILL.md §2 gates it to
 * /learn's new-topic path) but matters for `ritualFromTranscript.ts`, which
 * replays /learn and /review transcripts through the same walk and must not
 * mistake one domain's call for the other's. */
export function isReviewRateCommand(command: string): boolean {
  return command.includes(' rate ') && command.includes('--rating') && !command.includes('--kind pretest')
}

/** A checkpoint-mode rate call — the overlay's mandated `--source quick-mc`
 * stamp, sniffed off the command string the same way pendingRateTopic reads
 * `--topic` (the rate stdout payload does not echo `source`; only the
 * on-disk receipt carries it, so live counting must read the command). */
export function hasQuickSource(command: string): boolean {
  return /--source\s+["']?quick-mc\b/.test(command)
}

/** The one cap violation that is machine-detectable at the moment it
 * happens: a checkpoint-stamped rate call minting `easy`. The overlay caps
 * a flawless chain at `good`; this firing means the tutor drifted. */
export function isQuickEasyViolation(command: string): boolean {
  return hasQuickSource(command) && /--rating\s+["']?easy\b/.test(command)
}

/** Real signal, grep-verified against the grad-quantum-mechanics sitting of
 * 2026-07-23 (session f1cb000e-9397-49ff-8bbf-3be95b054631, ~/.claude/projects) —
 * the exact call that logged the ket-ln misconception on
 * schrodinger-equation-unitary-evolution: `python3 "$ENGRAM" misconception add
 * --topic <t> --node <n> --description "<text>"`. A separate real transcript
 * (54df0c3e-..., a physics qual-exam sitting) showed the tutor can batch TWO
 * invocations into one multi-line Bash call — each description is bounded by
 * the next newline (or end of string) rather than end-of-string alone, so
 * multiple invocations in one command are each captured, in order. */
export function parseMisconceptionAdds(command: string): Array<{ node: string | undefined; text: string }> {
  if (!command.includes('misconception add')) return []
  const out: Array<{ node: string | undefined; text: string }> = []
  const re = /misconception add\b([\s\S]*?)--description\s+"([\s\S]*?)"(?=\r?\n|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command))) {
    const raw = m[2].trim()
    const nodeMatch = m[1].match(/--node\s+"?([a-z0-9]+(?:-[a-z0-9]+)*)"?/)
    // File-mediated description — the skill's injection-safe pattern
    // (--description "$(cat "$D/….txt")"): the wording genuinely is NOT in
    // the command text, and the lazy capture would otherwise swallow shell
    // fragments through the trailing quotes ("(cat …)" > /dev/null && …,
    // seen rendered live 2026-07-31). Push an EMPTY text: the pin renders
    // its filed-to-the-ledger fallback instead of garbled shell.
    if (raw.includes('$(')) {
      out.push({ node: nodeMatch ? nodeMatch[1] : undefined, text: '' })
      continue
    }
    const text = raw.slice(0, 500)
    if (!text) continue
    out.push({ node: nodeMatch ? nodeMatch[1] : undefined, text })
  }
  return out
}

/** `misconception resolve --id m_...` — the closing half of the ledger loop
 * (misconceptions overhaul), mirroring parseMisconceptionAdds' multi-
 * invocation lesson: a tutor may batch several resolves into one Bash call,
 * so the global regex captures each id in order. Id-only BY DESIGN: the
 * command carries nothing else, and replay (a pure transcript walk, no IPC)
 * could never enrich it — live must not show more than replay can rebuild. */
export function parseMisconceptionResolves(command: string): string[] {
  if (!command.includes('misconception resolve')) return []
  const out: string[] = []
  const re = /misconception resolve\b[\s\S]*?--id\s+"?(m_[A-Za-z0-9_]+)"?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command))) out.push(m[1])
  return out
}

/** `artifact set --topic <t> --node <n> --path <p>` (engram.py) — the literal
 * explorable-registration call, run either by the artifact-smith subagent
 * itself or, per SKILL.md's fallback clause, by the tutor directly. Returns
 * both fields (either may be `undefined` if its flag doesn't parse) whenever
 * the command contains `artifact set` at all; null only when it doesn't —
 * callers that only care about a resolved path gate on `.path` truthiness
 * themselves rather than this function collapsing to null on a missing path. */
export function looksLikeArtifactSetCommand(
  command: string,
): { node: string | undefined; path: string | undefined } | null {
  if (!command.includes('artifact set')) return null
  const pathMatch = command.match(/--path\s+"?([^"\s]+)"?/)
  const nodeMatch = command.match(/--node\s+"?([a-z0-9]+(?:-[a-z0-9]+)*)"?/)
  return { node: nodeMatch ? nodeMatch[1] : undefined, path: pathMatch ? pathMatch[1] : undefined }
}

/** `python3 "$ENGRAM" receipt --file <assessor-output.json>` (SKILL.md step 4)
 * — /learn's batch-grade call, the one place a Bash tool_result carries an
 * ARRAY of per-node grade results (`cmd_receipt` in engram.py) rather than a
 * single item. Promoted here (Task 7) from LearnSessionView's own
 * `looksLikeReceiptCall` so a receipt call's FAILURE can be recognized
 * identically live and in replay — see `classifyEngramBashFailure` below. */
export function isReceiptCommand(command: string): boolean {
  return command.includes('receipt') && command.includes('--file')
}

/** The "production filed for later grading" moment (spike/FINDINGS.md Finding
 * 5.2) — a Bash call containing the word `stash` that isn't actually the
 * next/pretest-rate/receipt call (those also happen to run through Bash and
 * could mention "stash" incidentally, so the exclusions matter more than they
 * would for a narrower regex). Promoted here (Task 7) from
 * LearnSessionView's own `looksLikeStashCall`, same reason as
 * `isReceiptCommand` above. */
export function isStashCommand(command: string): boolean {
  if (!/\bstash\b/.test(command)) return false
  if (isNextNodeCommand(command)) return false
  if (isReceiptCommand(command)) return false
  if (isPretestRateCommand(command)) return false
  return true
}

/** The tool-failure card's vocabulary (Task 7, `components/ritual/
 * ToolFailureCard.tsx`) — the six calls the brief names by name (pretest
 * rate, receipt, stash, next, artifact set, misconception add), Review's own
 * per-item `rate` call (the seventh — not literally named in the six above,
 * but the same class of thing: a call whose SUCCESS already produces UI
 * elsewhere, so its failure rendering nothing today is the exact bug being
 * fixed), and a generic bucket for any other Bash call that's plainly
 * talking to the engine (`engram.py` appears in the command) but isn't one of
 * the specifically-handled seven. Anything else (a build step, an `ls`, a
 * one-off `python3 -c` debug script, a `Read`/`Write`/`Edit`) returns `null` —
 * deliberately out of scope, see the doctrine comment on `tool-failure` in
 * Marks.tsx for why. */
export type ToolFailureKind =
  | 'pretest'
  | 'receipt'
  | 'stash'
  | 'next'
  | 'artifact-set'
  | 'misconception'
  | 'review-rate'
  | 'engram-bash'

/** Classifies a Bash tool_use's command for tool-failure purposes — the ONE
 * function both session views' live `tool_use` dispatch and
 * `ritualFromTranscript.ts`'s replay walk call to decide which ids get
 * claimed into their (separate, per-surface) pending-failure registries, so
 * live and replay can never disagree about which calls are "specifically
 * handled" vs. generic vs. out of scope. Order matters: pretest/receipt/
 * review-rate/next/artifact-set/misconception are each checked before the
 * looser `isStashCommand`/`engram.py` fallbacks, mirroring the exclusions
 * `isStashCommand` itself already encodes. */
export function classifyEngramBashFailure(command: string): ToolFailureKind | null {
  if (isPretestRateCommand(command)) return 'pretest'
  if (isReceiptCommand(command)) return 'receipt'
  if (isReviewRateCommand(command)) return 'review-rate'
  if (isNextNodeCommand(command)) return 'next'
  if (looksLikeArtifactSetCommand(command)) return 'artifact-set'
  if (/misconception (add|resolve)/.test(command)) return 'misconception'
  if (isStashCommand(command)) return 'stash'
  if (command.includes('engram.py')) return 'engram-bash'
  return null
}

// ---------------------------------------------------------------------------
// Subagent-spawn signals (Task/Agent tool_use blocks).
// ---------------------------------------------------------------------------

/** Every real /learn or /review transcript inspected in this environment
 * names the subagent-spawning tool 'Agent', never 'Task' — widened to accept
 * both names for robustness (see task-3-report.md for the full finding). */
export function isSubagentSpawnTool(name: string): boolean {
  return name === 'Task' || name === 'Agent'
}

/** True iff this spawn is the artifact-smith building an explorable (its
 * `input` mentions `engram-artifact-smith` anywhere — description, prompt, or
 * subagent_type all carry it in real spawns, so a blob-level substring check
 * is deliberately loose rather than pinned to one field). */
export function isArtifactSmithSpawnEvent(name: string, input: Record<string, unknown>): boolean {
  if (!isSubagentSpawnTool(name)) return false
  return JSON.stringify(input).includes('engram-artifact-smith')
}

/** True iff this spawn is the engram-assessor at all — audit (`/review`'s
 * honesty check) or verification (`/learn`'s batch-grade), undifferentiated.
 * Chat Presence's `tutorActivity.ts` (renderer-local, live-only) uses this
 * looser check for its `grading: 'assessing'` activity: it needs to know
 * "the assessor is working," full stop, the instant the spawn tool_use
 * fires — the narrower `isAssessorAuditSpawnEvent` below (which also
 * requires the word "audit") exists for a different purpose (Review's
 * `AuditCard`/`pending` mark, which must specifically NOT fire for a /learn
 * verification spawn of the same subagent) and would under-fire here. */
export function isAssessorSpawnEvent(name: string, input: Record<string, unknown>): boolean {
  if (!isSubagentSpawnTool(name)) return false
  return JSON.stringify(input).toLowerCase().includes('engram-assessor')
}

/** True iff this spawn is the assessor auditing a /review sitting's own
 * self-graded items (SKILL.md §3's honesty check) — differentiated from a
 * /learn verification spawn of the SAME subagent by the literal word "audit"
 * appearing in the spawn's own input; /learn's stash items carry
 * `kind:"encode"`, never `kind:"audit"`, so its spawns never mention the
 * word. */
export function isAssessorAuditSpawnEvent(name: string, input: Record<string, unknown>): boolean {
  if (!isSubagentSpawnTool(name)) return false
  const s = JSON.stringify(input).toLowerCase()
  return s.includes('engram-assessor') && s.includes('audit')
}

// ---------------------------------------------------------------------------
// The bubble-split boundary (the LEARN interleave fix — see
// .superpowers/sdd/chat-interleave-fix-report.md).
// ---------------------------------------------------------------------------

/** The engram-ui-bridge MCP tools as they appear in a transcript's (and the
 * live stream's) `tool_use` blocks. Kept here rather than imported from
 * ritualFromTranscript.ts (which exports the same four constants) because
 * that module already imports THIS one — the values are protocol constants,
 * not derived state, so the duplication can't drift without the bridge
 * itself changing names. */
const BRIDGE_TOOL_PREFIX = 'mcp__engram-ui-bridge__'

/** THE shared definition of "this tool_use pins a ritual mark between two
 * stretches of assistant prose" — the single predicate that decides where an
 * assistant bubble must SPLIT so that mark `atIndex` ordering is
 * chronologically correct by construction.
 *
 * Why a split is needed at all: assistant text deltas merge into one growing
 * ChatMessage (the append-if-last-was-assistant rule, present identically in
 * the live views' 'text' handlers, `parseTranscriptToMessages`, and
 * `buildHistoryTimeline`), while ritual marks are pinned BETWEEN messages by
 * `atIndex`. Without a split, text arriving AFTER a mid-turn signal is
 * appended into the same bubble that renders BEFORE the mark — intra-turn
 * order becomes unrepresentable, and every ask/frontispiece/beat card dumps
 * after the whole turn's prose (the exact mis-ordering reported from the
 * 2026-07-27 hamilton-jacobi-theory sprint sitting).
 *
 * Every caller that segments assistant prose MUST consult this same
 * predicate — the live 'text'/'tool_use' handlers in LearnSessionView and
 * ReviewSessionView, `parseTranscriptToMessages` (chatMessages.ts),
 * `buildHistoryTimeline` (SessionHistoryDrawer.tsx), and `deriveRitualMarks`'s
 * message counting (ritualFromTranscript.ts) — so live and replay can never
 * disagree about which message index a given stretch of prose lands on.
 *
 * True iff this tool_use can produce a ritual mark, at dispatch OR at its
 * eventual tool_result (a result can't be seen at split time, and no
 * assistant text can ever arrive between a tool_use and its own result, so
 * splitting at the tool_use covers both cases deterministically):
 *  - bridge calls that pin marks: `render_beat` (beat card + possible
 *    crossing), `session_phase` (frontispiece + possible diagnostic plate),
 *    `ask_user_question` (inline AskCard), `show_figure` (figure card,
 *    live-only), and a `beat_outcome` naming beat `verify` with outcome
 *    `confirmed` (the verify seal — the only outcome that marks; the input
 *    is available here, so other outcomes deliberately do NOT split);
 *  - any Bash call `classifyEngramBashFailure` recognizes — the exact set
 *    whose results can pin diagnostic/misconception/explorable/stamp/lapse/
 *    milestone/atlas/tool-failure marks (its generic `engram-bash` bucket is
 *    included on purpose: ANY engram.py call's failure pins a card);
 *  - the mark-producing subagent spawns: artifact-smith (explorable),
 *    assessor audit (audit card), curriculum-architect (atlas).
 * Everything else (Read/Write/Edit, non-engram Bash, progress_note,
 * suggest_action, spotlight_node, annotate_node, a generic assessor
 * verification spawn) produces no mark and does NOT split — adjacent prose
 * around those keeps merging exactly as before. */
export function isMarkBoundaryToolUse(name: string, input: Record<string, unknown>): boolean {
  if (name.startsWith(BRIDGE_TOOL_PREFIX)) {
    const tool = name.slice(BRIDGE_TOOL_PREFIX.length)
    if (
      tool === 'render_beat' ||
      tool === 'session_phase' ||
      tool === 'ask_user_question' ||
      tool === 'show_figure' ||
      tool === 'render_ticket' ||
      tool === 'report_verdict'
    ) {
      return true
    }
    if (tool === 'beat_outcome') {
      return input.beat === 'verify' && input.outcome === 'confirmed'
    }
    return false
  }
  if (name === 'Bash') {
    const command = String((input as { command?: unknown }).command ?? '')
    return classifyEngramBashFailure(command) !== null
  }
  if (isSubagentSpawnTool(name)) {
    const s = JSON.stringify(input).toLowerCase()
    return s.includes('engram-artifact-smith') || s.includes('curriculum-architect') || (s.includes('engram-assessor') && s.includes('audit'))
  }
  return false
}

/** "Build Schrödinger unitary-evolution explorable" -> "Schrödinger
 * unitary-evolution" — every real artifact-smith spawn's `description`
 * observed (a dozen+ across several sessions) follows this "Build <X>
 * explorable[.]" shape; it's the Task/Agent tool's own required short-label
 * field, not SKILL.md-mandated wording, so this is best-effort and falls back
 * to the raw description if it doesn't match. */
export function explorableTitleFromDescription(description: unknown): string | undefined {
  if (typeof description !== 'string') return undefined
  const trimmed = description.trim()
  if (!trimmed) return undefined
  const stripped = trimmed.replace(/^build\s+/i, '').replace(/\s+explorable\.?$/i, '')
  const title = stripped || trimmed
  return title.length > 120 ? `${title.slice(0, 120)}…` : title
}

/** Best-effort node id out of the spawn prompt's free text — real prompts
 * inspected varied wildly ("Topic: t. Node id: n." / `node "n" in topic "t"` /
 * prose with no structured mention at all), so this is deliberately a
 * last-resort parse, not a relied-upon signal; returns undefined rather than
 * guessing when nothing matches. */
export function explorableNodeFromPrompt(prompt: unknown): string | undefined {
  if (typeof prompt !== 'string') return undefined
  const patterns = [/Node id:\s*([a-z0-9]+(?:-[a-z0-9]+)*)/i, /node\s+"([a-z0-9]+(?:-[a-z0-9]+)*)"/i]
  for (const re of patterns) {
    const m = prompt.match(re)
    if (m) return m[1].toLowerCase()
  }
  return undefined
}
