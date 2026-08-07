/** The one place a `bridge:ui` payload becomes a typed intent.
 *
 * Before this module, each session view shape-guarded the bridge's payloads
 * inline in its own `onBridgeUi` switch: LearnSessionView handled eight tools
 * with hand-written `typeof` ladders, and ReviewSessionView handled exactly
 * one (`report_verdict`) behind an early `return` that silently dropped every
 * other tool. The same `show_figure` call therefore drew a card in a /learn
 * sitting and nothing at all in a /review sitting — the tutor's behavior was
 * identical, the learner's screen was not. Worse, the two ladders could drift
 * apart on their own: they were separate code with no shared test.
 *
 * So: ONE classifier, no React, no view state, fully unit-tested. Both views
 * call `bridgeUiIntent(tool, payload)` and switch on the returned intent's
 * `kind`. A view that has no state for a given intent (Review has no beat
 * trail; Learn has no review queue) simply doesn't handle that case — but it
 * can never again *fail to parse* something the other view parses, because
 * there is only one parse.
 *
 * Discipline preserved from the inline ladders, deliberately:
 *  - Every field is `typeof`-checked before use. The payload is the MCP
 *    tool's raw input — zod-validated at the worker, but this side treats it
 *    as untrusted, same as before.
 *  - A malformed payload returns `null` (ignored), never a partial intent and
 *    never a throw. A tutor that gets a field wrong loses one card; it never
 *    breaks the transcript.
 *  - An unknown tool name returns `null`. New bridge tools are additive; an
 *    older app build talking to a newer worker just ignores what it doesn't
 *    know.
 *  - Nothing here reads or writes state, so live and replay can share it —
 *    `ritualFromTranscript.ts` classifies the SAME payloads out of a saved
 *    transcript through this same function, which is what keeps a resumed
 *    sitting showing the cards the live sitting showed. */

import { parseVerdictHint, type VerdictHint } from './verdictSegments'

/** The seven prose beats `render_beat`/`beat_outcome` may name. Mirrors
 * `ProseBeat` in beatEvents.ts (kept as a Set here for the runtime guard —
 * that module's type is compile-time only). */
const KNOWN_BEATS = new Set(['open_gap', 'predict', 'struggle', 'resolve', 'self_explain', 'connect', 'verify'])
/** Deliberately excludes 'visited' — that's the app's own "a step was taken"
 * default, never something the tutor reports. */
const KNOWN_OUTCOMES = new Set(['confirmed', 'partial', 'missed'])
const KNOWN_ACTION_KINDS = new Set(['open_explorable', 'show_on_map', 'go_review', 'prefill'])

export type BeatOutcome = 'confirmed' | 'partial' | 'missed'

export interface IntentAction {
  label: string
  kind: 'open_explorable' | 'show_on_map' | 'go_review' | 'prefill'
  arg?: string
}

export interface IntentTicket {
  kind: string
  mode: string | null
  fields: { key: string; value: string }[]
}

/** One row of a `render_comparison` call — a labelled column of prose. */
export interface ComparisonSide {
  label: string
  body: string
}

/** One rung of a `render_steps` ladder. `note` is the aside the tutor would
 * otherwise have put in parentheses — the "why this step" line. */
export interface LadderStep {
  text: string
  note?: string
}

/** One entry of a `render_formula` where-clause. */
export interface SymbolGloss {
  symbol: string
  meaning: string
}

export type BridgeUiIntent =
  | { kind: 'phase'; phase: string }
  | { kind: 'beat-outcome'; beat: string; outcome: BeatOutcome }
  | { kind: 'figure'; title: string | null; body: string }
  | { kind: 'ticket'; ticket: IntentTicket }
  | { kind: 'actions'; actions: IntentAction[] }
  | { kind: 'progress-note'; text: string }
  | { kind: 'spotlight'; topicId: string; nodeId: string }
  | { kind: 'verdict-hint'; hint: VerdictHint }
  | { kind: 'annotate'; topicId: string; nodeId: string; latexLabel: string | null; latexClaim: string | null }
  | { kind: 'comparison'; title: string | null; left: ComparisonSide; right: ComparisonSide }
  | { kind: 'steps'; title: string | null; steps: LadderStep[] }
  | { kind: 'formula'; latex: string; caption: string | null; where: SymbolGloss[] }
  | { kind: 'citation'; label: string; locator: string | null; note: string | null }

