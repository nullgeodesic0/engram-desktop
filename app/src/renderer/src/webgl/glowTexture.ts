import * as THREE from 'three'

/**
 * Reads a color from a CSS custom property. Accepts either a bare property
 * name ("--color-ink-cool") or a var() reference ("var(--color-ink-cool)")
 * so callers can pass EDGE_STYLE's existing `stroke: 'var(--color-ink-cool)'`
 * strings directly without re-formatting them.
 */
export function cssColor(ref: string, fallback: string): THREE.Color {
  const match = ref.match(/^var\((--[a-zA-Z0-9-]+)\)$/)
  const varName = match ? match[1] : ref
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  try {
    return new THREE.Color(v || fallback)
  } catch {
    return new THREE.Color(fallback)
  }
}

/** A brighter, more saturated variant of a theme ink for WebGL surfaces —
 * the UI's own tokens are deliberately muted for legibility, but decorative
 * particles/nodes can afford to actually glow. */
export function vivid(base: THREE.Color, satBoost: number, lightBoost: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 }
  base.getHSL(hsl)
  const c = new THREE.Color()
  c.setHSL(hsl.h, Math.min(1, hsl.s + satBoost), Math.min(0.85, hsl.l + lightBoost))
  return c
}

/** Small radial-gradient sprite so points read as glowing spheres rather than
 * flat squares/discs — a single shared texture, cheap to reuse across many
 * sprites/particles. */
export function makeGlowTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.28)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}
