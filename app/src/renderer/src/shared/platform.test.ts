import { describe, expect, it } from 'vitest'
import { shortcutLabel } from './platform'

describe('shortcutLabel', () => {
  it('leaves macOS glyphs alone on macOS — they are the native form there', () => {
    expect(shortcutLabel('⇧⌘H', true)).toBe('⇧⌘H')
    expect(shortcutLabel('⌘⏎', true)).toBe('⌘⏎')
  })

  it('translates to the words Windows and Linux actually use', () => {
    expect(shortcutLabel('⌘K', false)).toBe('Ctrl+K')
    expect(shortcutLabel('⇧⌘H', false)).toBe('Ctrl+Shift+H')
    expect(shortcutLabel('⌘,', false)).toBe('Ctrl+,')
  })

  it('writes modifiers in the platform order, not the order the glyphs were authored in', () => {
    // The source table writes Shift first (⇧⌘R); Windows convention is Ctrl first.
    expect(shortcutLabel('⇧⌘R', false)).toBe('Ctrl+Shift+R')
  })

  it('spells out the non-letter keys that only exist as glyphs on macOS', () => {
    expect(shortcutLabel('⌘⏎', false)).toBe('Ctrl+Enter')
    expect(shortcutLabel('⌥⌫', false)).toBe('Alt+Backspace')
  })

  it('maps ⌃ to Ctrl too, so a macOS Control shortcut does not come out blank', () => {
    expect(shortcutLabel('⌃⌘F', false)).toBe('Ctrl+F')
  })
})
