/**
 * The loop's per-item progress marker, which both skills emit as the first
 * line of the message that poses a probe:
 *
 *   Review — `[3/6] · residual-stream †`            (review/SKILL.md §2)
 *   Learn  — `node 2/3 · residual-stream †`          (learn/SKILL.md, grammar §121)
 *
 * A live tutor also appends the topic in italics — `[1/12] · euler-angles
 * -orientation *(classical mechanics)*` — so that trailing group is optional.
 * The `†` marks a THRESHOLD concept (the graph's `threshold` flag), not a
 * footnote: those are the gateway ideas a topic hinges on.
 *
 * Parsed so the renderer can set the marker as a real card instead of leaving
 * it as prose the eye slides past. Returns null for anything that isn't a
 * marker — the common case, and the caller falls back to ordinary rendering.
 */
export interface ProbeHeader {
  index: number
  total: number
  node: string
  /** The graph's threshold flag, as signalled by the tutor's `†`. */
  threshold: boolean
  /** Present only when the tutor annotated the topic; never invented here. */
  topic: string | null
  /** Addition C (chat refine round) — present when the tutor's own header
   * line states how overdue this item is ("· 5 days overdue"), parsed
   * tolerantly (see `OVERDUE_RE` below) from that line's own text — never
   * invented, never recomputed from `due()`'s numbers elsewhere. Real
   * headers state this in more than one shape (a parenthetical topic before
   * it, an em-dash topic before it — see `chat-ordering-fix-report.md`'s own
   * captured real line, `**[3/12] · \`economism-tendency\`** — lenin-what-
   * is-to-be-done · 1 day overdue` — or nothing at all), so this is matched
   * independently of the structural marker/node/topic captures above rather
   * than threaded into one fixed position in `HEADER_RE`. `null` when
   * absent, the common case. */
  daysOverdue: number | null
  /** Everything after the marker line — the probe itself. */
  body: string
}

// Tolerant, independent of HEADER_RE's own capture order — real headers put
// the overdue clause in different positions/shapes (see `daysOverdue`'s own
// doctrine comment), so this is applied to the header LINE's own matched
// text (`m[0]`) rather than woven into the structural regex above.
const OVERDUE_RE = /(\d+)\s*days?\s*overdue/i

// `[3/6] ·` or `node 3/6 ·`, then the node id, an optional dagger, and an
// optional *(topic)*. Anchored to the start of a LINE (multiline), not the
// string: a tutor often leads with a sentence of transition before the
// marker. The `·` separator plus a kebab-case node id is distinctive enough
// that a bracketed fraction in ordinary prose won't match — verified against
// adversarial strings in the parser's tests.
// Tolerant of what a model actually emits rather than the skill's idealized
// example: `[^\S\n]` (not `[ \t]`) so a non-breaking or thin space around the
// separator still matches, the whole middle-dot family as the separator, and
// optional `**`/`` ` `` decoration around the counter and node id. Every one
// of those variants was observed or is a near-miss of one that was.
const SP = '[^\\S\\n]*'
/** Spaces with optional markdown emphasis/code marks — a real tutor bolds the
 * whole `**[1/12] · node**` and italicizes the topic separately, so the
 * decoration lands BETWEEN the parts, not just around the whole line.
 * `{0,4}` (not `{0,2}`) — a real header sometimes stacks bold AND code marks
 * on the SAME token (`` **`[1/5]` · `euler-lagrange-equations` †** ``, a
 * genuine 2026-07 /review sitting): the leading decoration there is `` **` ``
 * — three marker characters — and the `{0,2}` cap this used to carry
 * silently failed to match the whole line, leaving it as unstructured prose
 * instead of a ProbeCard. `{0,4}` covers that shape (and the doubled closing
 * `` `** `` a matching node/dagger can carry) without materially loosening
 * the separator scan below — no header case in the corpus needs more than 2
 * decoration characters PLUS one code-fence backtick on each side. */
const GAP = `${SP}[*\`]{0,4}${SP}`
const HEADER_RE = new RegExp(
  `^${GAP}(?:\\[(\\d+)${SP}/${SP}(\\d+)\\]|node[^\\S\\n]+(\\d+)${SP}/${SP}(\\d+))` +
    `${GAP}[·•∙⋅]${GAP}([a-z0-9][a-z0-9-]*)${GAP}(†)?${GAP}(?:\\*?\\(([^)]+)\\)\\*?)?[^\\n]*\\n?`,
  'im',
)

