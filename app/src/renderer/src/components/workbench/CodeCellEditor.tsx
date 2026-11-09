import { useEffect, useRef } from 'react'
import { Compartment, EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  type DecorationSet,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete'
import { python } from '@codemirror/lang-python'
import { vim } from '@replit/codemirror-vim'
import { emacs } from '@replit/codemirror-emacs'
import { tags as t } from '@lezer/highlight'
import type { EditorPrefs } from '../../shared/editorPrefs'

/**
 * One cell's code editor: CodeMirror 6 with Python highlighting, themed from
 * the app's own colour tokens so it follows light and dark with the rest of
 * the page. Shift+Enter runs the cell and moves on, Mod+Enter runs it in
 * place, Alt+Enter runs it and inserts a cell below, and Escape leaves the
 * editor for the notebook's command mode (Shift+Escape under Vim, where
 * Escape belongs to Vim). Given cells (pack scaffolding) are read-only.
 *
 * Everything the editor preferences control sits in a compartment, so a
 * change in the View menu reconfigures every open cell in place.
 */

const theme = EditorView.theme({
  '&': {
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
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--color-ink-cool) 16%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-ink-warm) 24%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--color-ink-warm) 45%, transparent)' },
  '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', color: 'var(--color-text-faint)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: '1px solid var(--color-hairline)',
    color: 'var(--color-text-dim)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--color-surface-2, transparent)',
    color: 'var(--color-text-primary)',
    borderColor: 'var(--color-hairline)',
  },
  '.cm-panels input, .cm-panels button': { fontSize: '12px' },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-surface-2, var(--color-void))',
    border: '1px solid var(--color-hairline)',
    color: 'var(--color-text-primary)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'color-mix(in srgb, var(--color-ink-cool) 30%, transparent)',
    color: 'var(--color-text-primary)',
  },
  '.cm-vim-panel, .cm-vim-panel input': { fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
})

/** A completion the notebook knows about: a kernel variable, or a name defined in another cell. */
export interface NotebookName {
  label: string
  type: 'variable' | 'function' | 'class' | 'module'
  detail?: string
}

/** The editor-preference extensions, one compartment each. */
const comps = {
  keymap: new Compartment(),
  lineNumbers: new Compartment(),
  wrap: new Compartment(),
  fold: new Compartment(),
  brackets: new Compartment(),
  completion: new Compartment(),
  match: new Compartment(),
  font: new Compartment(),
  indent: new Compartment(),
}

function prefExtensions(p: EditorPrefs, source: (ctx: CompletionContext) => unknown) {
  return {
    keymap: p.keymap === 'vim' ? vim() : p.keymap === 'emacs' ? emacs() : [],
    lineNumbers: p.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
    wrap: p.lineWrap ? EditorView.lineWrapping : [],
    fold: p.foldGutter ? foldGutter() : [],
    brackets: p.closeBrackets ? closeBrackets() : [],
    completion: p.autocomplete
      ? [autocompletion({ activateOnTyping: true }), EditorState.languageData.of(() => [{ autocomplete: source }])]
      : [],
    match: p.matchHighlight ? highlightSelectionMatches() : [],
    font: EditorView.theme({ '&': { fontSize: `${p.fontSize}px` } }),
    indent: [indentUnit.of(' '.repeat(p.indent)), EditorState.tabSize.of(p.indent)],
  } satisfies Record<keyof typeof comps, Extension>
}

const highlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword],
    color: 'var(--color-ink-violet)',
  },
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
  prefs: EditorPrefs
  /** Names the notebook can offer beyond Python's own: kernel variables, defs in other cells. */
  names?: NotebookName[]
  /** Escape: leave the editor for command mode. */
  onEscape?: () => void
  /** Alt+Enter: run, then insert a cell below. */
  onRunInsert?: () => void
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

export function CodeCellEditor({
  value,
  prefs,
  names,
  readOnly,
  autoFocus,
  focusKey,
  errorLine,
  onChange,
  onRun,
  onFocus,
  onEscape,
  onRunInsert,
}: CodeCellEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Callbacks change every render; the editor reads them through refs so it is built once.
  const cb = useRef({ onChange, onRun, onFocus, onEscape, onRunInsert })
  cb.current = { onChange, onRun, onFocus, onEscape, onRunInsert }
  const namesRef = useRef<NotebookName[]>(names ?? [])
  namesRef.current = names ?? []
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const sourceRef = useRef<(ctx: CompletionContext) => unknown>(() => null)

  useEffect(() => {
    if (!host.current) return
    const notebookNames = (ctx: CompletionContext) => {
      const word = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/)
      if (!word || (word.from === word.to && !ctx.explicit)) return null
      // After a dot is an attribute: the kernel knows those, the notebook does not.
      if (ctx.state.sliceDoc(word.from - 1, word.from) === '.') return null
      const options: Completion[] = namesRef.current.map((n) => ({ label: n.label, type: n.type, detail: n.detail }))
      return { from: word.from, options, validFor: /^[A-Za-z0-9_]*$/ }
    }
    sourceRef.current = notebookNames
    const escapeKey = () => {
      if (!cb.current.onEscape) return false
      cb.current.onEscape()
      return true
    }
    const runKeys = Prec.highest(
      keymap.of([
        { key: 'Shift-Enter', run: () => (cb.current.onRun(true), true) },
        { key: 'Mod-Enter', run: () => (cb.current.onRun(false), true) },
        { key: 'Alt-Enter', run: () => (cb.current.onRunInsert?.(), true) },
        { key: 'Shift-Escape', run: escapeKey },
      ]),
    )
    // Escape leaves for command mode unless Vim wants it, or a panel or completion is open.
    const escape = keymap.of([{ key: 'Escape', run: () => (prefsRef.current.keymap === 'vim' ? false : escapeKey()) }])
    const pe = prefExtensions(prefs, notebookNames)
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          comps.keymap.of(pe.keymap),
          runKeys,
          comps.lineNumbers.of(pe.lineNumbers),
          comps.fold.of(pe.fold),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          rectangularSelection(),
          crosshairCursor(),
          indentOnInput(),
          bracketMatching(),
          comps.brackets.of(pe.brackets),
          highlightActiveLine(),
          comps.match.of(pe.match),
          comps.completion.of(pe.completion),
          search({ top: true }),
          python(),
          errorLineField,
          syntaxHighlighting(highlight),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          escape,
          comps.indent.of(pe.indent),
          comps.wrap.of(pe.wrap),
          comps.font.of(pe.font),
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
    // Built once per mount; value and preference changes from outside are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  useEffect(() => {
    const v = view.current
    if (!v) return
    const pe = prefExtensions(prefs, sourceRef.current)
    v.dispatch({ effects: (Object.keys(comps) as (keyof typeof comps)[]).map((k) => comps[k].reconfigure(pe[k])) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    prefs.keymap,
    prefs.lineNumbers,
    prefs.lineWrap,
    prefs.foldGutter,
    prefs.closeBrackets,
    prefs.matchHighlight,
    prefs.fontSize,
    prefs.indent,
    prefs.autocomplete,
  ])

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
