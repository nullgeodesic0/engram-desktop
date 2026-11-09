import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type CourseManifest,
  type CourseView,
  checkPreparedGraph,
  checkpointMet,
  consolidation,
  gateFor,
  parseCourseManifest,
  partContext,
} from './course'

const EXAMPLE = resolve(__dirname, '../../../examples/example-pack')

function base(): Record<string, unknown> {
  return {
    id: 'c',
    title: 'C',
    stages: [{ id: 's1', title: 'S1', tracks: [{ id: 't', title: 'T', topics: ['a', 'b', 'c'] }], milestones: [] }],
    topics: {
      a: { title: 'A', requires: [] },
      b: { title: 'B', requires: ['a'] },
      c: { title: 'C', requires: ['b'] },
    },
  }
}

function parsed(raw: unknown): CourseManifest {
  const r = parseCourseManifest(raw)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('course.json', () => {
  it('parses the example pack course, with its defaults', () => {
    const c = parsed(JSON.parse(readFileSync(resolve(EXAMPLE, 'course.json'), 'utf-8')))
    expect(c.id).toBe('linear-models')
    expect(Object.keys(c.topics)).toEqual(['least-squares', 'residuals'])
    expect(c.topics['least-squares'].graph).toBe('course/least-squares.graph.json')
    expect(c.topics.residuals.outline).toBe('course/residuals.outline.md')
    expect(c.stages[0].checkpoint?.parts.map((p) => p.evidence.kind)).toEqual(['lab', 'topic'])
    expect(c.stages[0].milestones.map((p) => p.evidence.kind)).toEqual(['attested', 'link'])
    const d = parsed(base())
    expect(d.threshold).toBe(0.6)
    expect(d.stages[0].checkpoint).toBeNull()
  })

  it('refuses a prerequisite loop, an unknown prerequisite and a self-requirement', () => {
    const loop = base()
    ;(loop.topics as Record<string, { requires: string[] }>).a.requires = ['c']
    expect(parseCourseManifest(loop)).toMatchObject({ ok: false, error: expect.stringMatching(/loop/) })
    const unknown = base()
    ;(unknown.topics as Record<string, { requires: string[] }>).a.requires = ['z']
    expect(parseCourseManifest(unknown)).toMatchObject({ ok: false, error: expect.stringMatching(/does not define/) })
    const self = base()
    ;(self.topics as Record<string, { requires: string[] }>).a.requires = ['a']
    expect(parseCourseManifest(self)).toMatchObject({ ok: false, error: expect.stringMatching(/requires itself/) })
  })

  it('places every topic in exactly one track', () => {
    const twice = base()
    ;(twice.stages as { tracks: unknown[] }[])[0].tracks.push({ id: 'u', title: 'U', topics: ['a'] })
    expect(parseCourseManifest(twice)).toMatchObject({ ok: false, error: expect.stringMatching(/already placed/) })
    const missing = base()
    ;(missing.stages as { tracks: { topics: string[] }[] }[])[0].tracks[0].topics = ['a', 'b']
    expect(parseCourseManifest(missing)).toMatchObject({ ok: false, error: expect.stringMatching(/not placed.*c/) })
  })

  it('refuses a topic with both a map and an outline, a bad id, and a part naming an unknown topic', () => {
    const both = base()
    ;(both.topics as Record<string, Record<string, unknown>>).a.graph = 'a.json'
    ;(both.topics as Record<string, Record<string, unknown>>).a.outline = 'a.md'
    expect(parseCourseManifest(both)).toMatchObject({ ok: false, error: expect.stringMatching(/not both/) })
    const bad = base()
    ;(bad.topics as Record<string, unknown>).Bad = { title: 'x' }
    expect(parseCourseManifest(bad).ok).toBe(false)
    const part = base()
    ;(part.stages as Record<string, unknown>[])[0].milestones = [
      { id: 'p', label: 'P', evidence: { kind: 'topic', topic: 'zz' } },
    ]
    expect(parseCourseManifest(part)).toMatchObject({ ok: false, error: expect.stringMatching(/zz/) })
  })

  it('refuses a part id used twice and a path out of the pack', () => {
    const dup = base()
    const p = { id: 'p', label: 'P', evidence: { kind: 'attested' } }
    ;(dup.stages as Record<string, unknown>[])[0].milestones = [p, p]
    expect(parseCourseManifest(dup)).toMatchObject({ ok: false, error: expect.stringMatching(/used twice/) })
    const out = base()
    ;(out.topics as Record<string, Record<string, unknown>>).a.graph = '../x.json'
    expect(parseCourseManifest(out).ok).toBe(false)
  })
})

describe('prepared maps', () => {
  const graph = JSON.parse(readFileSync(resolve(EXAMPLE, 'course/least-squares.graph.json'), 'utf-8'))

  it('accepts the example map for its own topic id only', () => {
    expect(checkPreparedGraph(graph, 'least-squares')).toBeNull()
    expect(checkPreparedGraph(graph, 'residuals')).toMatch(/not residuals/)
  })

  it('refuses a map with no nodes, too many nodes, or no order', () => {
    expect(checkPreparedGraph({ ...graph, nodes: {} }, 'least-squares')).toMatch(/no nodes/)
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`n${i}`, {}]))
    expect(checkPreparedGraph({ ...graph, nodes: many }, 'least-squares')).toMatch(/at most 20/)
    expect(checkPreparedGraph({ ...graph, order: undefined }, 'least-squares')).toMatch(/order/)
    expect(checkPreparedGraph([], 'least-squares')).toMatch(/not a JSON object/)
  })
})

