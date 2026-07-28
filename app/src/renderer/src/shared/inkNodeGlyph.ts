/** Hand-drawn neuron cell-body glyph geometry — the Night Atlas motif for "a
 * node." Extracted out of `components/ui/InkNode.tsx` (which still owns the
 * actual React `<svg>` rendering) so Chat Instruments Wave B's node-name
 * chips can draw the IDENTICAL deterministic-per-id blob into static HTML
 * (`shared/nodeChip.ts` — the chip is built as an HTML string for
 * `dangerouslySetInnerHTML`, not a React tree, so it can't render `<InkNode>`
 * directly) without a second, drifting copy of the wobble math. Pure
 * functions, no React import — safe for both a component and a plain string
 * builder to share. */
export function seededNodeGlyphValue(id: string, salt: number): number {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 10000) / 10000
}

export function nodeGlyphBlobPath(id: string, r: number): string {
  const points = 8
  const cx = r + 2
  const cy = r + 2
  const coords: [number, number][] = []
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    const wobble = 1 + (seededNodeGlyphValue(id, i + 1) - 0.5) * 0.45
    coords.push([cx + Math.cos(angle) * r * wobble, cy + Math.sin(angle) * r * wobble])
  }
  let d = `M ${coords[0][0].toFixed(2)} ${coords[0][1].toFixed(2)}`
  for (let i = 0; i < points; i++) {
    const curr = coords[i]
    const next = coords[(i + 1) % points]
    const midX = (curr[0] + next[0]) / 2
    const midY = (curr[1] + next[1]) / 2
    d += ` Q ${curr[0].toFixed(2)} ${curr[1].toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`
  }
  return d + ' Z'
}
