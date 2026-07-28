import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstrumentMoment } from '../shared/instrumentMoments'

/** Index-proportional placement — used ONLY as the fallback before a
 * checkpoint's real position has ever been measured (first paint, or a
 * moment whose `CheckpointAnchor` hasn't rendered yet), so the rail never
 * flashes empty or jumps from nothing to something. Once `measured` has an
 * entry for a moment, `glyphTopPercent` below takes over. Clamped so an edge
 * glyph (message 0, or the tail) never sits flush against the rail's own
 * rounded cap and gets visually clipped/crowded. */
function positionPercent(atIndex: number, totalMessages: number): number {
  const ratio = totalMessages > 0 ? atIndex / totalMessages : 0
  return clampPct(ratio * 100)
}

function clampPct(pct: number): number {
  return Math.min(97, Math.max(3, pct))
}

/** THE shared band-math function. A scroll fraction (0..1) expressed as a
 * percent of the rail — used for BOTH the viewport band's own top edge (fed
 * the container's LIVE `scrollTop`) and a glyph's position (fed the
 * `scrollTop` that clicking that glyph would actually produce). Same
 * function, two different scrollTops — that's what makes "band lands on
 * glyph" true by construction rather than by coincidence of two formulas
 * that happen to agree today. */
function bandTopPercent(scrollTop: number, scrollHeight: number): number {
  return scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0
}

/** The scrollTop a `jumpToCheckpoint`-style `scrollIntoView({block:'start'})`
 * actually lands on for an anchor at `offsetTop` with `scrollMarginTop` of
 * chrome clearance — clamped to what the container can actually scroll to.
 * This clamp is *also* what makes a bottom-of-transcript checkpoint's glyph
 * land at the band's true maximum reachable top instead of an unreachable
 * 100%: the same clamp scrollIntoView itself is subject to. */
function landingScrollTop(offsetTop: number, scrollMarginTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
  return Math.min(maxScrollTop, Math.max(0, offsetTop - scrollMarginTop))
}

type Measurement = {
  /** checkpoint id -> { its offsetTop relative to the scroll content, and
   * its own computed `scroll-margin-top` — read fresh per anchor rather
   * than hardcoded, so it stays correct if index.css's `.scroll-anchor-top`
   * value ever changes. } */
  offsets: Map<string, { top: number; marginTop: number }>
  /** `scrollHeight`/`clientHeight` at the moment of measurement — a glyph's
   * position is only meaningful relative to the geometry it was measured
   * against (see the component doctrine comment below on `content-
   * visibility` estimates), so these travel WITH the offsets map rather
   * than being re-read live at render time. */
  scrollHeight: number
  clientHeight: number
}

const MIN_GLYPH_SEPARATION_PX = 6

