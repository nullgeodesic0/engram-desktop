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
  /** Everything after the marker line — the probe itself. */
  body: string
}

// `[3/6] ·` or `node 3/6 ·`, then the node id, an optional dagger, and an
// optional *(topic)*. Anchored to the string's start: a marker is always the
// message's opening line, and matching mid-message would turn any bracketed
// fraction in prose into a false card.
const HEADER_RE =
  /^\s*(?:\[(\d+)\s*\/\s*(\d+)\]|node\s+(\d+)\s*\/\s*(\d+))\s*·\s*([a-z0-9][a-z0-9-]*)\s*(†)?\s*(?:\*\(([^)]+)\)\*)?[^\n]*\n?/i

export function parseProbeHeader(text: string): ProbeHeader | null {
  const m = HEADER_RE.exec(text)
  if (!m) return null
  const index = Number(m[1] ?? m[3])
  const total = Number(m[2] ?? m[4])
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return null
  return {
    index,
    total,
    node: m[5],
    threshold: Boolean(m[6]),
    topic: m[7]?.trim() || null,
    body: text.slice(m[0].length).trim(),
  }
}
