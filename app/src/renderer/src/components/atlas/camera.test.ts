import { describe, expect, it } from 'vitest'
import {
  ORIGIN,
  applyWheel,
  clampZoom,
  createView,
  fling,
  isPinchZoom,
  settleCoast,
  snapTo,
  tickCoast,
  zoomAt,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomStep,
  fitView,
  boundsOf,
  MAX_FIT_ZOOM,
  NO_INSETS,
} from './camera'

describe('camera', () => {
  it('clamps zoom to the plate range', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
    expect(clampZoom(1.2)).toBe(1.2)
  })

  it('treats ctrl-wheel as pinch zoom and plain wheel as pan', () => {
    expect(isPinchZoom({ ctrlKey: true })).toBe(true)
    expect(isPinchZoom({ ctrlKey: false })).toBe(false)
    const base = createView({ x: 10, y: 20, zoom: 1 })
    const zoomed = applyWheel(base, { deltaX: 0, deltaY: -100, ctrlKey: true }, { x: 100, y: 100 })
    expect(zoomed.zoom).toBeGreaterThan(1)
    const panned = applyWheel(base, { deltaX: 40, deltaY: 30, ctrlKey: false }, { x: 100, y: 100 })
    expect(panned.x).toBe(base.x - 40)
    expect(panned.y).toBe(base.y - 30)
    expect(panned.zoom).toBe(1)
  })

  it('zooms toward the pointer so the focal point stays put', () => {
    const view = createView()
    const next = zoomAt(view, 200, 150, -200)
    expect(next.zoom).toBeGreaterThan(1)
    const worldX = (200 - view.x) / view.zoom
    const worldY = (150 - view.y) / view.zoom
    expect(200 - next.x).toBeCloseTo(worldX * next.zoom, 5)
    expect(150 - next.y).toBeCloseTo(worldY * next.zoom, 5)
  })

  it('coasts after a fling and stops under reduced-motion settle', () => {
    const flung = fling(ORIGIN, 20, -12)
    const stepped = tickCoast(flung)
    expect(stepped).not.toBeNull()
    expect(stepped!.x).toBeGreaterThan(ORIGIN.x)
    expect(Math.abs(stepped!.vx)).toBeLessThan(Math.abs(flung.vx))
    const settled = settleCoast(flung)
    expect(settled.vx).toBe(0)
    expect(settled.vy).toBe(0)
    expect(tickCoast({ ...ORIGIN, vx: 0.05, vy: 0 })).toBeNull()
  })

  it('snaps straight to a target under reduced motion', () => {
    expect(snapTo({ x: 0, y: 0, zoom: 99 }).zoom).toBe(ZOOM_MAX)
  })

  it('coasts the same distance however often it is ticked', () => {
    const flung = fling(ORIGIN, 20, 0)
    let coarse = flung
    for (let i = 0; i < 30; i++) coarse = tickCoast(coarse, 1000 / 60) ?? coarse
    let fine = flung
    for (let i = 0; i < 60; i++) fine = tickCoast(fine, 1000 / 120) ?? fine
    expect(fine.x).toBeCloseTo(coarse.x, 6)
  })

  it('refuses to advance a coast by more than a few frames at once', () => {
    const flung = fling(ORIGIN, 20, 0)
    expect(tickCoast(flung, 5000)!.x).toBeLessThanOrEqual(20 * 4)
  })
})

