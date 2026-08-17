import { useEffect, useRef, useState } from 'react'
import type { MapAnnotations, TopicGraph } from '../../../../shared/types'
import { GraphEngine, type EngineCallbacks } from './engine/GraphEngine'
import { WebGLPainter } from './engine/WebGLPainter'
import { Canvas2DPainter } from './engine/render'
import type { PlatePainter } from './engine/paint'
import { GraphSettings } from './GraphSettings'
import { readGraphSettings, saveGraphSettings, type AtlasGraphSettings } from './settings'
import { CTRL_QUIET } from '../../shared/controlChrome'

/** The Topic Map's WebGL host — replaces the retired `GraphView.tsx`'s SVG
 * root with two stacked `<canvas>` elements (drawing, and a text overlay
 * for labels) driven by `GraphEngine`.
 *
 * Same props contract `GraphViewProps` had, so `TopicMapView.tsx` swaps
 * `<GraphView ...>` for `<AtlasCanvas ...>` with no other changes: the
 * search box, due-lens toggle, region focus state, replay scrubber, and
 * node-detail drawer all keep reading/writing exactly the state they
 * already owned.
 *
 * Architecturally mirrors CairnDesktop's `AtlasPlate.tsx`: canvas refs, a
 * host div for sizing, WebGL2→Canvas2D fallback on mount failure, a mid-
 * session fallback factory handed to the engine for context loss, and
 * callback props held in a ref so `GraphEngine`'s own `EngineCallbacks`
 * object is registered once at mount rather than on every render. */

export interface AtlasCanvasProps {
  graph: TopicGraph
  selected: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  query: string
  retrievability: Map<string, number> | null
  annotations?: MapAnnotations | null
  dueLens: boolean
  visibleNodes?: Set<string> | null
  regions: Map<string, string[]>
  focusedRegion: string | null
  onFocusRegion: (seed: string | null) => void
}

export function AtlasCanvas(props: AtlasCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<GraphEngine | null>(null)
  const callbacksRef = useRef(props)
  callbacksRef.current = props
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AtlasGraphSettings>(readGraphSettings)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    const text = textRef.current
    if (!host || !canvas) return

    const callbacks: EngineCallbacks = {
      onSelect: (id) => callbacksRef.current.onSelect(id),
      onOpen: (id) => callbacksRef.current.onOpen(id),
      onFocusRegion: (seed) => callbacksRef.current.onFocusRegion(seed),
    }

    let painter: PlatePainter
    try {
      painter = new WebGLPainter(canvas, text)
    } catch {
      // WebGL2 unavailable at all (disabled acceleration, an old driver
      // blocklisted by Chromium) — the honest degradation, not a crash.
      painter = new Canvas2DPainter(canvas)
    }
    const makeFallback = (): PlatePainter => new Canvas2DPainter(canvas)

    const engine = new GraphEngine(host, canvas, text, callbacks, painter, makeFallback)
    engineRef.current = engine
    engine.mount()
    return () => {
      engine.destroy()
      engineRef.current = null
    }
    // Mount once — the engine's own `update()` (below) is how prop changes
    // reach it after that; remounting on every graph/selection change would
    // tear down the camera and physics state a reader is mid-interaction with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    engineRef.current?.update({
      graph: props.graph,
      selected: props.selected,
      query: props.query,
      retrievability: props.retrievability,
      annotations: props.annotations ?? null,
      dueLens: props.dueLens,
      visibleNodes: props.visibleNodes ?? null,
      regions: props.regions,
      focusedRegion: props.focusedRegion,
    })
  }, [
    props.graph,
    props.selected,
    props.query,
    props.retrievability,
    props.annotations,
    props.dueLens,
    props.visibleNodes,
    props.regions,
    props.focusedRegion,
  ])

  // Pushed to the engine on every change, not just on open/close — a slider
  // drag must resettle the plate live, the same immediacy Cairn's docked
  // panel has. Persisted here too, so the panel's own Reset button (which
  // only touches React state) and this effect are the single place settings
  // are written to storage.
  useEffect(() => {
    engineRef.current?.updateSettings(settings)
    saveGraphSettings(settings)
  }, [settings])

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden" aria-label={`Topic map — ${props.graph.title}`}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" tabIndex={0} />
      <canvas ref={textRef} className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true" />

      {/* Bottom-right — the one corner the plate's other floating chrome
          (search top-left, territory/pressure readouts top-right, Key
          bottom-left) leaves free. */}
      {!settingsOpen && (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Graph settings"
          title="Graph settings"
          className={`${CTRL_QUIET} absolute bottom-3 right-3 z-10`}
        >
          Settings
        </button>
      )}

      {settingsOpen && <GraphSettings value={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
