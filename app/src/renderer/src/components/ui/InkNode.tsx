/** Hand-drawn neuron cell-body glyph — the Night Atlas motif for "a node".
 * The outline is an irregular closed blob whose lumpiness is deterministic
 * per id (same seeding trick as graph3d/layout.ts's seeded()), so a given
 * node always draws the same cell. Variants map to node state:
 * filled = consolidated, outlined = new, dashed = threshold. */
function seeded(id: string, salt: number): number {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 10000) / 10000
}

function blobPath(id: string, r: number): string {
  const points = 8
  const cx = r + 2
  const cy = r + 2
  const coords: [number, number][] = []
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    const wobble = 1 + (seeded(id, i + 1) - 0.5) * 0.45
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
  const d = blobPath(id, r)
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
