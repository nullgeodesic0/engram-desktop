/** Resolve Night Atlas ink tokens from the live document for GL/Canvas paint.
 *
 * Ported from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/engine/tokens.ts) — same shape, same
 * mechanism (read `getComputedStyle`, fall back to a hardcoded palette when
 * unavailable, e.g. in tests). The two apps' dark-theme values are close
 * enough that this is closer to "confirm and extend" than "port": Engram's
 * own index.css already defines every one of these custom properties under
 * the identical name. Extended with `dangerDim`/`textFaint`, which Engram's
 * marks need (lapse stippling, faint decoration) and Cairn's did not. */

export interface PlateTokens {
  void: string
  hairline: string
  textPrimary: string
  textDim: string
  textFaint: string
  warm: string
  /** The palette's brightest — reserved for the selected/hot state. */
  hot: string
  warmDim: string
  cool: string
  coolDim: string
  violet: string
  danger: string
  dangerDim: string
  fontSerif: string
  fontData: string
}

const FALLBACK: PlateTokens = {
  void: '#0d0e12',
  hairline: '#262a36',
  textPrimary: '#e6dfd0',
  textDim: '#8b8878',
  textFaint: '#7b7768',
  warm: '#e8a857',
  hot: '#f0c24b',
  warmDim: '#8a6533',
  cool: '#5b8fa8',
  coolDim: '#3a5a6b',
  violet: '#a78bda',
  danger: '#c4685a',
  dangerDim: '#6b3d36',
  fontSerif: "'EpocaPro', 'Epoca Pro', 'Fraunces', Georgia, serif",
  fontData: "'Futura', 'Futura PT', ui-monospace, 'SF Mono', Menlo, monospace",
}

export function readPlateTokens(el: Element | null): PlateTokens {
  if (!el || typeof getComputedStyle === 'undefined') return { ...FALLBACK }
  const s = getComputedStyle(el)
  const v = (name: string, fb: string): string => {
    const raw = s.getPropertyValue(name).trim()
    return raw || fb
  }
  return {
    void: v('--color-void', FALLBACK.void),
    hairline: v('--color-hairline', FALLBACK.hairline),
    textPrimary: v('--color-text-primary', FALLBACK.textPrimary),
    textDim: v('--color-text-dim', FALLBACK.textDim),
    textFaint: v('--color-text-faint', FALLBACK.textFaint),
    warm: v('--color-ink-warm', FALLBACK.warm),
    hot: v('--color-ink-hot', FALLBACK.hot),
    warmDim: v('--color-ink-warm-dim', FALLBACK.warmDim),
    cool: v('--color-ink-cool', FALLBACK.cool),
    coolDim: v('--color-ink-cool-dim', FALLBACK.coolDim),
    violet: v('--color-ink-violet', FALLBACK.violet),
    danger: v('--color-ink-danger', FALLBACK.danger),
    dangerDim: v('--color-ink-danger-dim', FALLBACK.dangerDim),
    fontSerif: v('--font-serif', FALLBACK.fontSerif),
    fontData: v('--font-data', FALLBACK.fontData),
  }
}
