# WebGL Topic Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SVG-rendered force-directed Topic Map (`GraphView.tsx`) with a three.js pseudo-3D scene — dependency-depth Z axis, constrained-orbit camera with fly-to, real FSRS-retrievability-driven node glow, and an animated path-to-capstone trail — while reusing the existing force simulation, drag/select/hover logic, search/edge-filter behavior, and node-detail modal without regression.

**Architecture:** Extract the current SVG component's pure graph math (layering, simulation tick, neighbor/frontier/path computation) into a new `graph3d/` module directory shared by the rewritten component. `GraphView.tsx` becomes a three.js scene: `THREE.Sprite` glow-orbs for nodes (color from state, brightness from real per-node retrievability read via `engram.py decay`), batched `LineSegments2` per edge kind, an absolutely-positioned HTML overlay for labels (projected each frame), and a constrained-orbit camera (drag-to-rotate, scroll-to-dolly, fly-to-on-select). The component's external props/behavior stay compatible with `TopicMapView.tsx`, plus one new `retrievability` prop.

**Tech Stack:** React 19 + TypeScript, three.js (`^0.185.1`, already a dependency — `Points`/`Sprite`, `Line2`/`LineSegmentsGeometry`/`LineMaterial`, `EffectComposer`/`UnrealBloomPass` from `three/examples/jsm`), Electron IPC via the existing `window.engram` preload bridge.

## Global Constraints

- **No test runner is configured in this project** (no vitest/jest/playwright unit-test setup — confirmed via `package.json`). Every task's verification is `npm run typecheck` + `npm run build`, plus a concrete manual-check via `npm run dev`, matching this project's established verification pattern for every prior milestone (M0–M22) — do not add a new test framework as part of this plan.
- This is a **daily-use personal app** — before any step that involves quitting/reinstalling the packaged app (only the final task does this), check `ps aux` for a live `claude` subprocess spawned by Engram Desktop (matches `--tools Bash,Write,Read,Task`) and do not disturb an in-progress learning/review session.
- Follow the codebase's established three.js idiom exactly as seen in `src/renderer/src/components/NeuralField.tsx`: one big `useEffect` per THREE.js lifecycle concern, direct DOM/object writes in the animation loop (never React re-renders per frame), `ResizeObserver` for sizing, full disposal (geometries/materials/renderer) in the effect's cleanup function.
- Never fork or reimplement engine logic that already exists in `engram.py` — retrievability comes from `engram.py decay`'s real `r_now`, never a client-side forgetting-curve reimplementation.
- Preserve `TopicMapView.tsx`'s settings panel, search bar, edge-filter checkboxes, and node-detail modal exactly as they behave today — only `GraphView.tsx`'s internals and one new prop change.

---

### Task 1: Extract shared glow-texture/color-helper module

**Files:**
- Create: `src/renderer/src/webgl/glowTexture.ts`
- Modify: `src/renderer/src/components/NeuralField.tsx:1-53` (remove the three local functions, import from the new module instead)

**Interfaces:**
- Produces: `cssColor(ref: string, fallback: string): THREE.Color`, `vivid(base: THREE.Color, satBoost: number, lightBoost: number): THREE.Color`, `makeGlowTexture(): THREE.Texture` — all used by later tasks (Task 6 onward) and by the now-refactored `NeuralField.tsx`.

- [ ] **Step 1: Create the shared module**

```ts
// src/renderer/src/webgl/glowTexture.ts
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
```

- [ ] **Step 2: Refactor `NeuralField.tsx` to use the shared module**

Replace lines 1–53 of `src/renderer/src/components/NeuralField.tsx` (the imports block through the end of `makeGlowTexture`) with:

```tsx
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { onPulse } from '../../../shared/neuralFieldBus'
import { cssColor, vivid, makeGlowTexture } from '../webgl/glowTexture'

const PARTICLE_COUNT = 180
const CONNECT_DISTANCE = 110
const MAX_CONNECTIONS_PER_PARTICLE = 4
const BASE_PARTICLE_SIZE = 6.5
const BASE_PARTICLE_OPACITY = 0.9
const PULSE_DECAY = 0.94 // per frame — a pulse fades to near-nothing in ~1–1.5s at 60fps
```

(Everything from `export function NeuralField() {` onward — currently starting at line 61 — is unchanged; only the top of the file moves from defining `cssColor`/`vivid`/`makeGlowTexture` locally to importing them.)

- [ ] **Step 3: Verify**

```bash
cd app
npm run typecheck
npm run build
```
Expected: both pass with no errors (this is a pure extraction — no behavior change).

Then run `npm run dev`, open any view, and confirm the ambient particle background still renders and drifts exactly as before (same colors, same synapse-line fading) — this is the only manual check needed since the code is unchanged in behavior, only moved.

- [ ] **Step 4: Commit**

```bash
cd .
git add app/src/renderer/src/webgl/glowTexture.ts app/src/renderer/src/components/NeuralField.tsx
git commit -m "refactor: extract shared WebGL glow-texture/color helpers"
```

---

### Task 2: Typed decay result + preload signature

