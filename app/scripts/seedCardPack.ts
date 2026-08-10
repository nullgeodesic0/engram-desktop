/**
 * Builds a card pack from a REAL node in the learner's graph, for developing
 * and demonstrating the mobile walk without spending a live session.
 *
 * ⚠ THIS IS A DEV FIXTURE, NOT THE GENERATOR. The real path is a tutor calling
 * the `emit_card_pack` bridge tool mid-session, where distractors are authored
 * against the learner's own recorded misconceptions as the overlay requires.
 * This script approximates that with the best material available offline: true
 * steps come from the node's own `rubric` (which is already an ordered list of
 * criteria), and distractors are lifted from OTHER nodes' criteria in the same
 * topic — real, adjacent, plausible-looking near-misses rather than filler, but
 * chosen by proximity rather than by pedagogy. Packs it writes are good enough
 * to walk and to look at. They are not evidence that generation works.
 *
 * Reads the graph read-only. Writes only into the app's own card-pack store.
 *
 *   npx tsx scripts/seedCardPack.ts <topic> [nodeId]
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createCardPackStore } from '../src/main/link/cardPackStore'
import type { CardPack } from '../src/shared/cardPack'

const GRAPHS = join(homedir(), '.claude', 'learning', 'graphs')
const PACK_ROOT = join(homedir(), 'Library', 'Application Support', 'Engram Desktop', 'card-packs')

interface Node {
  claim: string
  probe: string
  rubric: string[]
  edges?: { requires?: string[]; derives_from?: string[]; contrasts_with?: string[]; analogous_to?: string[] }
  threshold?: boolean
  kind?: string
  arbitrary?: boolean
  transfer_probe?: string
  state?: string
}

function nodeKind(node: Node): 'concept' | 'fact' | 'procedure' {
  if (node.kind === 'procedure') return 'procedure'
  if (node.kind === 'fact') return 'fact'
  if (node.kind === 'concept') return 'concept'
  // Mirrors engram.py's node_kind_of for the 117 kindless nodes.
  return node.arbitrary ? 'fact' : 'concept'
}

function shuffle<T>(items: T[], seed: number): T[] {
  // Deterministic, so re-seeding the same node yields the same pack — a demo
  // that reshuffles under you is hard to talk about.
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 4294967296
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function main(): Promise<void> {
  const [topic, requestedNode] = process.argv.slice(2)
  if (!topic) {
    console.error('usage: npx tsx scripts/seedCardPack.ts <topic> [nodeId]')
    process.exit(1)
  }

  const graph = JSON.parse(readFileSync(join(GRAPHS, `${topic}.json`), 'utf-8')) as {
    nodes: Record<string, Node>
  }
  const entries = Object.entries(graph.nodes)
  const [nodeId, node] = requestedNode
    ? [requestedNode, graph.nodes[requestedNode]]
    : (entries.find(([, n]) => (n.rubric?.length ?? 0) >= 3) ?? entries[0])

  if (!node) {
    console.error(`no such node: ${requestedNode}`)
    process.exit(1)
  }
  if (!node.rubric || node.rubric.length < 2) {
    console.error(`node ${nodeId} has too few rubric criteria to build a ladder from`)
    process.exit(1)
  }

  // Distractors: other nodes' criteria in this topic. Adjacent material, so
  // they read as plausible rather than as filler.
  const foreign = entries
    .filter(([id]) => id !== nodeId)
    .flatMap(([, n]) => n.rubric ?? [])
    .filter((c) => c.length > 20 && c.length < 220)
  const distractors = shuffle(foreign, 7).slice(0, Math.max(node.rubric.length, 3))

  const trueSteps = node.rubric.map((c, i) => ({ id: `s${i}`, label: c }))
  const noise = distractors.map((c, i) => ({ id: `d${i}`, label: c }))
  const pool = shuffle([...trueSteps, ...noise], 11)

  const neighbours = [
    ...(node.edges?.requires ?? []),
    ...(node.edges?.derives_from ?? []),
    ...(node.edges?.contrasts_with ?? []),
  ].filter((id) => graph.nodes[id])
  const nonNeighbours = entries
    .map(([id]) => id)
    .filter((id) => id !== nodeId && !neighbours.includes(id))
    .slice(0, 2)

  const eligibility = {
    nodeKind: nodeKind(node),
    threshold: Boolean(node.threshold),
    transferReady: false,
    lapsed: node.state === 'lapsed',
    experimentArm: null,
  }
  const carvedOut =
    eligibility.threshold || eligibility.nodeKind === 'procedure' || eligibility.lapsed

  const connectOptions =
    neighbours.length > 0
      ? [
          { id: 'a', label: neighbours[0] },
          ...nonNeighbours.map((id, i) => ({ id: `x${i}`, label: id })),
        ]
      : [
          { id: 'a', label: 'no recorded neighbour' },
          ...nonNeighbours.map((id, i) => ({ id: `x${i}`, label: id })),
        ]

  const pack: CardPack = {
    packId: randomUUID(),
    topic,
    node: nodeId,
    nodeTitle: nodeId.replace(/-/g, ' '),
    generatedAt: new Date().toISOString(),
    eligibility,
    beats: [
      { beat: 'open_gap', kind: 'prose', content: node.probe },
      {
        beat: 'predict',
        kind: 'mc',
        stem: 'Before anything is shown — which of these does the argument have to establish first?',
        options: shuffle(
          [
            { id: 'a', label: node.rubric[0] },
            ...distractors.slice(0, 2).map((c, i) => ({ id: `b${i}`, label: c })),
          ],
          3,
        ),
        sealed: { correctOptionIds: ['a'], revealMarkdown: node.rubric[0] },
      },
      {
        beat: 'struggle',
        kind: 'hints',
        rungs: node.rubric.slice(0, 2).map((c) => `Consider what has to be true for: ${c}`),
      },
      { beat: 'resolve', kind: 'prose', content: node.claim },
      {
        beat: 'self_explain',
        kind: 'ladder',
        stem: 'In your own order — assemble the argument for why this must hold.',
        pool,
        sealed: {
          orderedStepIds: trueSteps.map((s) => s.id),
          revealMarkdown: node.rubric.map((c, i) => `${i + 1}. ${c}`).join('\n'),
        },
      },
      {
        beat: 'connect',
        kind: 'mc',
        stem: 'Name one edge out loud: which node does this lean on?',
        options: connectOptions,
        sealed: { correctOptionIds: ['a'], revealMarkdown: neighbours[0] ?? '—' },
      },
      carvedOut
        ? {
            beat: 'verify',
            kind: 'recall',
            stem: node.probe,
            sealed: { revealMarkdown: node.claim },
          }
        : {
            beat: 'verify',
            kind: 'ladder',
            stem: `Cold, from memory: ${node.probe}`,
            pool: shuffle(pool, 23),
            sealed: {
              orderedStepIds: trueSteps.map((s) => s.id),
              revealMarkdown: node.claim,
            },
          },
      {
        beat: 'close',
        kind: 'prose',
        content: 'Walked on glass — this node is provisional until a desk sitting solidifies it.',
      },
    ],
  } as CardPack

  const store = createCardPackStore({ rootDir: PACK_ROOT })
  await store.put(pack)

  console.log(`seeded ${topic}/${nodeId}`)
  console.log(`  node_kind=${eligibility.nodeKind} threshold=${eligibility.threshold} carved-out=${carvedOut}`)
  console.log(`  verify=${carvedOut ? 'recall (carve-out honoured)' : 'ladder'}`)
  console.log(`  ladder: ${trueSteps.length} true steps in a pool of ${pool.length}`)
  console.log(`  → ${join(PACK_ROOT, topic, `${nodeId}.json`)}`)
  console.log('\n⚠ dev fixture: distractors are neighbouring rubric criteria, not tutor-authored.')
}

void main()
