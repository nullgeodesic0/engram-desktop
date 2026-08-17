import { describe, expect, it } from 'vitest'
import { flightDistance, planFlight, type Viewpoint } from './flight'

const at = (cx: number, cy: number, w: number): Viewpoint => ({ cx, cy, w })

describe('planFlight', () => {
  it('starts where it starts and ends where it ends', () => {
    const flight = planFlight(at(0, 0, 800), at(4000, 1200, 200))
    const start = flight.at(0)
    const end = flight.at(flight.duration)
    expect(start.cx).toBeCloseTo(0, 3)
    expect(start.w).toBeCloseTo(800, 3)
    expect(end.cx).toBeCloseTo(4000, 2)
    expect(end.cy).toBeCloseTo(1200, 2)
    expect(end.w).toBeCloseTo(200, 2)
  })

  it('rises above both ends when the journey is long', () => {
    const flight = planFlight(at(0, 0, 300), at(9000, 0, 300))
    const middle = flight.at(flight.duration / 2)
    expect(middle.w).toBeGreaterThan(300 * 3)
  })

  it('does not rise for a short hop', () => {
    const flight = planFlight(at(0, 0, 600), at(120, 0, 600))
    const middle = flight.at(flight.duration / 2)
    expect(middle.w).toBeLessThan(600 * 1.2)
  })

  it('moves monotonically toward the target', () => {
    const flight = planFlight(at(0, 0, 500), at(3000, 0, 500))
    let previous = -Infinity
    for (let i = 0; i <= 20; i++) {
      const point = flight.at((flight.duration * i) / 20)
      expect(point.cx).toBeGreaterThanOrEqual(previous - 1e-6)
      previous = point.cx
    }
  })

  it('interpolates a pure zoom geometrically', () => {
    const flight = planFlight(at(0, 0, 800), at(0, 0, 200))
    expect(flight.at(flight.duration / 2).w).toBeCloseTo(400, 1)
  })

  it('survives identical viewpoints without producing NaN', () => {
    const flight = planFlight(at(10, 10, 400), at(10, 10, 400))
    const point = flight.at(flight.duration / 2)
    expect(Number.isFinite(point.cx)).toBe(true)
    expect(Number.isFinite(point.w)).toBe(true)
    expect(flight.length).toBeCloseTo(0, 6)
  })

  it('clamps time outside the flight to its ends', () => {
    const flight = planFlight(at(0, 0, 400), at(500, 0, 100))
    expect(flight.at(-50).cx).toBeCloseTo(0, 6)
    expect(flight.at(flight.duration * 3).cx).toBeCloseTo(500, 2)
  })

  it('keeps every duration inside the band a reader will tolerate', () => {
    const tiny = planFlight(at(0, 0, 500), at(1, 0, 500))
    const enormous = planFlight(at(0, 0, 50), at(500000, 400000, 50))
    expect(tiny.duration).toBeGreaterThanOrEqual(90)
    expect(enormous.duration).toBeLessThanOrEqual(900)
  })
})

describe('flightDistance', () => {
  it('keeps growing after the duration has hit its ceiling', () => {
    const far = flightDistance(at(0, 0, 50), at(500000, 0, 50))
    const farther = flightDistance(at(0, 0, 50), at(5000000, 0, 50))
    expect(farther).toBeGreaterThan(far)
  })

  it('is zero for a move that is not a move', () => {
    expect(flightDistance(at(3, 4, 700), at(3, 4, 700))).toBeCloseTo(0, 6)
  })
})
