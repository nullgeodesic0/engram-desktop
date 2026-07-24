#!/usr/bin/env node
// Generates the Night Atlas app icon + DMG background masters from the same
// seeded-wobble shape language the topic plate uses (InkNode technique) —
// see app/src/renderer/src/components/graph2d/plate.ts for the source of
// truth this is ported from. Plain node, no TS, no build step: this is a
// one-shot generator whose *output* (build/icon.svg, build/icon.png,
// build/dmg-background.png) is what actually ships, committed alongside it
// so a fresh checkout never needs to re-run this to produce a build.
//
// Usage: node scripts/make-icon.mjs
// Then:  npm run icons   (rasterizes build/icon.svg -> build/icon.icns via
//                          qlmanage + sips + iconutil, macOS-only)

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(__dirname, '..')
const BUILD_DIR = join(APP_ROOT, 'build')

// ---------------------------------------------------------------------------
// Night Atlas palette (app/src/renderer/src/index.css)
// ---------------------------------------------------------------------------
const VOID = '#0d0e12'
const VOID_DEEP = '#08090c'
const INK_WARM = '#e8a857'
const INK_WARM_DIM = '#8a6533'
const INK_COOL = '#5b8fa8'
const INK_COOL_DIM = '#3a5a6b'

// ---------------------------------------------------------------------------
// Ported from graph2d/plate.ts — same math, so the icon is unmistakably the
// same organism as the topic plate, not a redrawn logo.
// ---------------------------------------------------------------------------
function seeded(id, salt) {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 10000) / 10000
}

/** Irregular closed blob path, in coordinates centered on the origin —
 * caller translates. Identical algorithm to cellBodyPath in plate.ts. */
function cellBodyPath(id, r, wobbleScale = 0.38) {
  const points = 10
  const coords = []
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    const wobble = 1 + (seeded(id, i + 1) - 0.5) * wobbleScale
    coords.push([Math.cos(angle) * r * wobble, Math.sin(angle) * r * wobble])
  }
  let d = ''
  for (let i = 0; i < points; i++) {
    const curr = coords[i]
    const next = coords[(i + 1) % points]
    const midX = (curr[0] + next[0]) / 2
    const midY = (curr[1] + next[1]) / 2
    d += i === 0 ? `M ${midX.toFixed(2)} ${midY.toFixed(2)}` : ''
    d += ` Q ${curr[0].toFixed(2)} ${curr[1].toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`
  }
  const last = coords[0]
  const firstMid = [(coords[0][0] + coords[1][0]) / 2, (coords[0][1] + coords[1][1]) / 2]
  d += ` Q ${last[0].toFixed(2)} ${last[1].toFixed(2)} ${firstMid[0].toFixed(2)} ${firstMid[1].toFixed(2)} Z`
  return { d, coords }
}

/** Short dendrite stubs reaching from the body rim toward given directions —
 * identical algorithm to dendriteStubs in plate.ts, ported for absolute
 * (pos-relative) coordinates instead of the plate's simulation space.
 *
 * `overlap`: cellBodyPath's wobble means the blob's actual edge at a given
 * angle can sit noticeably inside the nominal radius `r` (wobble factor
 * dips as low as ~0.81, less after quadratic smoothing but still real) —
 * starting the stub exactly at `r` can land outside the drawn fill at that
 * angle, leaving a visible gap between soma and dendrite. `overlap` pulls
 * only the stub's *start* point inward along the same radial direction, by
 * more than the wobble could ever dip, so the start is always covered by
 * the body fill (drawn on top) and the stub reads as growing out of the
 * soma. The outer sweep (mid/end) is computed from the unmoved nominal rim
 * point, so the visible reach of the stub is unchanged. */