describe('a wheel means different things on different devices', () => {
  const pointer = { x: 100, y: 100 }

  it('pans on a trackpad two-finger scroll', () => {
    const next = applyWheel(ORIGIN, { deltaX: 10, deltaY: 20, ctrlKey: false, deltaMode: 0 }, pointer)
    expect(next.zoom).toBe(1)
    expect(next.x).toBe(-10)
    expect(next.y).toBe(-20)
  })

  it('zooms on a pinch', () => {
    expect(applyWheel(ORIGIN, { deltaX: 0, deltaY: -50, ctrlKey: true, deltaMode: 0 }, pointer).zoom).toBeGreaterThan(1)
  })

  it('zooms on a mouse wheel, which reports line deltas', () => {
    const next = applyWheel(ORIGIN, { deltaX: 0, deltaY: -3, ctrlKey: false, deltaMode: 1 }, pointer)
    expect(next.zoom).toBeGreaterThan(1)
    expect(isPinchZoom({ ctrlKey: false, deltaMode: 1 })).toBe(true)
    expect(isPinchZoom({ ctrlKey: false, deltaMode: 0 })).toBe(false)
  })

  it('keeps a wheel notch to a sane step rather than crossing the whole range', () => {
    const next = applyWheel(ORIGIN, { deltaX: 0, deltaY: -3, ctrlKey: false, deltaMode: 1 }, pointer)
    expect(next.zoom).toBeLessThan(2)
  })

  it('steps zoom about a fixed point, for the keyboard', () => {
    const inOne = zoomStep(ORIGIN, 1.25, 100, 100)
    expect(inOne.zoom).toBeCloseTo(1.25, 6)
    expect((100 - inOne.x) / inOne.zoom).toBeCloseTo((100 - ORIGIN.x) / ORIGIN.zoom, 6)
  })

  it('refuses to step past the ends of the range', () => {
    expect(zoomStep({ ...ORIGIN, zoom: ZOOM_MAX }, 2, 0, 0).zoom).toBe(ZOOM_MAX)
    expect(zoomStep({ ...ORIGIN, zoom: ZOOM_MIN }, 0.5, 0, 0).zoom).toBe(ZOOM_MIN)
  })
})

describe('releasing a drag', () => {
  it('carries an ordinary flick', () => {
    const flung = fling(ORIGIN, 20, -12)
    expect(flung.vx).toBe(20)
    expect(flung.vy).toBe(-12)
  })

  it('caps a wild one instead of losing the plate', () => {
    const flung = fling(ORIGIN, 4000, 0)
    expect(Math.hypot(flung.vx, flung.vy)).toBeLessThanOrEqual(45)
    expect(Math.sign(flung.vx)).toBe(1)
    expect(flung.vy).toBe(0)
  })

  it('keeps the direction of a diagonal throw while capping it', () => {
    const flung = fling(ORIGIN, 300, 400)
    expect(Math.hypot(flung.vx, flung.vy)).toBeCloseTo(45, 6)
    expect(flung.vx / flung.vy).toBeCloseTo(300 / 400, 6)
  })

  it('does nothing to a still release', () => {
    expect(fling(ORIGIN, 0, 0)).toMatchObject({ vx: 0, vy: 0 })
  })
})

