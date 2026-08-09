import { useEffect, useRef, useState } from 'react'
import type { TopicGraph } from '../../../shared/types'
import { layoutConstellation, type Constellation } from '../shared/constellationLayout'

const W = 260
const H = 68

/** One topic's actual concept graph, drawn at row scale as a Cajal figure.
 *
 * Every mark is real: the nodes are the topic's nodes, the lines are its
 * `requires` edges, and each node's ink is its own FSRS state — warm filled
 * for consolidated, warm outlined mid-encoding, cool outlined for not yet, and
 * violet dashed for a threshold concept. Nothing here is decorative geometry
 * standing in for data (PRODUCT.md: the app never claims a measurement it did
 * not take), which is also why a graph too large to draw whole reports itself
 * as partial rather than quietly showing a slice.
 *
 * Circles, not the InkNode wobble blob: at r ≈ 1–3px the 8-point hand-drawn
 * outline is sub-pixel — it would cost eight curve segments per node to render
 * something indistinguishable from a dot. The blob stays the row's own single
 * glyph, where it is big enough to read as a cell.
 *
 * COST DISCIPLINE. The graph is fetched only when the row is near the
 * viewport, and cached module-wide for the session, so a shelf of nine topics
 * costs nine reads spread across scrolling and none on first paint. Rows
 * render the empty frame until their graph lands, so nothing blocks and
 * nothing reflows.
 */

/** Session cache — shared by every mount, so scrolling a row out and back does
 * not refetch, and Home/the drilldown could reuse it later. `null` marks a
 * topic whose graph could not be read, so a failure is remembered instead of
 * retried on every intersection. */
const graphCache = new Map<string, TopicGraph | null>()

export function TopicConstellation({ topic, className = '' }: { topic: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [shape, setShape] = useState<Constellation | null>(null)
  const [near, setNear] = useState(false)

  // Near-viewport gate. `rootMargin` pre-warms so the figure is already drawn
  // by the time the row is actually looked at.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!near) return
    let alive = true
    const cached = graphCache.get(topic)
    if (cached !== undefined) {
      if (cached) setShape(layoutConstellation(cached, W, H))
      return
    }
    window.engram
      .topicGraph(topic)
      .then((g) => {
        const graph = (g ?? null) as TopicGraph | null
        graphCache.set(topic, graph)
        if (alive && graph) setShape(layoutConstellation(graph, W, H))
      })
      .catch(() => {
        // A topic whose graph cannot be read simply has no figure — the row
        // still works, and the failure is cached so it is not retried.
        graphCache.set(topic, null)
      })
    return () => {
      alive = false
    }
  }, [near, topic])

  const total = shape?.nodes.length ?? 0
  const consolidated = shape?.nodes.filter((n) => n.state === 'review').length ?? 0

  return (
    <div ref={hostRef} className={`shrink-0 ${className}`} aria-hidden="true">
      {shape && total > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="presentation">
          <title>
            {`${total} node${total === 1 ? '' : 's'} · ${consolidated} consolidated · ${shape.edges.length} prerequisite link${
              shape.edges.length === 1 ? '' : 's'
            } drawn${
              shape.elidedCapstoneEdges > 0
                ? ` · ${shape.elidedCapstoneEdges} capstone link${shape.elidedCapstoneEdges === 1 ? '' : 's'} not shown`
                : ''
            }${shape.truncated ? ' · figure partial' : ''}`}
          </title>
          {/* Prerequisite edges first, under the cells. Faint by decree: the
              structure should be legible as a texture, and the cells are what
              carry state. */}
          {shape.edges.map((e, i) => (
            <line
              key={`e${i}`}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke="var(--color-edge)"
              strokeWidth="0.7"
              // Normalises every line to one unit so the dash draw runs at a
              // uniform rate regardless of the edge's real length.
              pathLength={1}
              strokeDasharray={1}
              className="constellation-edge"
              style={{ ['--ink-delay' as string]: `${Math.min(260, i * 3)}ms` }}
            />
          ))}
          {shape.nodes.map((n, i) => {
            const threshold = n.threshold
            const ink = threshold
              ? 'var(--color-ink-violet)'
              : n.state === 'review'
                ? 'var(--color-ink-warm)'
                : n.state === 'learning'
                  ? 'var(--color-ink-warm-dim)'
                  : 'var(--color-ink-cool)'
            // Filled = consolidated, outlined = not yet. The same reading the
            // InkNode variant carries everywhere else in the app.
            const filled = n.state === 'review'
            return (
              <circle
                key={n.id}
                cx={n.x}
                cy={n.y}
                r={shape.r}
                fill={filled ? ink : 'none'}
                stroke={ink}
                strokeWidth={threshold ? 0.9 : 0.8}
                strokeDasharray={threshold ? '1.6 1.4' : undefined}
                opacity={filled ? 0.92 : 0.75}
                className="constellation-cell"
                style={{ ['--ink-delay' as string]: `${Math.min(320, 60 + i * 4)}ms` }}
              />
            )
          })}
        </svg>
      )}
      {shape?.truncated && (
        <div className="label-data text-[9px] text-[var(--color-text-faint)] text-right">figure partial</div>
      )}
    </div>
  )
}
