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
 *   - `will-change: transform` is promoted only on the hovered CHAIN (a card
 *     plus the plates it nests in — two, occasionally three) and demoted once
 *     each settles — never sprayed across the surface.
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
 * EDGE THROW IS THE TUNED QUANTITY (2026-08-09, superseding the per-tier
 * angle multipliers above). A rotation's felt strength is how far it throws
 * the edge it pivots about — `(extent / 2) * sin(angle)` — so a fixed angle
 * makes a card's motion grow with the card. Measured across real surfaces
 * that was a 7x spread: a short transcript card moved 3px under the pointer
 * while a tall explorable in the same column moved 21px, and a 1400px nav row
 * threw its ends 131px. Response that inconsistent does not read as
 * responsiveness; it reads as the large surfaces being unstable, and 20px of
 * travel under the cursor while you are reading is the effect obstructing the
 * work it decorates.
 *
 * So `POINTER_THROW_PX` and `IDLE_THROW_PX` hold throw roughly constant and
 * the angle is solved per axis from the element's measured size
 * (`scaleForThrow`). The class multipliers survive as CEILINGS: below the cap
 * a card keeps every degree it had, so small elements are untouched and only
 * large ones settle. Idle drift carries a much tighter budget than pointer
 * tilt, because a card that moves because you moved is feedback while a card
 * that moves on its own as you read is interference.
 *
 * Nesting (2026-08-09): tilt cards nest — rows inside plates — and hover
 * applies to the whole ANCESTOR CHAIN, not just the innermost card. Hovering
 * only the innermost made a plate shudder: with the pointer on a row the
 * plate read as unhovered and fell to idle drift, while the few-px gap
 * between two rows read as the plate and snapped it to pointer-tilt, so
 * scanning a list swung the plate's target between a half-minute sinusoid
 * and the cursor several times a second. The chain keeps a background card
 * continuously pointer-driven for as long as the pointer is anywhere inside
 * it, which removes the discontinuity and is also the more honest physical
 * model: a card underneath still feels the pointer through what sits on it.
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
 * `SOFT_SCALE`. Reads BIGGER than the base tier, not smaller: the smaller
 * the element, the more its tilt should read, not less — a short lever arm
 * needs a wider angle to displace its corner by the same felt amount a
 * large card gets from a shallow one. Pushed further per a second round of
 * feedback (2026-07-29): at 4x idle drift spans ~1.6–3.2deg and pointer-tilt
 * reaches ~10.8deg on a ~36px-tall button — unmistakably alive. Independent
 * per-element phase keeps the row from moving in lockstep even at this
 * amplitude. */
const RAIL_SCALE = 4
/** Edge-excursion targets, in CSS pixels — the quantity this file actually
 * tunes. Angle is only how it gets there.
 *
 * A rotation's felt strength is not its angle but how far it throws the edge
 * it pivots about: `(extent / 2) * sin(angle)`. A fixed angle therefore means
 * a card's motion grows with the card, and measured on real surfaces that was
 * a 7x spread — a short transcript card moved 3px under the pointer while a
 * tall explorable in the same column moved 21px. Response that inconsistent
 * does not read as responsiveness, it reads as the big cards being unstable,
 * and 21px of travel under the cursor while you are READING the thing is the
 * effect getting in the way of the work.
 *
 * Holding throw roughly constant instead means every surface answers the
 * pointer by about the same amount, whatever its size — small cards keep a
 * wide, lively angle because they need one to move at all, and large cards
 * settle. The tiers differ only in how much answer they owe:
 *
 *   rail  — small chrome. Most angle, because a short lever needs it.
 *   soft  — transcript cards. TIGHTEST throw of the three: this is the
 *           surface being read, and a paragraph that shifts under the eye is
 *           worse than one that sits still.
 *   full  — plates and dashboards. Chrome you look AT rather than read, so it
 *           may move a little further.
 */
const POINTER_THROW_PX: Record<'full' | 'soft' | 'rail', number> = {
  rail: 12,
  soft: 10,
  full: 14,
}

