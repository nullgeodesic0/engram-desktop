import { describe, expect, it } from 'vitest'
import { clipLabel, labelPriority, placeLabels, type LabelInput } from './labels'
import type { AtlasNode } from './layout'

function node(overrides: Partial<AtlasNode> & { id: string }): AtlasNode {
  return {
    x: 0,
    y: 0,
    r: 10,
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
