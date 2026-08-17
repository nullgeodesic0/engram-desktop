/** CSS colour strings into GL floats.
 *
 * The plate's palette lives in CSS custom properties and reaches the
 * painter as whatever `getComputedStyle` resolved them to. That is usually
 * `#rrggbb`, but the token sheet also uses `color-mix()`, which resolves to
 * `rgb(…)` or `oklab(…)` depending on the browser — so a hex regex would
 * silently return black for a token that renders perfectly in the DOM.
 * Anything unrecognised falls back to mid-grey rather than transparent,
 * because a mark drawn in the wrong colour is a bug you can see and a mark
 * drawn at alpha 0 is a bug you cannot.
 *
 * Ported verbatim from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/engine/gl/color.ts). */

export type RGB = readonly [number, number, number]

const FALLBACK: RGB = [0.5, 0.5, 0.5]
const cache = new Map<string, RGB>()

export function parseColor(css: string): RGB {
  const hit = cache.get(css)
  if (hit) return hit
  const parsed = parse(css.trim())
  cache.set(css, parsed)
  return parsed
}

function parse(css: string): RGB {
  if (css.startsWith('#')) {
    const hex = css.slice(1)
    if (hex.length === 3) {
      return [h(hex[0] + hex[0]), h(hex[1] + hex[1]), h(hex[2] + hex[2])]
    }
    if (hex.length === 6 || hex.length === 8) {
      return [h(hex.slice(0, 2)), h(hex.slice(2, 4)), h(hex.slice(4, 6))]
    }
    return FALLBACK
  }

  const open = css.indexOf('(')
  if (open > 0 && css.endsWith(')')) {
    const fn = css.slice(0, open).trim().toLowerCase()
    const args = css
      .slice(open + 1, -1)
      .split(/[\s,/]+/)
      .filter(Boolean)
    if (fn === 'rgb' || fn === 'rgba') {
      const [r, g, b] = args
      return [channel(r), channel(g), channel(b)]
    }
    if (fn === 'oklab') return oklabToRgb(Number(args[0]), Number(args[1]), Number(args[2]))
    if (fn === 'oklch') {
      const hue = (Number(args[2]) * Math.PI) / 180
      const chroma = Number(args[1])
      return oklabToRgb(Number(args[0]), Math.cos(hue) * chroma, Math.sin(hue) * chroma)
    }
  }
  return FALLBACK
}

function h(pair: string): number {
  const v = Number.parseInt(pair, 16)
  return Number.isFinite(v) ? v / 255 : 0.5
}

/** `rgb()` channels may be 0–255 or a percentage. */
function channel(raw: string | undefined): number {
  if (raw === undefined) return 0.5
  const v = Number.parseFloat(raw)
  if (!Number.isFinite(v)) return 0.5
  return raw.includes('%') ? clamp01(v / 100) : clamp01(v / 255)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Oklab → linear sRGB → sRGB. Only reached when a token resolves through
 * `color-mix()`, which the derived tokens in index.css do. */
function oklabToRgb(L: number, a: number, b: number): RGB {
  if (!Number.isFinite(L) || !Number.isFinite(a) || !Number.isFinite(b)) return FALLBACK
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    clamp01(gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp01(gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp01(gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ]
}

function gamma(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055
}
