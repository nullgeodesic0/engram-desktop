import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { MathRenderer } from '../MathRenderer'
import { MarkFrame } from './MarkFrame'
import type { PlotSeries, PlotMarker } from '../../../../shared/bridgeUiIntents'

/** An inline sketch — the shape of a function, drawn.
 *
 * "Sketch E(r) inside and outside the sphere" is not a decorative request; in
 * a physics or finance curriculum it is frequently the whole point of the
 * node, and the answer a learner gets wrong is usually a SHAPE (linear where
 * it should be quadratic, discontinuous where it must be continuous) rather
 * than an algebra slip. Until now the tutor could only describe that shape in
 * prose, which is exactly the modality the learner already failed to convert.
 *
 * The tutor supplies sampled points; this card does the fit, the axes, and
 * the drawing. It never evaluates a function, never extrapolates, and never
 * interpolates through a gap it wasn't given — what is plotted is precisely
 * what was sent, so the card cannot assert more than the tutor did.
 *
 * The line draws itself in on arrival (stroke-dashoffset, the same idiom
 * RetentionCurve uses), which is worth more here than anywhere else in the
 * app: watching a curve get traced left-to-right is watching the function be
 * swept through its domain. Skipped entirely under reduced motion — the path
 * renders fully drawn, no dasharray touched. */

const W = 520
const H = 190
const PAD_L = 40
const PAD_R = 14
const PAD_T = 12
const PAD_B = 30

/** Warm first: a single-series plot is the common case and warm is the
 * transcript's "the loop teaching" ink. Cool and violet follow for contrast
 * curves, in the same meanings MarkFrame's taxonomy assigns them. */
const SERIES_INK = ['var(--color-ink-warm)', 'var(--color-ink-cool)', 'var(--color-ink-violet)']

