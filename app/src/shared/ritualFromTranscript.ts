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

import { parsePretestGradeResults, verdictFromGrade } from './gradeResult'

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
  id?: string
  tool_use_id?: string
  content?: unknown
}

export const RENDER_BEAT = 'mcp__engram-ui-bridge__render_beat'
export const BEAT_OUTCOME = 'mcp__engram-ui-bridge__beat_outcome'
export const SESSION_PHASE = 'mcp__engram-ui-bridge__session_phase'

/** One bridge `tool_use` block, in true transcript emission order. */
export interface BridgeToolUse {
  name: string
  input: Record<string, unknown>
}

type WalkEvent =
  | { kind: 'user_message' }
  | { kind: 'assistant_text' }
  | { kind: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; toolUseId: string; content: unknown }

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

    // Tool-result plumbing turns (chatMessages.ts skips these for the chat
    // bubbles — they carry an array of tool_result blocks, not real prose —
    // but the diagnostic-plate derivation needs the pretest `rate` call's
    // result, so they're walked here too. Never counted toward messageCount.
    if (line?.type === 'user' && Array.isArray(line.message?.content)) {
      for (const block of line.message.content) {
        if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          yield { kind: 'tool_result', toolUseId: block.tool_use_id, content: block.content }
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

// Mirrors LearnSessionView's looksLikePretestRate/looksLikeNextNodeCall core
// checks (Bash-command substring tests) — duplicated rather than imported
// since shared/ must not reach into renderer/ (see the doctrine comment atop
// this file). Kept in careful sync with those; node/rating extraction isn't
// needed here since parsePretestGradeResults reads `node`/`rating` straight
// out of the result JSON instead of the command text.
function isPretestRateCommand(command: string): boolean {
  return command.includes(' rate ') && command.includes('--kind pretest')
}
function isNextNodeCommand(command: string): boolean {
  return command.includes(' next ') && command.includes('--topic')
}

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

/** Rebuilds the durable subset of ritual marks (beat cards, node crossings,
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
 * Figure/atlas/stash marks are NOT derived here — they're one-time tutor
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
    if (event.kind === 'tool_result') {
      if (pendingPretestToolUseIds.has(event.toolUseId)) {
        pendingPretestToolUseIds.delete(event.toolUseId)
        for (const r of parsePretestGradeResults(event.content)) {
          pretestItems.push({ node: r.node, verdict: verdictFromGrade(r.grade) })
        }
      }
      continue
    }
    // tool_use
    if (event.name === 'Bash') {
      const command = String((event.input as { command?: unknown }).command ?? '')
      if (isPretestRateCommand(command)) pendingPretestToolUseIds.add(event.id)
      if (isNextNodeCommand(command) && diagnosticGateOnNextNode(gate, pretestItems.length)) {
        marks.push({ id: `dmark-${seq++}`, atIndex: messageCount, kind: 'diagnostic', items: [...pretestItems] })
      }
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
