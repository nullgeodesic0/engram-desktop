/** The one contract both painters (`WebGLPainter`, the Canvas2D fallback in
 * `render.ts`) satisfy, and the one shape `GraphEngine` builds every frame
 * to hand to whichever of them is mounted.
 *
 * Splitting this out from either painter is what lets `GraphEngine` swap
 * GL for Canvas2D mid-session on context loss without knowing anything
 * about how either one actually draws — it only ever talks to this
 * interface. */

import type { CameraView } from '../camera'
import type { LabelBox } from '../labels'
import type { AtlasLayout } from '../layout'
import type { PlateTokens } from './tokens'

export interface RenderFrame {
  layout: AtlasLayout
  view: CameraView
  width: number
  height: number
  dpr: number
  tokens: PlateTokens
  title: string
  selected: string | null
  hovered: string | null
  dueLens: boolean
  ancestorSet: ReadonlySet<string> | null
  descendantSet: ReadonlySet<string> | null
  /** Replay gating (`TopicMapView`'s growth scrubber) — null means "show
   * everything", a Set means "show only these ids", matching the SVG
   * renderer's own `visibleNodes` prop exactly. */
  visibleNodes: ReadonlySet<string> | null
  retrievability: ReadonlyMap<string, number> | null
  focusedRegion: string | null
  query: string
  /** Computed once per frame by `GraphEngine` (via `labels.ts`'s
   * `placeLabels`) and handed to the painter already positioned — the
   * painter draws them, it does not decide which names win the space. */
  labels: LabelBox[]
  /** Monotonic seconds, for the one time-driven effect left on this plate
   * once the ambient drift wobble was retired in favour of real physics —
   * the frontier ring's pulse. */
  nowSec: number
  reducedMotion: boolean
}

export interface PlatePainter {
  paint(frame: RenderFrame): void
  resize(width: number, height: number, dpr: number): void
  dispose(): void
}