function dendriteStubs(id, pos, neighborDirs, r, reachScale = 1, overlap = 0) {
  return neighborDirs.map((dir, i) => {
    const len = Math.hypot(dir.x, dir.y) || 1
    const ux = dir.x / len
    const uy = dir.y / len
    const rim = { x: pos.x + ux * r, y: pos.y + uy * r }
    const start = { x: rim.x - ux * overlap, y: rim.y - uy * overlap }
    const reach = r * (0.8 + seeded(id, 20 + i) * 0.7) * reachScale
    const kink = (seeded(id, 40 + i) - 0.5) * r * 0.6
    const midX = rim.x + ux * reach * 0.55 - uy * kink
    const midY = rim.y + uy * reach * 0.55 + ux * kink
    const endX = rim.x + ux * reach
    const endY = rim.y + uy * reach
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`
  })
}

// ---------------------------------------------------------------------------
// Seed selection: try a handful of candidate ids, keep the one whose blob
// has the lowest wobble variance (smoothest silhouette — survives downscale
// to 16px best) while still being visibly organic, not a perfect circle.
// ---------------------------------------------------------------------------
function wobbleVariance(id) {
  const { coords } = cellBodyPath(id, 100)
  const radii = coords.map(([x, y]) => Math.hypot(x, y))
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length
  const variance = radii.reduce((a, r) => a + (r - mean) ** 2, 0) / radii.length
  return variance
}

const CANDIDATES = ['engram', 'ink-node', 'atlas', 'consolidate', 'engram-icon', 'plate', 'seed-a', 'seed-b', 'seed-c', 'origin']
let bestSeed = CANDIDATES[0]
let bestVariance = Infinity
for (const c of CANDIDATES) {
  const v = wobbleVariance(c)
  if (v < bestVariance) {
    bestVariance = v
    bestSeed = c
  }
}
console.log(`[make-icon] chosen seed "${bestSeed}" (wobble variance ${bestVariance.toFixed(1)}) of ${CANDIDATES.length} candidates`)

// ---------------------------------------------------------------------------
// Squircle background path (superellipse, n=5) — macOS Big Sur+ icons ship
// pre-masked with their own rounded-square field rather than relying on the
// OS to mask a plain square.
// ---------------------------------------------------------------------------
function squirclePath(cx, cy, halfSize, n = 5, steps = 128) {
  const pts = []
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const x = Math.sign(c) * Math.abs(c) ** (2 / n) * halfSize
    const y = Math.sign(s) * Math.abs(s) ** (2 / n) * halfSize
    pts.push([cx + x, cy + y])
  }
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`
  return d + ' Z'
}

// ---------------------------------------------------------------------------
// App icon: 1024px master, squircle field, one warm cell body + 3 dendrite
// stubs, sized so the silhouette alone reads at 16px.
// ---------------------------------------------------------------------------
function buildIconSvg() {
  const SIZE = 1024
  const CENTER = SIZE / 2
  const squircle = squirclePath(CENTER, CENTER, SIZE * 0.47)
  const bodyR = SIZE * 0.225
  const { d: bodyPath } = cellBodyPath(bestSeed, bodyR)

  // Three stubs at evenly spaced-ish angles (seeded jitter keeps it from
  // looking like a perfect tripod), reaching toward the squircle corners.
  const dirs = [0, 1, 2].map((i) => {
    const baseAngle = -Math.PI / 2 + (i / 3) * Math.PI * 2
    const jitter = (seeded(bestSeed, 60 + i) - 0.5) * 0.5
    const angle = baseAngle + jitter
    return { x: Math.cos(angle), y: Math.sin(angle) }
  })
  // Reach kept short (0.55x the plate default) so stubs stay well inside the
  // squircle field at every downscaled size — the silhouette must read at
  // 16px, which means nothing may clip the icon's rounded-square bounds.
  const stubs = dendriteStubs(bestSeed, { x: CENTER, y: CENTER }, dirs, bodyR, 0.55, bodyR * 0.3)

  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="field" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="${VOID}"/>
      <stop offset="100%" stop-color="${VOID_DEEP}"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${INK_WARM}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${INK_WARM}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <path d="${squircle}" fill="url(#field)"/>

  <circle cx="${CENTER}" cy="${CENTER}" r="${bodyR * 2.1}" fill="url(#glow)"/>

  <g stroke="${INK_WARM}" stroke-width="26" stroke-linecap="round" fill="none" opacity="0.95">
    ${stubs.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>

  <path d="${bodyPath}" fill="${INK_WARM}" stroke="${INK_WARM_DIM}" stroke-width="6" transform="translate(${CENTER} ${CENTER})"/>
</svg>
`
}

// ---------------------------------------------------------------------------
// DMG background: 660x400 @2x = 1320x800. Void field, faint dendrite
// constellation, app icon left / arrow / Applications right — matching the
// electron-builder dmg.contents positions (app/package.json "build.dmg").
// Rendered as a square (1320x1320) master with the 1320x800 art centered in
// the middle band, because qlmanage's SVG rasterizer scales non-square
// inputs with a "cover" fit that distorts aspect ratio; a square in, square
// out round-trip avoids that, and the padding is cropped off afterward by
// build-dmg-background.sh via `sips -c 800 1320`.
// ---------------------------------------------------------------------------
function buildDmgSvg() {
  const W = 1320
  const H = 800
  const SQUARE = 1320
  const PAD_Y = (SQUARE - H) / 2 // 260 — vertical offset of the real art within the square master

  const iconCx = W * 0.27 // ~356 — matches dmg.contents file x=180 at 1x
  const iconCy = H * 0.5 + PAD_Y
  const appCx = W * 0.73 // ~964 — matches dmg.contents Applications x=480 at 1x
  const appCy = iconCy

  // Small ink-node echo at the DMG icon position (not the real .icns — Finder
  // draws that on top of the file's actual icon; this is just background art
  // continuity so the constellation reads as reaching toward it).
  const bodyR = 70
  const { d: bodyPath } = cellBodyPath(bestSeed, bodyR)
  const dirs = [
    { x: -1, y: -0.3 },
    { x: -0.2, y: 1 },
    { x: 1, y: -0.6 },
  ]
  const stubs = dendriteStubs(bestSeed, { x: iconCx, y: iconCy }, dirs, bodyR, 1, bodyR * 0.3)

  // Faint constellation: scattered dim dendrite lines across the field,
  // deterministic per index so re-running this script reproduces the file
  // byte-for-byte.
  let constellation = ''
  for (let i = 0; i < 14; i++) {
    const x1 = seeded(`dmg-${i}`, 1) * W
    const y1 = PAD_Y + seeded(`dmg-${i}`, 2) * H
    const ang = seeded(`dmg-${i}`, 3) * Math.PI * 2
    const len = 40 + seeded(`dmg-${i}`, 4) * 90
    const x2 = x1 + Math.cos(ang) * len
    const y2 = y1 + Math.sin(ang) * len
    constellation += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>\n    `
  }

  // Arrow between the two positions, on the shared centerline.
  const arrowY = iconCy
  const arrowX1 = iconCx + 140
  const arrowX2 = appCx - 140
  const arrowMidX = (arrowX1 + arrowX2) / 2

  return `<svg width="${SQUARE}" height="${SQUARE}" viewBox="0 0 ${SQUARE} ${SQUARE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="dmg-field" cx="50%" cy="45%" r="80%">
      <stop offset="0%" stop-color="${VOID}"/>
      <stop offset="100%" stop-color="${VOID_DEEP}"/>
    </radialGradient>
  </defs>

  <rect width="${SQUARE}" height="${SQUARE}" fill="url(#dmg-field)"/>

  <g stroke="${INK_COOL_DIM}" stroke-width="1.5" opacity="0.4">
    ${constellation}
  </g>

  <g stroke="${INK_WARM}" stroke-width="4" stroke-linecap="round" fill="none" opacity="0.85">
    ${stubs.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>
  <path d="${bodyPath}" fill="${INK_WARM}" stroke="${INK_WARM_DIM}" stroke-width="2" opacity="0.9" transform="translate(${iconCx} ${iconCy})"/>

  <g stroke="${INK_COOL}" stroke-width="3" fill="none" opacity="0.55" stroke-linecap="round">
    <line x1="${arrowX1}" y1="${arrowY}" x2="${arrowX2}" y2="${arrowY}"/>
    <path d="M ${arrowX2 - 18} ${arrowY - 14} L ${arrowX2} ${arrowY} L ${arrowX2 - 18} ${arrowY + 14}"/>
  </g>
  <text x="${arrowMidX}" y="${arrowY - 26}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="${INK_COOL}" opacity="0.5" letter-spacing="2">DRAG TO APPLICATIONS</text>
</svg>
`
}

// ---------------------------------------------------------------------------
// Write SVG masters, then rasterize PNG masters via the macOS-only tools
// already used by scripts/build-icons.sh (qlmanage for SVG->PNG, sips for
// resize/crop) — verified present on this machine before relying on them.
// ---------------------------------------------------------------------------
function toolExists(bin) {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

mkdirSync(BUILD_DIR, { recursive: true })

const iconSvgPath = join(BUILD_DIR, 'icon.svg')
writeFileSync(iconSvgPath, buildIconSvg())
console.log(`[make-icon] wrote ${iconSvgPath}`)

const dmgSvgSquarePath = join(BUILD_DIR, '.dmg-background-square.svg')
writeFileSync(dmgSvgSquarePath, buildDmgSvg())

if (!toolExists('qlmanage') || !toolExists('sips')) {
  console.warn(
    '[make-icon] qlmanage/sips not found (macOS-only) — wrote SVG masters only. ' +
      'Run this script on macOS to also produce build/icon.png and build/dmg-background.png.',
  )
  process.exit(0)
}

// build/icon.png (1024, square in/out — no distortion risk).
const iconThumbBase = `${iconSvgPath}.png`
if (existsSync(iconThumbBase)) rmSync(iconThumbBase)
execFileSync('qlmanage', ['-t', '-s', '1024', '-o', BUILD_DIR, iconSvgPath], { stdio: 'ignore' })
const iconPngPath = join(BUILD_DIR, 'icon.png')
execFileSync('sips', ['-z', '1024', '1024', iconThumbBase, '--out', iconPngPath], { stdio: 'ignore' })
rmSync(iconThumbBase)
console.log(`[make-icon] wrote ${iconPngPath}`)

// build/dmg-background.png (1320x800 — rasterize the 1320x1320 square master
// then crop the top/bottom padding back off).
const dmgThumbBase = `${dmgSvgSquarePath}.png`
if (existsSync(dmgThumbBase)) rmSync(dmgThumbBase)
execFileSync('qlmanage', ['-t', '-s', '1320', '-o', BUILD_DIR, dmgSvgSquarePath], { stdio: 'ignore' })
const dmgPngPath = join(BUILD_DIR, 'dmg-background.png')
execFileSync('sips', ['-c', '800', '1320', dmgThumbBase, '--out', dmgPngPath], { stdio: 'ignore' })
rmSync(dmgThumbBase)
rmSync(dmgSvgSquarePath)
console.log(`[make-icon] wrote ${dmgPngPath}`)