/** The prose before the marker (if any) and the parsed probe. Null when the
 * text carries no marker at all — the common case. */
export function splitAroundProbeHeader(text: string): { before: string; header: ProbeHeader } | null {
  const m = HEADER_RE.exec(text)
  if (!m) return null
  const index = Number(m[1] ?? m[3])
  const total = Number(m[2] ?? m[4])
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return null
  const overdueMatch = OVERDUE_RE.exec(m[0])
  return {
    before: text.slice(0, m.index).trim(),
    header: {
      index,
      total,
      node: m[5],
      threshold: Boolean(m[6]),
      topic: m[7]?.trim() || null,
      daysOverdue: overdueMatch ? Number(overdueMatch[1]) : null,
      body: text.slice(m.index + m[0].length).trim(),
    },
  }
}

export function parseProbeHeader(text: string): ProbeHeader | null {
  return splitAroundProbeHeader(text)?.header ?? null
}

/** True when `text` is (up to trailing whitespace) NOTHING but a bare probe
 * header — matched, and `header.body` empty. This is the shape a tutor's
 * text block has when it emits `**[3/5] · \`node\`**` and then immediately
 * calls a bridge tool (`render_beat`, in the real corpus case this guards)
 * before writing the probe question itself: the header line lands as its
 * OWN assistant text block, with the question following in a SEPARATE block
 * after the tool call. The interleave fix (`isMarkBoundaryToolUse`) would
 * otherwise split that following block into its own bubble, stranding the
 * header in a title-only `ProbeCard` with the question rendered as
 * unrelated prose underneath — a real, reported bug (see
 * `probe-card-question-fix-report.md`). Callers use this to special-case
 * that ONE boundary: when the bubble about to close is a bare header like
 * this, the next text block is folded into the SAME bubble instead of
 * starting a new one, so `splitAroundProbeHeader` sees header + body
 * together and `ProbeCard` renders the question inside the card, as it
 * already does whenever both arrive in one block. */
export function endsWithBareProbeHeader(text: string): boolean {
  const split = splitAroundProbeHeader(text)
  return split !== null && split.header.body === ''
}

/** Merges a newly-arrived assistant text delta into the PREVIOUS bubble's
 * text — the ONE place every caller that implements the bare-probe-header
 * exception (LearnSessionView.tsx, ReviewSessionView.tsx, chatMessages.ts's
 * `parseTranscriptToMessages`, SessionHistoryDrawer.tsx's
 * `buildHistoryTimeline`) should build the merged string, so a fix here
 * can't drift out of sync across the four copies again.
 *
 * A bare `existingText + newText` concatenation is only correct for genuine
 * mid-stream continuation (`breakBubble` false — the model is still writing
 * the same sentence, delta by delta). When the merge instead happens
 * THROUGH the bare-header exception (a boundary tool fired, but the
 * previous bubble is nothing but a header line with no body), the arriving
 * text is a fresh paragraph from a NEW model turn, and `existingText` has no
 * trailing newline of its own — the header's text simply stopped the
 * instant the tool call fired. Without a separator, `HEADER_RE`'s
 * intentionally permissive trailing `[^\n]*\n?` (there to swallow whatever
 * decoration trails the header on its OWN line) instead swallows the entire
 * next sentence as if it were that trailing junk — a real bug hit live in a
 * /review sitting: the probe's whole question vanished, leaving only its
 * last sentence ("Take your time; write as much of the chain as you can.")
 * visible, because the question's first sentence got consumed into the
 * header match itself and `header.body` started only at the next paragraph
 * break. Inserting a paragraph break here is what the model's own fresh-turn
 * boundary already implied; it changes zero words, only restores the break
 * a raw string concatenation silently erased. */
export function mergeAssistantText(existingText: string, breakBubble: boolean, newText: string): string {
  const viaBareHeaderException = breakBubble && endsWithBareProbeHeader(existingText)
  return existingText + (viaBareHeaderException ? '\n\n' : '') + newText
}