interface Fit {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Pad a range by 6% so a curve never rides the frame, and give a degenerate
 * range (a flat line, a single x) an arbitrary but finite width — otherwise
 * every point maps to the same pixel and the plot silently collapses. */
function padRange(lo: number, hi: number): [number, number] {
  if (!(hi > lo)) {
    const mid = (hi + lo) / 2
    const span = Math.abs(mid) > 0 ? Math.abs(mid) * 0.5 : 1
    return [mid - span, mid + span]
  }
  const pad = (hi - lo) * 0.06
  return [lo - pad, hi + pad]
}

export const PlotCard = memo(function PlotCard({
  title,
  xLabel,
  yLabel,
  series,
  markers,
}: {
  title: string | null
  xLabel: string | null
  yLabel: string | null
  series: PlotSeries[]
  markers: PlotMarker[]
}) {
  const fit: Fit = useMemo(() => {
    const xs: number[] = []
    const ys: number[] = []
    for (const s of series) {
      for (const [x, y] of s.points) {
        xs.push(x)
        ys.push(y)
      }
    }
    // Markers extend the x-range: a guide at r = a that fell outside the
    // plotted domain would be clipped off the frame, which reads as the app
    // dropping it rather than as the tutor having put it there.
    for (const m of markers) xs.push(m.x)
    const [x0, x1] = padRange(Math.min(...xs), Math.max(...xs))
    // The y-range includes zero whenever the data straddles or approaches it,
    // so a field that decays toward zero is drawn decaying toward the axis
    // rather than toward an arbitrary floor.
    const yLo = Math.min(...ys, 0)
    const [y0, y1] = padRange(yLo, Math.max(...ys))
    return { x0, x1, y0, y1 }
  }, [series, markers])

  const sx = (x: number) => PAD_L + ((x - fit.x0) / (fit.x1 - fit.x0)) * (W - PAD_L - PAD_R)
  const sy = (y: number) => H - PAD_B - ((y - fit.y0) / (fit.y1 - fit.y0)) * (H - PAD_T - PAD_B)

  const pathRefs = useRef<(SVGPathElement | null)[]>([])
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const paths = pathRefs.current.filter((el): el is SVGPathElement => el !== null)
    paths.forEach((el) => {
      const len = el.getTotalLength()
      el.style.transition = 'none'
      el.style.strokeDasharray = `${len}`
      el.style.strokeDashoffset = `${len}`
    })
    const raf = requestAnimationFrame(() => {
      paths.forEach((el, i) => {
        // Curves trace in sequence, not together — on a contrast plot the
        // second curve landing a beat later is what makes the two readable as
        // two, rather than as one tangle appearing at once.
        el.style.transition = `stroke-dashoffset calc(var(--dur-base) * 4) var(--ease-out-soft) ${i * 180}ms`
        el.style.strokeDashoffset = '0'
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [series])

  const zeroY = fit.y0 < 0 && fit.y1 > 0 ? sy(0) : null

  return (
    <MarkFrame
      accent="cool"
      label="SKETCH"
      glyph={
        <>
          <path d="M2 12 V2 M2 12 H12.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M3.5 10 C6 10 6.5 4.5 9 4.5 S11.5 7 12.5 3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        </>
      }
    >
      {title && (
        <MathRenderer text={title} inlineOnly className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]" />
      )}

      {yLabel && (
        <MathRenderer text={yLabel} inlineOnly className="fig-caption text-[var(--color-ink-cool)]" />
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={title ?? 'sketch'}>
        {/* Frame: two hairlines, not a box — the transcript's own grammar. */}
        <path
          d={`M${PAD_L} ${PAD_T} V${H - PAD_B} H${W - PAD_R}`}
          stroke="var(--color-hairline)"
          strokeWidth="1"
          fill="none"
        />
        {zeroY !== null && (
          <path d={`M${PAD_L} ${zeroY} H${W - PAD_R}`} stroke="var(--color-hairline)" strokeWidth="1" strokeDasharray="2 4" fill="none" />
        )}

        {markers.map((m, i) => (
          <g key={`m${i}`}>
            <path
              d={`M${sx(m.x)} ${PAD_T} V${H - PAD_B}`}
              stroke="var(--color-ink-warm-dim)"
              strokeWidth="1"
              strokeDasharray="3 3"
              fill="none"
            />
            {m.label && (
              <text
                x={sx(m.x) + 4}
                y={PAD_T + 9}
                className="label-data"
                fontSize="9"
                letterSpacing="0.08em"
                fill="var(--color-ink-warm)"
              >
                {m.label}
              </text>
            )}
          </g>
        ))}

        {series.map((s, i) => (
          <path
            key={`s${i}`}
            ref={(el) => {
              pathRefs.current[i] = el
            }}
            d={s.points.map(([x, y], j) => `${j === 0 ? 'M' : 'L'}${sx(x).toFixed(2)} ${sy(y).toFixed(2)}`).join(' ')}
            stroke={SERIES_INK[i % SERIES_INK.length]}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dashed ? '5 4' : undefined}
            fill="none"
          />
        ))}
      </svg>

      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        {/* Legend suppressed for a lone unlabeled-by-context curve? No — the
            tutor always names its series, and on a single-curve plot that name
            IS the y-axis quantity, which is worth stating. */}
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          {series.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 min-w-0">
              <span
                aria-hidden="true"
                className="inline-block w-3.5 h-px shrink-0"
                style={{
                  background: s.dashed
                    ? `repeating-linear-gradient(to right, ${SERIES_INK[i % SERIES_INK.length]} 0 3px, transparent 3px 5px)`
                    : SERIES_INK[i % SERIES_INK.length],
                }}
              />
              <MathRenderer text={s.label} inlineOnly className="fig-caption" />
            </span>
          ))}
        </div>
        {xLabel && <MathRenderer text={xLabel} inlineOnly className="fig-caption text-[var(--color-ink-cool)] shrink-0" />}
      </div>
    </MarkFrame>
  )
})
