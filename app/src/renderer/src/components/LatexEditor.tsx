import { useCallback, useEffect, useRef } from 'react'
import { scanLatex, pairAtCaret } from '../shared/latexSyntax'
import { onInsert, onBackspace, onCompletion } from '../shared/latexEditing'
import { nextStop, prevStop, matchingDelimiter, expandSelection } from '../shared/latexNavigation'
import { createHistory, record, undo as undoHistory, redo as redoHistory, current as currentSnapshot, type EditHistory, type EditKind } from '../shared/editHistory'
import {
  readText,
  getCaretOffset,
  setCaretOffset,
  paint,
  applyBeforeInput,
  type PaintSpan,
} from '../shared/editableSurface'

/** A plain-text editor with depth-coloured LaTeX delimiters.
 *
 * One element. The coloured spans ARE the editable content — there is no
 * hidden mirror to keep aligned, which is what the previous implementation
 * spent four fixes failing to do (see editableSurface.ts for the full
 * autopsy).
 *
 * React never renders the children. The DOM under this div is painted
 * imperatively from our own text model, and every edit is intercepted at
 * `beforeinput` so the browser's default action never runs. That is what
 * makes the caret predictable: we always know the text and the offsets
 * because we computed both, rather than reading back whatever DOM Chromium
 * decided to build.
 *
 * Verified before shipping, in a browser harness driving these exact modules
 * against the app's compiled stylesheet: text round-trips byte for byte
 * across newlines, caret offsets round-trip at every position, repainting is
 * idempotent, and typing/Enter/backspace/selection-replace all land the caret
 * where they should. */

const DEPTH_INK = [
  'var(--color-ink-warm)',
  'var(--color-ink-cool)',
  'var(--color-ink-violet)',
  'var(--color-ink-lavender)',
]

function spansFor(text: string, caret: number | null): PaintSpan[] {
  const { tokens } = scanLatex(text)
  const pair = caret === null ? null : pairAtCaret(tokens, caret)
  const focused = pair ? new Set([pair.a, pair.b]) : new Set<number>()
  return tokens.map((t, i) => ({
    start: t.start,
    end: t.end,
    style: {
      color: t.partner === null ? 'var(--color-ink-danger)' : DEPTH_INK[t.depth % DEPTH_INK.length],
      background: focused.has(i) ? 'color-mix(in srgb, currentColor 24%, transparent)' : '',
      boxShadow: focused.has(i) ? 'inset 0 0 0 1px currentColor' : '',
      borderRadius: focused.has(i) ? '2px' : '',
    } as Partial<CSSStyleDeclaration>,
  }))
}