/** The five entities a model actually emits when it over-escapes prose.
 * Ordered so `&amp;` resolves LAST — decoding it first would turn a literal
 * `&amp;lt;` into `<` instead of `&lt;`. */
const ENTITIES: [RegExp, string][] = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#0*39;|&apos;/g, "'"],
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
]

/** Undo HTML escaping in tutor-authored payload text.
 *
 * Observed live 2026-08-07, in a single `render_steps` call in one /learn
 * sitting: the `title` field arrived as `for $r&lt;a$` while four of that same
 * call's own step bodies carried a raw `for $r<a$`. Same model, same message,
 * same tool — escaped in one field and not the others. The bytes are already
 * escaped when Claude Code writes the transcript, so nothing between the model
 * and this app did it.
 *
 * Nothing downstream can recover from it: `$r&lt;a$` reaches KaTeX as five
 * literal characters where an inequality belongs. And it isn't confined to
 * this channel — the assessor's `<task-notification>` payloads arrive escaped
 * too (see shared/taskNotification.ts).
 *
 * So it's undone here, at the one boundary every bridge payload crosses,
 * rather than in each card. Both live views and `deriveRitualMarks` route
 * through this function, so a sitting can't render one way live and another
 * on resume. The cost is that a learner-visible literal `&lt;` becomes `<` —
 * which in physics or finance prose is what was meant every time. */
function decodeEntities(v: string): string {
  if (!v.includes('&')) return v
  let out = v
  for (const [re, ch] of ENTITIES) out = out.replace(re, ch)
  return out
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? decodeEntities(v) : null
}

/** Optional string field: `undefined`/absent is fine and yields null; a
 * present-but-wrong-typed field is a malformed payload, signalled by the
 * `false` return so the caller can bail on the whole intent. */
function optStr(v: unknown): string | null | false {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') return false
  return v.trim().length > 0 ? decodeEntities(v) : null
}

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function comparisonSide(v: unknown): ComparisonSide | null {
  const rec = record(v)
  if (!rec) return null
  const label = str(rec.label)
  const body = str(rec.body)
  if (!label || !body) return null
  return { label, body }
}

/** Cap on how much structure one call may draw. Not a safety boundary (the
 * tutor is not an adversary here) — a layout one: a 40-rung ladder or a
 * 30-symbol glossary is a wall of text wearing a card's clothes, and the card
 * grammar only reads as premium while it stays card-sized. Over the cap, the
 * intent is dropped and the tutor's own prose (which it writes anyway) is
 * what the learner reads. */
const MAX_STEPS = 12
const MAX_GLOSS = 8
const MAX_ACTIONS = 3

