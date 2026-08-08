/** The DOM layer for a syntax-highlighted plain-text editor built on
 * `contenteditable`, with no mirror element.
 *
 * WHY THIS EXISTS. The first implementation painted a `<pre>` underneath a
 * `<textarea>` whose glyphs were transparent. That technique requires two
 * different element types to agree on a long list of invariants — font,
 * line-height, letter-spacing, padding, box-sizing, wrap rules, scroll range,
 * inline-vs-block layout — and every one of them is a separate way for the
 * text to stop sitting under its own highlight. Four real divergences were
 * found and fixed and it still misaligned. The contract itself was the defect.
 *
 * Here the coloured spans ARE the editable content. There is no second
 * element, so there is nothing to align, nothing to keep in scroll sync, and
 * no box model to reconcile. This is how real editors do it.
 *
 * WHAT IT COSTS, honestly: `contenteditable` hands us caret management. The
 * functions below are that cost, isolated into one file with no React in it,
 * so the whole of it can be driven from a browser harness against the app's
 * real stylesheet before any of it reaches a learner.
 *
 * `plaintext-only` does the heavy lifting on the rest: Chromium then refuses
 * rich-text paste and formatting commands outright, so we never have to strip
 * `<b>`/`<span style>`/`<meta>` soup out of a paste, and the element's content
 * stays a flat run of text and line breaks. */

export interface PaintSpan {
  start: number
  end: number
  /** Inline style applied to this run. Layout-affecting properties are the
   * caller's responsibility to avoid — but unlike the mirror technique, a
   * mistake here shifts the REAL text rather than desynchronising it from a
   * hidden copy, so it is visible immediately instead of subtly wrong. */
  style: Partial<CSSStyleDeclaration>
}

/** Read the editor's text.
 *
 * Not `textContent` (which drops line breaks entirely — a `<br>` contributes
 * nothing) and not `innerText` (which is layout-dependent, collapses runs,
 * and can add or drop trailing newlines depending on how the browser last
 * laid the element out). A explicit walk is the only reading that round-trips
 * exactly what was painted. */
export function readText(root: HTMLElement): string {
  let out = ''
  // A trailing <br> is the RENDERING SENTINEL `paint` adds so a final empty
  // line has a focusable position (see paint). It is not content, and
  // counting it would grow the text by one newline on every repaint.
  const sentinel = root.lastChild && root.lastChild.nodeName === 'BR' ? root.lastChild : null
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child === sentinel) continue
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue ?? ''
      } else if (child.nodeName === 'BR') {
        out += '\n'
      } else {
        // Chromium wraps lines in <div> when Enter is pressed in some modes.
        // A block boundary is a newline, except before the very first one.
        if (out.length > 0 && !out.endsWith('\n') && isBlock(child)) out += '\n'
        walk(child)
      }
    }
  }
  walk(root)
  return out
}

function isBlock(node: Node): boolean {
  return node.nodeName === 'DIV' || node.nodeName === 'P'
}

/** Character offset of the caret (or of a selection edge) within `root`. */
export function getCaretOffset(root: HTMLElement, which: 'start' | 'end' = 'start'): number | null {
  const sel = root.ownerDocument.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const node = which === 'start' ? range.startContainer : range.endContainer
  const offset = which === 'start' ? range.startOffset : range.endOffset
  return offsetOf(root, node, offset)
}

/** Walk to `(node, offset)` counting characters exactly the way `readText`
 * emits them, so the two can never disagree about what offset 12 means. */
