import { useCallback, useState } from 'react'

/** A scrubbing cursor over `count` evenly-spaced slots, generalized from the
 * crosshair PlotCard already runs over its own series (ritual/PlotCard.tsx —
 * pointer x → viewBox units → nearest index, arrows scrub the same index,
 * focus opens at the middle, blur closes).
 *
 * Home's two charts were the ones opting out: both had a per-element
 * `onMouseEnter` tooltip, so the tick you pointed at never changed, there was
 * no guide line tying the readout to a position, and neither was reachable
 * from the keyboard at all. This is that same instrument, minus the series
 * math — the caller owns what a slot means and what to draw at it.
 *
 * Geometry lives here, not in the caller: `onPointerMove` measures the
 * element the handler is attached to, so the same hook serves an SVG of 180
 * rects and a flex row of 7 divs without either knowing about the other.
 *
 * `inset` is the axis gutter as a FRACTION of the box, because both consumers
 * draw into a `viewBox` that scales to its container: a 16-unit gutter in a
 * 600-unit viewBox is 2.67% of the rendered width at every size, so the
 * fraction is the width-independent quantity and a pixel figure would be
 * right at one window size only. (A chart that gutters with CSS padding
 * instead — a fixed `pl-5` — would need the opposite, and should convert:
 * `padPx / measuredWidth`.)
 */
/** Pointer x → slot index, with `inset` as a fraction of the box (see above).
 * Pure, and separated from the handler so the
 * geometry is testable without a DOM (this project's vitest runs in `node`;
 * same arithmetic-without-I/O split shared/sittingPace.ts makes). Returns
 * null when the box has no usable plot width. Out-of-range x clamps to an
 * end slot rather than reading null — a pointer 2px past the last bar is
 * still pointing at the last bar. */
export function slotAt(
  clientX: number,
  box: { left: number; width: number },
  count: number,
  inset: { left?: number; right?: number } = {},
): number | null {
  if (count <= 0) return null
  const left = inset.left ?? 0
  const right = inset.right ?? 0
  const plotW = box.width * (1 - left - right)
  if (plotW <= 0) return null
  const frac = (clientX - box.left - box.width * left) / plotW
  return Math.max(0, Math.min(count - 1, Math.floor(frac * count)))
}

export function useChartCursor(count: number, inset: { left?: number; right?: number } = {}) {
  const [cursor, setCursor] = useState<number | null>(null)
  const left = inset.left ?? 0
  const right = inset.right ?? 0

  const onPointerMove = useCallback(
    (e: React.PointerEvent<Element>) => {
      const slot = slotAt(e.clientX, e.currentTarget.getBoundingClientRect(), count, { left, right })
      if (slot !== null) setCursor(slot)
    },
    [count, left, right],
  )

  const onPointerLeave = useCallback(() => setCursor(null), [])
  const onFocus = useCallback(() => setCursor((c) => c ?? Math.max(0, count - 1)), [count])
  const onBlur = useCallback(() => setCursor(null), [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<Element>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      setCursor((c) => {
        const base = c ?? Math.max(0, count - 1)
        return Math.max(0, Math.min(count - 1, base + (e.key === 'ArrowRight' ? 1 : -1)))
      })
    },
    [count],
  )

  /** Spread onto the plot element. `tabIndex` is part of the bargain — the
   * readout is not a mouse-only affordance. */
  const cursorProps = {
    tabIndex: 0,
    onPointerMove,
    onPointerLeave,
    onFocus,
    onBlur,
    onKeyDown,
  }

  return { cursor, cursorProps }
}
