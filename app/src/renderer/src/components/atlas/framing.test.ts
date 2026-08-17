import { describe, expect, it } from 'vitest'
import { NO_INSETS, createView, type CameraView } from './camera'
import { boundsWithMargin, clampToContent, frameBounds, isComfortable, revealTarget, safeArea } from './framing'

const VIEWPORT = { w: 1200, h: 800, insets: NO_INSETS }
const PANELLED = { w: 1200, h: 800, insets: { left: 320, right: 380, top: 0, bottom: 0 } }
const mark = (x: number, y: number, r = 20): { x: number; y: number; r: number } => ({ x, y, r })

describe('safeArea', () => {
  it('is what the panels leave, not what the canvas claims', () => {
    expect(safeArea(PANELLED)).toEqual({ x: 320, y: 0, w: 500, h: 800 })
  })
})

describe('revealTarget', () => {
  it('does nothing when the node is already comfortably in view', () => {
    const view = createView({ x: 600, y: 400, zoom: 1 })
    expect(revealTarget(mark(0, 0), view, VIEWPORT)).toBeNull()
  })

  it('pans without changing the zoom when the size is already right', () => {
    const view = createView({ x: 0, y: 0, zoom: 1 })
    const target = revealTarget(mark(4000, 3000), view, VIEWPORT)
    expect(target).not.toBeNull()
    expect(target!.zoom).toBe(1)
    expect(4000 * target!.zoom + target!.x).toBeCloseTo(600, 6)
  })

  it('zooms out when the node has swallowed the frame', () => {
    const view = createView({ x: 600, y: 400, zoom: 6 })
    const target = revealTarget(mark(0, 0), view, VIEWPORT)
    expect(target!.zoom).toBeLessThan(view.zoom)
  })

  it('zooms in when the node is a speck', () => {
    const view = createView({ x: 600, y: 400, zoom: 0.2 })
    const target = revealTarget(mark(0, 0), view, VIEWPORT)
    expect(target!.zoom).toBeGreaterThan(0.2)
  })

  it('frames the neighbourhood, not the node alone', () => {
    const view = createView({ x: 600, y: 400, zoom: 0.05 })
    const subject = mark(0, 0)
    const kin = [mark(-300, 0), mark(300, 0), mark(0, 260)]
    const target = revealTarget(subject, view, VIEWPORT, kin)!
    for (const k of kin) {
      const sx = k.x * target.zoom + target.x
      const sy = k.y * target.zoom + target.y
      expect(sx).toBeGreaterThan(0)
      expect(sx).toBeLessThan(VIEWPORT.w)
      expect(sy).toBeGreaterThan(0)
      expect(sy).toBeLessThan(VIEWPORT.h)
    }
  })

  it('keeps the subject legible even inside a crowded neighbourhood', () => {
    const view = createView({ x: 600, y: 400, zoom: 0.02 })
    const kin = Array.from({ length: 60 }, (_, i) => mark(Math.cos(i) * 4000, Math.sin(i) * 4000))
    const target = revealTarget(mark(0, 0), view, VIEWPORT, kin)!
    expect(mark(0, 0).r * 2 * target.zoom).toBeGreaterThanOrEqual(26)
  })

  it('centres on what the panels leave visible, not on the canvas', () => {
    const view = createView({ x: 0, y: 0, zoom: 1 })
    const target = revealTarget(mark(4000, 400), view, PANELLED)!
    expect(4000 * target.zoom + target.x).toBeCloseTo(570, 6)
  })
})

describe('frameBounds', () => {
  it('leaves the subject room to breathe rather than filling the frame', () => {
    const bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 }
    const view = frameBounds(bounds, VIEWPORT)
    expect(200 * view.zoom).toBeLessThan(800)
    expect(200 * view.zoom).toBeGreaterThan(400)
  })
})

describe('clampToContent', () => {
  const bounds = { minX: -200, minY: -200, maxX: 200, maxY: 200 }

  it('leaves an ordinary view alone', () => {
    const view = createView({ x: 600, y: 400, zoom: 1 })
    expect(clampToContent(view, bounds, VIEWPORT)).toBe(view)
  })

  it('pulls the content back when it has been thrown off screen', () => {
    const thrown = createView({ x: 90000, y: 0, zoom: 1 })
    const held = clampToContent(thrown, bounds, VIEWPORT)
    const nearEdge = bounds.minX * held.zoom + held.x
    expect(nearEdge).toBeLessThanOrEqual(VIEWPORT.w)
  })

  it('still allows pushing the graph aside to look at it', () => {
    const nudged = createView({ x: 900, y: 400, zoom: 1 })
    expect(clampToContent(nudged, bounds, VIEWPORT)).toBe(nudged)
  })

  it('has nothing to hold on to when there is no content', () => {
    const view = createView({ x: 5000, y: 5000, zoom: 1 })
    expect(clampToContent(view, null, VIEWPORT)).toBe(view)
  })
})

describe('isComfortable', () => {
  const view: CameraView = createView({ x: 600, y: 400, zoom: 1 })

  it('rejects a mark hugging the edge of the frame', () => {
    expect(isComfortable(mark(590, 0), view, VIEWPORT)).toBe(false)
  })

  it('rejects a mark too small to read', () => {
    expect(isComfortable(mark(0, 0, 4), view, VIEWPORT)).toBe(false)
  })

  it('accounts for the panels when deciding what is on screen', () => {
    expect(isComfortable(mark(250, 0), view, VIEWPORT)).toBe(true)
    expect(isComfortable(mark(250, 0), view, PANELLED)).toBe(false)
  })
})

describe('boundsWithMargin', () => {
  it('includes the radii so nothing is clipped at the frame edge', () => {
    expect(boundsWithMargin([mark(0, 0, 10)], 5)).toEqual({ minX: -15, minY: -15, maxX: 15, maxY: 15 })
  })

  it('has no answer for nothing', () => {
    expect(boundsWithMargin([])).toBeNull()
  })
})
