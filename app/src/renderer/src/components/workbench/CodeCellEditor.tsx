import { useEffect, useRef } from 'react'
import { EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { tags as t } from '@lezer/highlight'

/**
 * One cell's code editor: CodeMirror 6 with Python highlighting, themed from
 * the app's own colour tokens so it follows light and dark with the rest of
 * the page. Shift+Enter runs the cell and moves on; Mod+Enter runs it in
 * place. Given cells (pack scaffolding) are read-only.
 */

const theme = EditorView.theme({
  '&': {
    fontSize: '13px',
    backgroundColor: 'transparent',
    color: 'var(--color-text-primary)',
  },
  '.cm-content': {
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    padding: '8px 0',
    caretColor: 'var(--color-ink-warm)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--color-text-faint)',
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: '11px',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-surface-3) 35%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-text-dim)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--color-ink-cool) 28%, transparent) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-ink-warm)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--color-ink-warm) 22%, transparent)' },
  '.cm-line.cm-error-line': { backgroundColor: 'color-mix(in srgb, var(--color-ink-danger) 14%, transparent)' },
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--color-ink-violet)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--color-ink-warm)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--color-ink-cool)' },
  { tag: [t.comment, t.lineComment], color: 'var(--color-text-faint)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--color-ink-lavender)' },
  { tag: [t.definition(t.variableName), t.className], color: 'var(--color-text-primary)', fontWeight: '600' },
  { tag: [t.self, t.special(t.variableName)], color: 'var(--color-ink-cool)' },
])

/** The line the last error points at, as a line decoration; cleared by the next edit. */
const setErrorLine = StateEffect.define<number | null>()
const errorLineDeco = Decoration.line({ class: 'cm-error-line' })
const errorLineField: Extension = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        const n = e.value
        if (!n || n < 1 || n > tr.state.doc.lines) return Decoration.none
        return Decoration.set([errorLineDeco.range(tr.state.doc.line(n).from)])
      }
    }
    return tr.docChanged ? Decoration.none : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

export interface CodeCellEditorProps {
  value: string
  readOnly?: boolean
  autoFocus?: boolean
  /** Bumped by the parent to move focus into this editor. */
  focusKey?: number
  /** 1-based line to mark, from the last error. */
  errorLine?: number | null
  onChange: (value: string) => void
  onRun: (advance: boolean) => void
  onFocus?: () => void
}

export function CodeCellEditor({ value, readOnly, autoFocus, focusKey, errorLine, onChange, onRun, onFocus }: CodeCellEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Callbacks change every render; the editor reads them through refs so it is built once.
  const cb = useRef({ onChange, onRun, onFocus })
  cb.current = { onChange, onRun, onFocus }

  useEffect(() => {
    if (!host.current) return
    const runKeys = Prec.highest(
      keymap.of([
        { key: 'Shift-Enter', run: () => (cb.current.onRun(true), true) },
        { key: 'Mod-Enter', run: () => (cb.current.onRun(false), true) },
      ]),
    )
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          runKeys,
          lineNumbers(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          python(),
          errorLineField,
          syntaxHighlighting(highlight),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorState.tabSize.of(4),
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString())
            if (u.focusChanged && u.view.hasFocus) cb.current.onFocus?.()
          }),
        ],
      }),
    })
    view.current = v
    if (autoFocus) v.focus()
    return () => {
      v.destroy()
      view.current = null
    }
    // Built once per mount; value changes from outside are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    if (focusKey) view.current?.focus()
  }, [focusKey])

  useEffect(() => {
    view.current?.dispatch({ effects: setErrorLine.of(errorLine ?? null) })
  }, [errorLine])

  return <div ref={host} className="min-w-0" />
}
