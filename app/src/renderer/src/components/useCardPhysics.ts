import { useCallback, useRef } from 'react'

/**
 * Card physics — cards sit EMBEDDED in shallow 3D space, not printed on it.
 * Two motions, both nearly subliminal:
 *
 *   1. Idle drift — every visible `.tilt-card` wanders in and out of the page
 *      plane on a slow sinusoid (≤ ~0.8deg, half-minute-scale periods), each card
 *      carrying its own randomized period + phase so the surface breathes
 *      rather than marches in lockstep.
 *   2. Pointer tilt — while the cursor is over a card, the tilt follows the
 *      pointer as if pressing INTO a floating plate: the corner nearest the
 *      cursor dips away toward the page (≤ 2.7deg at the edges), critically-
 *      damped so it glides, never snaps, and eases back to idle drift on
 *      leave.
 *
 * Architecture (modeled on useEquationCopy's delegated callback-ref pattern):
 * ONE container (App's root) attaches via the callback ref below; the module-
 * level manager discovers targets by class, runs ONE rAF loop and ONE set of
 * delegated pointer listeners per container, and keeps per-element state in a
 * WeakMap. No per-card React state, no per-card listeners, no re-renders.
 *
 * The manager never writes `transform` itself — it writes only the registered
 * non-inheriting custom properties `--tilt-rx`/`--tilt-ry` (see index.css's
 * `@property` declarations), and a single components-layer rule owns the
 * actual transform. That way the tilt can never clobber (or be clobbered by)
 * any other transform source: the base-layer press scale composes via a
 * dedicated `button.tilt-card:active` rule, and CSS animations (the grade-
 * card flip, entrance washes) win over the static rule for exactly as long as
 * they run, then hand back seamlessly.
 *
 * Performance discipline:
 *   - IntersectionObserver gates everything: offscreen cards (including the
 *     transcript's hundreds of `content-visibility: auto` blocks) are parked
 *     at exactly 0 and cost nothing — not a WeakMap read, not a style write.
 *   - The concurrently idle-drifting set is capped (MAX_IDLE_DRIVEN); cards
 *     past the cap stay planted but remain fully pointer-responsive.
 *   - The rAF loop halts outright when nothing is driven, when the document
 *     is hidden, and when the window blurs.
 *   - `will-change: transform` is promoted ONLY on the actively hovered card
 *     and demoted once it settles — never sprayed across the surface.
 *   - Style writes are skipped below a delta epsilon, and a settled card has
 *     its inline properties REMOVED (falling back to the `@property` initial
 *     of 0deg) so a resting card carries no inline style at all.
 *
 * Reduced motion: `prefers-reduced-motion: reduce` makes this a no-op (live —
 * flipping the OS setting mid-session drains everything to flat), and
 * index.css independently forces `transform: none` on `.tilt-card`/
 * `.tilt-card-soft` under the same media query as a belt-and-braces
 * guarantee.
 *
 * Soft variant (`.tilt-card-soft`): every chat-transcript card (the ritual
 * family — beat/grade/probe/ask/canonical/milestone/… — plus the coach's own
 * cards) rides the SAME idle-drift and pointer-tilt behavior as `.tilt-card`,
 * just quieter — the chat surface asked to read as calmer than the rest of
 * the app. This is a per-element AMPLITUDE MULTIPLIER (`SOFT_SCALE` below),
 * computed once at registration from which class the element carries, never
 * a second set of tuning constants: `.tilt-card-soft` scales the exact same
 * `IDLE_AMP_MIN/MAX_DEG`/`POINTER_MAX_DEG` this file already tunes, so a
 * change to those numbers moves both variants together, in proportion.
 *
 * Rail variant (`.tilt-card-rail`): the sidebar nav buttons — small (~36px
 * tall), packed edge-to-edge (2px gaps), and read as a scanned list rather
 * than isolated cards. `.tilt-card-soft`'s amplitude (`SOFT_SCALE`, currently
 * 1× — see that constant's own note) is tuned for spaced, card-scale chat
 * bubbles; at nav-item density several independently-phased idle drifts
 * sitting a couple pixels apart read as a busy, uncoordinated wobble rather
 * than the single-card "breathing" the effect is meant to read as. Same
 * multiplier mechanism as `SOFT_SCALE`, one tier quieter (`RAIL_SCALE`
 * below) — not a parallel tuning, still scales the same base numbers.
 *
 * Contract: the `.tilt-card`/`.tilt-card-soft`/`.tilt-card-rail` class must
 * be present from the element's mount (every current host bakes it into a
 * static className template) — discovery watches childList mutations, not
 * class-attribute churn. A card is exactly one of the three, never more than
 * one — index.css's transform rule matches all three classes identically;
 * only this file's amplitude differs.
 */
