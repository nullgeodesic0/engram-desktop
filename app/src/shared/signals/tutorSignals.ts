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
    const text = m[2].trim().slice(0, 500)
    if (!text) continue
    const nodeMatch = m[1].match(/--node\s+"?([a-z0-9]+(?:-[a-z0-9]+)*)"?/)
    out.push({ node: nodeMatch ? nodeMatch[1] : undefined, text })
  }
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
