import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Shared chart hover-popover shell, extracted from the identical portal
 * markup previously duplicated in RetentionTrend and StreakCalendar.
 * Portaled straight to `document.body` — an ancestor `.panel`'s
 * backdrop-filter creates a new containing block for `position: fixed`
 * descendants, which clips/mispositions this against the panel's own box
 * instead of the real viewport. Escaping the DOM ancestor chain entirely is
 * the fix, not a z-index bump. Anchored at (x, y) = the hovered element's
 * center-top, per `useChartHover`. */
export function ChartTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return createPortal(
    <div
      className="fixed z-50 panel-raised px-3 py-2 text-xs pointer-events-none -translate-x-1/2 -translate-y-full -mt-2"
      style={{ left: x, top: y }}
    >
      {children}
    </div>,
    document.body,
  )
}
