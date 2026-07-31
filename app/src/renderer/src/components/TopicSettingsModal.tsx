import { useEffect, useState } from 'react'
import { Modal } from './ui/Modal'

interface TopicSettingsModalProps {
  topicId: string
  topicTitle: string
  onClose: () => void
  /** Course Automation H1 — saves current settings (so contextFiles are on
   * disk for the fresh session's injection to read), closes, then launches
   * the procedure-layer extend sitting (see LearnSessionView's
   * startPracticeExtendForTopic). Optional so other hosts can omit it. */
  onAddPractice?: () => void
}

const EXAMPLE = 'Use LaTeX ($...$ for inline, $$...$$ for display) for every equation and mathematical expression.'

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

export function TopicSettingsModal({ topicId, topicTitle, onClose, onAddPractice }: TopicSettingsModalProps) {
  const [value, setValue] = useState('')
  const [contextFiles, setContextFiles] = useState<string[]>([])
  const [targetDate, setTargetDate] = useState<string | null>(null)
  const [displayTitle, setDisplayTitle] = useState('')
  // The engine's own generated title, for the rename field's reference line —
  // `topicTitle` (the prop) may already BE a rename, so it can't serve as
  // "what the engine calls this". getTopicsCached preserves the original as
  // `engineTitle` whenever a rename is active.
  const [engineTitle, setEngineTitle] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.engram.getTopicSettings(topicId).then((s) => {
      setValue(s.systemPromptExtra)
      setContextFiles(s.contextFiles)
      setTargetDate(s.targetDate ?? null)
      setDisplayTitle(s.displayTitle ?? '')
      setLoaded(true)
    })
    window.engram.topics().then((list) => {
      const entry = list.find((t) => t.topic === topicId)
      if (entry) setEngineTitle(entry.engineTitle ?? entry.title)
    })
  }, [topicId])

  async function addFiles() {
    const picked = await window.engram.pickFiles()
    setContextFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  function removeFile(path: string) {
    setContextFiles((prev) => prev.filter((p) => p !== path))
  }

  async function persist(files: string[] = contextFiles) {
    setSaving(true)
    await window.engram.setTopicSettings(topicId, {
      systemPromptExtra: value.trim(),
      contextFiles: files,
      targetDate,
      displayTitle: displayTitle.trim() || null,
    })
    setSaving(false)
  }

  async function save() {
    await persist()
    onClose()
  }

  // The practice flow's whole point is building from the learner's own
  // materials — so with NO reference files registered, this opens the file
  // browser first (textbook / problem sets), and cancelling the picker
  // cancels the launch. Files then persist BEFORE the sitting spawns (the
  // fresh session's contextFiles injection reads from disk).
  async function addPractice() {
    if (!onAddPractice) return
    let files = contextFiles
    if (files.length === 0) {
      const picked = await window.engram.pickFiles()
      if (picked.length === 0) return
      files = picked
      setContextFiles(picked)
    }
    await persist(files)
    onClose()
    onAddPractice()
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
        </>
      }
    >
      <div
        className="flex flex-col gap-4"
        // The footer's "↵ save" kbd-hint chip promised this and nothing
        // implemented it — a bordered key-cap that LOOKS like a second Save
        // button but did nothing when clicked or pressed (reported live as
        // "two save buttons, only one clickable"). Enter now genuinely
        // saves from any single-line field; inside the textarea plain Enter
        // must keep inserting newlines, so ⌘/Ctrl+Enter saves from there.
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || saving || !loaded) return
          const inTextarea = (e.target as HTMLElement).tagName === 'TEXTAREA'
          if (inTextarea && !(e.metaKey || e.ctrlKey)) return
          e.preventDefault()
          void save()
        }}
      >
        <div className="flex flex-col gap-2">
          <label className="text-sm text-[var(--color-text-primary)]">Display name</label>
          <p className="text-xs text-[var(--color-text-faint)]">
            Shown across the app in place of the engine’s generated title. Display only — the engine’s own records
            never change. Leave empty to use the engine’s title.
          </p>
          <input
            type="text"
            value={displayTitle}
            onChange={(e) => setDisplayTitle(e.target.value)}
            disabled={!loaded}
            placeholder={engineTitle ?? topicTitle}
            className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] disabled:opacity-50"
          />
          {engineTitle && displayTitle.trim() && (
            <div className="label-data text-[10px] text-[var(--color-text-faint)] truncate" title={engineTitle}>
              engine’s title: {engineTitle}
            </div>
          )}
        </div>

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
            className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] resize-none disabled:opacity-50"
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

        {onAddPractice && (
          <div className="flex flex-col gap-2">
            <label className="text-sm text-[var(--color-text-primary)]">Problem practice</label>
            <p className="text-xs text-[var(--color-text-faint)]">
              Extends this topic with procedure skills for working real problems, built from the reference files
              above (your textbook and problem sets). Reviews then serve fresh problem instances for those skills —
              everything already learned keeps its schedule exactly as is.
            </p>
            {contextFiles.length === 0 && (
              <p className="fig-caption">
                you’ll be asked to pick your textbook or problem-set files first — the extension reads them.
              </p>
            )}
            <button
              onClick={addPractice}
              disabled={!loaded || saving}
              className="focus-ring self-start text-xs text-[var(--color-ink-warm)] hover:underline disabled:opacity-40"
            >
              + Add problem practice…
            </button>
          </div>
        )}

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
              className="focus-ring panel px-3 py-1.5 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] disabled:opacity-50"
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
