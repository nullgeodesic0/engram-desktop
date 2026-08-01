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
 * block-by-block — INCLUDING the bubble-split at mark-producing tool_use
 * boundaries (`isMarkBoundaryToolUse`, signals/tutorSignals.ts — the
 * interleave fix; see `deriveRitualMarks`'s own boundary comment below) —
 * (kept in careful sync with that file — it stays the source
 * of truth for actual message text; this only needs the running COUNT) so a
 * mark's `atIndex` always equals "how many chat messages exist so far" at the
 * exact point in the transcript the underlying tool call landed, matching the
 * live path's `pushMark`, which stamps `atIndex: messagesRef.current.length`
 * synchronously when the bridge event arrives. */

import {
  parsePretestGradeResults,
  parseGradeResult,
  parseGradeResults,
  verdictFromGrade,
  lapseReturnDate,
  isStabilityMilestone,
  type StabilityMilestoneScale,
} from './gradeResult'
import { humanizeNodeId } from './humanizeId'
import { parseAuditNotification, parseCurriculumReturn, isTaskNotificationContent } from './taskNotification'
import {
  isPretestRateCommand,
  isNextNodeCommand,
  isReviewRateCommand,
  isReceiptCommand,
  parseMisconceptionAdds,
  parseMisconceptionResolves,
  looksLikeArtifactSetCommand,
  isArtifactSmithSpawnEvent,
  isAssessorAuditSpawnEvent,
  isMarkBoundaryToolUse,
  explorableTitleFromDescription,
  explorableNodeFromPrompt,
  classifyEngramBashFailure,
  type ToolFailureKind,
} from './signals/tutorSignals'

interface TranscriptLine {
  type?: string
  /** ISO timestamp on the raw transcript entry — same field
   * `sessionScan.ts`'s `dateOf` reads for provenance dates. Needed here so a
   * derived lapse mark's "returns <date>" can anchor to the sitting's own
   * timestamp rather than replay-time wall-clock (see `lapseReturnDate` in
   * gradeResult.ts). */
  timestamp?: string
  message?: {
    content?: string | ContentBlock[]
  }
}

interface ContentBlock {
  type?: string
  text?: string
  name?: string
  input?: Record<string, unknown>
  id?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

export const RENDER_BEAT = 'mcp__engram-ui-bridge__render_beat'
export const BEAT_OUTCOME = 'mcp__engram-ui-bridge__beat_outcome'
export const SESSION_PHASE = 'mcp__engram-ui-bridge__session_phase'
export const ASK_USER_QUESTION = 'mcp__engram-ui-bridge__ask_user_question'

/** One bridge `tool_use` block, in true transcript emission order. */
export interface BridgeToolUse {
  name: string
  input: Record<string, unknown>
}

type WalkEvent =
  | { kind: 'user_message' }
  | { kind: 'assistant_text' }
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; toolUseId: string; content: unknown; timestamp?: string; isError: boolean }
  | { kind: 'task_notification'; content: string }

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
      // A background-agent completion (e.g. the assessor audit below) lands
      // as an ordinary `type: "user"` string-content line too — a
      // `<task-notification>` envelope, never a genuine learner turn (see
      // shared/taskNotification.ts's doctrine comment: it carries the
      // assessor's raw JSON, including `rubric_notes` quoting the very
      // rubric the audited sitting is being graded against). It must NOT
      // count toward messageCount or yield a `user_message` — doing either
      // would make chatMessages.ts's sibling walk (which also skips it, see
      // that file) or this module's own callers treat the envelope as a real
      // chat turn. Yielding only `task_notification` here means any mark
      // whose atIndex would have landed AFTER this line in a transcript that
      // contains one shifts down by exactly the count of skipped envelopes —
      // an intentional, documented reindexing, not a bug.
      if (isTaskNotificationContent(line.message.content)) {
        yield { kind: 'task_notification', content: line.message.content }
        continue
      }
      yield { kind: 'user_message' }
      continue
    }

    // Tool-result plumbing turns (chatMessages.ts skips these for the chat
    // bubbles — they carry an array of tool_result blocks, not real prose —
    // but the diagnostic-plate derivation needs the pretest `rate` call's
    // result, so they're walked here too. Never counted toward messageCount.
    if (line?.type === 'user' && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          yield {
            kind: 'tool_result',
            toolUseId: block.tool_use_id,
            content: block.content,
            timestamp: line.timestamp,
            isError: block.is_error === true,
          }
        }
      }
      continue
    }

    if (line?.type === 'assistant' && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (block?.type === 'text' && block.text) {
          yield { kind: 'assistant_text' }
          continue
        }
        if (block?.type === 'tool_use' && typeof block.name === 'string' && typeof block.input === 'object' && block.input !== null) {
          yield { kind: 'tool_use', id: typeof block.id === 'string' ? block.id : '', name: block.name, input: block.input as Record<string, unknown> }
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

/** A single pretest verdict — RitualMark's `diagnostic` kind carries a list of
 * these. Kept as a bare object (not importing GradeResult) since it's the
 * plate's own display vocabulary, already reduced via `verdictFromGrade`. */
export interface DiagnosticItem {
  node: string
  verdict: 'held' | 'partial' | 'unknown'
}

/** Shared state machine deciding WHEN the pretest diagnostic plate fires —
 * used identically by the live wiring (LearnSessionView, one ref per
 * session) and this module's derivation (one local instance per replay), so
 * "when does the plate show up" can never drift between the two surfaces.
 *
 * Rule (task brief): emit when the phase leaves 'pretest' OR the first walk
 * beat arrives, whichever happens first; never emit twice; never emit an
 * empty plate. "The first walk beat arrives" is operationalized as "the
 * first `next --topic` node-selection call lands" rather than literally the
 * first render_beat — SKILL.md §2 shows the pretest's own render_beat calls
 * (administering the cold probes) can fire before any `next --topic` call
 * exists, so gating on a beat directly would fire the plate before the
 * pretest even finishes. `next --topic` is the one call SKILL.md §3 makes
 * exactly once per real teaching node, and never during pretest (§2) — the
 * same signal `looksLikeNextNodeCall` in LearnSessionView already treats as
 * the real node-boundary marker. */
export interface DiagnosticGate {
  phase: string | null
  emitted: boolean
}

export function createDiagnosticGate(): DiagnosticGate {
  return { phase: null, emitted: false }
}

/** Call on every `session_phase` signal. Returns true iff this transition
 * should fire the plate right now (mutates `emitted` when it does).
 * `gate.phase` always advances to `nextPhase`, fire or not. */
export function diagnosticGateOnPhase(gate: DiagnosticGate, nextPhase: string, itemCount: number): boolean {
  const fires = gate.phase === 'pretest' && nextPhase !== 'pretest' && !gate.emitted && itemCount > 0
  gate.phase = nextPhase
  if (fires) gate.emitted = true
  return fires
}

/** Call on every `next --topic` node-selection landing. Returns true iff this
 * is the fallback trigger — the plate hasn't fired yet (e.g. the model never
 * called session_phase) and at least one pretest item is in hand. */
export function diagnosticGateOnNextNode(gate: DiagnosticGate, itemCount: number): boolean {
  if (gate.emitted || itemCount === 0) return false
  gate.emitted = true
  return true
}

// isPretestRateCommand / isNextNodeCommand / isReviewRateCommand now live in
// shared/signals/tutorSignals.ts (imported above) — the single copy Learn,
// Review, and this replay walk all share. node/rating extraction isn't needed
// here since parsePretestGradeResults reads `node`/`rating` straight out of
// the result JSON instead of the command text.

// Task 3 signals, grep-verified against real transcripts (see task-3-report.md
// for the full findings) before writing either of these:
//
// MISCONCEPTION — confirmed real. `~/.claude/projects/*/*.jsonl` session
// f1cb000e-9397-49ff-8bbf-3be95b054631 (the grad-quantum-mechanics sitting of
// 2026-07-23) contains the exact call that logged the ket-ln misconception:
//   python3 "$ENGRAM" misconception add --topic grad-quantum-mechanics \
//     --node schrodinger-equation-unitary-evolution --description "Solves the
//     operator ODE iħ d|ψ>/dt = H|ψ> by taking 'ln(|ψ(t)>/|ψ(0)>)' as if kets
//     could be divided and logged like scalars — pattern-matched from scalar
//     exponential decay instead of exponentiating the operator equation
//     directly to get |ψ(t)>=e^{-iHt/ħ}|ψ(0)>."
// `--description` is always the LAST flag within a single invocation, which
// first suggested anchoring its capture to end-of-string — but a real
// transcript (`54df0c3e-...` — the same physics qual-exam sitting, a later
// Bash call) disproved that: the tutor sometimes batches TWO `misconception
// add` invocations into one multi-line Bash call (clear the stash, then log
// two misconceptions back to back), which an end-of-string anchor would
// merge into one garbled mark and silently drop the second entirely. Each
// invocation's description is instead bounded by the next newline (or true
// end of string) — real descriptions never contain a literal `"` followed
// immediately by a newline — so multiple invocations in one command are
// each captured correctly, in order, via the global match below.
// `parseMisconceptionAdds` now lives in shared/signals/tutorSignals.ts
// (imported above) — the single copy this walk and LearnSessionView share.

// EXPLORABLE — two real signals found, of differing reliability:
//
//  1. `artifact set --topic <t> --node <n> --path <p>` (engram.py) is the
//     literal registration call — confirmed real in multiple sessions (e.g.
//     `.../12498e68-.../*.jsonl`: `artifact set --topic grad-classical-mechanics
//     --node small-oscillations-normal-modes --path "$HOME/.claude/learning/
//     artifacts/grad-classical-mechanics/small-oscillations-normal-modes.html"`).
//     Gives an exact, existence-checkable path — the strongest possible signal
//     — but it's run either by the artifact-smith subagent itself (usually
//     invisible to the parent transcript, see #2) or, per SKILL.md's own
//     fallback clause ("if its report shows registration failed, run the
//     `artifact set` line yourself"), by the tutor directly. Only the latter
//     case actually lands in the transcript this module walks.
//  2. The artifact-smith spawn (a `Task`/`Agent` tool_use whose input mentions
//     `engram-artifact-smith`) fires first and is reliably present, but the
//     smith runs in the BACKGROUND — checked against the exact sitting above
//     (f1cb000e...) and confirmed its subsequent `artifact set` call never
//     appears anywhere in the parent transcript at all, only the spawn and
//     (much later) an ask_user_question referencing the finished explorable.
//     So the spawn is the only universally-present signal; it carries no path,
//     only a title (from the spawn's own required `description` field, which
//     is "Build <X> explorable" in every real example inspected) and,
//     best-effort, a node id parsed out of the free-form prompt text (whose
//     exact wording is NOT standardized by SKILL.md and varies session to
//     session — parsing failure here is expected and handled by leaving the
//     mark's `node` unset rather than guessing).
//
// Tool-name note: every real /learn transcript inspected in this environment
// names the subagent-spawning tool 'Agent', never 'Task' — this is also true
// of the pre-existing `isArtifactSmithSpawn`/curriculum-architect atlas-mark
// checks in LearnSessionView.tsx, which assume 'Task' only and so likely never
// fire against real sessions here. Both names are accepted below for
// robustness; see task-3-report.md for this finding (left unfixed elsewhere —
// out of this task's scope).
//
// `looksLikeArtifactSetCommand`, `isArtifactSmithSpawnEvent`,
// `explorableTitleFromDescription`, and `explorableNodeFromPrompt` now live in
// shared/signals/tutorSignals.ts (imported above) — the single copies this
// walk and LearnSessionView share.

// AUDIT (Task 4) — grep-verified against real transcripts before writing any of
// this: `grep -l audit ~/.claude/projects/*/*.jsonl`, narrowed to real
// `/engram:review` sittings (transcripts whose first user line's content is
// literally `<command-name>/engram:review</command-name>` — the app's own
// resume/kickoff signature) via `~/.claude/projects/-Users-tylerhadsell/*.jsonl`.
// Of 7 such real review sittings found, exactly ONE (`6130a05d-34c0-4191-96c1-
// 894e3b359366.jsonl`) actually triggered an audit — SKILL.md §3 only calls for
// one "if the session had ≥8 items, any disputed grade, or ≥3 partials", so most
// sittings never spawn one. That one sitting's shape:
//
//  1. A Bash call builds a stash whose entries carry `kind: "audit"` and
//     `tutor_rating` (SKILL.md §3's own documented stash shape: `{topic, node,
//     probe, claim, rubric, production, confidence, kind:"audit",
//     tutor_rating:"<r>"}`), then `stash add --file ...`.
//  2. `Agent({description: "Assessor audit of review session", subagent_type:
//     "engram:engram-assessor", prompt: "Run \`... stash list\` and audit the 5
//     items in it (kind: \"audit\") ... return: node, your independent grade
//     ..., and whether you agree or disagree with the tutor_rating ..."})` —
//     confirming the same 'Agent'-not-'Task' naming noted in the EXPLORABLE
//     comment above. Differentiated from a /learn verification spawn of the
//     SAME subagent (also confirmed real, e.g. the physics-qual sitting
//     `54df0c3e-...`'s "Assess stashed physics productions") by the literal
//     word "audit" appearing in the spawn's own input — /learn's stash items
//     carry `kind:"encode"`, never `kind:"audit"`, so its spawns never
//     mention the word.
//  3. The verdict itself does NOT land as this tool_use's `tool_result` — the
//     spawn runs as a background agent (its own tool_result is just "Async
//     agent launched successfully…"), and the actual verdict arrives LATER as
//     a `<task-notification>` string landing in an ordinary `type: "user"`
//     transcript line, matched back to the spawn via `<tool-use-id>`, gated on
//     `<status>completed</status>`. That notification's `<result>` embeds a
//     fenced ```json array — and this real sitting's shape (engine 1.0.7, the
//     version running when it was recorded) is: `"audit": {"tutor_rating":
//     "...", "agree": true|false, "note": "..."}` per item (verified against
//     both the real transcript's actual JSON AND the agent spec's own
//     example at that version — two independent sources agreeing, not a
//     single guessed shape). The engine was later updated to 1.10.1, which
//     FLATTENED this: `agents/engram-assessor.md` and `engram.py`'s
//     `apply_item` now document/consume top-level `kind: "audit"`, `rating`,
//     `audited_rating`, `agree` fields instead of a nested `audit` object.
//     `parseAssessorAuditVerdict` in shared/taskNotification.ts tries the
//     flat shape first and falls back to this nested one, so this historical
//     sitting keeps parsing exactly as it always did (replay parity) while a
//     fresh 1.10.1 sitting also resolves.
//
// That async hand-off matters for where this can ever resolve: SessionManager.ts's
// `type === 'user'` branch only forwards `tool_result` blocks out of an ARRAY
// `message.content` — a task-notification's content is a bare STRING, so it
// never reaches the live SessionEvent stream at all today. A live sitting can
// therefore only ever observe the SPAWN (mark stays `verdict: 'pending'`
// forever, live); only a replayed transcript (this function) can resolve it.
//
// `isAssessorAuditSpawnEvent` now lives in shared/signals/tutorSignals.ts
// (imported above) — the single copy this walk and ReviewSessionView share.

/** Best-effort item count out of the spawn's own prompt text ("...audit the 5
 * items in it (kind: \"audit\")...", the one real phrasing observed) — purely
 * cosmetic for the `pending` mark; undefined rather than guessed if it
 * doesn't match, same discipline as `explorableNodeFromPrompt` above. */
function auditItemCountFromPrompt(prompt: unknown): number | null {
  if (typeof prompt !== 'string') return null
  const m = prompt.match(/(\d+)\s+items?\b/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ASK (Wave E, Task 11) — grep-verified against a real transcript before
// writing any of this: `~/.claude/projects/-Users-tylerhadsell/
// 87baada2-728b-42de-99ee-b9b2e2b36919.jsonl` contains two live Confidence
// asks. The tool_use's `input` matches BridgeAskRequest's own shape minus
// `sessionId`/`requestId` (`question`, `header`, `options: {label,
// description?}[]`, `multiSelect`) — literally the same payload
// mcpBridgeWorker.mjs forwards to bridgeServer.ts's `/bridge/:id/ask`, just
// without the two fields the server itself stamps on. Its `tool_result`
// content is an array of `{type:'text', text:string}` blocks whose text is
// the bare JSON `{"chosen":[...]}`/`{"chosen":null}` bridgeServer.ts's
// `BridgeAskResponse` defines — confirmed against both real results in that
// transcript (`{"chosen":["Pretty sure"]}`, `{"chosen":["Certain"]}`).
interface AskUserQuestionInput {
  question: string
  header: string
  options: { label: string; description?: string }[]
  multiSelect: boolean
}

/** Shape-guards a `ask_user_question` tool_use's `input` — never fabricates a
 * question the model didn't actually send. Any structural mismatch (missing
 * `question`/`header`, a non-array `options`, an option missing its
 * `label`) returns null and the spawn is simply not turned into a mark. */
function parseAskUserQuestionInput(input: Record<string, unknown>): AskUserQuestionInput | null {
  if (typeof input.question !== 'string' || typeof input.header !== 'string') return null
  if (!Array.isArray(input.options)) return null
  const options: { label: string; description?: string }[] = []
  for (const raw of input.options) {
    if (!raw || typeof raw !== 'object') return null
    const label = (raw as Record<string, unknown>).label
    if (typeof label !== 'string') return null
    const description = (raw as Record<string, unknown>).description
    options.push(typeof description === 'string' ? { label, description } : { label })
  }
  return { question: input.question, header: input.header, options, multiSelect: input.multiSelect === true }
}

/** Same string-or-blocks normalization as gradeResult.ts's own (unexported)
 * `contentToText` — kept as a small local copy rather than exporting that
 * one, since the two call sites read genuinely different payloads (a
 * GradeResult vs. `{chosen}`) and this module already keeps its own
 * `walkTranscript`/parsing pieces self-contained. */
function contentAsText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const first = content.find((b) => b && typeof b === 'object' && 'text' in b) as { text?: unknown } | undefined
    if (first && typeof first.text === 'string') return first.text
  }
  return null
}

/** Resolves an `ask_user_question` tool_result into the mark's own `answer`
 * vocabulary — `string[]` for a real pick, `[]` for an explicit skip
 * (`{"chosen":null}` on the wire; see RitualMark's doctrine comment in
 * Marks.tsx for exactly why a skip is never stored as `null` here), or
 * `undefined` when the content can't be parsed as `{chosen: ...}` at all —
 * meaning the caller should leave the mark's `answer` at `null` (still open,
 * or orphaned) rather than guess. Never fabricated. */
function askAnswerFromToolResult(content: unknown): string[] | null | undefined {
  const text = contentAsText(content)
  if (text === null) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const chosen = (parsed as Record<string, unknown>).chosen
  if (chosen === null) return []
  if (Array.isArray(chosen) && chosen.every((c) => typeof c === 'string')) return chosen as string[]
  return undefined
}

// `parseAuditNotification` (resolves a pending audit's verdict from a
// `<task-notification>` string — see the AUDIT doctrine comment above for the
// exact real shape it reads) now lives in `shared/taskNotification.ts`,
// composed from that module's `parseTaskNotificationEnvelope` (tag
// extraction) and `parseAssessorAuditVerdict` (the one function allowed to
// parse the assessor's JSON body) — imported above. This is a PURE
// extraction: same signature, same behavior, verified empty-diff against
// every real transcript on this machine via `npm run check:ritual-snapshot
// -- --diff` before this change was committed. Shared here (rather than only
// in taskNotification.ts) because SessionManager.ts's live wire and
// ReviewSessionView.tsx/LearnSessionView.tsx's live resolution need the exact
// same parser this replay path uses, so replay and live can never disagree
// about the same bytes.

/** Structurally a subset of the `RitualMark` union (components/ritual/Marks.tsx)
 * — only the kinds this module can derive after the fact. Kept as a local
 * type (rather than importing RitualMark) so shared/ doesn't reach into
 * renderer/components; every literal below is still assignable to
 * `RitualMark[]` at call sites since TS matches union members structurally. */
export type DerivedRitualMark =
  | { id: string; atIndex: number; kind: 'beat'; beat: string; content: string }
  | { id: string; atIndex: number; kind: 'crossing'; nodeId: string }
  | { id: string; atIndex: number; kind: 'phase'; phase: string }
  | { id: string; atIndex: number; kind: 'diagnostic'; items: DiagnosticItem[] }
  | { id: string; atIndex: number; kind: 'misconception'; text: string; node?: string }
  | { id: string; atIndex: number; kind: 'misconception-resolved'; misconceptionId: string }
  | { id: string; atIndex: number; kind: 'agent-return'; topic: string; nodeCount: number }
  | { id: string; atIndex: number; kind: 'explorable'; title: string; path?: string; node?: string }
  | { id: string; atIndex: number; kind: 'verify-seal' }
  | { id: string; atIndex: number; kind: 'lapse'; node: string; returnDate: string | null }
  | {
      id: string
      atIndex: number
      kind: 'audit'
      itemCount: number | null
      verdict: 'pending' | 'agreed' | 'disputed'
      disputedNodes: string[]
    }
  | { id: string; atIndex: number; kind: 'milestone'; node: string; scale: StabilityMilestoneScale; sBefore: number; sAfter: number }
  | { id: string; atIndex: number; kind: 'tool-failure'; failureKind: ToolFailureKind }
  | {
      id: string
      atIndex: number
      kind: 'ask'
      // The transcript's own tool_use id — there is no real bridge
      // `requestId` to recover in a replay (that value is minted fresh,
      // server-side, per live HTTP call; see bridgeServer.ts). It only ever
      // needs to be a stable, unique key to match this mark's tool_result
      // within this one derive walk, and a React key at render time — the
      // tool_use id satisfies both without inventing anything.
      requestId: string
      header: string
      question: string
      options: { label: string; description?: string }[]
      multiSelect: boolean
      answer: string[] | null
      live: false
    }

/** Rebuilds the durable subset of ritual marks (beat cards, node crossings,
 *  - `ask` marks (Wave E, Task 11) come from any `ask_user_question` bridge
 *    tool_use — pushed `answer: null, live: false` at the spawn, resolved to
 *    a real `answer` if and only if a matching tool_result parses cleanly
 *    (see `askAnswerFromToolResult`'s doctrine comment above). Unlike
 *    `audit`, this one CAN resolve within a single live sitting too (the
 *    tool_result lands as an ordinary array-content `type:"user"` line, not
 *    a background-agent `<task-notification>`) — but the live views resolve
 *    their own open ask marks directly at answer time, never through this
 *    replay path; this function only ever produces `live: false` marks,
 *    which read correctly either way (already-answered renders identically
 *    regardless of `live`; never-answered renders as the honest orphaned
 *    state, which is exactly right for anything only reconstructable after
 *    the fact).
 * phase frontispieces, the pretest diagnostic plate) from a transcript.
 * Mirrors the live paths exactly:
 *  - `crossToNode` in LearnSessionView only logs a crossing when a node was
 *    already active and the new one differs — the very first node entered
 *    never gets a crossing card, live or replayed.
 *  - `onBridgeBeat` crosses the node (if named) BEFORE pushing the beat mark,
 *    so a crossing mark for a given atIndex always precedes its beat mark —
 *    replayed here in the same order.
 *  - A `session_phase` call only gets a frontispiece when the phase actually
 *    changed (a repeated call for the same phase is a no-op), and if that
 *    same transition also satisfies `DiagnosticGate`, the diagnostic mark is
 *    pushed first so it reads as "here's how pretest went" immediately ahead
 *    of the new phase's title — same order the live path uses.
 *  - `misconception` marks come from `misconception add` Bash calls, and
 *    `explorable` marks from either an artifact-smith spawn (title/node only)
 *    or an `artifact set` call (which fills in an existing spawn's path, or
 *    stands alone if the tutor ran it directly) — see the doctrine comments
 *    on `parseMisconceptionAdds`/`looksLikeArtifactSetCommand` above for the
 *    real-transcript verification behind both.
 *  - `verify-seal` marks come from a `beat_outcome` bridge:ui call naming
 *    beat `verify` with outcome `confirmed` — mirrors LearnSessionView's live
 *    gate exactly (see VerifySeal's doctrine comment in Marks.tsx); partial
 *    and missed verify outcomes still ink the beat trail but never a seal.
 *  - `lapse` marks come from a Review sitting's own `rate --rating` call (not
 *    a pretest one) whose result grades 'lapsed' — mirrors ReviewSessionView's
 *    live push in its rate-result handler, EXCEPT for the "returns <date>"
 *    figure's anchor: the live push anchors to wall-clock now (the lapse just
 *    happened), but a replayed sitting anchors to that entry's own transcript
 *    timestamp instead (same field sessionScan.ts's `dateOf` reads), or omits
 *    the date entirely when no usable timestamp exists — never wall-clock
 *    "now", which would fabricate a future date for an old sitting (see
 *    `lapseReturnDate`'s doctrine comment in gradeResult.ts and LapseRite's
 *    in Marks.tsx).
 *  - `audit` marks come from a /review sitting's own assessor-audit spawn (see
 *    the AUDIT doctrine comment above `isAssessorAuditSpawnEvent` for the
 *    real-transcript shape) — pushed `pending` at the spawn, resolved to
 *    `agreed`/`disputed` if and only if a matching `<task-notification>` with
 *    `<status>completed</status>` later parses cleanly; never fabricated.
 *  - `milestone` marks (Task 6) come from ANY `rate`/`receipt` result (Learn's
 *    pretest, Learn's batch receipt, or Review's per-item rate — every place
 *    a `GradeResult` is parsed) whose `isStabilityMilestone` (gradeResult.ts)
 *    reads non-null — mirrors both live pushes exactly, same shared
 *    predicate, so a resumed sitting can never show a different set of
 *    milestones than the live sitting showed.
 *  - `tool-failure` marks (Task 7) come from any Bash tool_use this transcript
 *    classifies via `classifyEngramBashFailure` (the six specifically-named
 *    calls, Review's own `rate` call, or the generic `engram-bash` bucket)
 *    whose `tool_result` came back `isError` — mirrors both live wirings
 *    exactly, same shared classifier. A Bash call classifyEngramBashFailure
 *    returns `null` for (a build step, `ls`, an ad hoc debug one-liner, a
 *    non-Bash tool like Read/Write/Edit) is deliberately never claimed into
 *    the registry below, so its failure renders nothing — see the doctrine
 *    comment on `tool-failure` in Marks.tsx for why that's scope, not an
 *    oversight.
 * Figure/atlas/stash/docket marks are NOT derived here — they're one-time
 * signals with no durable record in the transcript to replay from (see the
 * doctrine comment on `RitualMark` in Marks.tsx). */
export function deriveRitualMarks(entries: unknown[]): DerivedRitualMark[] {
  const marks: DerivedRitualMark[] = []
  let messageCount = 0
  let lastWasAssistantText = false
  let lastNodeId: string | null = null
  let seq = 0
  const gate = createDiagnosticGate()
  const pretestItems: DiagnosticItem[] = []
  const pendingPretestToolUseIds = new Set<string>()
  // A live Review sitting's own `rate --rating` calls (not pretest) — tracked
  // the same shape as pendingPretestToolUseIds so its tool_result can be
  // matched back to the call that produced it.
  const pendingReviewRateToolUseIds = new Set<string>()
  // Learn's batch-grade `receipt --file` call (Task 6) — its tool_result
  // carries an ARRAY of GradeResults (parseGradeResults, not the single-item
  // parseGradeResult the pretest/review-rate paths above use), each of which
  // can independently earn a milestone mark.
  const pendingReceiptToolUseIds = new Set<string>()
  // Task 7's claimed-tool-use registry — every Bash tool_use
  // `classifyEngramBashFailure` recognizes (the six named calls, Review's own
  // rate call, or the generic engram-bash bucket) gets its id claimed here at
  // dispatch time, exactly like LearnSessionView's/ReviewSessionView's own
  // per-view `toolFailureRegistry` ref — so a later `tool_result` with
  // `isError` can push the SAME specific card a live sitting would have shown.
  const pendingToolFailureKind = new Map<string, ToolFailureKind>()
  // Explorable marks pushed by an artifact-smith spawn (no path yet), keyed by
  // node id, so a later `artifact set` call for the same node fills the path
  // in rather than duplicating the mark — mirrors LearnSessionView's JobsRail
  // matching (see task-3-report.md for why the spawn's path usually never
  // arrives in this transcript at all).
  //
  // A QUEUE per node, not a single slot: re-encoding a repeatedly-lapsing
  // node (the artifact-smith agent's own stated use case) spawns a second
  // smith for the SAME node within one sitting. A single `Map<node, index>`
  // slot would have the second spawn's `.set()` clobber the first spawn's
  // pending entry — so the first spawn's `artifact set` (which lands first,
  // smiths finish in spawn order) would find no pending entry, fall through,
  // and push a stray extra mark, while the SECOND spawn's `artifact set`
  // would then wrongly attach its path to whichever mark happened to still
  // be indexed. FIFO (append on spawn, shift oldest on `artifact set`)
  // matches same-node respawns to their own `artifact set` in completion
  // order instead.
  const pendingExplorableByNode = new Map<string, number[]>()
  // Pending assessor-audit spawns awaiting their `<task-notification>`
  // verdict, FIFO like `pendingExplorableByNode` above (same "more than one
  // per sitting is unlikely but not impossible" caution — the notification's
  // own `<tool-use-id>` is the real match key, this queue just bounds the
  // search to spawns not yet resolved).
  const pendingAudits: Array<{ toolUseId: string; markIndex: number }> = []
  // ask_user_question spawns awaiting their own tool_result — keyed by
  // toolUseId directly (not a FIFO queue like pendingAudits/
  // pendingExplorableByNode above), since the tool_result event already
  // carries the exact tool_use id it answers.
  const pendingAsks = new Map<string, number>()

  for (const event of walkTranscript(entries)) {
    if (event.kind === 'task_notification') {
      for (let i = 0; i < pendingAudits.length; i++) {
        const pending = pendingAudits[i]
        const verdict = parseAuditNotification(event.content, pending.toolUseId)
        if (verdict) {
          const existing = marks[pending.markIndex] as Extract<DerivedRitualMark, { kind: 'audit' }>
          marks[pending.markIndex] = {
            ...existing,
            itemCount: verdict.itemCount,
            verdict: verdict.disputedNodes.length === 0 ? 'agreed' : 'disputed',
            disputedNodes: verdict.disputedNodes,
          }
          pendingAudits.splice(i, 1)
          break
        }
      }
      // A completed architect return — the notification's `<result>` body is
      // a curriculum payload. Pin the moment instead of silence: the learner
      // watched a long "atlas being drawn" wait; this is its receipt. Shape-
      // disjoint from audit results (see parseCurriculumReturn's doctrine
      // comment), so this never double-fires on the loop above.
      const curriculum = parseCurriculumReturn(event.content)
      if (curriculum) {
        marks.push({
          id: `dmark-${seq++}`,
          atIndex: messageCount,
          kind: 'agent-return',
          topic: curriculum.topic,
          nodeCount: curriculum.nodeCount,
        })
      }
      continue
    }
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
    if (event.kind === 'tool_result') {
      // Task 7 — pushed first so a failure reads above whatever (possibly
      // stale/optimistic) mark the matching success-side branch below might
      // also push for the same event; order within one atIndex, not a
      // correctness dependency (the branches below already no-op on
      // unparseable/error content on their own).
      const failureKind = pendingToolFailureKind.get(event.toolUseId)
      if (failureKind !== undefined) {
        pendingToolFailureKind.delete(event.toolUseId)
        if (event.isError) {
          marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'tool-failure', failureKind })
        }
      }
      const askMarkIndex = pendingAsks.get(event.toolUseId)
      if (askMarkIndex !== undefined) {
        pendingAsks.delete(event.toolUseId)
        const answer = askAnswerFromToolResult(event.content)
        // `undefined` means "couldn't parse a {chosen:...} shape" — leave the
        // mark exactly as pushed (`answer: null, live: false`), which is the
        // orphaned-replay rendering anyway, same "never fabricate" discipline
        // as parseAuditNotification above.
        if (answer !== undefined) {
          const existing = marks[askMarkIndex] as Extract<DerivedRitualMark, { kind: 'ask' }>
          marks[askMarkIndex] = { ...existing, answer }
        }
      }
      if (pendingPretestToolUseIds.has(event.toolUseId)) {
        pendingPretestToolUseIds.delete(event.toolUseId)
        for (const r of parsePretestGradeResults(event.content)) {
          pretestItems.push({ node: r.node, verdict: verdictFromGrade(r.grade) })
          const scale = isStabilityMilestone(r)
          if (scale) {
            marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'milestone', node: r.node, scale, sBefore: r.sBefore as number, sAfter: r.sAfter as number })
          }
        }
      }
      if (pendingReceiptToolUseIds.has(event.toolUseId)) {
        pendingReceiptToolUseIds.delete(event.toolUseId)
        if (!event.isError) {
          for (const r of parseGradeResults(event.content)) {
            const scale = isStabilityMilestone(r)
            if (scale) {
              marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'milestone', node: r.node, scale, sBefore: r.sBefore as number, sAfter: r.sAfter as number })
            }
          }
        }
      }
      if (pendingReviewRateToolUseIds.has(event.toolUseId)) {
        pendingReviewRateToolUseIds.delete(event.toolUseId)
        const result = parseGradeResult(event.content)
        if (result && result.grade === 'lapsed') {
          // Anchor to the ENTRY's own timestamp, never wall-clock "now" — a
          // sitting replayed months later must not fabricate a future
          // "returns <date>" from today's date (see lapseReturnDate's
          // doctrine comment in gradeResult.ts). No usable timestamp means
          // no date, full stop — never falls back to today the way
          // sessionScan.ts's dateOf does for provenance dates.
          const parsedTs = event.timestamp ? new Date(event.timestamp) : null
          const anchor = parsedTs && !Number.isNaN(parsedTs.getTime()) ? parsedTs : null
          marks.push({
            id: `dmark-${seq++}`,
            atIndex: messageCount,
            kind: 'lapse',
            node: result.node,
            returnDate: anchor ? lapseReturnDate(result.intervalDays, anchor) : null,
          })
        }
        if (result) {
          const scale = isStabilityMilestone(result)
          if (scale) {
            marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'milestone', node: result.node, scale, sBefore: result.sBefore as number, sAfter: result.sAfter as number })
          }
        }
      }
      continue
    }
    // tool_use — FIRST, the bubble-split boundary (the interleave fix): a
    // mark-producing tool_use ends the current assistant bubble, so the next
    // assistant_text event increments messageCount instead of merging. This
    // MUST mirror `parseTranscriptToMessages`/`buildHistoryTimeline`'s own
    // split (same shared predicate — see isMarkBoundaryToolUse's doctrine
    // comment in signals/tutorSignals.ts), or every mark pushed below with
    // `atIndex: messageCount` would disagree with the rendered message list
    // about where "between the preceding and following prose" actually is.
    if (isMarkBoundaryToolUse(event.name, event.input)) {
      lastWasAssistantText = false
    }
    if (event.name === 'Bash') {
      const command = String((event.input as { command?: unknown }).command ?? '')
      const failureKind = classifyEngramBashFailure(command)
      if (failureKind) pendingToolFailureKind.set(event.id, failureKind)
      if (isPretestRateCommand(command)) pendingPretestToolUseIds.add(event.id)
      if (isReceiptCommand(command)) pendingReceiptToolUseIds.add(event.id)
      if (isReviewRateCommand(command)) pendingReviewRateToolUseIds.add(event.id)
      if (isNextNodeCommand(command) && diagnosticGateOnNextNode(gate, pretestItems.length)) {
        marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'diagnostic', items: [...pretestItems] })
      }
      for (const misconception of parseMisconceptionAdds(command)) {
        marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'misconception', text: misconception.text, node: misconception.node })
      }
      for (const resolvedId of parseMisconceptionResolves(command)) {
        marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'misconception-resolved', misconceptionId: resolvedId })
      }
      const artifactSet = looksLikeArtifactSetCommand(command)
      if (artifactSet?.path) {
        const queue = artifactSet.node ? pendingExplorableByNode.get(artifactSet.node) : undefined
        const pendingIdx = queue?.length ? queue.shift() : undefined
        if (pendingIdx !== undefined) {
          const existing = marks[pendingIdx] as Extract<DerivedRitualMark, { kind: 'explorable' }>
          marks[pendingIdx] = { ...existing, path: artifactSet.path }
          if (queue && queue.length === 0 && artifactSet.node) pendingExplorableByNode.delete(artifactSet.node)
        } else {
          marks.push({
            id: `dmark-${seq++}`,
            atIndex: messageCount,
            kind: 'explorable',
            title: artifactSet.node ? humanizeNodeId(artifactSet.node) : 'Explorable',
            path: artifactSet.path,
            node: artifactSet.node,
          })
        }
      }
      continue
    }
    if (isArtifactSmithSpawnEvent(event.name, event.input)) {
      const input = event.input as { description?: unknown; prompt?: unknown }
      const title = explorableTitleFromDescription(input.description) ?? 'Explorable'
      const node = explorableNodeFromPrompt(input.prompt)
      marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'explorable', title, node })
      if (node) {
        const queue = pendingExplorableByNode.get(node)
        if (queue) queue.push(marks.length - 1)
        else pendingExplorableByNode.set(node, [marks.length - 1])
      }
      continue
    }
    if (event.name === ASK_USER_QUESTION) {
      const parsedInput = parseAskUserQuestionInput(event.input)
      if (parsedInput) {
        marks.push({
          id: `dmark-${seq++}`,
          atIndex: messageCount,
          kind: 'ask',
          requestId: event.id,
          header: parsedInput.header,
          question: parsedInput.question,
          options: parsedInput.options,
          multiSelect: parsedInput.multiSelect,
          answer: null,
          live: false,
        })
        pendingAsks.set(event.id, marks.length - 1)
      }
      continue
    }
    if (isAssessorAuditSpawnEvent(event.name, event.input)) {
      const input = event.input as { prompt?: unknown }
      marks.push({
        id: `dmark-${seq++}`,
        atIndex: messageCount,
        kind: 'audit',
        itemCount: auditItemCountFromPrompt(input.prompt),
        verdict: 'pending',
        disputedNodes: [],
      })
      pendingAudits.push({ toolUseId: event.id, markIndex: marks.length - 1 })
      continue
    }
    if (event.name === SESSION_PHASE) {
      const input = event.input as { phase?: unknown }
      if (typeof input.phase === 'string') {
        const nextPhase = input.phase
        const prevPhase = gate.phase
        const fires = diagnosticGateOnPhase(gate, nextPhase, pretestItems.length)
        if (fires) marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'diagnostic', items: [...pretestItems] })
        if (prevPhase !== nextPhase) marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'phase', phase: nextPhase })
      }
      continue
    }
    if (event.name === BEAT_OUTCOME) {
      const input = event.input as { beat?: unknown; outcome?: unknown }
      // Mirrors LearnSessionView's live gate exactly: only a confirmed verify
      // beat earns the seal — partial/missed get nothing (see VerifySeal's
      // doctrine comment in Marks.tsx for why that's a spec constraint, not
      // an oversight).
      if (input.beat === 'verify' && input.outcome === 'confirmed') {
        marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'verify-seal' })
      }
      continue
    }
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