**Files:**
- Modify: `src/shared/types.ts` (add new interfaces near `ArtifactEntry`, end of file)
- Modify: `src/preload/index.ts` (type the existing `decay` method's return value)

**Interfaces:**
- Produces: `DecayNodeEntry`, `DecayResult` — consumed by Task 11 (`TopicMapView.tsx`).

- [ ] **Step 1: Add the types**

Append to the end of `src/shared/types.ts` (after the existing `ArtifactEntry` interface):

```ts
export interface DecayNodeEntry {
  topic: string
  node: string
  due: boolean
  s: number | null
  r_now: number
  r_no_review: number
  r_if_reviewed: number
  s_if_reviewed: number | null
}

export interface DecayResult {
  topic: string
  horizon_days: number
  encoded: number
  due_now: number
  nodes: DecayNodeEntry[]
}
```

- [ ] **Step 2: Type the preload method**

In `src/preload/index.ts`, add `DecayResult` to the type-only import from `../shared/types` (the existing multi-line import list that already includes `TopicSummary, EngramStats, DueItem, ...`):

```ts
  DecayResult,
```

Then change:

```ts
  decay: (topic?: string, horizon?: number): Promise<unknown> => ipcRenderer.invoke('engram:decay', topic, horizon),
```

to:

```ts
  decay: (topic?: string, horizon?: number): Promise<DecayResult> => ipcRenderer.invoke('engram:decay', topic, horizon),
```

- [ ] **Step 3: Verify**

```bash
cd app
npm run typecheck
npm run build
```
Expected: both pass (no current renderer code calls `window.engram.decay`, so this is a safe, isolated type tightening).

Cross-check the field names against the real engine output (already confirmed once during design, re-confirm here):

```bash
python3 "~/.claude/plugins/cache/engram/engram/1.0.7/scripts/engram.py" decay --topic grad-classical-mechanics
```
Expected: JSON with a top-level `nodes` array whose entries have exactly `topic, node, due, s, r_now, r_no_review, r_if_reviewed, s_if_reviewed` — matching `DecayNodeEntry` field-for-field.

- [ ] **Step 4: Commit**

```bash
cd .
git add app/src/shared/types.ts app/src/preload/index.ts
git commit -m "feat: add typed DecayResult for engram.py decay output"
```

---

### Task 3: Graph3D shared types module

**Files:**
- Create: `src/renderer/src/components/graph3d/types.ts`

**Interfaces:**
- Produces: `EdgeKind`, `SimEdge`, `EdgeStyleSpec`, `EDGE_STYLE`, `ForceParams`, `DEFAULT_FORCE_PARAMS` — consumed by Task 4 (`layout.ts`), Task 6 (`GraphView.tsx`, which re-exports these for `TopicMapView.tsx`'s unchanged import statement).

- [ ] **Step 1: Create the module**

This is a direct, unmodified extraction of the corresponding declarations from the current `src/renderer/src/components/GraphView.tsx` (lines 17–54):

```ts
// src/renderer/src/components/graph3d/types.ts

export type EdgeKind = 'requires' | 'derives_from' | 'contrasts_with' | 'analogous_to'

export interface SimEdge {
  source: string
  target: string
  kind: EdgeKind
}

export interface EdgeStyleSpec {
  stroke: string
  dash?: string
  width: number
  label: string
}

export const EDGE_STYLE: Record<EdgeKind, EdgeStyleSpec> = {
  requires: { stroke: 'var(--color-ink-cool)', width: 1.3, label: 'requires' },
  derives_from: { stroke: 'var(--color-ink-cool-dim)', dash: '1 3', width: 1, label: 'derives from' },
  contrasts_with: { stroke: 'var(--color-ink-danger-dim)', dash: '5 3', width: 1, label: 'contrasts with' },
  analogous_to: { stroke: 'var(--color-ink-warm-dim)', dash: '1 4', width: 1, label: 'analogous to' },
}

export interface ForceParams {
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
  nodeSize: number
  linkThickness: number
  labelSize: number
  showLabels: 'auto' | 'always' | 'never'
  showArrows: boolean
}

export const DEFAULT_FORCE_PARAMS: ForceParams = {
  centerForce: 1,
  repelForce: 1,
  linkForce: 1,
  linkDistance: 1,
  nodeSize: 1,
  linkThickness: 1,
  labelSize: 11,
  showLabels: 'auto',
  showArrows: true,
}
```

- [ ] **Step 2: Verify**

```bash
cd app
npm run typecheck
```
Expected: passes — this file isn't imported anywhere yet, so it can't break anything; typecheck just confirms the file itself is valid TypeScript.

- [ ] **Step 3: Commit**

```bash
cd .
git add app/src/renderer/src/components/graph3d/types.ts
git commit -m "refactor: extract graph edge/force-param types into graph3d/types.ts"
```

---

### Task 4: Graph3D pure layout/simulation module

**Files:**
- Create: `src/renderer/src/components/graph3d/layout.ts`

**Interfaces:**
- Consumes: `TopicGraph`, `EngramNode` from `../../../../shared/types`; `EdgeKind, SimEdge, ForceParams` from `./types` (Task 3).
- Produces: `SimNode3D`, `Z_NEAR`, `Z_FAR`, `seeded`, `layersOf`, `computeZ`, `buildEdges`, `computeDegree`, `computeNeighbors`, `computeFrontierIds`, `computeForwardAdjacency`, `findCapstoneId`, `bfsPathToCapstone`, `initSimNodes`, `stepSimulation` — all consumed by Task 6 (`GraphView.tsx`).

- [ ] **Step 1: Create the module**

This ports the pure graph/simulation logic already present in the current `GraphView.tsx` (the `layersOf`, `seeded`, the `edges`/`degree`/`neighbors`/`frontierIds`/`forwardAdjacency`/`capstoneId`/`pathToCapstone` `useMemo` bodies, and the `tick()` force-simulation math), unchanged in behavior, plus the new `computeZ`/`Z_NEAR`/`Z_FAR` depth mapping:

```ts
// src/renderer/src/components/graph3d/layout.ts
import type { TopicGraph } from '../../../../shared/types'
import type { EdgeKind, SimEdge, ForceParams } from './types'

export interface SimNode3D {
  id: string
  x: number
  y: number
  z: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
  r: number
  layer: number
}

/** Dependency-depth Z range — foundational nodes (layer 0) sit near the
 * camera, the capstone (deepest layer) sits farthest back. Static per node,
 * set once when the simulation is (re)initialized — never touched by the
 * force simulation, which only ever moves nodes in X/Y. */
export const Z_NEAR = 420
export const Z_FAR = -420

/** Deterministic pseudo-random in [0,1) seeded by a string — keeps the initial
 * scatter stable across re-renders of the same topic instead of jumping around. */
export function seeded(id: string, salt: number): number {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 10000) / 10000
}

export function layersOf(graph: TopicGraph): Map<string, number> {
  const depth = new Map<string, number>()
  function depthOf(id: string, seen: Set<string>): number {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const requires = graph.nodes[id]?.edges.requires ?? []
    const d = requires.length === 0 ? 0 : 1 + Math.max(...requires.map((r) => depthOf(r, seen)))
    depth.set(id, d)
    return d
  }
  for (const id of graph.order) depthOf(id, new Set())
  return depth
}

export function computeZ(layer: number, maxLayer: number): number {
  if (maxLayer <= 0) return Z_NEAR
  const t = layer / maxLayer
  return Z_NEAR + (Z_FAR - Z_NEAR) * t
}

export function buildEdges(graph: TopicGraph): SimEdge[] {
  const list: SimEdge[] = []
  const seen = new Set<string>()
  for (const id of graph.order) {
    const e = graph.nodes[id]?.edges
    if (!e) continue
    for (const r of e.requires ?? []) list.push({ source: r, target: id, kind: 'requires' })
    for (const r of e.derives_from ?? []) list.push({ source: r, target: id, kind: 'derives_from' })
    for (const r of e.contrasts_with ?? []) {
      const key = [id, r].sort().join('::c::')
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ source: id, target: r, kind: 'contrasts_with' })
    }
    for (const r of e.analogous_to ?? []) {
      const key = [id, r].sort().join('::a::')
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ source: id, target: r, kind: 'analogous_to' })
    }
  }
  return list.filter((e) => graph.nodes[e.source] && graph.nodes[e.target])
}

export function computeDegree(edges: SimEdge[]): Map<string, number> {
  const d = new Map<string, number>()
  for (const e of edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1)
    d.set(e.target, (d.get(e.target) ?? 0) + 1)
  }
  return d
}

export function computeNeighbors(graph: TopicGraph, edges: SimEdge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const id of graph.order) m.set(id, new Set())
  for (const e of edges) {
    m.get(e.source)?.add(e.target)
    m.get(e.target)?.add(e.source)
  }
  return m
}

/** "Frontier" — not-yet-started nodes whose every prerequisite is already
 * past 'new' — i.e. what /engram:learn would actually teach next. */
export function computeFrontierIds(graph: TopicGraph): Set<string> {
  const s = new Set<string>()
  for (const id of graph.order) {
    const node = graph.nodes[id]
    if (!node || node.state !== 'new') continue
    const requires = node.edges.requires ?? []
    if (requires.every((r) => graph.nodes[r]?.state !== 'new')) s.add(id)
  }
  return s
}

/** Forward-only adjacency (prerequisite -> the node that requires it) for the
 * "path to mastery" highlight — direction matters here, unlike `computeNeighbors`. */
export function computeForwardAdjacency(edges: SimEdge[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const e of edges) {
    if (e.kind !== 'requires') continue
    if (!m.has(e.source)) m.set(e.source, [])
    m.get(e.source)!.push(e.target)
  }
  return m
}

export function findCapstoneId(graph: TopicGraph): string | null {
  return graph.order.find((id) => graph.nodes[id]?.capstone) ?? null
}

export function bfsPathToCapstone(
  start: string,
  capstoneId: string | null,
  forwardAdjacency: Map<string, string[]>,
): string[] | null {
  if (!capstoneId) return null
  if (start === capstoneId) return [start]
  const queue = [start]
  const parent = new Map<string, string>()
  const seen = new Set([start])
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const next of forwardAdjacency.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      parent.set(next, cur)
      if (next === capstoneId) {
        const path = [capstoneId]
        let p = capstoneId
        while (parent.has(p)) {
          p = parent.get(p)!
          path.push(p)
        }
        return path
      }
      queue.push(next)
    }
  }
  return null
}

export function initSimNodes(graph: TopicGraph, edges: SimEdge[], centerX: number, centerY: number): Map<string, SimNode3D> {
  const layers = layersOf(graph)
  const maxLayer = Math.max(0, ...Array.from(layers.values()))
  const degree = computeDegree(edges)
  const sim = new Map<string, SimNode3D>()
  for (const id of graph.order) {
    const layer = layers.get(id) ?? 0
    const angle = seeded(id, 1) * Math.PI * 2
    const radiusBand = 60 + (layer / Math.max(1, maxLayer)) * Math.min(centerX, centerY) * 0.7
    const jitter = seeded(id, 2) * 40
    sim.set(id, {
      id,
      x: centerX + Math.cos(angle) * (radiusBand + jitter),
      y: centerY + Math.sin(angle) * (radiusBand + jitter),
      z: computeZ(layer, maxLayer),
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      r: 5 + Math.min(10, degree.get(id) ?? 0) * 1.4 + (graph.nodes[id]?.capstone ? 3 : 0),
      layer,
    })
  }
  return sim
}

/** One force-simulation tick — repulsion, spring edges, weak centering pull.
 * Mutates `sim` in place. Only ever touches x/y/vx/vy — z is set once by
 * `initSimNodes` and never moves. Identical math to the current SVG
 * GraphView's `tick()`, just extracted so it's usable outside a React effect. */
export function stepSimulation(
  sim: Map<string, SimNode3D>,
  edges: SimEdge[],
  params: ForceParams,
  alpha: number,
  centerX: number,
  centerY: number,
): void {
  const nodes = Array.from(sim.values())
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d2 = dx * dx + dy * dy
      if (d2 < 1) d2 = 1
      const d = Math.sqrt(d2)
      const force = ((900 * params.repelForce) / d2) * alpha
      dx /= d
      dy /= d
      a.vx -= dx * force
      a.vy -= dy * force
      b.vx += dx * force
      b.vy += dy * force
    }
  }
  for (const e of edges) {
    const a = sim.get(e.source)
    const b = sim.get(e.target)
    if (!a || !b) continue
    const target = (e.kind === 'requires' || e.kind === 'derives_from' ? 90 : 130) * params.linkDistance
    let dx = b.x - a.x
    let dy = b.y - a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const strength = (e.kind === 'requires' ? 0.06 : 0.02) * params.linkForce * alpha
    const disp = (d - target) * strength
    dx /= d
    dy /= d
    a.vx += dx * disp
    a.vy += dy * disp
    b.vx -= dx * disp
    b.vy -= dy * disp
  }
  for (const n of nodes) {
    n.vx += (centerX - n.x) * 0.003 * params.centerForce * alpha
    n.vy += (centerY - n.y) * 0.003 * params.centerForce * alpha
    if (n.fx != null) {
      n.x = n.fx
      n.vx = 0
    } else {
      n.vx *= 0.82
      n.x += n.vx
    }
    if (n.fy != null) {
      n.y = n.fy
      n.vy = 0
    } else {
      n.vy *= 0.82
      n.y += n.vy
    }
  }
}

export type { EdgeKind }
```

- [ ] **Step 2: Verify**

```bash
cd app
npm run typecheck
```
Expected: passes. This module isn't imported anywhere yet (Task 6 wires it in), so there's no behavioral check possible until then — that's expected and covered by Task 6's manual verification.

- [ ] **Step 3: Commit**

```bash
cd .
git add app/src/renderer/src/components/graph3d/layout.ts
git commit -m "refactor: extract graph layout/simulation math into graph3d/layout.ts"
```

---

### Task 5: Orbit camera math module

**Files:**
- Create: `src/renderer/src/components/graph3d/orbitCamera.ts`

**Interfaces:**
- Produces: `OrbitState`, `ORBIT_MIN_ELEVATION`, `ORBIT_MAX_ELEVATION`, `ORBIT_MIN_RADIUS`, `ORBIT_MAX_RADIUS`, `clampOrbit`, `orbitPosition`, `easeOutCubic`, `lerp`, `lerpOrbit` — consumed by Task 6 and Task 7 (`GraphView.tsx`).

- [ ] **Step 1: Create the module**

```ts
// src/renderer/src/components/graph3d/orbitCamera.ts
import * as THREE from 'three'

/** A constrained-orbit camera state: rotates around a target point within a
 * limited elevation range (never flips over the top/bottom) and dollies
 * in/out — deliberately not a free-fly camera, so it can never get "lost" and
 * node dragging (which projects onto a fixed depth plane, see layout.ts'
 * SimNode3D.z) stays simple. */
export interface OrbitState {
  azimuth: number // radians, unclamped — a full 360° spin is fine
  elevation: number // radians, clamped
  radius: number // clamped
  targetX: number
  targetY: number
  targetZ: number
}

export const ORBIT_MIN_ELEVATION = -0.6981317 // -40deg
export const ORBIT_MAX_ELEVATION = 0.6981317 // +40deg
export const ORBIT_MIN_RADIUS = 200
export const ORBIT_MAX_RADIUS = 2200

export function clampOrbit(state: OrbitState): OrbitState {
  return {
    ...state,
    elevation: Math.min(ORBIT_MAX_ELEVATION, Math.max(ORBIT_MIN_ELEVATION, state.elevation)),
    radius: Math.min(ORBIT_MAX_RADIUS, Math.max(ORBIT_MIN_RADIUS, state.radius)),
  }
}

/** Spherical -> cartesian camera position around the orbit's target. */
export function orbitPosition(state: OrbitState): THREE.Vector3 {
  const { azimuth, elevation, radius, targetX, targetY, targetZ } = state
  const x = targetX + radius * Math.cos(elevation) * Math.sin(azimuth)
  const y = targetY + radius * Math.sin(elevation)
  const z = targetZ + radius * Math.cos(elevation) * Math.cos(azimuth)
  return new THREE.Vector3(x, y, z)
}

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - c, 3)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Interpolates between two orbit states for a fly-to animation. Azimuth uses
 * shortest-path interpolation so a fly-to never spins the long way around. */
export function lerpOrbit(a: OrbitState, b: OrbitState, t: number): OrbitState {
  let da = b.azimuth - a.azimuth
  while (da > Math.PI) da -= Math.PI * 2
  while (da < -Math.PI) da += Math.PI * 2
  return clampOrbit({
    azimuth: a.azimuth + da * t,
    elevation: lerp(a.elevation, b.elevation, t),
    radius: lerp(a.radius, b.radius, t),
    targetX: lerp(a.targetX, b.targetX, t),
    targetY: lerp(a.targetY, b.targetY, t),
    targetZ: lerp(a.targetZ, b.targetZ, t),
  })
}
```

- [ ] **Step 2: Verify**

```bash
cd app
npm run typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
cd .
git add app/src/renderer/src/components/graph3d/orbitCamera.ts
git commit -m "feat: add constrained-orbit camera math module"
```

---

### Task 6: GraphView.tsx — full three.js rewrite (scene, nodes, edges, labels, retrievability brightness, camera interaction)

This is the core task: `GraphView.tsx` is fully replaced. It delivers functional parity with the current SVG component (drag/pan-as-orbit/zoom-as-dolly/hover/select/open/search-dim/edge-filter/threshold-and-capstone-styling/force-sliders) plus the new pseudo-3D depth and retrievability-driven brightness. Fly-to easing, bloom, frontier rings, the animated path trail, and error-handling are deliberately deferred to Tasks 7–10 so this task's diff stays reviewable.

**Files:**
- Modify (full replacement): `src/renderer/src/components/GraphView.tsx`

**Interfaces:**
- Consumes: everything from Task 3 (`graph3d/types.ts`) and Task 4 (`graph3d/layout.ts`) and Task 5 (`graph3d/orbitCamera.ts`); `cssColor, makeGlowTexture` from Task 1 (`webgl/glowTexture.ts`); `TopicGraph, EngramNode` from `shared/types`; `humanizeNodeId` from `shared/humanizeId`.
- Produces: `GraphView` (React component, props below), re-exports `EDGE_STYLE`, `DEFAULT_FORCE_PARAMS`, `type EdgeKind`, `type ForceParams` (so `TopicMapView.tsx`'s existing import line needs zero changes). New prop: `retrievability: Map<string, number> | null`, consumed starting in Task 11.

```ts
interface GraphViewProps {
  graph: TopicGraph
  selected: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  edgeFilter: Record<EdgeKind, boolean>
  query: string
  params: ForceParams
  retrievability: Map<string, number> | null
}
```

- [ ] **Step 1: Replace the entire file**

Replace the full contents of `src/renderer/src/components/GraphView.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { TopicGraph, EngramNode } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { cssColor, makeGlowTexture } from '../webgl/glowTexture'
import { EDGE_STYLE, DEFAULT_FORCE_PARAMS, type EdgeKind, type ForceParams, type SimEdge } from './graph3d/types'
import {
  buildEdges,
  computeNeighbors,
  computeFrontierIds,
  computeForwardAdjacency,
  findCapstoneId,
  initSimNodes,
  stepSimulation,
} from './graph3d/layout'
import { clampOrbit, orbitPosition, type OrbitState } from './graph3d/orbitCamera'

export { EDGE_STYLE, DEFAULT_FORCE_PARAMS }
export type { EdgeKind, ForceParams }

const EDGE_KINDS: EdgeKind[] = ['requires', 'derives_from', 'contrasts_with', 'analogous_to']

function nodeFill(node: EngramNode): string {
  if (node.state === 'new') return 'var(--color-ink-cool-dim)'
  if (node.state === 'learning') return 'var(--color-ink-cool)'
  return 'var(--color-ink-warm)'
}

/** How much a node's real memory decay dims its glow. A `new` node has no
 * retrievability yet (nothing to decay from), so a missing map entry reads as
 * full brightness — decay only visibly applies once a node has FSRS history. */
function retrievabilityBrightness(r: number | undefined): number {
  return 0.4 + 0.6 * (r ?? 1)
}

interface GraphViewProps {
  graph: TopicGraph
  selected: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  edgeFilter: Record<EdgeKind, boolean>
  query: string
  params: ForceParams
  retrievability: Map<string, number> | null
}

export function GraphView({ graph, selected, onSelect, onOpen, edgeFilter, query, params, retrievability }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const labelContainerRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  // Pure graph derivations — identical call sites to the old SVG component,
  // just imported from graph3d/layout.ts instead of defined inline.
  const edges: SimEdge[] = useMemo(() => buildEdges(graph), [graph])
  const neighbors = useMemo(() => computeNeighbors(graph, edges), [graph, edges])
  const frontierIds = useMemo(() => computeFrontierIds(graph), [graph])
  const forwardAdjacency = useMemo(() => computeForwardAdjacency(edges), [edges])
  const capstoneId = useMemo(() => findCapstoneId(graph), [graph])

  // Bridge refs — the render loop lives in a mount-once effect (below) and
  // reads the latest props/derived data via refs each frame, exactly like the
  // old component's `paramsRef` pattern, extended to every prop that can
  // change without needing to tear down the WebGL scene.
  const graphRef = useRef(graph)
  graphRef.current = graph
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const neighborsRef = useRef(neighbors)
  neighborsRef.current = neighbors
  const frontierIdsRef = useRef(frontierIds)
  frontierIdsRef.current = frontierIds
  const forwardAdjacencyRef = useRef(forwardAdjacency)
  forwardAdjacencyRef.current = forwardAdjacency
  const capstoneIdRef = useRef(capstoneId)
  capstoneIdRef.current = capstoneId
  const paramsRef = useRef(params)
  paramsRef.current = params
  const edgeFilterRef = useRef(edgeFilter)
  edgeFilterRef.current = edgeFilter
  const queryRef = useRef(query)
  queryRef.current = query
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const hoveredRef = useRef(hovered)
  hoveredRef.current = hovered
  const retrievabilityRef = useRef(retrievability)
  retrievabilityRef.current = retrievability

  // Exposed by the mount effect so other effects (param changes, graph
  // changes) can reach into the running scene without re-creating it.
  const reheatRef = useRef<() => void>(() => {})
  const resetForNewGraphRef = useRef<(g: TopicGraph, e: SimEdge[]) => void>(() => {})
  const resetViewRef = useRef<() => void>(() => {})

  useEffect(() => {
    reheatRef.current()
  }, [params])

  useEffect(() => {
    resetForNewGraphRef.current(graph, edges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  useEffect(() => {
    const container = containerRef.current
    const labelContainer = labelContainerRef.current
    if (!container || !labelContainer) return

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 10, 5000)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      return // WebGL unavailable — see Task 10 for a visible fallback notice.
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const glowTexture = makeGlowTexture()

    let centerX = container.clientWidth / 2 || 400
    let centerY = container.clientHeight / 2 || 300
    let sim = initSimNodes(graphRef.current, edgesRef.current, centerX, centerY)
    let alpha = 1

    const orbit: OrbitState = clampOrbit({
      azimuth: 0,
      elevation: 0.3,
      radius: 900,
      targetX: centerX,
      targetY: centerY,
      targetZ: 0,
    })

    const nodeGroup = new THREE.Group()
    scene.add(nodeGroup)
    const nodeSprites = new Map<string, THREE.Sprite>()
    const haloSprites = new Map<string, THREE.Sprite>()

    function disposeNodeSprites() {
      for (const sprite of nodeSprites.values()) {
        nodeGroup.remove(sprite)
        sprite.material.dispose()
      }
      for (const sprite of haloSprites.values()) {
        nodeGroup.remove(sprite)
        sprite.material.dispose()
      }
      nodeSprites.clear()
      haloSprites.clear()
    }

    function rebuildNodeSprites(g: TopicGraph) {
      disposeNodeSprites()
      for (const id of g.order) {
        const node = g.nodes[id]
        if (!node) continue
        const material = new THREE.SpriteMaterial({
          map: glowTexture,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
        const sprite = new THREE.Sprite(material)
        sprite.userData.id = id
        nodeGroup.add(sprite)
        nodeSprites.set(id, sprite)

        if ((node.fsrs.lapses ?? 0) > 0) {
          const haloMat = new THREE.SpriteMaterial({
            map: glowTexture,
            color: new THREE.Color('#e05a4e'),
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
          const halo = new THREE.Sprite(haloMat)
          halo.userData.id = id
          nodeGroup.add(halo)
          haloSprites.set(id, halo)
        }
      }
    }
    rebuildNodeSprites(graphRef.current)

    const edgeLines = new Map<EdgeKind, LineSegments2>()
    const edgeMaterials = new Map<EdgeKind, LineMaterial>()
    const edgeColors = new Map<EdgeKind, THREE.Color>()
    for (const kind of EDGE_KINDS) {
      const geo = new LineSegmentsGeometry()
      const mat = new LineMaterial({
        linewidth: EDGE_STYLE[kind].width,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      })
      mat.resolution.set(container.clientWidth || 1, container.clientHeight || 1)
      const lineObj = new LineSegments2(geo, mat)
      lineObj.frustumCulled = false
      scene.add(lineObj)
      edgeLines.set(kind, lineObj)
      edgeMaterials.set(kind, mat)
      edgeColors.set(kind, cssColor(EDGE_STYLE[kind].stroke, '#5b8fa8'))
    }

    // --- HTML label overlay: one <div> per currently-visible label, position
    // written each frame from a screen-space projection (never React state
    // for position — only created/removed when the visible-id set changes). ---
    const labelEls = new Map<string, HTMLDivElement>()
    function ensureLabel(id: string): HTMLDivElement {
      let el = labelEls.get(id)
      if (!el) {
        el = document.createElement('div')
        el.className = 'absolute select-none pointer-events-none whitespace-nowrap'
        el.style.transform = 'translate(-9999px,-9999px)'
        labelContainer.appendChild(el)
        labelEls.set(id, el)
      }
      return el
    }
    function removeLabel(id: string) {
      const el = labelEls.get(id)
      if (el) {
        labelContainer.removeChild(el)
        labelEls.delete(id)
      }
    }

    const raycaster = new THREE.Raycaster()
    const pointerNdc = new THREE.Vector2()

    function updatePointerNdc(clientX: number, clientY: number) {
      const rect = container.getBoundingClientRect()
      pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    }

    function hitTestNode(clientX: number, clientY: number): string | null {
      updatePointerNdc(clientX, clientY)
      raycaster.setFromCamera(pointerNdc, camera)
      const targets = Array.from(nodeSprites.values())
      const hits = raycaster.intersectObjects(targets, false)
      return hits.length > 0 ? ((hits[0].object.userData.id as string) ?? null) : null
    }

    /** Projects a screen point onto the horizontal plane at a fixed world Z —
     * node Z is a static dependency-depth offset (see layout.ts), so dragging
     * a node only ever changes its X/Y, never its depth. */
    function projectToPlaneZ(clientX: number, clientY: number, z: number): { x: number; y: number } | null {
      updatePointerNdc(clientX, clientY)
      raycaster.setFromCamera(pointerNdc, camera)
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z)
      const point = new THREE.Vector3()
      const hit = raycaster.ray.intersectPlane(plane, point)
      return hit ? { x: point.x, y: point.y } : null
    }

    type DragState = { kind: 'node'; id: string } | { kind: 'orbit'; lastX: number; lastY: number } | null
    let drag: DragState = null

    function onPointerDown(e: PointerEvent) {
      const hitId = hitTestNode(e.clientX, e.clientY)
      if (hitId) {
        onSelect(hitId)
        const n = sim.get(hitId)
        if (n) {
          const p = projectToPlaneZ(e.clientX, e.clientY, n.z)
          if (p) {
            n.fx = p.x
            n.fy = p.y
          }
        }
        drag = { kind: 'node', id: hitId }
        reheat()
      } else {
        drag = { kind: 'orbit', lastX: e.clientX, lastY: e.clientY }
      }
      container.setPointerCapture(e.pointerId)
    }

    function onPointerMove(e: PointerEvent) {
      if (drag?.kind === 'node') {
        const n = sim.get(drag.id)
        if (n) {
          const p = projectToPlaneZ(e.clientX, e.clientY, n.z)
          if (p) {
            n.fx = p.x
            n.fy = p.y
          }
        }
        return
      }
      if (drag?.kind === 'orbit') {
        const dx = e.clientX - drag.lastX
        const dy = e.clientY - drag.lastY
        drag.lastX = e.clientX
        drag.lastY = e.clientY
        const next = clampOrbit({
          ...orbit,
          azimuth: orbit.azimuth - dx * 0.006,
          elevation: orbit.elevation + dy * 0.006,
        })
        orbit.azimuth = next.azimuth
        orbit.elevation = next.elevation
        return
      }
      // Not dragging — continuous hover hit-testing.
      const hitId = hitTestNode(e.clientX, e.clientY)
      setHovered((h) => (h === hitId ? h : hitId))
    }

    function onPointerUp() {
      if (drag?.kind === 'node') {
        const n = sim.get(drag.id)
        if (n) {
          n.fx = null
          n.fy = null
        }
      }
      drag = null
    }

    function onDoubleClick(e: MouseEvent) {
      const hitId = hitTestNode(e.clientX, e.clientY)
      if (hitId) onOpen(hitId)
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 0.9 : 1.1
      const next = clampOrbit({ ...orbit, radius: orbit.radius * factor })
      orbit.radius = next.radius
    }

    function resetView() {
      const bounds = computeCentroid()
      orbit.azimuth = 0
      orbit.elevation = 0.3
      orbit.radius = 900
      orbit.targetX = bounds.x
      orbit.targetY = bounds.y
      orbit.targetZ = bounds.z
    }
    resetViewRef.current = resetView

    function computeCentroid(): { x: number; y: number; z: number } {
      const nodes = Array.from(sim.values())
      if (nodes.length === 0) return { x: centerX, y: centerY, z: 0 }
      let x = 0
      let y = 0
      let z = 0
      for (const n of nodes) {
        x += n.x
        y += n.y
        z += n.z
      }
      return { x: x / nodes.length, y: y / nodes.length, z: z / nodes.length }
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerUp)
    container.addEventListener('dblclick', onDoubleClick)
    container.addEventListener('wheel', onWheel, { passive: false })

    function reheat() {
      alpha = Math.max(alpha, 0.6)
    }
    reheatRef.current = reheat

    resetForNewGraphRef.current = (g: TopicGraph, e: SimEdge[]) => {
      centerX = container.clientWidth / 2 || 400
      centerY = container.clientHeight / 2 || 300
      sim = initSimNodes(g, e, centerX, centerY)
      alpha = 1
      rebuildNodeSprites(g)
      const c = computeCentroid()
      orbit.targetX = c.x
      orbit.targetY = c.y
      orbit.targetZ = c.z
    }

    let raf = 0

    function tick() {
      const p = paramsRef.current
      const g = graphRef.current
      const currentEdges = edgesRef.current

      if (alpha > 0.001) {
        stepSimulation(sim, currentEdges, p, alpha, centerX, centerY)
        alpha *= 0.985
      }

      const activeHighlight = hoveredRef.current ?? selectedRef.current
      const activeNeighbors = activeHighlight ? neighborsRef.current.get(activeHighlight) : null
      const q = queryRef.current.trim().toLowerCase()
      const matches = q
        ? new Set(
            g.order.filter(
              (id) =>
                id.toLowerCase().includes(q) ||
                humanizeNodeId(id).toLowerCase().includes(q) ||
                g.nodes[id]?.claim.toLowerCase().includes(q),
            ),
          )
        : null

      const visibleLabelIds = new Set<string>()

      for (const id of g.order) {
        const node = g.nodes[id]
        const n = sim.get(id)
        const sprite = nodeSprites.get(id)
        if (!node || !n || !sprite) continue

        sprite.position.set(n.x, n.y, n.z)
        const r = n.r * p.nodeSize
        sprite.scale.set(r * 2, r * 2, 1)

        const dimmed =
          (activeHighlight != null && activeHighlight !== id && !activeNeighbors?.has(id)) ||
          (matches != null && !matches.has(id))
        const brightness = retrievabilityBrightness(retrievabilityRef.current?.get(id))
        const baseColor = cssColor(nodeFill(node), '#e8a857')
        const mat = sprite.material as THREE.SpriteMaterial
        mat.color = baseColor
        mat.opacity = (dimmed ? 0.22 : 1) * brightness

        const halo = haloSprites.get(id)
        if (halo) {
          halo.position.set(n.x, n.y, n.z)
          halo.scale.set(r * 2.6, r * 2.6, 1)
          ;(halo.material as THREE.SpriteMaterial).opacity = dimmed ? 0.06 : 0.3
        }

        const isSelected = selectedRef.current === id
        const isHovered = hoveredRef.current === id
        const showLabel =
          p.showLabels === 'always' || (p.showLabels === 'auto' && (isHovered || isSelected || n.r > 9))
        if (showLabel) {
          visibleLabelIds.add(id)
          const el = ensureLabel(id)
          const projected = new THREE.Vector3(n.x, n.y, n.z).project(camera)
          if (projected.z > 1 || projected.z < -1) {
            el.style.display = 'none'
          } else {
            const px = ((projected.x + 1) / 2) * container.clientWidth
            const py = ((1 - projected.y) / 2) * container.clientHeight
            el.style.display = 'block'
            el.style.transform = `translate(${px + r + 6}px, ${py - 8}px)`
            el.style.fontSize = `${p.labelSize}px`
            el.style.color = isSelected ? 'var(--color-text-primary)' : 'var(--color-text-dim)'
            el.style.opacity = dimmed ? '0.22' : '1'
            el.textContent = humanizeNodeId(id)
          }
        }
      }
      for (const id of Array.from(labelEls.keys())) {
        if (!visibleLabelIds.has(id)) removeLabel(id)
      }

      for (const kind of EDGE_KINDS) {
        const lineObj = edgeLines.get(kind)!
        const mat = edgeMaterials.get(kind)!
        if (!edgeFilterRef.current[kind]) {
          lineObj.visible = false
          continue
        }
        lineObj.visible = true
        const relevant = currentEdges.filter((e) => e.kind === kind)
        const positions = new Float32Array(relevant.length * 6)
        const colors = new Float32Array(relevant.length * 6)
        const baseColor = edgeColors.get(kind)!
        let count = 0
        for (const e of relevant) {
          const a = sim.get(e.source)
          const b = sim.get(e.target)
          if (!a || !b) continue
          const dimmed = activeHighlight != null && e.source !== activeHighlight && e.target !== activeHighlight
          const op = (dimmed ? 0.06 : 0.55) * p.linkThickness
          const o = count * 6
          positions[o] = a.x
          positions[o + 1] = a.y
          positions[o + 2] = a.z
          positions[o + 3] = b.x
          positions[o + 4] = b.y
          positions[o + 5] = b.z
          colors[o] = baseColor.r * op
          colors[o + 1] = baseColor.g * op
          colors[o + 2] = baseColor.b * op
          colors[o + 3] = baseColor.r * op
          colors[o + 4] = baseColor.g * op
          colors[o + 5] = baseColor.b * op
          count++
        }
        lineObj.geometry.setPositions(positions.subarray(0, count * 6))
        lineObj.geometry.setColors(colors.subarray(0, count * 6))
        mat.linewidth = EDGE_STYLE[kind].width * p.linkThickness
      }

      const pos = orbitPosition(orbit)
      camera.position.copy(pos)
      camera.lookAt(orbit.targetX, orbit.targetY, orbit.targetZ)

      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    function resize() {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      for (const mat of edgeMaterials.values()) mat.resolution.set(w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerUp)
      container.removeEventListener('dblclick', onDoubleClick)
      container.removeEventListener('wheel', onWheel)
      disposeNodeSprites()
      for (const kind of EDGE_KINDS) {
        edgeLines.get(kind)!.geometry.dispose()
        edgeMaterials.get(kind)!.dispose()
      }
      for (const el of labelEls.values()) labelContainer.removeChild(el)
      labelEls.clear()
      glowTexture.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 rounded-xl overflow-hidden" style={{ background: 'var(--color-void)' }}>
      <div ref={labelContainerRef} className="absolute inset-0 pointer-events-none overflow-hidden" />
      <div className="absolute bottom-3 right-3 flex gap-1.5">
        <button
          onClick={() => resetViewRef.current()}
          title="Reset view"
          className="focus-ring panel px-2.5 py-1.5 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
        >
          Reset
        </button>
        <button
          onClick={() => reheatRef.current()}
          title="Re-settle layout"
          className="focus-ring panel px-2.5 py-1.5 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
        >
          ↻ Settle
        </button>
      </div>
    </div>
  )
}
```

Note: `EDGE_KINDS` was previously a local constant only used inside `TopicMapView.tsx` (it stays there, unchanged) — this new module-level `EDGE_KINDS` inside `GraphView.tsx` is a separate, internal-only list used for iterating edge-kind line objects, not exported.

- [ ] **Step 2: Verify**

```bash
cd app
npm run typecheck
npm run build
```
Expected: both pass. If `npm run typecheck` reports that `TopicMapView.tsx` is missing the `retrievability` prop on `<GraphView>`, that's expected and will be fixed in Task 11 — for now, temporarily add `retrievability={null}` at the `<GraphView>` call site in `TopicMapView.tsx` (around line 147) so the build stays green until Task 11 does it properly:

```tsx
            <GraphView
              graph={graph}
              selected={selectedNode}
              onSelect={setSelectedNode}
              onOpen={setOpenNode}
              edgeFilter={edgeFilter}
              query={query}
              params={forceParams}
              retrievability={null}
            />
```

- [ ] **Step 3: Manual verification**

```bash
npm run dev
```
Navigate to Topic Map, select a real in-progress topic (e.g. grad-classical-mechanics), and confirm:
- The graph renders as glowing 3D-ish orbs with connecting lines, tilted (not flat top-down).
- Dragging on empty space rotates the view (azimuth/elevation); it never flips upside down.
- Scrolling zooms in/out (dolly), clamped (it stops getting closer/farther past a point).
- Dragging a node repositions it and the simulation reheats (nodes visibly resettle).
- Clicking a node selects it (opens its detail info elsewhere in the page, per `TopicMapView.tsx`'s existing `selectedNode` wiring); double-clicking opens its detail modal.
- Hovering a node highlights it and dims unrelated nodes/edges; typing in the search box dims non-matching nodes.
- Toggling each of the four edge-filter checkboxes shows/hides that edge kind.
- Every force/display slider (center/repel/link force, link distance, node size, link thickness, label size) visibly changes the layout/appearance.
- "Reset" and "↻ Settle" buttons work.
- Switching topics (via the topic dropdown) rebuilds the graph without any console errors and without the WebGL canvas going blank.

- [ ] **Step 4: Commit**

```bash
cd .
git add app/src/renderer/src/components/GraphView.tsx app/src/renderer/src/app/TopicMapView.tsx
git commit -m "feat: rewrite Topic Map as a pseudo-3D WebGL scene"
```

---

### Task 7: Fly-to camera easing on selection change

**Files:**
- Modify: `src/renderer/src/components/GraphView.tsx`

**Interfaces:**
- Consumes: `lerpOrbit, easeOutCubic` from `./graph3d/orbitCamera` (Task 5, not yet imported in Task 6 — add here).

- [ ] **Step 1: Add the fly-to state and trigger**

In the imports at the top of `GraphView.tsx`, change:

```ts
import { clampOrbit, orbitPosition, type OrbitState } from './graph3d/orbitCamera'
```
to:
```ts
import { clampOrbit, orbitPosition, lerpOrbit, easeOutCubic, type OrbitState } from './graph3d/orbitCamera'
```

Inside the mount effect, immediately after the `const orbit: OrbitState = clampOrbit({...})` block, add:

```ts
    let flyFrom: OrbitState | null = null
    let flyTo: OrbitState | null = null
    let flyStart = 0
    const FLY_DURATION_MS = 550

    function flyToNode(id: string) {
      const n = sim.get(id)
      if (!n) return
      flyFrom = { ...orbit }
      flyTo = clampOrbit({ ...orbit, targetX: n.x, targetY: n.y, targetZ: n.z })
      flyStart = performance.now()
    }
```

- [ ] **Step 2: Drive the animation from `tick()`**

In `tick()`, immediately before the line `const pos = orbitPosition(orbit)`, add:

```ts
      if (flyFrom && flyTo) {
        const t = easeOutCubic((performance.now() - flyStart) / FLY_DURATION_MS)
        const interpolated = lerpOrbit(flyFrom, flyTo, t)
        orbit.targetX = interpolated.targetX
        orbit.targetY = interpolated.targetY
        orbit.targetZ = interpolated.targetZ
        if (t >= 1) {
          flyFrom = null
          flyTo = null
        }
      }
```

- [ ] **Step 3: Trigger on prop changes, not just clicks**

Add a new `useEffect` in the component body (after the existing `resetForNewGraphRef` effect, before the big mount effect) that fires whenever `selected` changes to a real id:

```ts
  const flyToRef = useRef<(id: string) => void>(() => {})
  useEffect(() => {
    if (selected) flyToRef.current(selected)
  }, [selected])
```

Then, inside the mount effect, expose the function by adding (right after `function flyToNode(id: string) { ... }`):

```ts
    flyToRef.current = flyToNode
```

- [ ] **Step 4: Verify**

```bash
cd app
npm run typecheck
npm run build
```
Expected: both pass.

Manual check via `npm run dev`: in Topic Map, use the search box to find a node and select it, and separately use the ⌘K command palette's global node search to jump to a node in a different topic — in both cases confirm the camera visibly, smoothly eases to re-center on the target node over about half a second, rather than jumping instantly or not moving at all. Also click directly on a node and confirm the camera eases toward it too (a small, harmless move since it's usually already close).

- [ ] **Step 5: Commit**

```bash
cd .
git add app/src/renderer/src/components/GraphView.tsx
git commit -m "feat: add camera fly-to easing on node selection"
```

---

### Task 8: Bloom post-processing + directional arrow cones

**Files:**
- Modify: `src/renderer/src/components/GraphView.tsx`

**Interfaces:**
- Consumes: `EffectComposer`, `RenderPass`, `UnrealBloomPass` from `three/examples/jsm/postprocessing/*.js`.

- [ ] **Step 1: Add the imports**

At the top of `GraphView.tsx`, add:

```ts
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
```

- [ ] **Step 2: Set up the composer**

Immediately after the line `container.appendChild(renderer.domElement)`, add:

```ts
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth || 1, container.clientHeight || 1),
      0.55, // strength — tuned to read as "glowing orbs," not a blown-out haze
      0.4, // radius
      0.15, // threshold
    )
    composer.addPass(bloomPass)
```

- [ ] **Step 3: Render through the composer instead of the raw renderer**

In `tick()`, replace:

```ts
      renderer.render(scene, camera)
```
with:
```ts
      composer.render()
```

- [ ] **Step 4: Keep the composer in sync on resize**

In `resize()`, immediately after `renderer.setSize(w, h)`, add:

```ts
      composer.setSize(w, h)
      bloomPass.resolution.set(w, h)
```

- [ ] **Step 5: Dispose the composer on unmount**

In the effect's cleanup function, immediately before `renderer.dispose()`, add:

```ts
      composer.dispose()
```

- [ ] **Step 6: Add directional arrow cones**

Add a small cone geometry/material shared across directional edges, created once per mount alongside the edge-line setup (right after the `for (const kind of EDGE_KINDS) { ... }` block that builds `edgeLines`):

```ts
    const arrowGeo = new THREE.ConeGeometry(4, 10, 8)
    const arrowGroup = new THREE.Group()
    scene.add(arrowGroup)
    const arrowMeshes = new Map<string, THREE.Mesh>() // keyed `${kind}:${source}:${target}`

    function ensureArrow(key: string, color: THREE.Color): THREE.Mesh {
      let mesh = arrowMeshes.get(key)
      if (!mesh) {
        mesh = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color, transparent: true }))
        arrowGroup.add(mesh)
        arrowMeshes.set(key, mesh)
      }
      return mesh
    }
```

In `tick()`, inside the `for (const kind of EDGE_KINDS) { ... }` loop, only for directional kinds, position an arrow just before the target node along the edge direction. Replace the loop's closing lines (`lineObj.geometry.setPositions(...)` through `mat.linewidth = ...`) with:

```ts
        lineObj.geometry.setPositions(positions.subarray(0, count * 6))
        lineObj.geometry.setColors(colors.subarray(0, count * 6))
        mat.linewidth = EDGE_STYLE[kind].width * p.linkThickness

        const directional = kind === 'requires' || kind === 'derives_from'
        const usedArrowKeys = new Set<string>()
        if (p.showArrows && directional) {
          for (const e of relevant) {
            const a = sim.get(e.source)
            const b = sim.get(e.target)
            if (!a || !b) continue
            const key = `${kind}:${e.source}:${e.target}`
            usedArrowKeys.add(key)
            const dx = b.x - a.x
            const dy = b.y - a.y
            const dz = b.z - a.z
            const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
            const backoff = (b.r ?? 8) + 6 // stop just short of the target sprite
            const mesh = ensureArrow(key, edgeColors.get(kind)!)
            mesh.position.set(b.x - (dx / len) * backoff, b.y - (dy / len) * backoff, b.z - (dz / len) * backoff)
            mesh.lookAt(b.x, b.y, b.z)
            mesh.rotateX(Math.PI / 2)
            const dimmed = activeHighlight != null && e.source !== activeHighlight && e.target !== activeHighlight
            ;(mesh.material as THREE.MeshBasicMaterial).opacity = dimmed ? 0.06 : 0.8
            mesh.visible = true
          }
        }
        for (const [key, mesh] of arrowMeshes) {
          if (key.startsWith(`${kind}:`) && !usedArrowKeys.has(key)) mesh.visible = false
        }
```

- [ ] **Step 7: Dispose arrow resources on unmount**

In the cleanup function, immediately after the edge-material disposal loop, add:

```ts
      arrowGeo.dispose()
      for (const mesh of arrowMeshes.values()) (mesh.material as THREE.MeshBasicMaterial).dispose()
```

- [ ] **Step 8: Verify**

```bash
cd app
npm run typecheck
npm run build
```
Expected: both pass.

Manual check via `npm run dev`: nodes should now have a visible soft glow/bloom halo rather than a flat sprite edge; directional edges (`requires`/`derives_from`) should show a small cone/arrowhead near the target node pointing the right direction; toggling the "arrows" checkbox in the settings panel should show/hide them. Confirm the bloom isn't so strong that node colors wash out to white — if it is, this is the moment to reduce the `UnrealBloomPass` strength argument (0.55) before moving on.

- [ ] **Step 9: Commit**

```bash
cd .
git add app/src/renderer/src/components/GraphView.tsx
git commit -m "feat: add bloom post-processing and directional arrow cones to Topic Map"
```

---

### Task 9: Frontier rings + animated path-to-capstone trail

**Files:**
- Modify: `src/renderer/src/components/GraphView.tsx`

- [ ] **Step 1: Add frontier and capstone ring sprites**

Right after the `rebuildNodeSprites(graphRef.current)` call, add a ring-sprite setup (reusing the same glow texture, additively blended, larger and dimmer than the node itself so it reads as a halo ring rather than a solid disc):

```ts
    const ringSprites = new Map<string, THREE.Sprite>() // frontier or capstone ring, one per node max

    function disposeRings() {
      for (const sprite of ringSprites.values()) {
        nodeGroup.remove(sprite)
        sprite.material.dispose()
      }
      ringSprites.clear()
    }

    function rebuildRings(g: TopicGraph) {
      disposeRings()
      for (const id of g.order) {
        const node = g.nodes[id]
        if (!node) continue
        const isFrontier = frontierIdsRef.current.has(id)
        if (!node.capstone && !isFrontier) continue
        const color = new THREE.Color(node.capstone ? '#e0703c' : '#e8a857')
        const mat = new THREE.SpriteMaterial({
          map: glowTexture,
          color,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
        const sprite = new THREE.Sprite(mat)
        sprite.userData.id = id
        sprite.userData.pulse = isFrontier
        nodeGroup.add(sprite)
        ringSprites.set(id, sprite)
      }
    }
    rebuildRings(graphRef.current)
```

Update `resetForNewGraphRef.current`'s body (from Task 6) to also rebuild rings — change:

```ts
    resetForNewGraphRef.current = (g: TopicGraph, e: SimEdge[]) => {
      centerX = container.clientWidth / 2 || 400
      centerY = container.clientHeight / 2 || 300
      sim = initSimNodes(g, e, centerX, centerY)
      alpha = 1
      rebuildNodeSprites(g)
      const c = computeCentroid()
      orbit.targetX = c.x
      orbit.targetY = c.y
      orbit.targetZ = c.z
    }
```
to:
```ts
    resetForNewGraphRef.current = (g: TopicGraph, e: SimEdge[]) => {
      centerX = container.clientWidth / 2 || 400
      centerY = container.clientHeight / 2 || 300
      sim = initSimNodes(g, e, centerX, centerY)
      alpha = 1
      rebuildNodeSprites(g)
      rebuildRings(g)
      const c = computeCentroid()
      orbit.targetX = c.x
      orbit.targetY = c.y
      orbit.targetZ = c.z
    }
```

- [ ] **Step 2: Animate and position rings in `tick()`**

Immediately after the `for (const id of g.order) { ... }` node-sprite-update loop in `tick()` (right after its closing brace, before the `for (const id of Array.from(labelEls.keys()))` label-cleanup block), add:

```ts
      const pulse = 1 + Math.sin(performance.now() / 260) * 0.12
      for (const [id, ring] of ringSprites) {
        const n = sim.get(id)
        if (!n) continue
        ring.position.set(n.x, n.y, n.z)
        const baseR = n.r * p.nodeSize + 5
        const scale = ring.userData.pulse ? baseR * 2 * pulse : baseR * 2
        ring.scale.set(scale, scale, 1)
      }
```

- [ ] **Step 3: Import `bfsPathToCapstone`**

This step's trail logic is the first thing in `GraphView.tsx` to call `bfsPathToCapstone` — add it to the existing `./graph3d/layout` import (added in Task 4, narrowed in Task 6). Change:

```ts
import {
  buildEdges,
  computeNeighbors,
  computeFrontierIds,
  computeForwardAdjacency,
  findCapstoneId,
  initSimNodes,
  stepSimulation,
} from './graph3d/layout'
```
to:
```ts
import {
  buildEdges,
  computeNeighbors,
  computeFrontierIds,
  computeForwardAdjacency,
  findCapstoneId,
  bfsPathToCapstone,
  initSimNodes,
  stepSimulation,
} from './graph3d/layout'
```

- [ ] **Step 4: Animated path-to-capstone trail**

Add a dedicated `LineSegments2` for the trail (created once, alongside the per-kind edge lines) plus a moving pulse sprite that travels along it:

```ts
    const trailGeo = new LineSegmentsGeometry()
    const trailMat = new LineMaterial({
      linewidth: 2.5,
      color: new THREE.Color('#e0703c'),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
    trailMat.resolution.set(container.clientWidth || 1, container.clientHeight || 1)
    const trailLine = new LineSegments2(trailGeo, trailMat)
    trailLine.frustumCulled = false
    trailLine.visible = false
    scene.add(trailLine)

    const trailPulseMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: new THREE.Color('#ffb066'),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const trailPulse = new THREE.Sprite(trailPulseMat)
    trailPulse.scale.set(14, 14, 1)
    trailPulse.visible = false
    scene.add(trailPulse)
```

In `tick()`, immediately after the ring-animation block from Step 2, add the trail update:

```ts
      const activeForPath = hoveredRef.current ?? selectedRef.current
      const path = activeForPath ? bfsPathToCapstone(activeForPath, capstoneIdRef.current, forwardAdjacencyRef.current) : null
      if (path && path.length > 1) {
        trailLine.visible = true
        trailPulse.visible = true
        const positions = new Float32Array((path.length - 1) * 6)
        for (let i = 0; i < path.length - 1; i++) {
          const a = sim.get(path[i])
          const b = sim.get(path[i + 1])
          if (!a || !b) continue
          const o = i * 6
          positions[o] = a.x
          positions[o + 1] = a.y
          positions[o + 2] = a.z
          positions[o + 3] = b.x
          positions[o + 4] = b.y
          positions[o + 5] = b.z
        }
        trailGeo.setPositions(positions)

        // Animate a bright pulse traveling along the path, looping every 1.4s.
        const segCount = path.length - 1
        const loopT = (performance.now() / 1400) % 1
        const segFloat = loopT * segCount
        const segIndex = Math.min(segCount - 1, Math.floor(segFloat))
        const segT = segFloat - segIndex
        const a = sim.get(path[segIndex])
        const b = sim.get(path[segIndex + 1])
        if (a && b) {
          trailPulse.position.set(a.x + (b.x - a.x) * segT, a.y + (b.y - a.y) * segT, a.z + (b.z - a.z) * segT)
        }
      } else {
        trailLine.visible = false
        trailPulse.visible = false
      }
```

- [ ] **Step 5: Dispose new resources on unmount**

In the cleanup function, immediately after the arrow-resource disposal added in Task 8, add:

```ts
      disposeRings()
      trailGeo.dispose()
      trailMat.dispose()
      trailPulseMat.dispose()
```

- [ ] **Step 6: Verify**

```bash
cd app
npm run typecheck
npm run build
```
Expected: both pass.

Manual check via `npm run dev` against a real in-progress topic: confirm frontier nodes (the ones `/engram:learn` would teach next) show a gently pulsing ring, the capstone node shows a static ring in a distinct color, and hovering or selecting any node shows a glowing orange trail (with a small bright pulse traveling along it) tracing the path from that node to the capstone, matching what the old SVG version's static highlighted path used to show for the same node.

- [ ] **Step 7: Commit**

```bash
cd .
git add app/src/renderer/src/components/GraphView.tsx
git commit -m "feat: add frontier rings and animated path-to-capstone trail"
```

---

### Task 10: WebGL context-loss handling + empty/single-node guard

**Files:**
- Modify: `src/renderer/src/components/GraphView.tsx`

- [ ] **Step 1: Add a context-loss notice**

Add a new piece of React state near the top of the component (with the existing `hovered` state):

```ts
  const [contextLost, setContextLost] = useState(false)
```

Inside the mount effect, immediately after `container.appendChild(renderer.domElement)`, add:

```ts
    function onContextLost(e: Event) {
      e.preventDefault()
      setContextLost(true)
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)
```

In the cleanup function, immediately after the `container.removeEventListener('wheel', onWheel)` line, add:

```ts
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
```

- [ ] **Step 2: Render the notice**

In the returned JSX, add the notice as a sibling of the existing bottom-right button row:

```tsx
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-void)]/90">
          <div className="panel px-5 py-4 text-sm text-[var(--color-text-dim)] max-w-xs text-center">
            Graph rendering paused — reload to restore.
          </div>
        </div>
      )}
```

- [ ] **Step 3: Guard the centroid/orbit math against empty or single-node graphs**

`computeCentroid()` (added in Task 6) already returns a safe fallback when `sim.size === 0`. Additionally guard `ORBIT_MIN_RADIUS`/`ORBIT_MAX_RADIUS` never being reached for a single node by leaving `orbit.radius` at its default (900) regardless of node count — no code change needed here since `resetForNewGraphRef.current` never derives `radius` from node positions, only `target`. Confirm this by inspection: re-read the `resetForNewGraphRef.current` assignment from Task 9 and confirm it only sets `targetX/targetY/targetZ`, never `radius` or `azimuth`/`elevation` — if it does, remove those lines so a topic with 0 or 1 nodes can't produce a NaN or zero-radius orbit.

- [ ] **Step 4: Verify**

```bash
cd app
npm run typecheck
npm run build
```
Expected: both pass.

Manual check via `npm run dev`: this task's context-loss path is not realistically triggerable on demand in normal use, so it's acceptable to verify by code inspection only (confirm the event listener is attached/removed correctly and the notice's JSX is well-formed) rather than a forced GPU-crash reproduction. Do manually verify the single-node guard: if any real topic has a node with zero edges and zero dependents (or, failing that, temporarily and reversibly comment out all but one entry in a topic's `graphs/<topic>.json` `order` array in a **copy** of the file for testing, never the real file), confirm the graph still renders that one node centered, without a blank canvas or console errors, then revert.

- [ ] **Step 5: Commit**

```bash
cd .
git add app/src/renderer/src/components/GraphView.tsx
git commit -m "feat: handle WebGL context loss and empty/single-node topics gracefully"
```

---

### Task 11: Wire TopicMapView.tsx to fetch and pass real retrievability

**Files:**
- Modify: `src/renderer/src/app/TopicMapView.tsx`

**Interfaces:**
- Consumes: `window.engram.decay(topic)` (typed `Promise<DecayResult>` since Task 2), `DecayResult` type if needed for local typing.

- [ ] **Step 1: Add retrievability state**

Near the existing `const [graph, setGraph] = useState<TopicGraph | null>(null)` line in `TopicMapView.tsx`, add:

```ts
  const [retrievability, setRetrievability] = useState<Map<string, number> | null>(null)
```

- [ ] **Step 2: Fetch decay data alongside the graph**

Find the existing effect that fetches the topic graph on `selectedTopic` change (it calls `window.engram.topicGraph(selectedTopic)` and `setGraph(...)`). Immediately after that effect's `window.engram.topicGraph(...)` call resolves and calls `setGraph`, add a second, independent fetch in the same effect body:

```ts
    window.engram
      .decay(selectedTopic)
      .then((result) => {
        const map = new Map(result.nodes.map((n) => [n.node, n.r_now] as const))
        setRetrievability(map)
      })
      .catch(() => setRetrievability(null)) // topic with no decay-relevant history yet — GraphView treats this as full brightness
```

(If the existing effect is structured as a single `.then()` chain rather than two separate calls, add this as a second, independent `window.engram.decay(...)` promise alongside the existing `window.engram.topicGraph(...)` one — it does not need to block or sequence after the graph fetch, since `GraphView` already handles `retrievability` arriving as `null` initially.)

Also reset it when switching topics, so a stale topic's retrievability data never briefly shows against the newly-selected topic's graph — add `setRetrievability(null)` at the very start of the same effect, before either fetch is kicked off.

- [ ] **Step 3: Replace the temporary `retrievability={null}` from Task 6**

Change the `<GraphView>` call site (added temporarily in Task 6) from:

```tsx
              retrievability={null}
```
to:
```tsx
              retrievability={retrievability}
```

- [ ] **Step 4: Verify**

```bash
cd app
npm run typecheck
npm run build
```
Expected: both pass.

Cross-check against real data: for a real in-progress topic, run the direct CLI comparison used during design:

```bash
python3 "~/.claude/plugins/cache/engram/engram/1.0.7/scripts/engram.py" decay --topic grad-classical-mechanics
```
Note the `r_now` values for two or three specific nodes (one high, one lower). Then in `npm run dev`, open Topic Map for that same topic and confirm the node with the lower `r_now` visibly renders dimmer than the node with the higher `r_now` (both compared at the same zoom/selection state, since selection/hover dimming is a separate, stronger effect).

- [ ] **Step 5: Commit**

```bash
cd .
git add app/src/renderer/src/app/TopicMapView.tsx
git commit -m "feat: drive Topic Map node brightness from real FSRS retrievability"
```

---

### Task 12: Final integration pass — full manual QA + packaged rebuild

**Files:** none (verification-only task).

- [ ] **Step 1: Full typecheck + build**

```bash
cd app
npm run typecheck
npm run build
```
Expected: both pass cleanly with zero errors or warnings related to this feature.

- [ ] **Step 2: Full manual interaction checklist**

Via `npm run dev`, against at least two real topics with different sizes (e.g. grad-classical-mechanics and Lenin's What Is to Be Done), walk through every item from the spec's testing section:
- Drag-to-orbit, scroll-to-zoom, node drag repositioning within its depth plane.
- Click-select, double-click-to-open (confirm the node detail modal still opens correctly and unchanged).
- Hover dimming/neighbor-highlight, search-driven dimming.
- All four edge-kind filter checkboxes.
- Every force/display slider (center/repel/link force, link distance, node size, link thickness, label size, show-labels mode, arrows toggle).
- Fly-to on a search result selection and on a ⌘K command-palette deep-link into a specific node in a different topic.
- Frontier rings match the nodes `/engram:learn` would actually teach next (cross-check by eye against the topic's known state).
- The path-to-capstone trail traces a real, unbroken `requires` chain when hovering/selecting a node.
- Node brightness ordering roughly matches real `r_now` ordering (already spot-checked in Task 11; re-confirm here in context with everything else running).

- [ ] **Step 3: Packaged rebuild**

Check for a live Engram Desktop session before touching the installed app:

```bash
ps aux | grep -- "--tools Bash,Write,Read,Task" | grep -v grep
```
If any process matches, **stop here** and wait until it's safe (no active learning/review session) before continuing.

If clear:
```bash
cd app
npm run dist:mac
osascript -e 'quit app "Engram Desktop"' 2>/dev/null; sleep 1
pkill -f "Engram Desktop" 2>/dev/null; sleep 1
rm -rf "/Applications/Engram Desktop.app"
cp -R "/app/dist/mac-arm64/Engram Desktop.app" /Applications/
open -a "Engram Desktop"
sleep 2
ps aux | grep "[E]ngram Desktop.app/Contents/MacOS/Engram Desktop"
```
Expected: exactly one `Engram Desktop` process running (confirms the single-instance-lock fix is still intact), and repeating the manual checklist from Step 2 against the packaged app (not just `npm run dev`) confirms the same behavior.

- [ ] **Step 4: Update the plan file's own milestone note**

No separate action needed beyond this plan's own checkboxes — this project's convention (see `~/.claude/plans/lets-shift-to-a-validated-hamster.md`) is to annotate the relevant milestone with a "✅ DONE" note and verification evidence once a feature is confirmed live; do that as a small follow-up edit to that file, referencing this plan's path.