/** Idle drift gets its own, far tighter budget.
 *
 * Autonomous motion is a different thing from response, and it is judged more
 * harshly: a card that moves because you moved is feedback, a card that moves
 * on its own while you read is interference. Under the old fixed angle a
 * 900px card breathed ~6px with nobody touching it. Three pixels is present
 * at the edge of notice and absent everywhere else, which is what "the
 * surface breathes" was always supposed to mean. */
const IDLE_THROW_PX = 3

/** The angle that puts this extent's edge at `throwPx`, expressed as a
 * multiplier on `baseAngleDeg` and capped at the tier's own ceiling. Returns
 * the ceiling when the cap is out of reach, so small elements are unaffected
 * and keep every degree they had. */
function scaleForThrow(extentPx: number, maxScale: number, throwPx: number, baseAngleDeg: number): number {
  if (!(extentPx > 0)) return maxScale
  const half = extentPx / 2
  if (half <= throwPx) return maxScale
  const maxDeg = (Math.asin(Math.min(1, throwPx / half)) * 180) / Math.PI
  return Math.min(maxScale, maxDeg / baseAngleDeg)
}

const SMOOTH_TAU_MS = 150

/** How long after the last scroll event the surface stays still.
 *
 * The pointer-follow target is recomputed from the card's rect every frame, so
 * SCROLLING moved it even with the pointer completely stationary: the card
 * under the cursor rolled continuously for as long as you were scrolling, and
 * the thing you were scrolling in order to READ was the thing that would not
 * hold still. Tilt is meant to answer the pointer, and during a scroll the
 * pointer is not saying anything.
 *
 * So a scroll stills the surface — cards drain to idle drift and pick the
 * pointer back up once the view settles. Long enough to bridge the gaps
 * between wheel events inside one gesture, short enough that it reads as the
 * card waiting rather than the effect having died. */
const SCROLL_STILL_MS = 200
let lastScrollAt = 0
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
  /** Base tier multiplier from the element's class: `.tilt-card-rail` →
   * `RAIL_SCALE`, `.tilt-card-soft` → `SOFT_SCALE`, `.tilt-card` → 1.
   * Computed once at registration. */
  scale: number
  /** Which tier this card belongs to — selects its throw budget. */
  tier: 'full' | 'soft' | 'rail'
  /** Live per-axis multipliers, refreshed from whatever measurement the loop
   * already had to take. `X` governs rotateX and is derived from HEIGHT (the
   * extent that axis pivots about); `Y` governs rotateY and comes from WIDTH.
   * Pointer and idle are tuned SEPARATELY — a card that moves because you
   * moved is feedback, a card that moves on its own while you read is
   * interference, and they do not deserve the same budget. Applied at use
   * rather than baked into `ampX`/`ampY`, so a resize re-tunes a card instead
   * of stranding it at its mount-time size. */
  pointerX: number
  pointerY: number
  idleX: number
  idleY: number
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
      // The entry carries the rect, so idle drift gets correctly-scaled axes
      // without this file ever forcing its own layout read.
      measure(st, entry.boundingClientRect)
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
  const tier: 'full' | 'soft' | 'rail' = el.matches(RAIL_SELECTOR)
    ? 'rail'
    : el.matches(SOFT_SELECTOR)
      ? 'soft'
      : 'full'
  const scale = tier === 'rail' ? RAIL_SCALE : tier === 'soft' ? SOFT_SCALE : 1
  states.set(el, {
    visible: false,
    hovered: false,
    px: 0,
    py: 0,
    rx: 0,
    ry: 0,
    wrx: 0,
    wry: 0,
    // Unscaled — the per-axis multiplier is applied in `tick`, not baked in.
    ampX: rand(IDLE_AMP_MIN_DEG, IDLE_AMP_MAX_DEG),
    ampY: rand(IDLE_AMP_MIN_DEG, IDLE_AMP_MAX_DEG),
    omegaX: (2 * Math.PI) / rand(IDLE_PERIOD_MIN_S, IDLE_PERIOD_MAX_S),
    omegaY: (2 * Math.PI) / rand(IDLE_PERIOD_MIN_S, IDLE_PERIOD_MAX_S),
    phaseX: rand(0, 2 * Math.PI),
    phaseY: rand(0, 2 * Math.PI),
    promoted: false,
    scale,
    tier,
    // Until the first measurement lands, behave exactly as the flat tier did.
    pointerX: scale,
    pointerY: scale,
    idleX: scale,
    idleY: scale,
  })
  io.observe(el)
}

