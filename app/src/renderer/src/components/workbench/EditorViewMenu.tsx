import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { SegmentedControl } from '../ui/SegmentedControl'
import { FONT_SIZES, OUTPUT_HEIGHTS, type EditorPrefs, type Keymap } from '../../shared/editorPrefs'

/**
 * The workbench's View menu: how code cells edit, for every notebook on this
 * machine. Changes apply to every open cell at once (see CodeCellEditor).
 */
export function EditorViewMenu({
  prefs,
  onChange,
}: {
  prefs: EditorPrefs
  onChange: (patch: Partial<EditorPrefs>) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (key: keyof EditorPrefs, label: string, hint?: string) => (
    <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)] py-0.5" title={hint}>
      <input
        type="checkbox"
        checked={prefs[key] as boolean}
        onChange={(e) => onChange({ [key]: e.target.checked })}
        className="accent-[var(--color-ink-warm)]"
      />
      {label}
    </label>
  )

  return (
    <div ref={box} className="relative">
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        View
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Editor view"
          className="panel-raised absolute right-0 top-full mt-1.5 z-30 w-72 px-4 py-3 flex flex-col gap-3 shadow-lg"
        >
          <div className="flex flex-col gap-1">
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
              Font size
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                aria-label="Smaller"
                disabled={prefs.fontSize === FONT_SIZES[0]}
                onClick={() =>
                  onChange({ fontSize: FONT_SIZES[Math.max(0, FONT_SIZES.indexOf(prefs.fontSize as never) - 1)] })
                }
              >
                A−
              </Button>
              <span className="label-data text-xs text-[var(--color-text-primary)] w-10 text-center">
                {prefs.fontSize} px
              </span>
              <Button
                size="sm"
                aria-label="Larger"
                disabled={prefs.fontSize === FONT_SIZES[FONT_SIZES.length - 1]}
                onClick={() =>
                  onChange({
                    fontSize:
                      FONT_SIZES[Math.min(FONT_SIZES.length - 1, FONT_SIZES.indexOf(prefs.fontSize as never) + 1)],
                  })
                }
              >
                A+
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">Keys</div>
            <SegmentedControl<Keymap>
              ariaLabel="Key bindings"
              value={prefs.keymap}
              onChange={(keymap) => onChange({ keymap })}
              options={[
                { value: 'default', label: 'Standard' },
                { value: 'vim', label: 'Vim' },
                { value: 'emacs', label: 'Emacs' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
              Indent
            </div>
            <SegmentedControl<'2' | '4'>
              ariaLabel="Indent width"
              value={String(prefs.indent) as '2' | '4'}
              onChange={(v) => onChange({ indent: Number(v) as 2 | 4 })}
              options={[
                { value: '2', label: '2 spaces' },
                { value: '4', label: '4 spaces' },
              ]}
            />
          </div>
          <div className="flex flex-col">
            {toggle('lineNumbers', 'Line numbers', 'L in command mode')}
            {toggle('lineWrap', 'Wrap long lines')}
            {toggle('foldGutter', 'Fold markers', 'Fold a block from the gutter, or Mod+Shift+[')}
            {toggle(
              'autocomplete',
              'Completions as you type',
              'Python, the kernel’s variables and the notebook’s names',
            )}
            {toggle('closeBrackets', 'Close brackets and quotes')}
            {toggle('matchHighlight', 'Highlight other uses of the selection')}
          </div>
          <div className="flex flex-col gap-1">
            <div className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">
              Long outputs
            </div>
            <select
              value={prefs.outputMaxHeight}
              onChange={(e) => onChange({ outputMaxHeight: Number(e.target.value) })}
              aria-label="Long outputs"
              className="focus-ring bg-transparent border border-[var(--color-hairline)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            >
              {OUTPUT_HEIGHTS.map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? 'Show in full' : `Scroll past ${h} px`}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