export function LatexEditor({
  value,
  onChange,
  onSubmit,
  placeholder,
  ariaLabel,
  minRows = 4,
  className = '',
}: {
  value: string
  onChange: (next: string) => void
  onSubmit?: () => void
  placeholder?: string
  ariaLabel?: string
  minRows?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  /** The text we last painted. Guards the sync effect below: without it,
   * every keystroke's `onChange` would come back as a prop and repaint on top
   * of a caret we just placed. */
  const painted = useRef<string>('')
  /** Undo history. Ours, because intercepting `beforeinput` means Chromium's
   * native stack never records anything — ⌘Z did nothing at all before this.
   * A ref, not state: history is not something the view renders. */
  const history = useRef<EditHistory>(createHistory({ text: value, caret: value.length }))

  /** Repaint, restoring the FULL selection — both ends, not just the caret.
   *
   * `paint` calls `replaceChildren`, which destroys the selection outright.
   * Restoring a single offset therefore COLLAPSED every selection: finishing a
   * mouse drag repainted and dropped you back to a caret, so text could not be
   * selected in the composer at all. `end` defaults to `start`, which is the
   * right behaviour after an edit (an insertion does collapse the selection)
   * but was wrong for every pure selection change. */
  const repaint = useCallback((text: string, start: number | null, end?: number) => {
    const el = ref.current
    if (!el) return
    paint(el, text, spansFor(text, start), start === null)
    if (start !== null) setCaretOffset(el, start, end ?? start)
    painted.current = text
  }, [])

  /** Commit a (text, caret) pair: paint it, place the caret, tell the parent. */
  const commit = useCallback(
    (text: string, caret: number, kind: EditKind = 'other') => {
      record(history.current, { text, caret }, kind, Date.now())
      repaint(text, caret)
      onChange(text)
    },
    [onChange, repaint],
  )

  /** Apply a history step. Deliberately does NOT go through `commit`, which
   * would record the step as a new edit and make undo unreachable. */
  const applyStep = useCallback(
    (snap: { text: string; caret: number }) => {
      repaint(snap.text, snap.caret)
      onChange(snap.text)
    },
    [onChange, repaint],
  )

  // External changes only — a prefill, the unicode conversion, a cleared
  // composer after send. Skipped when the value is what we just painted.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (value === painted.current) return
    const focused = el.ownerDocument.activeElement === el
    const caret = focused ? Math.min(getCaretOffset(el) ?? value.length, value.length) : value.length
    // A prefill or the unicode conversion arrives from outside; it should be
    // undoable, and it must never coalesce with typing around it.
    if (currentSnapshot(history.current).text !== value) {
      record(history.current, { text: value, caret }, 'other', Date.now())
    }
    repaint(value, focused ? caret : null)
  }, [value, repaint])

  /** Native `beforeinput`, attached by hand.
   *
   * NOT React's `onBeforeInput`, which is a legacy synthetic polyfill rather
   * than a binding to the real event — it never fired for these input types.
   * Caught in the harness before shipping: every edit silently did nothing,
   * exactly as it would have in the app.
   *
   * `capture` so we claim the edit before anything else can, and a manual
   * `preventDefault` since a passive listener could not stop the browser's
   * own action, which is the entire mechanism here. */
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handler = (e: InputEvent) => {
          const sel = currentSelection()
          if (!sel) return
          const { inputType, data } = e

          // A single typed character goes through the LaTeX aids first — they
          // own pairing, `$` growth, type-over and the `^{}` rule.
          if (inputType === 'insertText' && data && data.length === 1) {
            const state = { text: sel.text, selStart: sel.a, selEnd: sel.b }
            const aided = onInsert(state, data)
            if (aided) {
              e.preventDefault()
              // A structural aid (pairing, `$` growth) is its own undo step,
              // never merged into surrounding typing.
              commit(aided.text, aided.selStart, 'other')
              return
            }
            const plain = applyBeforeInput(sel.text, sel.a, sel.b, inputType, data)
            if (!plain) return
            e.preventDefault()
            // Completions read the text as it will be after this key.
            const done = onCompletion({ text: plain.text, selStart: plain.caret, selEnd: plain.caret }, data)
            if (done) commit(done.text, done.selStart, 'other')
            else commit(plain.text, plain.caret, 'insert')
            return
          }

          if (inputType === 'deleteContentBackward') {
            const aided = onBackspace({ text: sel.text, selStart: sel.a, selEnd: sel.b })
            if (aided) {
              e.preventDefault()
              commit(aided.text, aided.selStart, 'other')
              return
            }
          }

          const applied = applyBeforeInput(sel.text, sel.a, sel.b, inputType, data)
          if (!applied) return
          e.preventDefault()
          commit(applied.text, applied.caret, inputType.startsWith('delete') ? 'delete' : 'insert')
    }
    el.addEventListener('beforeinput', handler as EventListener)
    return () => el.removeEventListener('beforeinput', handler as EventListener)
  })

  function currentSelection(): { text: string; a: number; b: number } | null {
    const el = ref.current
    if (!el) return null
    const text = readText(el)
    const s = getCaretOffset(el, 'start')
    const e = getCaretOffset(el, 'end')
    if (s === null || e === null) return null
    return { text, a: Math.min(s, e), b: Math.max(s, e) }
  }

  return (
    <div
      ref={ref}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel ?? placeholder}
      data-placeholder={placeholder}
      spellCheck={false}
      className={`latex-editor ${value.length === 0 ? 'is-empty' : ''} ${className}`}
      style={{ minHeight: `${minRows * 1.5}em` }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          onSubmit?.()
          return
        }
        if (e.key === 'Escape') {
          ;(e.currentTarget as HTMLElement).blur()
          return
        }
        if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
          const wantsRedo = e.key === 'y' || e.shiftKey
          const snap = wantsRedo ? redoHistory(history.current) : undoHistory(history.current)
          // Always preventDefault, even at the ends of the history: letting
          // ⌘Z through would hand it to Chromium's own (empty) stack, which
          // can clear the element outright.
          e.preventDefault()
          if (snap) applyStep(snap)
          return
        }
        const sel = currentSelection()
        if (!sel) return

        if (e.key === 'Tab') {
          const to = e.shiftKey ? prevStop(sel.text, sel.a) : nextStop(sel.text, sel.a)
          // null outside maths, so Tab still moves focus in prose.
          if (to === null) return
          e.preventDefault()
          setCaretOffset(e.currentTarget as HTMLElement, to)
          repaint(sel.text, to)
          return
        }
        if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
          const to = matchingDelimiter(sel.text, sel.a)
          if (to === null) return
          e.preventDefault()
          setCaretOffset(e.currentTarget as HTMLElement, to)
          repaint(sel.text, to)
          return
        }
        if (e.altKey && e.key === 'ArrowUp') {
          const r = expandSelection(sel.text, sel.a, sel.b)
          if (!r) return
          e.preventDefault()
          setCaretOffset(e.currentTarget as HTMLElement, r.selStart, r.selEnd)
          return
        }
      }}
      // Repaint on selection movement so the matched-pair emphasis follows the
      // caret. Cheap: the scan is linear and the content is composer-sized.
      onKeyUp={(e) => {
        if (!e.key.startsWith('Arrow') && e.key !== 'Home' && e.key !== 'End') return
        const el = ref.current
        if (!el) return
        // Both ends: ⇧← extends a selection, and collapsing it here would
        // make keyboard selection impossible in exactly the way the mouse
        // path was broken.
        repaint(readText(el), getCaretOffset(el, 'start'), getCaretOffset(el, 'end') ?? undefined)
      }}
      onMouseUp={() => {
        const el = ref.current
        if (!el) return
        const a = getCaretOffset(el, 'start')
        const b = getCaretOffset(el, 'end')
        // A drag that selected something needs no repaint at all — the
        // matched-pair emphasis is a caret affordance, and repainting mid-
        // selection is pure risk for no gain.
        if (a !== null && b !== null && a !== b) return
        repaint(readText(el), a)
      }}
      onBlur={() => {
        const el = ref.current
        if (!el) return
        repaint(readText(el), null)
      }}
    />
  )
}