/** Chat Instruments Wave B (rail-as-ruler revision) — a hairline vertical
 * rail beside the transcript, one glyph per notable moment
 * (`shared/instrumentMoments.ts`'s own doctrine comment has the full
 * vocabulary rationale).
 *
 * THE RAIL IS A SCROLL RULER, NOT AN INDEX RULER. Earlier doctrine here
 * argued glyphs should sit at `atIndex / totalMessages` because pixel
 * measurement "would lie" under `content-visibility: auto` — true as far as
 * it went, but it dodged the actual complaint: message heights vary wildly
 * (a one-line reply next to a diagnostic plate next to a multi-result grade
 * stack), so an index-proportional glyph and the viewport band it's
 * supposed to predict routinely disagreed by a screenful. A rail whose
 * glyphs don't match where their own checkpoints land isn't a ruler, it's
 * decoration.
 *
 * THE INVARIANT NOW: after `onJump` for a glyph settles, the viewport band's
 * TOP edge sits on that glyph. Both are computed by the SAME function,
 * `bandTopPercent` above — the band from the container's live `scrollTop`,
 * a glyph from the `scrollTop` a click on it would actually produce
 * (`landingScrollTop`, mirroring `jumpToCheckpoint`'s own
 * `scrollIntoView({block:'start'})` + `scroll-margin-top` math exactly).
 * They can't drift apart because they're not two formulas that happen to
 * agree — they're one formula fed two different scrollTops.
 *
 * Measurement mechanics: each moment's `CheckpointAnchor` DOM node
 * (`[data-checkpoint-id]`) is measured lazily — `offsetTop` relative to the
 * scroll content via `getBoundingClientRect()` diffed against the
 * container's own rect plus its `scrollTop` (robust to whatever the
 * `offsetParent` chain happens to be) — and CACHED in `measurement` state,
 * recomputed on: (a) the container's ResizeObserver, throttled to one
 * pending recompute per animation frame so a burst of streaming-in content
 * doesn't thrash it; (b) `totalMessages` changing; (c) a jump settling (see
 * `onJump`'s wrapper below) — heights just materialized for real once
 * `content-visibility` stops estimating them.
 *
 * `content-visibility` virtualization means a distant checkpoint's measured
 * offset can be computed from an ESTIMATED (`contain-intrinsic-size: auto
 * 120px`) height for blocks between it and the viewport. That's fine, not a
 * bug: the viewport-band math a real jump to that checkpoint would use is
 * computed against the EXACT SAME estimates at click time (browsers don't
 * force-measure skipped blocks to service `scrollIntoView` either) — so the
 * glyph and the landing it predicts stay consistent with EACH OTHER even
 * though both may be off from where the transcript "really" is until it
 * paints. The post-settle recompute (trigger (c) above) trues both up once
 * real heights exist.
 *
 * Before first measurement (or for a moment whose anchor hasn't rendered),
 * `positionPercent`'s old index-proportional formula is the fallback — the
 * rail never flashes empty while waiting for real numbers.
 *
 * Overlay, not layout: `absolute` inside the SAME `relative` wrapper
 * ChatScrollRegion already renders its scroll container in (see that
 * component's `railSlot` prop) — this never narrows `.transcript-measure`'s
 * own width. Quiet by default (low opacity), warms to full opacity on
 * pointer proximity via plain CSS `:hover`/`:focus-within`.
 *
 * Hidden entirely below 2 moments — no empty rail chrome for an ordinary
 * short exchange. */