function offsetOf(root: HTMLElement, node: Node, offset: number): number | null {
  let count = 0
  let found = false
  const sentinel = root.lastChild && root.lastChild.nodeName === 'BR' ? root.lastChild : null

  const walk = (current: Node): void => {
    if (found) return
    for (const child of Array.from(current.childNodes)) {
      if (found) return
      if (child === sentinel) continue
      if (child === node) {
        // Caret inside this text node, or before this element child.
        count += child.nodeType === Node.TEXT_NODE ? offset : 0
        found = true
        return
      }
      if (child.nodeType === Node.TEXT_NODE) {
        count += (child.nodeValue ?? '').length
      } else if (child.nodeName === 'BR') {
        count += 1
      } else {
        if (count > 0 && isBlock(child)) count += 1
        walk(child)
      }
    }
  }

  // A caret positioned on the root itself (`node === root`) counts whole
  // children, which is how Chromium reports an empty or just-cleared editor.
  if (node === root) {
    let n = 0
    for (let i = 0; i < offset && i < root.childNodes.length; i++) {
      const child = root.childNodes[i]
      if (child === sentinelOf(root)) continue
      n += child.nodeName === 'BR' ? 1 : (child.textContent ?? '').length
    }
    return n
  }

  walk(root)
  return found ? count : null
}

/** Place the caret (or a selection) at character offsets within `root`. */
export function setCaretOffset(root: HTMLElement, start: number, end: number = start): void {
  const doc = root.ownerDocument
  const sel = doc.getSelection()
  if (!sel) return
  const a = locate(root, start)
  const b = end === start ? a : locate(root, end)
  if (!a || !b) return
  const range = doc.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  sel.removeAllRanges()
  sel.addRange(range)
}

/** Character offset → a concrete (text node, offset) position. */
function locate(root: HTMLElement, target: number): { node: Node; offset: number } | null {
  let count = 0
  let last: { node: Node; offset: number } | null = null
  let hit: { node: Node; offset: number } | null = null

  const sentinel = sentinelOf(root)
  const walk = (current: Node): void => {
    for (const child of Array.from(current.childNodes)) {
      if (hit) return
      if (child === sentinel) continue
      if (child.nodeType === Node.TEXT_NODE) {
        const len = (child.nodeValue ?? '').length
        // `<=` so a caret at the very end of a run lands in that run rather
        // than falling through to the next one — which is what keeps the
        // caret visually before a delimiter instead of after it.
        if (target <= count + len) {
          hit = { node: child, offset: target - count }
          return
        }
        count += len
        last = { node: child, offset: len }
      } else if (child.nodeName === 'BR') {
        if (target === count) {
          hit = { node: child.parentNode as Node, offset: indexOfChild(child) }
          return
        }
        count += 1
      } else {
        if (count > 0 && isBlock(child)) {
          if (target === count) {
            hit = { node: child, offset: 0 }
            return
          }
          count += 1
        }
        walk(child)
      }
    }
  }

  walk(root)
  if (hit) return hit
  if (last) return last
  return { node: root, offset: 0 }
}

function sentinelOf(root: HTMLElement): Node | null {
  return root.lastChild && root.lastChild.nodeName === 'BR' ? root.lastChild : null
}

function indexOfChild(node: Node): number {
  const parent = node.parentNode
  if (!parent) return 0
  return Array.prototype.indexOf.call(parent.childNodes, node)
}

/** Rebuild the editor's content from `text` and a set of styled spans,
 * preserving the caret.
 *
 * Rebuilds unconditionally rather than diffing: at composer scale (a few
 * hundred characters) the DOM write is trivial, and a diff is where subtle
 * caret bugs breed. The caret is captured before and restored after, by
 * character offset, so it survives the replacement exactly.
 *
 * Newlines are emitted as real `\n` inside text nodes with `white-space:
 * pre-wrap`, never as `<br>`. That keeps `readText` an exact inverse of what
 * was painted — the property the whole caret model rests on. */