export function bridgeUiIntent(tool: string, rawPayload: unknown): BridgeUiIntent | null {
  const payload = record(rawPayload)
  if (!payload) return null

  switch (tool) {
    case 'session_phase': {
      const phase = str(payload.phase)
      return phase ? { kind: 'phase', phase } : null
    }

    case 'beat_outcome': {
      const beat = str(payload.beat)
      const outcome = str(payload.outcome)
      if (!beat || !outcome) return null
      if (!KNOWN_BEATS.has(beat) || !KNOWN_OUTCOMES.has(outcome)) return null
      return { kind: 'beat-outcome', beat, outcome: outcome as BeatOutcome }
    }

    case 'show_figure': {
      const body = str(payload.body)
      if (!body) return null
      const title = optStr(payload.title)
      if (title === false) return null
      return { kind: 'figure', title, body }
    }

    case 'render_ticket': {
      const kind = str(payload.kind)
      if (!kind) return null
      const mode = optStr(payload.mode)
      if (mode === false) return null
      if (!Array.isArray(payload.fields)) return null
      const fields: { key: string; value: string }[] = []
      for (const f of payload.fields) {
        const rec = record(f)
        if (!rec) return null
        if (typeof rec.key !== 'string' || typeof rec.value !== 'string') return null
        fields.push({ key: decodeEntities(rec.key), value: decodeEntities(rec.value) })
      }
      if (fields.length === 0) return null
      return { kind: 'ticket', ticket: { kind, mode, fields } }
    }

    case 'suggest_action': {
      if (!Array.isArray(payload.actions) || payload.actions.length > MAX_ACTIONS) return null
      const actions: IntentAction[] = []
      for (const a of payload.actions) {
        const rec = record(a)
        if (!rec) return null
        const label = str(rec.label)
        if (!label) return null
        if (typeof rec.kind !== 'string' || !KNOWN_ACTION_KINDS.has(rec.kind)) return null
        const arg = optStr(rec.arg)
        if (arg === false) return null
        actions.push({ label, kind: rec.kind as IntentAction['kind'], ...(arg ? { arg } : {}) })
      }
      return { kind: 'actions', actions }
    }

    case 'progress_note': {
      const text = str(payload.text)
      return text ? { kind: 'progress-note', text } : null
    }

    case 'spotlight_node': {
      const topicId = str(payload.topic)
      const nodeId = str(payload.node)
      if (!topicId || !nodeId) return null
      return { kind: 'spotlight', topicId, nodeId }
    }

    case 'annotate_node': {
      const topicId = str(payload.topic)
      const nodeId = str(payload.node)
      if (!topicId || !nodeId) return null
      const latexLabel = optStr(payload.latex_label)
      const latexClaim = optStr(payload.latex_claim)
      if (latexLabel === false || latexClaim === false) return null
      // The tool's own contract: at least one of the two must be present.
      if (!latexLabel && !latexClaim) return null
      return { kind: 'annotate', topicId, nodeId, latexLabel, latexClaim }
    }

    case 'report_verdict': {
      const hint = parseVerdictHint(payload)
      return hint ? { kind: 'verdict-hint', hint } : null
    }

    case 'render_comparison': {
      const left = comparisonSide(payload.left)
      const right = comparisonSide(payload.right)
      if (!left || !right) return null
      const title = optStr(payload.title)
      if (title === false) return null
      return { kind: 'comparison', title, left, right }
    }

    case 'render_steps': {
      if (!Array.isArray(payload.steps)) return null
      if (payload.steps.length === 0 || payload.steps.length > MAX_STEPS) return null
      const steps: LadderStep[] = []
      for (const s of payload.steps) {
        // Accept a bare string rung as well as the {text, note} object — the
        // shape a model reaches for first when the note is empty anyway.
        if (typeof s === 'string') {
          const text = str(s)
          if (!text) return null
          steps.push({ text })
          continue
        }
        const rec = record(s)
        if (!rec) return null
        const text = str(rec.text)
        if (!text) return null
        const note = optStr(rec.note)
        if (note === false) return null
        steps.push(note ? { text, note } : { text })
      }
      const title = optStr(payload.title)
      if (title === false) return null
      return { kind: 'steps', title, steps }
    }

    case 'render_formula': {
      const latex = str(payload.latex)
      if (!latex) return null
      const caption = optStr(payload.caption)
      if (caption === false) return null
      const where: SymbolGloss[] = []
      if (payload.where !== undefined) {
        if (!Array.isArray(payload.where) || payload.where.length > MAX_GLOSS) return null
        for (const w of payload.where) {
          const rec = record(w)
          if (!rec) return null
          const symbol = str(rec.symbol)
          const meaning = str(rec.meaning)
          if (!symbol || !meaning) return null
          where.push({ symbol, meaning })
        }
      }
      return { kind: 'formula', latex, caption, where }
    }

    case 'cite_source': {
      const label = str(payload.label)
      if (!label) return null
      const locator = optStr(payload.locator)
      const note = optStr(payload.note)
      if (locator === false || note === false) return null
      return { kind: 'citation', label, locator, note }
    }

    default:
      return null
  }
}
