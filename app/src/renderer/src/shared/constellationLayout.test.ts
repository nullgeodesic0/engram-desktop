import { describe, it, expect } from 'vitest'
import { layoutConstellation } from './constellationLayout'
import type { EngramNode } from '../../../shared/types'

/** Minimal fixture: the layout reads ONLY `edges.requires`, `state` and
 * `threshold`, so the fixture names only those. Spelling out the rest of
 * EngramNode to satisfy the type would put `claim`/`rubric`/`transfer_probe`
 * in this file — the three fields the D4 answer-leak gate watches for — and
 * earning a pin for a test fixture would blunt a rule that exists to stop a
 * probe's answer reaching a learner early. The cast keeps the gate sharp and
 * documents the real dependency surface at the same time.
 */
const node = (requires: string[], state = 'new', threshold = false, capstone = false): EngramNode =>
  ({
    edges: { requires, derives_from: [], contrasts_with: [], analogous_to: [] },
    state,
    threshold,
    capstone,
  }) as unknown as EngramNode

const chain = {
  order: ['a', 'b', 'c'],
  nodes: { a: node([]), b: node(['a'], 'review'), c: node(['b'], 'learning') },
}

describe('layoutConstellation', () => {
  it('is deterministic — the same graph always draws the identical figure', () => {
    // The whole premise: a figure claiming to depict your knowledge must only
    // move when the knowledge does. A force simulation would fail this.
    const a = layoutConstellation(chain, 260, 68)
    const b = layoutConstellation(chain, 260, 68)
    expect(a).toEqual(b)
  })

  it('places nodes left-to-right by prerequisite depth', () => {
    const { nodes } = layoutConstellation(chain, 260, 68)
    const x = Object.fromEntries(nodes.map((n) => [n.id, n.x]))
    expect(x.a).toBeLessThan(x.b)
    expect(x.b).toBeLessThan(x.c)
  })

  it('carries each node\'s real state and threshold flag', () => {
    const { nodes } = layoutConstellation(chain, 260, 68)
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
    expect(byId.b.state).toBe('review')
    expect(byId.c.state).toBe('learning')
    expect(byId.a.threshold).toBe(false)
  })

  it('draws one edge per real requires link, and none that were not declared', () => {
    const { edges } = layoutConstellation(chain, 260, 68)
    expect(edges).toHaveLength(2) // b→a, c→b
  })

  it('survives a cyclic requires instead of recursing forever', () => {
    // The engine should never emit one, but a hang here would take the whole
    // shelf down, so the depth walk carries an in-progress guard.
    const cyclic = { order: ['x', 'y'], nodes: { x: node(['y']), y: node(['x']) } }
    const out = layoutConstellation(cyclic, 260, 68)
    expect(out.nodes).toHaveLength(2)
    expect(out.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true)
  })

  it('ignores requires pointing at nodes that are not in the graph', () => {
    const dangling = { order: ['a'], nodes: { a: node(['ghost']) } }
    const out = layoutConstellation(dangling, 260, 68)
    expect(out.nodes).toHaveLength(1)
    expect(out.edges).toHaveLength(0)
  })

  it('keeps every node inside the box', () => {
    const wide: Record<string, EngramNode> = {}
    for (let i = 0; i < 60; i++) wide[`n${i}`] = node(i > 0 ? ['n0'] : [])
    const out = layoutConstellation({ order: Object.keys(wide), nodes: wide }, 260, 68)
    // A fat layer spreads down the column plus a seeded nudge; the nudge must
    // never push a cell outside the figure.
    expect(out.nodes.every((n) => n.x >= 0 && n.x <= 260 && n.y >= 0 && n.y <= 68)).toBe(true)
  })

  it('shrinks the cell radius as the graph grows', () => {
    const big: Record<string, EngramNode> = {}
    for (let i = 0; i < 120; i++) big[`n${i}`] = node([])
    const small = layoutConstellation(chain, 260, 68)
    const large = layoutConstellation({ order: Object.keys(big), nodes: big }, 260, 68)
    expect(large.r).toBeLessThan(small.r)
    expect(large.r).toBeGreaterThan(0)
  })

  it('reports truncation rather than silently drawing a slice', () => {
    const huge: Record<string, EngramNode> = {}
    for (let i = 0; i < 260; i++) huge[`n${i}`] = node([])
    const out = layoutConstellation({ order: Object.keys(huge), nodes: huge }, 260, 68)
    expect(out.truncated).toBe(true)
    expect(out.nodes).toHaveLength(200)
    // And the common case must NOT claim truncation.
    expect(layoutConstellation(chain, 260, 68).truncated).toBe(false)
  })

  describe('capstone edges', () => {
    // A capstone requires most of the topic, so drawing every one of its
    // prerequisites fans lines in from every layer and hairballs the figure.
    // Only the immediately-preceding layer survives.
    const withCapstone = {
      order: ['a', 'b', 'c', 'cap'],
      nodes: {
        a: node([]),
        b: node(['a']),
        c: node(['b']),
        // Requires the whole chain, as a real capstone does.
        cap: node(['a', 'b', 'c'], 'new', false, true),
      },
    }

    it('keeps only the link from the layer immediately before it', () => {
      const { edges, elidedCapstoneEdges } = layoutConstellation(withCapstone, 260, 68)
      // a→b, b→c are ordinary. Of the capstone's three, only c→cap survives.
      expect(edges).toHaveLength(3)
      expect(elidedCapstoneEdges).toBe(2)
    })

    it('budgets a wide preceding layer instead of fanning it', () => {
      // Depth-1 alone was not enough: a capstone whose immediately-preceding
      // layer is wide still drew a line per member.
      const nodes: Record<string, EngramNode> = { root: node([]) }
      const preds: string[] = []
      for (let i = 0; i < 12; i++) {
        const id = `p${i}`
        preds.push(id)
        nodes[id] = node(['root'])
      }
      nodes.cap = node(preds, 'new', false, true)
      const out = layoutConstellation({ order: ['root', ...preds, 'cap'], nodes }, 260, 68)
      const intoCap = out.edges.length - preds.length // minus the root→pN links
      expect(intoCap).toBe(3)
      expect(out.elidedCapstoneEdges).toBe(9)
    })

    it('drops the busiest predecessors first and keeps the sparse ones', () => {
      // A hub already anchors the dense part of the figure, so its extra line
      // to the capstone costs the most and says the least.
      const nodes: Record<string, EngramNode> = { root: node([]) }
      // hub0..hub3 each pick up extra links; quiet0..quiet3 have only root.
      for (let i = 0; i < 4; i++) nodes[`quiet${i}`] = node(['root'])
      for (let i = 0; i < 4; i++) nodes[`hub${i}`] = node(['root'])
      for (let i = 0; i < 4; i++) nodes[`leaf${i}`] = node([`hub${i}`, `hub${(i + 1) % 4}`])
      const preds = ['quiet0', 'quiet1', 'quiet2', 'quiet3', 'hub0', 'hub1', 'hub2', 'hub3']
      nodes.cap = node(preds, 'new', false, true)
      const order = Object.keys(nodes)
      const out = layoutConstellation({ order, nodes }, 260, 68)
      // The capstone sits one level past the preds; whatever it kept must be
      // quiet nodes, never hubs.
      const capPos = out.nodes.find((n) => n.id === 'cap')!
      const quietPos = new Set(
        out.nodes.filter((n) => n.id.startsWith('quiet')).map((n) => `${n.x},${n.y}`),
      )
      const intoCap = out.edges.filter((e) => e.x2 === capPos.x && e.y2 === capPos.y)
      expect(intoCap).toHaveLength(3)
      expect(intoCap.every((e) => quietPos.has(`${e.x1},${e.y1}`))).toBe(true)
    })

    it('treats an UNFLAGGED node as a capstone when its in-degree says so', () => {
      // The case real data exposed: grad-classical-mechanics carries two
      // terminal nodes — one flagged `capstone`, one not — each requiring
      // ~37 of 39 nodes. Keying off the flag alone pruned the first and drew
      // all 37 lines into the second, so the wedge survived. What crowds a
      // drawing is convergence, and convergence is measurable.
      const nodes: Record<string, EngramNode> = { root: node([]) }
      const mid: string[] = []
      for (let i = 0; i < 10; i++) {
        const id = `m${i}`
        mid.push(id)
        nodes[id] = node(['root'])
      }
      nodes.unflagged = node(mid) // NOT capstone: true
      const out = layoutConstellation({ order: ['root', ...mid, 'unflagged'], nodes }, 260, 68)
      const target = out.nodes.find((n) => n.id === 'unflagged')!
      const into = out.edges.filter((e) => e.x2 === target.x && e.y2 === target.y)
      expect(into.length).toBeLessThanOrEqual(3)
      expect(out.elidedCapstoneEdges).toBeGreaterThan(0)
    })

    it('never strands a node whose only link is into a convergence point', () => {
      // Such a node loses the degree tie-break on its id alone, and a cell
      // with no line reads as a rendering fault rather than as a fact.
      const nodes: Record<string, EngramNode> = { root: node([]) }
      const mid: string[] = []
      for (let i = 0; i < 8; i++) {
        const id = `m${i}`
        mid.push(id)
        nodes[id] = node(['root'])
      }
      // Alphabetically last, so it loses every tie.
      nodes.zzz_lonely = node([])
      nodes.cap = node([...mid, 'zzz_lonely'], 'new', false, true)
      const out = layoutConstellation({ order: ['root', ...mid, 'zzz_lonely', 'cap'], nodes }, 260, 68)
      const lonely = out.nodes.find((n) => n.id === 'zzz_lonely')!
      const touching = out.edges.filter(
        (e) => (e.x1 === lonely.x && e.y1 === lonely.y) || (e.x2 === lonely.x && e.y2 === lonely.y),
      )
      expect(touching.length).toBeGreaterThan(0)
    })

    it('is still deterministic about WHICH links it keeps', () => {
      // Ties on degree are broken by id, so the same graph keeps the same
      // three links every time — the figure must not reshuffle on remount.
      const nodes: Record<string, EngramNode> = { root: node([]) }
      const preds: string[] = []
      for (let i = 0; i < 8; i++) {
        const id = `p${i}`
        preds.push(id)
        nodes[id] = node(['root'])
      }
      nodes.cap = node(preds, 'new', false, true)
      const g = { order: ['root', ...preds, 'cap'], nodes }
      expect(layoutConstellation(g, 260, 68)).toEqual(layoutConstellation(g, 260, 68))
    })

    it('never leaves a capstone floating with no edge at all', () => {
      // Depth is defined as one more than the deepest prerequisite, so some
      // prerequisite always sits exactly one level below and survives.
      // Annotated: without it TS unions the three object literals and the
      // union's `nodes` picks up an optional `b?: undefined`, which is not a
      // Record<string, EngramNode>.
      const shapes: Array<{ order: string[]; nodes: Record<string, EngramNode> }> = [
        { order: ['a', 'cap'], nodes: { a: node([]), cap: node(['a'], 'new', false, true) } },
        withCapstone,
        {
          order: ['a', 'b', 'cap'],
          nodes: { a: node([]), b: node([]), cap: node(['a', 'b'], 'new', false, true) },
        },
      ]
      for (const g of shapes) {
        expect(layoutConstellation(g, 260, 68).edges.length).toBeGreaterThan(0)
      }
    })

    it('leaves graphs without a capstone completely untouched', () => {
      const plain = { order: ['a', 'b', 'c'], nodes: { a: node([]), b: node(['a']), c: node(['a', 'b']) } }
      const out = layoutConstellation(plain, 260, 68)
      expect(out.edges).toHaveLength(3) // b→a, c→a, c→b — the long link stays
      expect(out.elidedCapstoneEdges).toBe(0)
    })

    it('applies the rule to a capstone that is itself a prerequisite', () => {
      // Rare, but the rule is symmetric: an edge TOUCHING a capstone is judged
      // by the depth gap, whichever end the capstone is on.
      const g = {
        order: ['a', 'cap', 'x', 'far'],
        nodes: {
          a: node([]),
          cap: node(['a'], 'new', false, true),
          x: node(['cap']),
          far: node(['x', 'cap']),
        },
      }
      const out = layoutConstellation(g, 260, 68)
      // far→cap spans two levels and goes; a→cap, cap→x, far→x remain.
      expect(out.elidedCapstoneEdges).toBe(1)
      expect(out.edges).toHaveLength(3)
    })
  })

  it('renders a graph with no order array', () => {
    const noOrder = { order: [] as string[], nodes: { a: node([]), b: node(['a']) } }
    expect(layoutConstellation(noOrder, 260, 68).nodes).toHaveLength(2)
  })

  it('returns an empty figure for an empty graph', () => {
    const out = layoutConstellation({ order: [], nodes: {} }, 260, 68)
    expect(out.nodes).toHaveLength(0)
    expect(out.edges).toHaveLength(0)
  })
})
