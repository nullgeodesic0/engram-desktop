import type { WorkbenchCell } from '../../../shared/runtime'

/**
 * Pure helpers for the notebook: the outline, the names a cell may complete,
 * and command mode's key map (Jupyter's, where it has one).
 */

export interface OutlineEntry {
  cellId: string
  /** 1-3 for a note's headings; 4 for a def or class in code. */
  level: number
  text: string
  kind: 'heading' | 'def' | 'class'
}

export function outlineOf(cells: WorkbenchCell[]): OutlineEntry[] {
  const out: OutlineEntry[] = []
  for (const c of cells) {
    if (c.kind === 'note') {
      let fence = false
      for (const line of c.source.split('\n')) {
        if (/^\s*```/.test(line)) fence = !fence
        const m = !fence && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
        if (m) out.push({ cellId: c.id, level: m[1].length, text: m[2], kind: 'heading' })
      }
    } else {
      for (const line of c.source.split('\n')) {
        const m = /^(def|class)\s+([A-Za-z_]\w*)/.exec(line)
        if (m) out.push({ cellId: c.id, level: 4, text: m[2], kind: m[1] === 'def' ? 'def' : 'class' })
      }
    }
  }
  return out
}

export interface DefinedName {
  label: string
  type: 'variable' | 'function' | 'class' | 'module'
}

/** Top-level names the cells define: defs, classes, imports and plain assignments. */
export function definedNames(cells: WorkbenchCell[]): DefinedName[] {
  const seen = new Map<string, DefinedName['type']>()
  const add = (label: string, type: DefinedName['type']) => {
    if (!seen.has(label)) seen.set(label, type)
  }
  for (const c of cells) {
    if (c.kind === 'note') continue
    for (const line of c.source.split('\n')) {
      let m: RegExpExecArray | null
      if ((m = /^def\s+([A-Za-z_]\w*)/.exec(line))) add(m[1], 'function')
      else if ((m = /^class\s+([A-Za-z_]\w*)/.exec(line))) add(m[1], 'class')
      else if ((m = /^import\s+(.+)$/.exec(line)) || (m = /^from\s+\S+\s+import\s+(.+)$/.exec(line))) {
        for (const part of m[1].replace(/[()]/g, '').split(',')) {
          const p = part.trim().split(/\s+as\s+/)
          const name = (p[1] ?? p[0]).split('.')[0].trim()
          if (/^[A-Za-z_]\w*$/.test(name)) add(name, 'module')
        }
      } else if ((m = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]+)?=(?!=)/.exec(line))) {
        for (const n of m[1].split(',')) add(n.trim(), 'variable')
      }
    }
  }
  return [...seen].map(([label, type]) => ({ label, type }))
}

export type NotebookCommand =
  | 'up'
  | 'down'
  | 'edit'
  | 'run'
  | 'runAdvance'
  | 'insertAbove'
  | 'insertBelow'
  | 'delete'
  | 'undoDelete'
  | 'toNote'
  | 'toCode'
  | 'copy'
  | 'cut'
  | 'pasteBelow'
  | 'pasteAbove'
  | 'moveUp'
  | 'moveDown'
  | 'toggleOutput'
  | 'toggleInput'
  | 'toggleLineNumbers'
  | 'interrupt'
  | 'restart'
  | 'help'
  | 'top'
  | 'bottom'

export interface KeyPress {
  key: string
  shift: boolean
  mod: boolean
  alt: boolean
}

/** Keys that need a second press within this many ms: D D, I I, 0 0. */
export const DOUBLE_MS = 700

/**
 * Command mode's key map. `prev` is the previous plain key and when it was
 * pressed, for the doubled ones. Null: not a notebook key.
 */
export function commandFor(k: KeyPress, prev: { key: string; at: number } | null, now: number): NotebookCommand | null {
  const doubled = (key: string) => !!prev && prev.key === key && now - prev.at <= DOUBLE_MS
  if (k.key === 'Enter') return k.shift ? 'runAdvance' : k.mod ? 'run' : 'edit'
  if (k.alt && k.key === 'ArrowUp') return 'moveUp'
  if (k.alt && k.key === 'ArrowDown') return 'moveDown'
  if (k.mod || k.alt) return null
  switch (k.key) {
    case 'ArrowUp':
    case 'k':
      return 'up'
    case 'ArrowDown':
    case 'j':
      return 'down'
    case 'Home':
      return 'top'
    case 'End':
      return 'bottom'
    case 'a':
      return 'insertAbove'
    case 'b':
      return 'insertBelow'
    case 'd':
      return doubled('d') ? 'delete' : null
    case 'z':
      return 'undoDelete'
    case 'm':
      return 'toNote'
    case 'y':
      return 'toCode'
    case 'c':
      return 'copy'
    case 'x':
      return 'cut'
    case 'v':
      return 'pasteBelow'
    case 'V':
      return 'pasteAbove'
    case 'o':
      return 'toggleOutput'
    case 'O':
      return 'toggleInput'
    case 'l':
      return 'toggleLineNumbers'
    case 'i':
      return doubled('i') ? 'interrupt' : null
    case '0':
      return doubled('0') ? 'restart' : null
    case 'h':
    case '?':
      return 'help'
  }
  return null
}

/** What the shortcuts panel lists, in its order. */
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'Shift+Enter', does: 'Run the cell and move to the next' },
  { keys: 'Mod+Enter', does: 'Run the cell in place' },
  { keys: 'Alt+Enter', does: 'Run the cell and insert one below (in a cell)' },
  { keys: 'Esc', does: 'Leave the editor for command mode (Shift+Esc under Vim)' },
  { keys: 'Enter', does: 'Edit the selected cell' },
  { keys: '↑ ↓ or K J', does: 'Select the cell above or below' },
  { keys: 'Alt+↑ Alt+↓', does: 'Move the cell up or down' },
  { keys: 'A  B', does: 'Insert a cell above or below' },
  { keys: 'D D', does: 'Delete the cell (Z brings it back)' },
  { keys: 'C  X  V  Shift+V', does: 'Copy, cut, paste below, paste above' },
  { keys: 'M  Y', does: 'Make it a note, or code' },
  { keys: 'O  Shift+O', does: 'Collapse or show the output, or the code' },
  { keys: 'L', does: 'Line numbers on or off' },
  { keys: 'I I  0 0', does: 'Interrupt, restart the kernel' },
  { keys: 'Mod+F', does: 'Find and replace in a cell (Mod+G next, Mod+Alt+G go to line)' },
  { keys: 'Mod+D', does: 'Select the next occurrence (multi-cursor)' },
  { keys: 'Alt+drag', does: 'Column selection' },
  { keys: 'Mod+/', does: 'Comment or uncomment lines' },
  { keys: 'Mod+[  Mod+]', does: 'Outdent, indent' },
  { keys: 'Mod+Shift+[  ]', does: 'Fold, unfold' },
  { keys: 'Ctrl+Space', does: 'Show completions' },
  { keys: 'H or ?', does: 'This list' },
]