describe('fitting the plate to the window', () => {
  const nodes = [
    { x: 400, y: 300, r: 20 },
    { x: 600, y: 400, r: 20 },
    { x: 500, y: 200, r: 20 },
  ]

  it('measures the marks, radii included, so nothing is clipped', () => {
    expect(boundsOf(nodes)).toEqual({ minX: 380, minY: 180, maxX: 620, maxY: 420 })
  })

  it('has no bounds for an empty plate', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('centres the content in the viewport', () => {
    const view = fitView(boundsOf(nodes)!, 1000, 700)
    const cx = 500 * view.zoom + view.x
    const cy = 300 * view.zoom + view.y
    expect(cx).toBeCloseTo(500, 6)
    expect(cy).toBeCloseTo(350, 6)
  })

  it('never zooms past natural size, however sparse the content', () => {
    expect(fitView(boundsOf(nodes)!, 1600, 1000).zoom).toBe(MAX_FIT_ZOOM)
    expect(fitView({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 1200, 800).zoom).toBe(MAX_FIT_ZOOM)
  })

  it('zooms out when the content is larger than the window', () => {
    const wide = [
      { x: 0, y: 0, r: 10 },
      { x: 4000, y: 3000, r: 10 },
    ]
    expect(fitView(boundsOf(wide)!, 800, 600).zoom).toBeLessThan(1)
  })

  it('keeps everything inside the frame, with its margin', () => {
    const view = fitView(boundsOf(nodes)!, 1000, 700, 64)
    for (const n of nodes) {
      const sx = n.x * view.zoom + view.x
      const sy = n.y * view.zoom + view.y
      expect(sx).toBeGreaterThanOrEqual(60)
      expect(sy).toBeGreaterThanOrEqual(60)
      expect(sx).toBeLessThanOrEqual(940)
      expect(sy).toBeLessThanOrEqual(640)
    }
  })

  it('still centres content it did not need to scale', () => {
    const view = fitView(boundsOf(nodes)!, 1600, 1000)
    expect(500 * view.zoom + view.x).toBeCloseTo(800, 6)
    expect(300 * view.zoom + view.y).toBeCloseTo(500, 6)
  })
})

describe('opening a node shows its neighbourhood, not just the node', () => {
  const W = 1100
  const H = 720

  function allVisible(nodes: Array<{ x: number; y: number; r: number }>): boolean {
    const view = fitView(boundsOf(nodes)!, W, H)
    return nodes.every((n) => {
      const sx = n.x * view.zoom + view.x
      const sy = n.y * view.zoom + view.y
      return sx > 0 && sy > 0 && sx < W && sy < H
    })
  }

  it('keeps a sparse cluster whole', () => {
    expect(
      allVisible([
        { x: 500, y: 350, r: 14 },
        { x: 560, y: 320, r: 8 },
        { x: 560, y: 380, r: 8 },
      ]),
    ).toBe(true)
  })

  it('keeps a single mark at natural size rather than filling the window', () => {
    const view = fitView(boundsOf([{ x: 500, y: 350, r: 12 }])!, W, H)
    expect(view.zoom).toBe(MAX_FIT_ZOOM)
  })

  it('keeps a dense constellation whole, zooming out as far as it must', () => {
    const ring = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 80) * Math.PI * 2
      return { x: 500 + Math.cos(a) * 900, y: 350 + Math.sin(a) * 900, r: 10 }
    })
    expect(allVisible(ring)).toBe(true)
    expect(fitView(boundsOf(ring)!, W, H).zoom).toBeLessThan(1)
  })
})

describe('fitting around panels that float over the plate', () => {
  const nodes = [
    { x: 400, y: 300, r: 20 },
    { x: 600, y: 400, r: 20 },
  ]

  it('centres in the visible region, not the canvas', () => {
    const insets = { left: 240, right: 300, top: 40, bottom: 0 }
    const view = fitView(boundsOf(nodes)!, 1200, 800, 40, insets)
    const cx = 500 * view.zoom + view.x
    expect(cx).toBeCloseTo(570, 6)
  })

  it('leaves everything clear of the panels', () => {
    const insets = { left: 240, right: 300, top: 40, bottom: 0 }
    const view = fitView(boundsOf(nodes)!, 1200, 800, 40, insets)
    for (const n of nodes) {
      const sx = n.x * view.zoom + view.x
      expect(sx).toBeGreaterThan(insets.left)
      expect(sx).toBeLessThan(1200 - insets.right)
    }
  })

  it('zooms to the visible width when panels are wide', () => {
    const wide = [
      { x: 0, y: 0, r: 5 },
      { x: 2000, y: 100, r: 5 },
    ]
    const open = fitView(boundsOf(wide)!, 1200, 800, 40, { left: 240, right: 300, top: 40, bottom: 0 })
    const shut = fitView(boundsOf(wide)!, 1200, 800, 40, NO_INSETS)
    expect(open.zoom).toBeLessThan(shut.zoom)
  })

  it('behaves exactly as before when nothing covers the plate', () => {
    expect(fitView(boundsOf(nodes)!, 1200, 800, 40, NO_INSETS)).toEqual(fitView(boundsOf(nodes)!, 1200, 800, 40))
  })
})
