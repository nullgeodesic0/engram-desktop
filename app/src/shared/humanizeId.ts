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