const TILT_SELECTOR = '.tilt-card, .tilt-card-soft, .tilt-card-rail'
const SOFT_SELECTOR = '.tilt-card-soft'
const RAIL_SELECTOR = '.tilt-card-rail'

/* Tuning — tiny by decree. The effect should be felt, not watched. */
const IDLE_AMP_MIN_DEG = 0.4
const IDLE_AMP_MAX_DEG = 0.8
const POINTER_MAX_DEG = 2.7
const IDLE_PERIOD_MIN_S = 22
const IDLE_PERIOD_MAX_S = 55
/** `.tilt-card-soft`'s per-element multiplier — applied to both idle
 * amplitude and pointer-tilt target, never a parallel constant set (see the
 * doctrine comment above). Chosen so the chat surface's drift is felt as
 * distinctly quieter without reading as "broken"/imperceptible. */
const SOFT_SCALE = 1 // one scale by user decision (2026-07-28): the chat-bubble
// values became the app-wide values, so soft === full today. The class split
// (.tilt-card vs .tilt-card-soft) is kept so the surfaces can re-diverge later.
/** `.tilt-card-rail`'s per-element multiplier — same mechanism as
 * `SOFT_SCALE`, tuned quieter for the nav rail's small, tightly-packed
 * buttons (see the doctrine comment above). At this scale idle drift tops
 * out well under a third of a degree and pointer-tilt under 1.1deg, which
 * keeps a hovered nav item's corner displacement to a fraction of a pixel at
 * its ~36px height/~192px expanded width — felt as a faint liveliness, not a
 * wobble neighbors visibly fight for the same 2px gap. */
const RAIL_SCALE = 0.75
/** Critically-damped-feel exponential smoothing time constant. */
const SMOOTH_TAU_MS = 150
/** Idle-drift concurrency cap — hover responsiveness is never capped. Bumped
 * 18 → 24 for the coach-panel sweep: a tall Dashboard/Topic-drilldown scroll
 * position can now have noticeably more `.tilt-card` surfaces simultaneously
 * visible (stat grids, chart-host panels, the topic list) than Wave 1's
 * coverage ever put on screen at once. Still bounded and still cheap — an
 * over-cap card simply stays flat until hovered (never drops pointer
 * response) — so this is a "still feels right at the new density" nudge, not
 * a re-tuning; revisit if a future sweep pushes the on-screen count much
 * higher again. */
const MAX_IDLE_DRIVEN = 24
/** Below this delta, skip the style write (the change is invisible). */
const WRITE_EPSILON_DEG = 0.0015
/** Within this of target, a returning card counts as settled. */
const SETTLE_EPSILON_DEG = 0.01

interface TiltState {
  visible: boolean
  hovered: boolean
  /** Latest pointer position (client coords); meaningful only while hovered. */
  px: number
  py: number
  /** Currently applied angles, degrees. */
  rx: number
  ry: number
  /** Last WRITTEN angles — dedupes redundant style writes. */
  wrx: number
  wry: number
  /** Per-card idle-drift character, randomized once at registration. */
  ampX: number
  ampY: number
  omegaX: number
  omegaY: number
  phaseX: number
  phaseY: number
  /** True while this card holds a `will-change: transform` promotion. */
  promoted: boolean
  /** `.tilt-card-rail` → `RAIL_SCALE`, `.tilt-card-soft` → `SOFT_SCALE`,
   * `.tilt-card` → 1. Computed once at registration from the element's own
   * class and applied to both idle amplitude (baked into `ampX`/`ampY`
   * below) and the pointer-tilt target (applied live in `tick`) — one
   * multiplier per class, not a second constant set. */
  scale: number
}

const states = new WeakMap<HTMLElement, TiltState>()
/** Every live tilt card (registered via container discovery). */
const registered = new Set<HTMLElement>()
/** The on-screen subset, maintained by the IntersectionObserver. */
const visibleSet = new Set<HTMLElement>()
/** Cards the rAF loop is actively writing to this frame. */
const driven = new Set<HTMLElement>()

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

let rafId: number | null = null
let lastNow = 0

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function ensureLoop(): void {
  if (rafId !== null || driven.size === 0) return
  if (reduceMotion.matches || document.hidden || !document.hasFocus()) return
  lastNow = 0
  rafId = requestAnimationFrame(tick)
}

