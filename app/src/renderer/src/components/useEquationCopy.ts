import { useCallback, useRef } from 'react'

/** Marks a wired container's own root as "a copy handler really is listening
 * here" — index.css scopes the `.katex` hover wash/ring/glyph affordance
 * under this exact class (`.katex-copy-scope .katex:hover`), so the cursor
 * and hover cues can never lie: they only ever appear where a click would
 * actually copy something. KaTeX output rendered OUTSIDE any wired container
 * (the Topic Map, the misconception ledger — never chat) keeps its plain,
 * un-hoverable look. */
const SCOPE_CLASS = 'katex-copy-scope'

const WHISPER_VISIBLE_MS = 900
const WHISPER_FADE_MS = 180

/** Pulls the original TeX straight back out of KaTeX's own rendered DOM —
 * `katex.renderToString`'s default `output` (both markdownWithMath.ts and
 * MathRenderer.tsx call it with only `{ throwOnError, displayMode }`, never
 * overriding `output`) always embeds the source in a MathML
 * `<annotation encoding="application/x-tex">` node, confirmed directly
 * against this app's own KaTeX output — so there's no need for any parallel
 * "which TeX rendered into which DOM node" bookkeeping. `.textContent`
 * decodes the annotation's own HTML-entity escaping for free (KaTeX escapes
 * `<`/`>`/`&` going in, since it's XML text content). */
function texFromKatex(el: HTMLElement): string | null {
  const annotation = el.querySelector('annotation[encoding="application/x-tex"]')
  const tex = annotation?.textContent
  return tex && tex.length > 0 ? tex : null
}

/** An equation rendered INSIDE one of these keeps that control's own primary
 * click behavior instead of copying — an AskCard/AskDialog option button or
 * an ActionChips chip can carry LaTeX in its own label (`MathRenderer
 * text={opt.label} inlineOnly`), and clicking it means "choose this
 * option"/"take this action", never "copy this equation". Equation-copy only
 * activates for equations in passive/display prose — the overwhelming
 * majority of equations in chat. */
const INTERACTIVE_ANCESTOR_SELECTOR = 'button, a, input, select, textarea, [role="button"], [contenteditable="true"]'

/** A transient "Copied" whisper near the cursor — the floating counterpart to
 * CopyButton's inline checkmark-flip (there's no single button here to flip;
 * equations copy from anywhere in their own rendered span). Built with plain
 * DOM rather than a React portal — this hook has no JSX tree of its own to
 * mount into, and the whisper's lifecycle (append, fade in, hold, fade out,
 * remove) is simpler as a fire-and-forget imperative sequence than a piece of
 * React state some component would have to own. */
function showCopiedWhisper(x: number, y: number): void {
  const el = document.createElement('div')
  el.textContent = 'Copied'
  el.setAttribute('aria-hidden', 'true')
  el.className =
    'fixed z-[60] pointer-events-none label-data text-[10px] text-[var(--color-ink-warm)] bg-[var(--color-surface-2)] border border-[var(--color-hairline)] rounded px-2 py-1 shadow-lg transition-opacity ease-out'
  el.style.left = `${x + 12}px`
  el.style.top = `${y - 10}px`
  el.style.transitionDuration = `${WHISPER_FADE_MS}ms`
  el.style.opacity = '0'
  document.body.appendChild(el)
  // Next frame, so the initial opacity:0 actually paints before the
  // transition to 1 starts (setting both in the same tick would collapse
  // into one paint with no visible fade-in).
  requestAnimationFrame(() => {
    el.style.opacity = '1'
  })
  window.setTimeout(() => {
    el.style.opacity = '0'
    window.setTimeout(() => el.remove(), WHISPER_FADE_MS)
  }, WHISPER_VISIBLE_MS)
}

function attach(node: HTMLElement): () => void {
  node.classList.add(SCOPE_CLASS)

  function onClick(e: MouseEvent): void {
    // A click that lands right after a text-selection drag must never
    // copy — the learner was selecting prose that happens to run through
    // an equation, not clicking the equation itself. A genuine click
    // clears any prior selection before it fires (standard browser
    // behavior), so this is reliable, not just a heuristic.
    if (window.getSelection()?.toString()) return

    const target = e.target as HTMLElement | null
    const katexEl = target?.closest<HTMLElement>('.katex') ?? null
    if (!katexEl || !node.contains(katexEl)) return
    if (katexEl.closest(INTERACTIVE_ANCESTOR_SELECTOR)) return

    const tex = texFromKatex(katexEl)
    if (!tex) return

    e.stopPropagation()
    const displayMode = Boolean(katexEl.closest('.katex-display'))
    const wrapped = displayMode ? `$$${tex}$$` : `$${tex}$`
    void navigator.clipboard.writeText(wrapped)
    showCopiedWhisper(e.clientX, e.clientY)
  }

  node.addEventListener('click', onClick)
  return () => {
    node.removeEventListener('click', onClick)
    node.classList.remove(SCOPE_CLASS)
  }
}

/**
 * ONE delegated click handler per wired container, covering every KaTeX
 * equation anywhere in its subtree — MathRenderer's `dangerouslySetInnerHTML`
 * output, ProseMarkdown's (via renderMarkdownWithMath), and every card built
 * on either (CanonicalPlate, MisconceptionPin, beat cards, ask cards, probe
 * cards, verdict rows, the receipt strip, action chips, the session-ceremony
 * commitment line, …) — with zero per-component wiring. Click copies the TeX
 * wrapped in the delimiters it actually rendered from: `$…$` for inline,
 * `$$…$$` for display (a `.katex-display` ancestor — see
 * markdownWithMath.ts/MathRenderer.tsx, both of which pass KaTeX's own
 * `displayMode` flag straight through, so this reads back the exact mode
 * that was rendered, never the source's own delimiter family). The source
 * may originally have used `\(…\)`/`\[…\]` — the app always hands back the
 * canonical `$`/`$$` form regardless, matching what a learner would paste
 * into a fresh message and have render correctly again.
 *
 * Returns a CALLBACK ref, not a `RefObject` — deliberately. A `RefObject` +
 * `useEffect(() => {...}, [ref])` only ever runs once, at whatever moment
 * `ref.current` happened to hold when the effect fired; several of this
 * hook's real call sites mount their container LATER than that (Modal's
 * `if (!open) return null` unmounts SessionHistoryDrawer's whole transcript
 * pane every time the drawer closes; LearnSessionView/ReviewSessionView's
 * own session pane is behind a `started`/`phase` conditional that mounts and
 * unmounts across "back to topics" / re-open) — a `RefObject` effect would
 * either never see a node at all, or keep listening on one that's since been
 * removed from the DOM. A callback ref fires exactly on every mount AND
 * unmount of whatever node it's attached to, so re-wiring on every remount
 * falls out for free.
 *
 * Safe to use at more than one mount point even when one container nests
 * inside another (e.g. MarkdownPreview's own wiring sits inside
 * LearnSessionView's outer session-pane wiring) — the innermost container
 * whose subtree contains the click handles it and calls `stopPropagation`,
 * so an outer container's own listener never double-fires for the same
 * click (no duplicate clipboard write, no doubled "Copied" whisper).
 */
export function useEquationCopy(): (node: HTMLElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback((node: HTMLElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!node) return
    cleanupRef.current = attach(node)
  }, [])
}
