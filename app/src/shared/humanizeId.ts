const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs'])

/** Turns Engram's kebab-case node ids ("euler-angles-orientation") into a readable
 * title ("Euler Angles Orientation") for display only — the id itself remains the
 * lookup key everywhere. Engram's schema has no per-node title field to draw from. */
export function humanizeNodeId(id: string): string {
  const words = id.split(/[-_]+/).filter(Boolean)
  return words
    .map((w, i) => {
      if (/^\d+$/.test(w)) return w
      const lower = w.toLowerCase()
      if (i > 0 && SMALL_WORDS.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

/** Below this, a shared prefix is a coincidence rather than a convention. */
const ARC_MIN_SIBLINGS = 3
/** Above this, a shared leading segment is a word the nodes have in common,
 * not a tag prefixed to them. */
const ARC_MAX_CHARS = 4

/**
 * The arc prefixes in use across a set of node ids.
 *
 * These curricula are authored with a per-arc prefix — `ce-` for the canonical
 * ensemble, `fd-` for foundations, `in-`/`an-`/`res-` in the annealing topic —
 * and rendering one as a word gives "Ce Canonical Partition Function".
 *
 * Detection is by SIBLING FREQUENCY, not by shape. A length-or-dictionary rule
 * was tried first and failed in both directions on the real corpus: it tagged
 * `so3-rotations`, whose "so3" is a group name, and refused `in-` and `an-`,
 * which are arcs that happen to spell words. How long a prefix is and whether
 * it is a word are both irrelevant; being shared by its siblings is the whole
 * signal, because that is what an arc IS.
 */
export function arcPrefixesOf(ids: string[]): Set<string> {
  const counts = new Map<string, number>()
  for (const id of ids) {
    const parts = id.split(/[-_]+/).filter(Boolean)
    if (parts.length < 2) continue
    const head = parts[0].toLowerCase()
    // A tag, not a name. Three nodes called `derivation-a/b/c` do share
    // "derivation", and promoting it would leave "DERIVATION · A". The cap is
    // a floor on absurdity, not the signal — frequency still decides, and
    // every prefix in the corpus (ce, fd, qs, in, an, res, css, l3, t) is
    // comfortably under it.
    if (head.length > ARC_MAX_CHARS) continue
    counts.set(head, (counts.get(head) ?? 0) + 1)
  }
  return new Set(
    [...counts.entries()].filter(([, n]) => n >= ARC_MIN_SIBLINGS).map(([prefix]) => prefix),
  )
}

/**
 * Humanises an id, rendering a known arc prefix as a tag.
 *
 * With an empty arc set this is exactly `humanizeNodeId` — callers without
 * sibling context lose nothing and guess nothing.
 */
export function humanizeWithArcs(id: string, arcs: Set<string>): string {
  const parts = id.split(/[-_]+/).filter(Boolean)
  const head = parts[0]?.toLowerCase()
  if (parts.length < 2 || !head || !arcs.has(head)) return humanizeNodeId(id)
  return `${head.toUpperCase()} · ${humanizeNodeId(parts.slice(1).join('-'))}`
}
