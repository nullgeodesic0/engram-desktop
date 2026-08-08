/** Undo/redo for the LaTeX editor.
 *
 * WHY THIS HAS TO EXIST. `LatexEditor` intercepts every `beforeinput` and
 * rewrites the DOM itself, which is what makes the caret predictable — but it
 * also means Chromium's native undo stack never records a single edit, so
 * ⌘Z did nothing at all. Owning the text model obliges us to own its history.
 *
 * COALESCING IS THE WHOLE DESIGN. A snapshot per keystroke is technically
 * correct and useless: undoing a sentence would take fifty presses. Real
 * editors group a run of typing into one entry, and the grouping rules are
 * what make undo feel right rather than arbitrary:
 *
 *   · a run breaks at whitespace, so undo steps back word by word — this is
 *     the behaviour people actually expect from every text field they use
 *   · a run breaks when the caret jumps, since typing somewhere else is a
 *     new thought, not a continuation
 *   · a run breaks when the KIND changes: inserting then deleting is two
 *     actions even if they happen a keystroke apart
 *   · a run breaks after a pause, because a pause is where the author
 *     themselves would say one edit ended
 *
 * PURE. Time is passed in rather than read, so the pause rule is testable
 * without faking a clock. */

export interface EditSnapshot {
  text: string
  caret: number
}

export type EditKind = 'insert' | 'delete' | 'other'

export interface EditHistory {
  entries: EditSnapshot[]
  /** Index of the CURRENT state within `entries`. Everything after it is the
   * redo tail, discarded the moment a new edit arrives. */
  index: number
  lastAt: number
  lastKind: EditKind | null
}

/** How long a typing run may pause before the next character starts a new
 * undo entry. Long enough not to fragment ordinary typing, short enough that
 * "I stopped and thought about it" reads as a boundary. */
const COALESCE_MS = 700

/** Bound on retained history. Composer-sized text, so this is a memory
 * courtesy rather than a real constraint — but unbounded growth over a long
 * sitting is still growth. */
const MAX_ENTRIES = 200

export function createHistory(initial: EditSnapshot): EditHistory {
  return { entries: [initial], index: 0, lastAt: 0, lastKind: null }
}

/** The state the history currently points at. */
export function current(h: EditHistory): EditSnapshot {
  return h.entries[h.index]
}

function isSingleInsertAt(prev: EditSnapshot, next: EditSnapshot): string | null {
  if (next.text.length !== prev.text.length + 1) return null
  if (next.caret !== prev.caret + 1) return null
  // The inserted character must sit exactly where the caret was.
  const inserted = next.text[prev.caret]
  if (prev.text.slice(0, prev.caret) !== next.text.slice(0, prev.caret)) return null
  if (prev.text.slice(prev.caret) !== next.text.slice(prev.caret + 1)) return null
  return inserted
}

function isSingleDeleteAt(prev: EditSnapshot, next: EditSnapshot): boolean {
  if (next.text.length !== prev.text.length - 1) return false
  if (next.caret !== prev.caret - 1) return false
  return prev.text.slice(0, next.caret) === next.text.slice(0, next.caret) && prev.text.slice(prev.caret) === next.text.slice(next.caret)
}

/** Record a new state. Returns the same history object mutated in place —
 * it lives in a ref, never in React state, because history is not something
 * the view renders. */
export function record(h: EditHistory, next: EditSnapshot, kind: EditKind, now: number): EditHistory {
  const prev = current(h)
  // A no-op edit (same text, caret moved) is not history. Keep the caret
  // fresh so a later undo returns you somewhere sensible.
  if (prev.text === next.text) {
    h.entries[h.index] = next
    return h
  }

  const inTime = now - h.lastAt < COALESCE_MS
  const sameKind = h.lastKind === kind
  let coalesce = false

  if (inTime && sameKind && kind === 'insert') {
    const ch = isSingleInsertAt(prev, next)
    // Whitespace ends a run rather than joining it, which is what produces
    // word-by-word undo.
    coalesce = ch !== null && !/\s/.test(ch)
  } else if (inTime && sameKind && kind === 'delete') {
    coalesce = isSingleDeleteAt(prev, next)
  }

  if (coalesce) {
    h.entries[h.index] = next
  } else {
    // Any new edit discards the redo tail — the future you branched away from
    // is not recoverable, same as every editor.
    h.entries = h.entries.slice(0, h.index + 1)
    h.entries.push(next)
    if (h.entries.length > MAX_ENTRIES) h.entries.shift()
    h.index = h.entries.length - 1
  }

  h.lastAt = now
  h.lastKind = kind
  return h
}

/** Step back. Returns null at the oldest entry, so the caller can let the
 * keystroke fall through rather than pretending something happened. */
export function undo(h: EditHistory): EditSnapshot | null {
  if (h.index <= 0) return null
  h.index--
  // A stepped-to state must not then coalesce with whatever is typed next.
  h.lastKind = null
  h.lastAt = 0
  return current(h)
}

export function redo(h: EditHistory): EditSnapshot | null {
  if (h.index >= h.entries.length - 1) return null
  h.index++
  h.lastKind = null
  h.lastAt = 0
  return current(h)
}