/** Refresh a card's per-axis multipliers from a rect we already have. Free —
 * every call site was already measuring for another reason. Applies to EVERY
 * tier now, not just rail: the transcript's own cards were the ones most in
 * need of it, being both the largest and the ones actually being read. */
function measure(st: TiltState, rect: { width: number; height: number }): void {
  const throwPx = POINTER_THROW_PX[st.tier]
  st.pointerX = scaleForThrow(rect.height, st.scale, throwPx, POINTER_MAX_DEG)
  st.pointerY = scaleForThrow(rect.width, st.scale, throwPx, POINTER_MAX_DEG)
  st.idleX = scaleForThrow(rect.height, st.scale, IDLE_THROW_PX, IDLE_AMP_MAX_DEG)
  st.idleY = scaleForThrow(rect.width, st.scale, IDLE_THROW_PX, IDLE_AMP_MAX_DEG)
}

/** Each live `attach` registers an evictor here, so `unregister` can drop a
 * card that is torn out of the DOM while hovered — otherwise it would sit in
 * that container's hover chain forever, and `onPointerOut`'s containment test
 * would consult a detached node. A SET, not one slot: `attach` supports more
 * than one container (each keeps its own `mine`), and a single slot would let
 * a second container silently clobber the first's evictor. */
const hoverEvictors = new Set<(el: HTMLElement) => void>()