export const TranscriptMinimap = memo(function TranscriptMinimap({
  moments,
  totalMessages,
  containerEl,
  onJump,
}: {
  moments: InstrumentMoment[]
  totalMessages: number
  /** The ACTUAL scrollable element (ChatScrollRegion's own `overflow-y-auto`
   * div, exposed via its `onContainerRef` prop) — needed to track the
   * current viewport band (scroll ratio), to measure each checkpoint's real
   * offset, and (via `onJump`) to locate a checkpoint's DOM node to scroll
   * to. `null` before ChatScrollRegion has mounted; the rail simply doesn't
   * track a viewport band or measure anything yet. */
  containerEl: HTMLDivElement | null
  /** May return a promise (the live views' `jumpToCheckpointMoment` wrappers
   * now forward `jumpToCheckpoint`'s own returned promise) — awaited before
   * re-measuring, so the post-jump recompute happens once the scroll has
   * actually settled and real heights exist, not mid-flight. A plain `void`
   * return (nothing to await) still works exactly as before. */
  onJump: (moment: InstrumentMoment) => void | Promise<void>
}) {
  const [viewport, setViewport] = useState<{ scrollTop: number; scrollHeight: number; clientHeight: number }>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  })
  const [measurement, setMeasurement] = useState<Measurement | null>(null)
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerEl) return
    function update() {
      const el = containerEl
      if (!el) return
      setViewport({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })
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

  const recomputeMeasurement = useCallback(() => {
    const el = containerEl
    if (!el) return
    const offsets = new Map<string, { top: number; marginTop: number }>()
    const containerRect = el.getBoundingClientRect()
    el.querySelectorAll<HTMLElement>('[data-checkpoint-id]').forEach((anchor) => {
      const id = anchor.dataset.checkpointId
      if (!id) return
      const rect = anchor.getBoundingClientRect()
      const marginTop = parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0
      offsets.set(id, { top: rect.top - containerRect.top + el.scrollTop, marginTop })
    })
    setMeasurement({ offsets, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight })
  }, [containerEl])

  // Trigger (a): content resize, throttled to one pending recompute per frame.
  useEffect(() => {
    if (!containerEl) return
    let scheduled = false
    function schedule() {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        recomputeMeasurement()
      })
    }
    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(containerEl)
    return () => ro.disconnect()
  }, [containerEl, recomputeMeasurement])

  // Trigger (b): message-count changes.
  useEffect(() => {
    recomputeMeasurement()
  }, [totalMessages, recomputeMeasurement])

  // Trigger (c): after a jump settles, wrapped below in `handleJump`.
  async function handleJump(moment: InstrumentMoment) {
    await onJump(moment)
    recomputeMeasurement()
  }

  const glyphPositions = useMemo(() => {
    const raw = moments.map((m) => {
      if (!measurement) return positionPercent(m.atIndex, totalMessages)
      const entry = measurement.offsets.get(m.id)
      if (!entry) return positionPercent(m.atIndex, totalMessages)
      const target = landingScrollTop(entry.top, entry.marginTop, measurement.scrollHeight, measurement.clientHeight)
      return clampPct(bandTopPercent(target, measurement.scrollHeight))
    })
    // Collision nudge: two glyphs measured to (nearly) the same pixel get
    // pushed apart by a minimum separation, preserving order — they were
    // already deduped visually by index spacing under the old scheme, but
    // measured spacing can legitimately stack them (e.g. a probe card and
    // its immediately-following grade card).
    const railHeightPx = railRef.current?.clientHeight
    if (!railHeightPx) return raw
    const minSepPct = (MIN_GLYPH_SEPARATION_PX / railHeightPx) * 100
    const nudged = [...raw]
    for (let i = 1; i < nudged.length; i++) {
      if (nudged[i] - nudged[i - 1] < minSepPct) {
        nudged[i] = nudged[i - 1] + minSepPct
      }
    }
    return nudged
  }, [moments, measurement, totalMessages])

  if (moments.length < 2) return null

  const bandStart = bandTopPercent(viewport.scrollTop, viewport.scrollHeight)
  const bandEnd = bandTopPercent(viewport.scrollTop + viewport.clientHeight, viewport.scrollHeight)

  return (
    <div
      ref={railRef}
      className="group/rail absolute right-0.5 top-1 bottom-1 w-3 z-[5] opacity-40 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-[var(--dur-fast)]"
    >
      {/* The rail's own hairline spine. */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-[var(--color-hairline)]" aria-hidden="true" />
      {/* Current viewport — a soft band, never a hard box. Same
          `bandTopPercent` function a glyph's own position comes from (see
          the component doctrine comment), just fed the LIVE scrollTop
          instead of a landing-target one. */}
      <div
        className="absolute left-0 right-0 rounded-sm bg-[var(--color-surface-3)] opacity-70 pointer-events-none"
        style={{ top: `${bandStart}%`, height: `${Math.max(1.5, bandEnd - bandStart)}%` }}
        aria-hidden="true"
      />
      {moments.map((m, i) => (
        <button
          key={m.id}
          type="button"
          title={m.tooltip}
          aria-label={m.tooltip}
          onClick={() => void handleJump(m)}
          className="focus-ring absolute left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center h-3.5 w-3.5 leading-none text-[9px] rounded-full hover:scale-125 transition-transform duration-[var(--dur-fast)]"
          style={{ top: `${glyphPositions[i]}%`, color: m.tone }}
        >
          <span aria-hidden="true">{m.glyph}</span>
        </button>
      ))}
    </div>
  )
})
