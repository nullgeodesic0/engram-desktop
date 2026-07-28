import { useEffect, useState } from 'react'
import { Modal } from './ui/Modal'

interface TopicSettingsModalProps {
  topicId: string
  topicTitle: string
  onClose: () => void
}

const EXAMPLE = 'Use LaTeX ($...$ for inline, $$...$$ for display) for every equation and mathematical expression.'

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

export function TopicSettingsModal({ topicId, topicTitle, onClose }: TopicSettingsModalProps) {
  const [value, setValue] = useState('')
  const [contextFiles, setContextFiles] = useState<string[]>([])
  const [targetDate, setTargetDate] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.engram.getTopicSettings(topicId).then((s) => {
      setValue(s.systemPromptExtra)
      setContextFiles(s.contextFiles)
      setTargetDate(s.targetDate ?? null)
      setLoaded(true)
    })
  }, [topicId])

  async function addFiles() {
    const picked = await window.engram.pickFiles()
    setContextFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  function removeFile(path: string) {
    setContextFiles((prev) => prev.filter((p) => p !== path))
  }

  async function save() {
    setSaving(true)
    await window.engram.setTopicSettings(topicId, { systemPromptExtra: value.trim(), contextFiles, targetDate })
    setSaving(false)
    onClose()
  }

  return (
    // Scrim/escape dismissal is a deliberate no-op — an accidental click or
    // Escape must not discard in-progress instructions/context edits; use
    // the explicit Cancel/Save buttons in the footer instead.
    <Modal
      open
      onClose={() => {}}
      title="Topic settings"
      subtitle={topicTitle}
      wide
      footer={
        <>
          <div className="flex gap-2">
            <button onClick={onClose} className="focus-ring text-xs text-[var(--color-text-faint)] px-3 py-1.5">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !loaded}
              className="focus-ring text-xs text-[var(--color-ink-warm)] px-3 py-1.5 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <span className="kbd-hint">↵ save</span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm text-[var(--color-text-primary)]">Extra instructions for this topic</label>
          <p className="text-xs text-[var(--color-text-faint)]">
            Appended to the tutor’s system prompt every time you learn or review this topic. Example: “{EXAMPLE}”
          </p>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!loaded}
            rows={5}
            placeholder={EXAMPLE}
            className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)] resize-none disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[var(--color-text-primary)]">Initial context files</label>
          <p className="text-xs text-[var(--color-text-faint)]">
            Read by the tutor at the start of every fresh session for this topic (a syllabus, exam PDF, reference notes…).
          </p>
          {contextFiles.length > 0 && (
            <div className="flex flex-col gap-1">
              {contextFiles.map((path) => (
                <div key={path} className="flex items-center justify-between gap-2 panel px-3 py-1.5 text-xs">
                  <span className="text-[var(--color-text-primary)] truncate" title={path}>
                    {fileName(path)}
                  </span>
                  <button
                    onClick={() => removeFile(path)}
                    className="focus-ring shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-ink-danger)]"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={addFiles}
            disabled={!loaded}
            className="focus-ring self-start text-xs text-[var(--color-ink-warm)] hover:underline disabled:opacity-40"
          >
            + Add file…
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[var(--color-text-primary)]">Target date</label>
          <p className="text-xs text-[var(--color-text-faint)]">
            An optional deadline for this topic. While set, the Topic Map shows nodes remaining, days left, the pace
            that would close the gap, and the pace you've actually kept — arithmetic only, never a reminder or a
            notification. Clearing it removes the figure.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={targetDate ?? ''}
              onChange={(e) => setTargetDate(e.target.value || null)}
              disabled={!loaded}
              aria-label="Target date"
              className="focus-ring panel px-3 py-1.5 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)] disabled:opacity-50"
            />
            {targetDate && (
              <button
                onClick={() => setTargetDate(null)}
                className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-ink-danger)]"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
