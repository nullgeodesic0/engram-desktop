import { useEffect, useRef, useState, type ReactNode } from 'react'

/** The scrollable message region shared by Learn and Review. Auto-sticks to the
 * bottom as new content streams in — but only while you're already at the
 * bottom; if you've scrolled up to reread something, new content no longer
 * yanks you back down, and a "Jump to latest" pill appears instead. */
export function ChatScrollRegion({
  children,
  deps,
  railSlot,
  onContainerRef,
}: {
  children: ReactNode
  deps: unknown[]
  /** Chat Instruments Wave B — the transcript minimap, rendered as a sibling
   * of the scrollable div INSIDE this component's own `relative` wrapper, so
   * it can sit `absolute` at the scroll region's right edge without stealing
   * width from `.transcript-measure`, and without this component needing to
   * know anything about what a minimap is. Undefined renders nothing extra —
   * byte-identical to before this wave. */
  railSlot?: ReactNode
  /** Reports the scrollable div itself (not just a ref object) — the minimap
   * needs the real DOM node to read scroll position and to `scrollIntoView`
   * on a jump; `null` on unmount, same callback-ref convention
   * `useEquationCopy` already established elsewhere in this codebase, chosen
   * for the same reason: this pane's own root can unmount/remount across a
   * session's lifecycle (see that hook's doctrine comment), so a callback
   * fired on every mount/unmount is what stays correct across a remount,
   * where a plain `useEffect(() => ..., [])` handed a `RefObject` would not. */
  onContainerRef?: (el: HTMLDivElement | null) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)

  useEffect(() => {
    onContainerRef?.(containerRef.current)
    return () => onContainerRef?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onScroll() {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setStick(distanceFromBottom < 80)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el || !stick) return
    el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  function jumpToBottom() {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setStick(true)
  }

  return (
    // `.corner-brackets` — one of the Guardian restyle's three placements
    // (the other two: TopicMapView's node drawer, DashboardView's main
    // pane). Applied here, at the shared component's own root, rather than
    // duplicated in every session view that hosts a transcript (Learn,
    // Review) — both get it for free. The minimap rail (`railSlot`, a
    // sibling below) hugs this same box's right edge, so its top/bottom ends
    // sit near this element's own corner marks; both are thin, low-opacity
    // hairline elements, and in practice they don't visually compete.
    <div className="relative flex-1 min-h-0 corner-brackets">
      {/* `scroll-fade-top`: content dissolves into the top edge instead of
          being guillotined by it, so the transcript reads as continuing past
          the viewport rather than being clipped at an arbitrary line — and
          the strip the masthead/probe cards tuck into stops looking like a
          hard boundary. See index.css. */}
      {/* `pb-7` matches the mask's 28px bottom ramp: scrolled to the end, the
          last line sits ABOVE the fade with only padding inside it, so the
          newest message is never dimmed — the fade only ever eats empty space
          or content still scrolling past. */}
      <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto flex flex-col gap-4 pb-7 scroll-fade-top">
        {children}
      </div>
      {railSlot}
      {!stick && (
        <button
          onClick={jumpToBottom}
          className="focus-ring absolute bottom-3 left-1/2 -translate-x-1/2 panel px-3 py-1.5 text-xs text-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] shadow-lg"
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}
