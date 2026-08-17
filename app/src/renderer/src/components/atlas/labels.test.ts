import { describe, expect, it } from 'vitest'
import { clearanceFor, clipLabel, labelPriority, placeLabels, type LabelInput } from './labels'
import type { AtlasNode } from './layout'

function node(overrides: Partial<AtlasNode> & { id: string }): AtlasNode {
  return {
    x: 0,
    y: 0,
    r: 10,
    baseR: 10,
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
    state: 'new',
    threshold: false,
    capstone: false,
    isHub: false,
    isFrontier: false,
    lapses: 0,
    due: null,
    degree: 0,
    kind: null,
    ...overrides,
  }
}

const baseInput = (nodes: AtlasNode[], extra: Partial<LabelInput> = {}): LabelInput => ({
  nodes,
  toScreen: (x, y) => ({ x, y }),
  labelFor: (n) => n.id,
  zoom: 1,
  selected: null,
  hovered: null,
  trail: null,
  width: 1000,
  height: 800,
  ...extra,
})

describe('labelPriority', () => {
  it('always wins for the hovered or selected node', () => {
    const a = node({ id: 'a', degree: 0 })
    const input = baseInput([a], { hovered: 'a' })
    expect(labelPriority(a, input)).toBeLessThan(labelPriority(node({ id: 'b', capstone: true }), input))
  })

  it('ranks the trail above ordinary structure, but below hover/selection', () => {
    const a = node({ id: 'a' })
    const input = baseInput([a], { trail: new Set(['a']) })
    const capstone = node({ id: 'cap', capstone: true })
    expect(labelPriority(a, input)).toBeLessThan(labelPriority(capstone, input))
    const hoveredInput = baseInput([a], { hovered: 'a', trail: new Set(['a']) })
    // Hover still outranks being merely on the trail.
    expect(labelPriority(a, hoveredInput)).toBeLessThan(labelPriority(a, input))
  })

  it('ranks a capstone or hub above an ordinary node of equal degree', () => {
    const input = baseInput([])
    const ordinary = node({ id: 'a', degree: 5 })
    const hub = node({ id: 'b', isHub: true, degree: 5 })
    expect(labelPriority(hub, input)).toBeLessThan(labelPriority(ordinary, input))
  })

  it('within a tier, ranks higher degree first', () => {
    const input = baseInput([])
    const busy = node({ id: 'a', degree: 12 })
    const quiet = node({ id: 'b', degree: 1 })
    expect(labelPriority(busy, input)).toBeLessThan(labelPriority(quiet, input))
  })
})

describe('clipLabel', () => {
  it('leaves a short label alone', () => {
    expect(clipLabel('newtons-laws')).toBe('newtons-laws')
  })

  it('truncates a long one with an ellipsis', () => {
    const long = 'a'.repeat(40)
    const clipped = clipLabel(long)
    expect(clipped.length).toBeLessThan(long.length)
    expect(clipped.endsWith('…')).toBe(true)
  })

  it('collapses internal whitespace', () => {
    expect(clipLabel('a   b\n c')).toBe('a b c')
  })
})

describe('placeLabels', () => {
  it('places a single node with no collision to avoid', () => {
    const a = node({ id: 'a', x: 500, y: 400 })
    const placed = placeLabels(baseInput([a]))
    expect(placed).toHaveLength(1)
    expect(placed[0].id).toBe('a')
  })

  it('drops a label once every berth around it is genuinely occupied', () => {
    // Ring the target tightly enough (well inside its own label width) that
    // none of its four berths can land clear of a wall's label box.
    const target = node({ id: 'target', x: 500, y: 400, degree: 0 })
    const walls = [
      node({ id: 'right', x: 512, y: 400, degree: 10 }),
      node({ id: 'left', x: 488, y: 400, degree: 10 }),
      node({ id: 'above', x: 500, y: 388, degree: 10 }),
      node({ id: 'below', x: 500, y: 412, degree: 10 }),
    ]
    const placed = placeLabels(baseInput([target, ...walls]))
    const ids = placed.map((l) => l.id)
    expect(ids).not.toContain('target')
    // The walls, ranked above target, get first claim on the space — some
    // of them win it; target, ranked below all four, never does.
    expect(placed.length).toBeGreaterThan(0)
  })

  it('never places a label outside the viewport', () => {
    const offscreen = node({ id: 'a', x: -5000, y: -5000 })
    expect(placeLabels(baseInput([offscreen]))).toHaveLength(0)
  })

  it('respects insets — a label under a floating panel is not placed', () => {
    const behindPanel = node({ id: 'a', x: 50, y: 50 })
    const placed = placeLabels(baseInput([behindPanel], { insets: { left: 200, right: 0, top: 0, bottom: 0 } }))
    expect(placed).toHaveLength(0)
  })

  it('is deterministic — same input, same output, every call', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => node({ id: `n${i}`, x: (i % 5) * 80, y: Math.floor(i / 5) * 80 }))
    const input = baseInput(nodes)
    const first = placeLabels(input).map((l) => l.id)
    const second = placeLabels(input).map((l) => l.id)
    expect(first).toEqual(second)
  })
})

