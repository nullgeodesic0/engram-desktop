import { useState } from 'react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'

/** One text field, one confirm — Learn's library uses it to name a new
 * folder, rename a folder, and rename a topic. `validate` returns a reason
 * the name can't be used (shown inline), or null. */
export function NameDialog({
  title,
  subtitle,
  label,
  initial = '',
  placeholder,
  confirmLabel,
  hint,
  validate,
  onConfirm,
  onClose,
}: {
  title: string
  subtitle?: string
  label: string
  initial?: string
  placeholder?: string
  confirmLabel: string
  hint?: string
  validate?: (value: string) => string | null
  onConfirm: (value: string) => void | Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const trimmed = value.trim().replace(/\s+/g, ' ')
  const problem = trimmed.length === 0 ? null : (validate?.(trimmed) ?? null)
  const canSave = trimmed.length > 0 && !problem && !busy

  async function submit() {
    if (!canSave) return
    setBusy(true)
    try {
      await onConfirm(trimmed)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={title} subtitle={subtitle}>
      <form
        className="flex flex-col gap-3 px-6 py-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">{label}</span>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            maxLength={80}
            className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)]"
          />
        </label>
        {problem ? (
          <div className="text-xs text-[var(--color-text-dim)]">{problem}</div>
        ) : (
          hint && <div className="text-xs text-[var(--color-text-faint)]">{hint}</div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!canSave}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
