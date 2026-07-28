import { memo, useEffect, useState } from 'react'
import type { InstrumentMoment } from '../shared/instrumentMoments'

/** Clamped so an edge glyph (message 0, or the tail) never sits flush against
 * the rail's own rounded cap and gets visually clipped/crowded. */
function positionPercent(atIndex: number, totalMessages: number): number {
  const ratio = totalMessages > 0 ? atIndex / totalMessages : 0
  return Math.min(97, Math.max(3, ratio * 100))
}

/** Chat Instruments Wave B — a hairline vertical rail beside the transcript,
 * one glyph per notable moment (`shared/instrumentMoments.ts`'s own doctrine
 * comment has the full vocabulary rationale), positioned proportional to
 * MESSAGE INDEX rather than measured pixels. Pixel measurement would lie:
 * `.transcript-measure`'s `content-visibility: auto` (index.css) skips
 * layout for scrolled-past blocks, so an old message's real height is
 * whatever `contain-intrinsic-size` guesses until it's actually painted
 * again — index proportion has no such dependency on what's currently
 * rendered.
 *
 * Overlay, not layout: `absolute` inside the SAME `relative` wrapper
 * ChatScrollRegion already renders its scroll container in (see that
 * component's `railSlot` prop) — this never narrows `.transcript-measure`'s
 * own width. Quiet by default (low opacity), warms to full opacity on
 * pointer proximity via plain CSS `:hover`/`:focus-within` — no peek/tuck
 * timers like the masthead/probe cards use elsewhere in these views; the
 * task's own framing calls for "opacity, not layout," and a rail that never
 * moves anything has no layout state to debounce.
 *
 * Hidden entirely below 2 moments (`className="hidden"`? — no: unmounted, via
 * the early return) — no empty rail chrome for an ordinary short exchange. */
export const TranscriptMinimap = memo(function TranscriptMinimap({
  moments,
  totalMessages,
  containerEl,
  onJump,
}: {
  moments: InstrumentMoment[]
  totalMessages: number
  /** The ACTUAL scrollable element (ChatScrollRegion's own `overflow-y-auto`
   * div, exposed via its `onContainerRef` prop) — needed both to track the
   * current viewport band (scroll ratio) and, on click, to locate a
   * message's DOM node to scroll to. `null` before ChatScrollRegion has
   * mounted; the rail simply doesn't track a viewport band yet. */
  containerEl: HTMLDivElement | null
  onJump: (atIndex: number) => void
}) {
  const [viewport, setViewport] = useState<{ start: number; end: number }>({ start: 0, end: 1 })

  useEffect(() => {
    if (!containerEl) return
    function update() {
      const el = containerEl
      if (!el) return
      const denom = el.scrollHeight
      if (denom <= 0) {
        setViewport({ start: 0, end: 1 })
        return
      }
      const start = el.scrollTop / denom
      const end = (el.scrollTop + el.clientHeight) / denom
      setViewport({ start: Math.max(0, start), end: Math.min(1, end) })
    }
    update()
    containerEl.addEventListener('scroll', update, { passive: true })
    // Content height changes as messages stream in/out (or the window
    // resizes) without necessarily firing a scroll event of their own.
    const ro = new ResizeObserver(update)
    ro.observe(containerEl)
    return () => {
      containerEl.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [containerEl])

  if (moments.length < 2) return null

  return (
    <div className="group/rail absolute right-0.5 top-1 bottom-1 w-3 z-[5] opacity-40 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-[var(--dur-fast)]">
      {/* The rail's own hairline spine. */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-[var(--color-hairline)]" aria-hidden="true" />
      {/* Current viewport — a soft band, never a hard box. */}
      <div
        className="absolute left-0 right-0 rounded-sm bg-[var(--color-surface-3)] opacity-70 pointer-events-none"
        style={{ top: `${viewport.start * 100}%`, height: `${Math.max(1.5, (viewport.end - viewport.start) * 100)}%` }}
        aria-hidden="true"
      />
      {moments.map((m) => (
        <button
          key={m.id}
          type="button"
          title={m.tooltip}
          aria-label={m.tooltip}
          onClick={() => onJump(m.atIndex)}
          className="focus-ring absolute left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center h-3.5 w-3.5 leading-none text-[9px] rounded-full hover:scale-125 transition-transform duration-[var(--dur-fast)]"
          style={{ top: `${positionPercent(m.atIndex, totalMessages)}%`, color: m.tone }}
        >
          <span aria-hidden="true">{m.glyph}</span>
        </button>
      ))}
    </div>
  )
})
