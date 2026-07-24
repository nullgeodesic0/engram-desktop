import { memo, useEffect, useState } from 'react'
import type { TopicGraph } from '../../../../shared/types'
import { settlePlate, cellBodyPath } from '../graph2d/plate'
import { buildEdges } from '../graph3d/layout'

const W = 360
const H = 220

/** The atlas being born: once the architect's `add-topic` lands, the new
 * curriculum stage-draws itself as a mini ink plate — nodes appearing in
 * dependency order, edges threading in after — turning the slowest moment
 * of the whole app (curriculum construction) into its best one. Static and
 * non-interactive; the real map lives in the Topic Map view. */
export const AtlasBirth = memo(function AtlasBirth({ topic }: { topic: string | null }) {
  const [graph, setGraph] = useState<TopicGraph | null>(null)

  useEffect(() => {
    if (!topic) return
    let cancelled = false
    window.engram
      .topicGraph(topic)
      .then((g) => {
        if (cancelled) return
        const maybe = g as TopicGraph
        if (maybe && typeof maybe === 'object' && maybe.nodes && maybe.order) setGraph(maybe)
      })
      .catch(() => {
        // The plate just stays in its drawing state — never a hard failure.
      })
    return () => {
      cancelled = true
    }
  }, [topic])

  if (!topic || !graph) {
    return (
      <div className="panel px-4 py-3 max-w-md flex flex-col gap-2 pointer-events-none">
        <div className="fig-caption">the atlas is being drawn…</div>
        <div className="skeleton rounded h-24 w-full" />
      </div>
    )
  }

  const plate = settlePlate(graph, W, H)
  const edges = buildEdges(graph).filter((e) => e.kind === 'requires')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const order = graph.order.filter((id) => plate.has(id))
  const nodeCount = order.length
  const edgeDelay = reduced ? 0 : nodeCount * 0.06 + 0.2

  return (
    <div className="panel px-4 py-3 max-w-md flex flex-col gap-2 pointer-events-none select-none">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <g style={{ opacity: 0, animation: `atlas-fade 0.6s ease-out ${edgeDelay}s forwards` }}>
          {edges.map((e, i) => {
            const a = plate.get(e.source)
            const b = plate.get(e.target)
            if (!a || !b) return null
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--color-ink-cool-dim)"
                strokeWidth="0.8"
                strokeOpacity="0.5"
              />
            )
          })}
        </g>
        {order.map((id, i) => {
          const p = plate.get(id)!
          const r = Math.max(3, p.r * 0.55)
          return (
            <g key={id} transform={`translate(${p.x} ${p.y})`}>
              <path
                d={cellBodyPath(id, r)}
                fill="none"
                stroke={graph.nodes[id]?.capstone ? 'var(--color-ink-warm)' : 'var(--color-ink-cool)'}
                strokeWidth="1"
                style={
                  reduced
                    ? undefined
                    : { opacity: 0, animation: `atlas-fade 0.35s ease-out ${i * 0.06}s forwards` }
                }
              />
            </g>
          )
        })}
      </svg>
      <div className="fig-caption" style={reduced ? undefined : { opacity: 0, animation: `atlas-fade 0.5s ease-out ${edgeDelay + 0.4}s forwards` }}>
        {nodeCount} nodes mapped — the walk begins
      </div>
    </div>
  )
})
