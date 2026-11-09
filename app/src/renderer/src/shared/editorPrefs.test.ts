import { describe, expect, it } from 'vitest'
import { DEFAULT_EDITOR_PREFS, parseEditorPrefs } from './editorPrefs'
import { clampSize } from './paneLayout'

describe('editor prefs and pane sizes', () => {
  it('keeps valid fields and defaults the rest', () => {
    expect(parseEditorPrefs(null)).toEqual(DEFAULT_EDITOR_PREFS)
    const p = parseEditorPrefs({ fontSize: 16, keymap: 'vim', indent: 3, lineWrap: 'yes', outputMaxHeight: 800 })
    expect(p).toMatchObject({ fontSize: 16, keymap: 'vim', indent: 4, lineWrap: false, outputMaxHeight: 800 })
    expect(parseEditorPrefs({ fontSize: 99 }).fontSize).toBe(13)
  })

  it('clamps pane sizes', () => {
    expect(clampSize(50, 160, 480)).toBe(160)
    expect(clampSize(900.4, 160, 480)).toBe(480)
    expect(clampSize(300.6, 160, 480)).toBe(301)
  })
})