function stopLoop(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

/** Zero a card's inline tilt (falls back to `@property` initial 0deg). */
function clearTilt(el: HTMLElement, st: TiltState): void {
  st.rx = 0
  st.ry = 0
  if (st.wrx !== 0 || st.wry !== 0) {
    st.wrx = 0
    st.wry = 0
    el.style.removeProperty('--tilt-rx')
    el.style.removeProperty('--tilt-ry')
  }
  if (st.promoted) {
    st.promoted = false
    el.style.willChange = ''
  }
}

/** Offscreen (or disabled) cards are parked flat — they must cost zero. */
function park(el: HTMLElement, st: TiltState): void {
  st.hovered = false
  clearTilt(el, st)
  driven.delete(el)
}

const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const el = entry.target as HTMLElement
      const st = states.get(el)
      if (!st) continue
      st.visible = entry.isIntersecting
      if (entry.isIntersecting) visibleSet.add(el)
      else {
        visibleSet.delete(el)
        park(el, st)
      }
    }
    // Visibility changed → idle slots may have opened up. Re-offer every
    // visible card to the loop; its own settle logic prunes the over-cap
    // ones right back out (they converge to 0 and drop from `driven`).
    if (!reduceMotion.matches) {
      for (const el of visibleSet) driven.add(el)
      ensureLoop()
    }
  },
  // A little pre-warm margin so a card is already mid-drift as it scrolls in.
  { rootMargin: '64px' },
)

function register(el: HTMLElement): void {
  if (registered.has(el)) return
  registered.add(el)
  const scale = el.matches(RAIL_SELECTOR) ? RAIL_SCALE : el.matches(SOFT_SELECTOR) ? SOFT_SCALE : 1
  states.set(el, {
    visible: false,
    hovered: false,
    px: 0,
    py: 0,
    rx: 0,
    ry: 0,
    wrx: 0,
    wry: 0,
    ampX: rand(IDLE_AMP_MIN_DEG, IDLE_AMP_MAX_DEG) * scale,
    ampY: rand(IDLE_AMP_MIN_DEG, IDLE_AMP_MAX_DEG) * scale,
    omegaX: (2 * Math.PI) / rand(IDLE_PERIOD_MIN_S, IDLE_PERIOD_MAX_S),
    omegaY: (2 * Math.PI) / rand(IDLE_PERIOD_MIN_S, IDLE_PERIOD_MAX_S),
    phaseX: rand(0, 2 * Math.PI),
    phaseY: rand(0, 2 * Math.PI),
    promoted: false,
    scale,
  })
  io.observe(el)
}

function unregister(el: HTMLElement): void {
  if (!registered.delete(el)) return
  io.unobserve(el)
  visibleSet.delete(el)
  driven.delete(el)
  const st = states.get(el)
  if (st) clearTilt(el, st) // harmless on detached nodes
  states.delete(el)
}

function tick(now: number): void {
  rafId = null
  const dtMs = lastNow === 0 ? 16 : Math.min(now - lastNow, 100)
  lastNow = now
  const k = 1 - Math.exp(-dtMs / SMOOTH_TAU_MS)
  const tSec = now / 1000
  let idleBudget = MAX_IDLE_DRIVEN

  for (const el of driven) {
    const st = states.get(el)
    if (!st) {
      driven.delete(el)
      continue
    }
    let tx = 0
    let ty = 0
    let wantsDrive = false
    if (st.hovered && st.visible) {
      // One layout READ for one element, and nothing in this loop writes
      // anything layout-affecting (custom-property → transform only), so
      // this can never thrash. Pressing INTO the plate: cursor near the top
      // edge → +rotateX (top recedes); near the right edge → +rotateY
      // (right recedes).
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        const nx = clamp01((st.px - rect.left) / rect.width)
        const ny = clamp01((st.py - rect.top) / rect.height)
        tx = (0.5 - ny) * 2 * POINTER_MAX_DEG * st.scale
        ty = (nx - 0.5) * 2 * POINTER_MAX_DEG * st.scale
      }
      wantsDrive = true
    } else if (st.visible && idleBudget > 0) {
      idleBudget--
      tx = st.ampX * Math.sin(st.omegaX * tSec + st.phaseX)
      ty = st.ampY * Math.sin(st.omegaY * tSec + st.phaseY)
      wantsDrive = true
    }

    st.rx += (tx - st.rx) * k
    st.ry += (ty - st.ry) * k
    const settled =
      Math.abs(st.rx - tx) < SETTLE_EPSILON_DEG && Math.abs(st.ry - ty) < SETTLE_EPSILON_DEG

    if (!st.hovered && st.promoted && settled) {
      st.promoted = false
      el.style.willChange = ''
    }
    if (!wantsDrive && settled) {
      // Over the idle cap (or freshly unhovered off-screen-cap): rest flat
      // with zero inline style, and stop paying for it per-frame.
      clearTilt(el, st)
      driven.delete(el)
      continue
    }
    if (Math.abs(st.rx - st.wrx) > WRITE_EPSILON_DEG) {
      st.wrx = st.rx
      el.style.setProperty('--tilt-rx', `${st.rx.toFixed(4)}deg`)
    }
    if (Math.abs(st.ry - st.wry) > WRITE_EPSILON_DEG) {
      st.wry = st.ry
      el.style.setProperty('--tilt-ry', `${st.ry.toFixed(4)}deg`)
    }
  }

  if (driven.size > 0 && !document.hidden) rafId = requestAnimationFrame(tick)
}