export function paint(root: HTMLElement, text: string, spans: PaintSpan[], preserveCaret = true): void {
  const doc = root.ownerDocument
  const hasFocus = doc.activeElement === root
  const caretStart = preserveCaret && hasFocus ? getCaretOffset(root, 'start') : null
  const caretEnd = preserveCaret && hasFocus ? getCaretOffset(root, 'end') : null

  const frag = doc.createDocumentFragment()
  let at = 0
  for (const span of spans) {
    if (span.start > at) frag.appendChild(doc.createTextNode(text.slice(at, span.start)))
    const el = doc.createElement('span')
    Object.assign(el.style, span.style)
    el.appendChild(doc.createTextNode(text.slice(span.start, span.end)))
    frag.appendChild(el)
    at = span.end
  }
  if (at < text.length) frag.appendChild(doc.createTextNode(text.slice(at)))

  // RENDERING SENTINEL. A text node ending in `\n` has no focusable position
  // after that newline — the browser collapses the caret back to the end of
  // the previous line. Found in the harness: typing Enter then `b` produced
  // "ab\n\n" instead of "a\nb", because the caret never made it to line 2.
  // A trailing <br> gives the empty last line a real position; `readText`,
  // `offsetOf` and `locate` all skip it, so it never becomes content.
  if (text.endsWith('\n')) frag.appendChild(doc.createElement('br'))

  root.replaceChildren(frag)

  if (caretStart !== null) setCaretOffset(root, caretStart, caretEnd ?? caretStart)
}

/** The edit a `beforeinput` event is asking for, resolved against OUR text
 * model rather than the browser's DOM.
 *
 * WHY WE INTERCEPT INSTEAD OF OBSERVE. The first attempt let Chromium apply
 * the edit and then read the result back. That works for ordinary characters
 * and fails on line breaks: after inserting one, Chromium anchors the caret
 * at the END OF THE PREVIOUS TEXT NODE rather than after the new break. Those
 * two positions are visually different but numerically identical to a script
 * — the distinction is selection *affinity*, which is not exposed. The
 * harness caught it as "type Enter then b" producing `ab\n\n` instead of
 * `a\nb`, with the caret one short.
 *
 * So the browser never gets to apply these. We compute the new text and caret
 * ourselves, from offsets we already hold, and repaint. The DOM becomes purely
 * an output of our model instead of a thing we interrogate.
 *
 * Returns null for input types we don't claim (composition, history, and
 * anything future), which are then left to the browser and reconciled by the
 * repaint that follows. */
export function applyBeforeInput(
  text: string,
  selStart: number,
  selEnd: number,
  inputType: string,
  data: string | null,
): { text: string; caret: number } | null {
  const cut = (insert: string, from = selStart, to = selEnd) => ({
    text: text.slice(0, from) + insert + text.slice(to),
    caret: from + insert.length,
  })

  switch (inputType) {
    case 'insertText':
      return data === null ? null : cut(data)
    case 'insertLineBreak':
    case 'insertParagraph':
      return cut('\n')
    case 'insertFromPaste':
    case 'insertFromDrop':
    case 'insertReplacementText':
      // `plaintext-only` guarantees `data` is already flat text.
      return data === null ? null : cut(data)
    case 'deleteContentBackward': {
      if (selEnd > selStart) return cut('')
      if (selStart === 0) return null
      return cut('', selStart - 1, selStart)
    }
    case 'deleteContentForward': {
      if (selEnd > selStart) return cut('')
      if (selStart >= text.length) return null
      return cut('', selStart, selStart + 1)
    }
    case 'deleteWordBackward': {
      if (selEnd > selStart) return cut('')
      // Trailing whitespace, then the run of non-whitespace before it.
      let i = selStart
      while (i > 0 && /\s/.test(text[i - 1])) i--
      while (i > 0 && !/\s/.test(text[i - 1])) i--
      return cut('', i, selStart)
    }
    case 'deleteWordForward': {
      if (selEnd > selStart) return cut('')
      let i = selStart
      while (i < text.length && /\s/.test(text[i])) i++
      while (i < text.length && !/\s/.test(text[i])) i++
      return cut('', selStart, i)
    }
    case 'deleteByCut':
      return cut('')
    default:
      return null
  }
}
