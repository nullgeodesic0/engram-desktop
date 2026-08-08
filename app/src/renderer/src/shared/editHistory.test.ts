import { describe, it, expect } from 'vitest'
import { createHistory, record, undo, redo, current, type EditHistory } from './editHistory'

/** Type a string one character at a time, at `t` ms apart, the way the editor
 * records it. Returns the history so a test can then undo through it. */
function typeInto(h: EditHistory, s: string, startText = '', startAt = 1000, gap = 50): EditHistory {
  let text = startText
  let t = startAt
  for (const ch of s) {
    text += ch
    record(h, { text, caret: text.length }, 'insert', t)
    t += gap
  }
  return h
}

describe('record — coalescing a typing run', () => {
  it('groups a word into ONE undo step', () => {
    const h = createHistory({ text: '', caret: 0 })
    typeInto(h, 'hello')
    expect(current(h).text).toBe('hello')
    expect(undo(h)?.text).toBe('')
  })

  it('breaks at whitespace, so undo steps back word by word', () => {
    const h = createHistory({ text: '', caret: 0 })
    typeInto(h, 'hello world')
    expect(current(h).text).toBe('hello world')
    // The space opens a new entry and the following word coalesces INTO it,
    // so one undo takes back " world" and leaves the first word — the same
    // step size every editor gives you.
    expect(undo(h)?.text).toBe('hello')
    expect(undo(h)?.text).toBe('')
  })

  it('breaks after a pause', () => {
    const h = createHistory({ text: '', caret: 0 })
    typeInto(h, 'abc', '', 1000, 50)
    // …a long think, then more typing.
    typeInto(h, 'def', 'abc', 5000, 50)
    expect(current(h).text).toBe('abcdef')
    expect(undo(h)?.text).toBe('abc')
  })

  it('breaks when the kind changes', () => {
    const h = createHistory({ text: '', caret: 0 })
    typeInto(h, 'abcd')
    record(h, { text: 'abc', caret: 3 }, 'delete', 1200)
    expect(undo(h)?.text).toBe('abcd')
    expect(undo(h)?.text).toBe('')
  })

  it('breaks when the caret jumps', () => {
    const h = createHistory({ text: '', caret: 0 })
    typeInto(h, 'abc')
    // Same kind and in time, but inserted somewhere else entirely.
    record(h, { text: 'Xabc', caret: 1 }, 'insert', 1200)
    expect(undo(h)?.text).toBe('abc')
  })

  it('groups a run of backspaces', () => {
    const h = createHistory({ text: 'abcd', caret: 4 })
    record(h, { text: 'abc', caret: 3 }, 'delete', 1000)
    record(h, { text: 'ab', caret: 2 }, 'delete', 1050)
    record(h, { text: 'a', caret: 1 }, 'delete', 1100)
    expect(undo(h)?.text).toBe('abcd')
  })

  it('treats a structural edit as its own step', () => {
    // `$` auto-pairing inserts two characters — not a single-char run, so it
    // can never merge into the surrounding typing.
    const h = createHistory({ text: '', caret: 0 })
    typeInto(h, 'ab')
    record(h, { text: 'ab$$', caret: 3 }, 'insert', 1150)
    expect(undo(h)?.text).toBe('ab')
  })
})

describe('undo / redo', () => {
  it('walks back and forward through the same states', () => {
    const h = createHistory({ text: '', caret: 0 })
    typeInto(h, 'one two')
    const seen: string[] = []
    let s = undo(h)
    while (s) {
      seen.push(s.text)
      s = undo(h)
    }
    expect(seen).toEqual(['one', ''])
    expect(redo(h)?.text).toBe('one')
    expect(redo(h)?.text).toBe('one two')
    expect(redo(h)).toBeNull()
  })

  it('returns null at the ends rather than pretending', () => {
    const h = createHistory({ text: 'x', caret: 1 })
    expect(undo(h)).toBeNull()
    expect(redo(h)).toBeNull()
  })

  it('discards the redo tail once you type again', () => {
    const h = createHistory({ text: '', caret: 0 })
    typeInto(h, 'abc')
    undo(h)
    expect(current(h).text).toBe('')
    record(h, { text: 'z', caret: 1 }, 'insert', 9000)
    expect(redo(h)).toBeNull()
    expect(current(h).text).toBe('z')
  })

  it('does not let a stepped-to state coalesce with the next keystroke', () => {
    const h = createHistory({ text: '', caret: 0 })
    typeInto(h, 'abc')
    undo(h)
    // Immediately after an undo, the next character must start its own entry
    // or the undo would be silently swallowed.
    record(h, { text: 'x', caret: 1 }, 'insert', 1160)
    expect(undo(h)?.text).toBe('')
  })

  it('records a caret move without creating a step', () => {
    const h = createHistory({ text: 'abc', caret: 3 })
    record(h, { text: 'abc', caret: 0 }, 'other', 1000)
    expect(h.entries).toHaveLength(1)
    expect(current(h).caret).toBe(0)
  })
})

describe('history is bounded', () => {
  it('drops the oldest entries past the cap', () => {
    const h = createHistory({ text: '', caret: 0 })
    // Each with a big time gap so nothing coalesces.
    for (let i = 1; i <= 260; i++) record(h, { text: 'x'.repeat(i), caret: i }, 'insert', i * 5000)
    expect(h.entries.length).toBeLessThanOrEqual(200)
    expect(current(h).text).toBe('x'.repeat(260))
  })
})