describe('gates and checkpoints', () => {
  const course = parsed(base())

  it('measures consolidation over live nodes', () => {
    expect(consolidation(undefined)).toBeNull()
    expect(consolidation({ states: { review: 3, learning: 1, new: 0 }, nodes: 4 })).toBe(0.75)
    expect(
      consolidation({
        states: { review: 3, learning: 1, new: 1 },
        nodes: 5,
        liveStates: { review: 3, learning: 1, new: 0 },
      }),
    ).toBe(0.75)
  })

  it('opens a topic whose prerequisites are past the threshold, and lists the path otherwise', () => {
    const cons = (m: Record<string, number>) => (t: string) => m[t] ?? null
    expect(gateFor(course, 'a', cons({}))).toEqual({ open: true, path: [] })
    expect(gateFor(course, 'c', cons({}))).toEqual({ open: false, path: ['a', 'b'] })
    expect(gateFor(course, 'c', cons({ a: 0.9, b: 0.3 }))).toEqual({ open: false, path: ['b'] })
    // A met prerequisite stops the walk, even when its own prerequisites are not.
    expect(gateFor(course, 'c', cons({ b: 0.6 }))).toEqual({ open: true, path: [] })
  })

  it('passes a checkpoint only when every part has its record', () => {
    const c = parsed(JSON.parse(readFileSync(resolve(EXAMPLE, 'course.json'), 'utf-8')))
    const view: CourseView = {
      packId: 'example-pack',
      packTitle: 'Example pack',
      course: c,
      labs: { 'fit-a-line': { title: 'Fit', passed: { m1: null }, milestoneTitles: {} } },
      records: { attested: {}, startedAnyway: {} },
      warnings: [],
    }
    const stage = c.stages[0]
    expect(
      checkpointMet(
        stage,
        partContext(view, () => 0.9),
      ),
    ).toBe(false)
    view.labs['fit-a-line'].passed.m1 = '2026-11-01T00:00:00.000Z'
    expect(
      checkpointMet(
        stage,
        partContext(view, () => 0.5),
      ),
    ).toBe(false)
    expect(
      checkpointMet(
        stage,
        partContext(view, () => 0.8),
      ),
    ).toBe(true)
  })
})