/** Live reduced-motion toggle: drain to flat instantly (CSS also forces
 * `transform: none` under the same query, so this is cleanup, not the guard). */
reduceMotion.addEventListener('change', () => {
  if (reduceMotion.matches) {
    stopLoop()
    for (const el of registered) {
      const st = states.get(el)
      if (st) park(el, st)
    }
  } else {
    for (const el of visibleSet) driven.add(el)
    ensureLoop()
  }
})

/* Halt entirely while the window is blurred/hidden; resume where the phase
 * clock (performance.now-based) says the drift should now be — the damped
 * lerp glides each card there, so resume never jumps. */
window.addEventListener('blur', stopLoop)
window.addEventListener('focus', ensureLoop)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop()
  else ensureLoop()
})

function attach(container: HTMLElement): () => void {
  /** Cards discovered under THIS container, so detach can unwind exactly. */
  const mine = new Set<HTMLElement>()

  function claim(el: HTMLElement): void {
    mine.add(el)
    register(el)
  }

  container.querySelectorAll<HTMLElement>(TILT_SELECTOR).forEach(claim)

  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const el = node as HTMLElement
        if (el.matches(TILT_SELECTOR)) claim(el)
        el.querySelectorAll<HTMLElement>(TILT_SELECTOR).forEach(claim)
      }
      for (const node of rec.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        const el = node as HTMLElement
        if (mine.has(el)) {
          mine.delete(el)
          unregister(el)
        }
        // querySelectorAll works fine on a detached subtree.
        el.querySelectorAll<HTMLElement>(TILT_SELECTOR).forEach((child) => {
          if (mine.has(child)) {
            mine.delete(child)
            unregister(child)
          }
        })
      }
    }
  })
  mo.observe(container, { childList: true, subtree: true })

  let hoverEl: HTMLElement | null = null

  function endHover(el: HTMLElement): void {
    const st = states.get(el)
    if (!st) return
    st.hovered = false
    // Keep it driven so it glides back to idle drift / flat.
    driven.add(el)
    ensureLoop()
  }

  function onPointerOver(e: PointerEvent): void {
    const target = e.target as Element | null
    const card = (target?.closest?.(TILT_SELECTOR) ?? null) as HTMLElement | null
    if (card === hoverEl) return
    if (hoverEl) endHover(hoverEl)
    hoverEl = null
    if (!card || !registered.has(card) || reduceMotion.matches) return
    const st = states.get(card)
    if (!st) return
    hoverEl = card
    st.hovered = true
    st.px = e.clientX
    st.py = e.clientY
    if (!st.promoted) {
      // The ONE card allowed a compositor promotion — demoted on settle.
      st.promoted = true
      card.style.willChange = 'transform'
    }
    driven.add(card)
    ensureLoop()
  }

  function onPointerOut(e: PointerEvent): void {
    if (!hoverEl) return
    const to = e.relatedTarget as Element | null
    if (to && hoverEl.contains(to)) return
    endHover(hoverEl)
    hoverEl = null
  }

  function onPointerMove(e: PointerEvent): void {
    if (!hoverEl) return
    const st = states.get(hoverEl)
    if (!st) return
    st.px = e.clientX
    st.py = e.clientY
  }

  container.addEventListener('pointerover', onPointerOver, { passive: true })
  container.addEventListener('pointerout', onPointerOut, { passive: true })
  container.addEventListener('pointermove', onPointerMove, { passive: true })

  return () => {
    mo.disconnect()
    container.removeEventListener('pointerover', onPointerOver)
    container.removeEventListener('pointerout', onPointerOut)
    container.removeEventListener('pointermove', onPointerMove)
    hoverEl = null
    for (const el of mine) unregister(el)
    mine.clear()
  }
}

/**
 * Returns a CALLBACK ref (same rationale as useEquationCopy: it fires on
 * every mount AND unmount of whatever node it lands on, so late-mounting or
 * remounting containers re-wire for free). Attach it to ONE ancestor that
 * contains every tilt surface — App's root — and every present and future
 * `.tilt-card` in its subtree joins the physics with zero per-card wiring.
 */
export function useCardPhysics(): (node: HTMLElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback((node: HTMLElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!node) return
    cleanupRef.current = attach(node)
  }, [])
}
