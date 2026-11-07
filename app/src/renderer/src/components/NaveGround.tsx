/** The Nave ground: the app's still backdrop, after RaftHad's Nave Folio look
 * (packages/web/src/theme/naveFolio there). It replaces the old NeuralField,
 * a full-window WebGL particle scene that redrew every frame and made every
 * glass panel above it re-blur on each of those frames — the app's idle heat.
 *
 * Everything here is painted once. The only motion is the light shafts'
 * slow sway, a compositor-only CSS animation paused while the window is
 * unfocused (index.css, nf-sway):
 *   - a rough paper ground: one seeded noise tile, laid twice at two scales;
 *   - three soft diagonal light shafts, the first warm and the third violet
 *     (overview pages only — `[data-shafts="off"]` on <html> hides them while
 *     a transcript is open, so long reading sits on plain paper);
 *   - a faint outline arch in the right-hand gutter, only where the window
 *     is wide enough.
 *
 * No canvas per frame, no filter, no backdrop-filter. Purely
 * decorative: fixed, behind everything, aria-hidden, pointer-events none. */

/** FNV-1a then mulberry32: a small seeded generator, so the grain is the same on every launch. */
function seeded(text: string): () => number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let s = h >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let grainCache: string | null = null

/** One 200px tile of black and white specks at low alpha, so it reads on
 * either theme's ground. Generated once per launch; '' where there is no
 * canvas (tests), and the ground simply has no grain. */
export function grainDataUrl(): string {
  if (grainCache !== null) return grainCache
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 200
    const ctx = c.getContext('2d')
    if (!ctx) return (grainCache = '')
    const im = ctx.createImageData(200, 200)
    const r = seeded('cairn-grain')
    for (let i = 0; i < 200 * 200; i++) {
      const v = r()
      const o = i * 4
      im.data[o] = im.data[o + 1] = im.data[o + 2] = v > 0.5 ? 255 : 0
      im.data[o + 3] = Math.floor(Math.pow(Math.abs(v - 0.5) * 2, 1.6) * 90)
    }
    ctx.putImageData(im, 0, 0)
    return (grainCache = c.toDataURL())
  } catch {
    return (grainCache = '')
  }
}

/** Puts the grain tile on <html> as `--look-grain`, for the ground and for
 * the paper sheets (`.panel`) that carry it faintly. */
export function applyGrain(root: HTMLElement = document.documentElement): void {
  const g = grainDataUrl()
  if (g) root.style.setProperty('--look-grain', `url(${g})`)
}

export function NaveGround() {
  return (
    <div className="nf-ground" aria-hidden="true">
      <b className="nf-bigarch" />
      <i className="nf-shaft s1" />
      <i className="nf-shaft s2" />
      <i className="nf-shaft s3" />
    </div>
  )
}