function unregister(el: HTMLElement): void {
  if (!registered.delete(el)) return
  for (const evict of hoverEvictors) evict(el)
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
  // Treat everything as unhovered while the view is moving under the pointer.
  const settling = now - lastScrollAt < SCROLL_STILL_MS
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
    if (st.hovered && st.visible && !settling) {
      // One layout READ per hovered element — at most a card and the plates
      // it nests in, since hover applies to the whole chain — and nothing in
      // this loop writes anything layout-affecting (custom-property →
      // transform only), so this can never thrash. Each element resolves the
      // pointer against ITS OWN rect, so a plate tilts toward where the
      // cursor is within the plate while the row on top of it tilts toward
      // where the cursor is within the row. Pressing INTO the plate: cursor near the top
      // edge → +rotateX (top recedes); near the right edge → +rotateY
      // (right recedes).
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        measure(st, rect)
        const nx = clamp01((st.px - rect.left) / rect.width)
        const ny = clamp01((st.py - rect.top) / rect.height)
        // rotateX pivots about the horizontal axis, so its cap comes from
        // HEIGHT; rotateY from WIDTH. On a long thin row that damps the sweep
        // across the length hard and leaves the dip across the depth alone —
        // the asymmetry a single scalar could not express.
        tx = (0.5 - ny) * 2 * POINTER_MAX_DEG * st.pointerX
        ty = (nx - 0.5) * 2 * POINTER_MAX_DEG * st.pointerY
      }
      wantsDrive = true
    } else if (st.visible && idleBudget > 0) {
      idleBudget--
      tx = st.ampX * st.idleX * Math.sin(st.omegaX * tSec + st.phaseX)
      ty = st.ampY * st.idleY * Math.sin(st.omegaY * tSec + st.phaseY)
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

  /** Every registered tilt card under the pointer, innermost first. Cards
   * NEST — nav rows and topic rows are `.tilt-card-rail` inside a
   * `.tilt-card-soft` plate — and the whole chain is hovered at once, not
   * just the innermost.
   *
   * Hovering only the innermost is what made a plate sway. `closest()`
   * returns one element, so with the pointer on a row the plate counted as
   * unhovered and fell back to idle drift; the 4px gap between two rows
   * counted as the plate itself and snapped it to pointer-tilt. Scanning a
   * list therefore drove the plate's TARGET back and forth between a
   * half-minute sinusoid and the cursor several times a second — a
   * discontinuity the damped lerp faithfully reproduced as a shudder.
   *
   * With the chain hovered, the plate is pointer-driven continuously for as
   * long as the pointer is anywhere inside it, gaps included, and the row on
   * top adds its own tilt over that. A background card keeps feeling the
   * pointer through the cards stacked on it, which is also just truer to the
   * physical model these surfaces claim. */
  let hoverChain: HTMLElement[] = []
  const evict = (el: HTMLElement): void => {
    if (hoverChain.includes(el)) hoverChain = hoverChain.filter((x) => x !== el)
  }
  hoverEvictors.add(evict)

  function chainFor(target: Element | null): HTMLElement[] {
    const out: HTMLElement[] = []
    let node: Element | null = target
    while (node) {
      const card = (node.closest?.(TILT_SELECTOR) ?? null) as HTMLElement | null
      if (!card) break
      if (registered.has(card)) out.push(card)
      node = card.parentElement
    }
    return out
  }

  function endHover(el: HTMLElement): void {
    const st = states.get(el)
    if (!st) return
    st.hovered = false
    // Keep it driven so it glides back to idle drift / flat.
    driven.add(el)
    ensureLoop()
  }

  function setChain(next: HTMLElement[], clientX: number, clientY: number): void {
    // Release only what actually left — a card that stays in the chain must
    // never be un-hovered and re-hovered, or it would take the same target
    // discontinuity this whole mechanism exists to remove.
    for (const el of hoverChain) {
      if (!next.includes(el)) endHover(el)
    }
    for (const el of next) {
      const st = states.get(el)
      if (!st) continue
      st.hovered = true
      st.px = clientX
      st.py = clientY
      if (!st.promoted) {
        // Promotion follows the hovered chain — at most a card and the plates
        // it sits in (two, occasionally three), never sprayed wider. Each is
        // demoted on settle exactly as before.
        st.promoted = true
        el.style.willChange = 'transform'
      }
      driven.add(el)
    }
    hoverChain = next
    if (next.length > 0) ensureLoop()
  }

  function onPointerOver(e: PointerEvent): void {
    if (reduceMotion.matches) {
      if (hoverChain.length > 0) setChain([], e.clientX, e.clientY)
      return
    }
    const next = chainFor(e.target as Element | null)
    // Cheap identity check — the common case is moving within one card.
    if (next.length === hoverChain.length && next.every((el, i) => el === hoverChain[i])) return
    setChain(next, e.clientX, e.clientY)
  }

  function onPointerOut(e: PointerEvent): void {
    if (hoverChain.length === 0) return
    const to = e.relatedTarget as Element | null
    // Outermost card in the chain: while the pointer is still inside it, any
    // change is a chain edit that `pointerover` will make, not an exit.
    const outer = hoverChain[hoverChain.length - 1]
    if (to && outer.contains(to)) return
    setChain([], e.clientX, e.clientY)
  }

  function onPointerMove(e: PointerEvent): void {
    for (const el of hoverChain) {
      const st = states.get(el)
      if (st) {
        st.px = e.clientX
        st.py = e.clientY
      }
    }
  }

  // Capture: scroll does not bubble, and the surfaces that actually scroll
  // here are nested (the transcript region, the shelf, a drilldown), so a
  // listener on the container alone would never hear them.
  const onAnyScroll = (): void => {
    lastScrollAt = performance.now()
    // Keep the loop awake so hovered cards can drain to idle rather than
    // freezing mid-tilt until the next pointer event.
    for (const el of hoverChain) driven.add(el)
    ensureLoop()
  }
  container.addEventListener('scroll', onAnyScroll, { capture: true, passive: true })

  container.addEventListener('pointerover', onPointerOver, { passive: true })
  container.addEventListener('pointerout', onPointerOut, { passive: true })
  container.addEventListener('pointermove', onPointerMove, { passive: true })

  return () => {
    mo.disconnect()
    container.removeEventListener('scroll', onAnyScroll, { capture: true })
    container.removeEventListener('pointerover', onPointerOver)
    container.removeEventListener('pointerout', onPointerOut)
    container.removeEventListener('pointermove', onPointerMove)
    hoverEvictors.delete(evict)
    hoverChain = []
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
