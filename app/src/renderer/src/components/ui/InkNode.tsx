import { nodeGlyphBlobPath } from '../../shared/inkNodeGlyph'

/** Hand-drawn neuron cell-body glyph — the Night Atlas motif for "a node".
 * The outline is an irregular closed blob whose lumpiness is deterministic
 * per id (same seeding trick as graph3d/layout.ts's seeded()), so a given
 * node always draws the same cell. Variants map to node state:
 * filled = consolidated, outlined = new, dashed = threshold.
 *
 * The blob geometry itself lives in shared/inkNodeGlyph.ts — Chat Instruments
 * Wave B's node-name chips draw this exact same glyph into static HTML, so
 * the wobble math has one source, not two that could quietly drift apart. */
export function InkNode({
  id,
  variant,
  color = 'var(--color-ink-warm)',
  size = 14,
}: {
  id: string
  variant: 'filled' | 'outlined' | 'dashed'
  color?: string
  size?: number
}) {
  const r = size / 2 - 2
  const d = nodeGlyphBlobPath(id, r)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <path
        d={d}
        fill={variant === 'filled' ? color : 'none'}
        stroke={color}
        strokeWidth={1.2}
        strokeDasharray={variant === 'dashed' ? '2.5 2' : undefined}
        opacity={variant === 'filled' ? 0.9 : 0.8}
      />
    </svg>
  )
}