describe('clearanceFor — cursor-aware decluttering', () => {
  it('needs no clearance at all for an always-clear name, regardless of the cursor', () => {
    expect(clearanceFor(500, 400, true, null)).toBe(0)
    expect(clearanceFor(500, 400, true, { x: 5000, y: 5000 })).toBe(0)
  })

  it('needs no extra clearance right under the cursor', () => {
    expect(clearanceFor(500, 400, false, { x: 500, y: 400 })).toBe(0)
  })

  it('needs the full clearance far from the cursor', () => {
    expect(clearanceFor(500, 400, false, { x: 5000, y: 5000 })).toBeGreaterThan(30)
  })

  it('falls back to a middle-ground clearance when there is no cursor to read at all', () => {
    const noCursor = clearanceFor(500, 400, false, null)
    const nearCursor = clearanceFor(500, 400, false, { x: 500, y: 400 })
    const farCursor = clearanceFor(500, 400, false, { x: 5000, y: 5000 })
    // Not fully attended (stricter than sitting right under a known
    // cursor) and not fully unattended either (looser than a name the
    // cursor is known to be far from) — a real middle ground, not a copy
    // of either extreme.
    expect(noCursor).toBeGreaterThan(nearCursor)
    expect(noCursor).toBeLessThan(farCursor)
  })
})

describe('placeLabels — cursor and due-lens as contextual clutter signals', () => {
  // Four names ringed tightly around a shared centre — identical to the
  // "drops a label" geometry above, just parameterised by an offset so the
  // same crowded neighbourhood can be reproduced at two different points on
  // the plate.
  function crowdedCluster(idPrefix: string, cx: number, cy: number): AtlasNode[] {
    return [
      node({ id: `${idPrefix}-c`, x: cx, y: cy, degree: 5 }),
      node({ id: `${idPrefix}-r`, x: cx + 12, y: cy, degree: 5 }),
      node({ id: `${idPrefix}-l`, x: cx - 12, y: cy, degree: 5 }),
      node({ id: `${idPrefix}-u`, x: cx, y: cy - 12, degree: 5 }),
      node({ id: `${idPrefix}-d`, x: cx, y: cy + 12, degree: 5 }),
    ]
  }

  it('names more of a crowded neighbourhood under the cursor than the identical neighbourhood far away', () => {
    const near = crowdedCluster('near', 200, 200)
    const far = crowdedCluster('far', 900, 700)
    const input = baseInput([...near, ...far], { cursor: { x: 200, y: 200 } })
    const placed = new Set(placeLabels(input).map((l) => l.id))
    const nearCount = near.filter((n) => placed.has(n.id)).length
    const farCount = far.filter((n) => placed.has(n.id)).length
    expect(nearCount).toBeGreaterThan(farCount)
  })

  it('keeps an overdue node named under the due lens even far from the cursor, though it would lose that same crowd unaided', () => {
    // Same ring-of-walls shape as the plain "drops a label" test above:
    // 'center' is outranked by its four walls on structure alone, so
    // without the due lens it loses the crowd exactly like 'target' did.
    const walls = [
      node({ id: 'wall-r', x: 912, y: 700, degree: 10 }),
      node({ id: 'wall-l', x: 888, y: 700, degree: 10 }),
      node({ id: 'wall-u', x: 900, y: 688, degree: 10 }),
      node({ id: 'wall-d', x: 900, y: 712, degree: 10 }),
    ]
    const center = node({ id: 'center', x: 900, y: 700, degree: 0, state: 'learning', due: '2020-01-01' })
    const cursorFar = { cursor: { x: 200, y: 200 } }

    const withoutLens = new Set(placeLabels(baseInput([center, ...walls], cursorFar)).map((l) => l.id))
    expect(withoutLens.has('center')).toBe(false)

    const withLens = new Set(placeLabels(baseInput([center, ...walls], { ...cursorFar, dueLens: true })).map((l) => l.id))
    expect(withLens.has('center')).toBe(true)
  })
})
