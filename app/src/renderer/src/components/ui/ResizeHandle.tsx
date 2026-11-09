import { useRef } from 'react'
import type { Pane } from '../../shared/paneLayout'

/**
 * A drag handle between two panes. `edge` says which side of the pane it sits
 * on: "end" for a pane on the left (drag right to grow), "start" for one on
 * the right (drag left to grow), "bottom" for a pane above. Arrow keys move
 * it by 16 px, Enter collapses or restores, double-click resets the size.
 */
export function ResizeHandle({ pane, edge, label }: { pane: Pane; edge: 'start' | 'end' | 'bottom'; label: string }) {
  const drag = useRef<{ from: number; size: number } | null>(null)
  const vertical = edge === 'bottom'
  const sign = edge === 'start' ? -1 : 1
  const size = pane.collapsed ? 0 : pane.size
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuemin={pane.min}
      aria-valuemax={pane.max}
      aria-valuenow={size}
      tabIndex={0}
      title={`${label}: drag to resize, double-click to reset, Enter to ${pane.collapsed ? 'show' : 'hide'}`}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { from: vertical ? e.clientY : e.clientX, size: pane.collapsed ? pane.min : pane.size }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        pane.setSize(d.size + sign * ((vertical ? e.clientY : e.clientX) - d.from))
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => pane.reset()}
      onKeyDown={(e) => {
        const grow = vertical ? 'ArrowDown' : edge === 'start' ? 'ArrowLeft' : 'ArrowRight'
        const shrink = vertical ? 'ArrowUp' : edge === 'start' ? 'ArrowRight' : 'ArrowLeft'
        if (e.key === grow || e.key === shrink) {
          e.preventDefault()
          pane.setSize(pane.size + (e.key === grow ? 16 : -16))
        } else if (e.key === 'Enter') {
          e.preventDefault()
          pane.toggle()
        }
      }}
      className={`focus-ring shrink-0 relative z-10 bg-transparent hover:bg-[var(--color-ink-warm)]/40 active:bg-[var(--color-ink-warm)]/60 transition-colors ${
        vertical ? 'h-1.5 w-full cursor-row-resize -my-0.5' : 'w-1.5 h-full cursor-col-resize -mx-0.5'
      }`}
    />
  )
}
