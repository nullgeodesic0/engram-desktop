import { useState } from 'react'
import { Modal } from './ui/Modal'
import { fileName } from './ChatMessageView'

interface NewTopicModalProps {
  onClose: () => void
  onStart: (goal: string, systemPromptExtra: string, contextFiles: string[]) => void
}

export function NewTopicModal({ onClose, onStart }: NewTopicModalProps) {
  const [goal, setGoal] = useState('')
  const [instructions, setInstructions] = useState('')
  const [files, setFiles] = useState<string[]>([])

  function submit() {
    if (!goal.trim()) return
    onStart(goal.trim(), instructions.trim(), files)
  }

  async function attach() {
    const picked = await window.engram.pickFiles()
    setFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  return (
    // Scrim/escape dismissal is a deliberate no-op — an accidental click or
    // Escape must not discard the goal text already typed; use the explicit
    // Cancel/Start buttons below instead.
    <Modal open onClose={() => {}} title="Start a new topic">
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-base text-[var(--color-text-primary)] mt-1">What do you want to learn?</div>
        </div>

        <p className="text-xs text-[var(--color-text-faint)]">
          Building the concept map takes a minute or two — the one slow step, then everything after is conversational.
          What do you want to be able to do with this, and by when (if there’s a deadline)?
        </p>

        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={4}
          autoFocus
          placeholder="e.g. “Understand special relativity well enough to derive time dilation from the postulates, for a qual exam in 6 weeks”"
          className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)] resize-none"
        />

        {/* Same two levers the per-topic settings expose after creation
            (TopicSettingsModal) — offered up front so the curriculum itself
            can be built with them. They persist as the topic's settings once
            the engine mints the topic id (see LearnSessionView's
            pendingNewTopicSettings). */}
        <div className="flex flex-col gap-1">
          <div className="text-xs text-[var(--color-text-dim)]">Topic instructions (optional)</div>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder="e.g. “Use LaTeX for all equations; ground examples in rowing”"
            className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)] resize-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-[var(--color-text-dim)]">Context files (optional) — syllabi, notes, past exams</div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((path) => (
                <span
                  key={path}
                  title={path}
                  className="label-data text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-dim)] inline-flex items-center gap-1"
                >
                  📎 {fileName(path)}
                  <button
                    onClick={() => setFiles((prev) => prev.filter((p) => p !== path))}
                    aria-label={`Remove ${fileName(path)}`}
                    className="focus-ring no-press text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <button onClick={attach} className="focus-ring self-start text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]">
            📎 Attach files
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="focus-ring text-xs text-[var(--color-text-faint)] px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!goal.trim()}
            className="focus-ring text-xs text-[var(--color-ink-warm)] px-3 py-1.5 disabled:opacity-40"
          >
            Start
          </button>
        </div>
      </div>
    </Modal>
  )
}
