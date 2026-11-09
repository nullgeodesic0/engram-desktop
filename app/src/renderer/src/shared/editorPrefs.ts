import { useEffect, useState } from 'react'

/**
 * How code cells edit, for every workbench and lab on this machine. A
 * per-viewer convenience in localStorage, like the pane sizes: losing it
 * costs a few clicks, never work. Changes reach every open editor at once.
 */

export type Keymap = 'default' | 'vim' | 'emacs'

export interface EditorPrefs {
  fontSize: number
  lineNumbers: boolean
  lineWrap: boolean
  /** Spaces per indent. */
  indent: 2 | 4
  autocomplete: boolean
  closeBrackets: boolean
  /** Highlight other occurrences of the selected word. */
  matchHighlight: boolean
  foldGutter: boolean
  keymap: Keymap
  /** Cap a long output at this many pixels, scrolling inside it; 0 never caps. */
  outputMaxHeight: number
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  fontSize: 13,
  lineNumbers: true,
  lineWrap: false,
  indent: 4,
  autocomplete: true,
  closeBrackets: true,
  matchHighlight: true,
  foldGutter: true,
  keymap: 'default',
  outputMaxHeight: 480,
}

export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20] as const
export const OUTPUT_HEIGHTS = [0, 240, 480, 800] as const

const KEY = 'engram.editorPrefs.v1'
const EVENT = 'engram:editor-prefs'

/** Reads stored prefs, keeping each field only if it is valid. */
export function parseEditorPrefs(raw: unknown): EditorPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_EDITOR_PREFS
  const bool = (k: keyof EditorPrefs) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (d[k] as boolean))
  return {
    fontSize: (FONT_SIZES as readonly number[]).includes(o.fontSize as number) ? (o.fontSize as number) : d.fontSize,
    lineNumbers: bool('lineNumbers'),
    lineWrap: bool('lineWrap'),
    indent: o.indent === 2 || o.indent === 4 ? o.indent : d.indent,
    autocomplete: bool('autocomplete'),
    closeBrackets: bool('closeBrackets'),
    matchHighlight: bool('matchHighlight'),
    foldGutter: bool('foldGutter'),
    keymap: o.keymap === 'vim' || o.keymap === 'emacs' || o.keymap === 'default' ? o.keymap : d.keymap,
    outputMaxHeight: (OUTPUT_HEIGHTS as readonly number[]).includes(o.outputMaxHeight as number)
      ? (o.outputMaxHeight as number)
      : d.outputMaxHeight,
  }
}

export function loadEditorPrefs(): EditorPrefs {
  try {
    return parseEditorPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return DEFAULT_EDITOR_PREFS
  }
}

export function saveEditorPrefs(p: EditorPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Storage unavailable: the change lasts this session only.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: p }))
}

export function useEditorPrefs(): [EditorPrefs, (patch: Partial<EditorPrefs>) => void] {
  const [prefs, setPrefs] = useState(loadEditorPrefs)
  useEffect(() => {
    const on = (e: Event) => setPrefs((e as CustomEvent<EditorPrefs>).detail)
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  const update = (patch: Partial<EditorPrefs>) => saveEditorPrefs(parseEditorPrefs({ ...loadEditorPrefs(), ...patch }))
  return [prefs, update]
}
