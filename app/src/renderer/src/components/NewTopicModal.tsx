import { useState } from 'react'
import { Modal } from './ui/Modal'
import { fileName } from './ChatMessageView'
import { PaperclipIcon } from './ui/icons'

interface NewTopicModalProps {
  onClose: () => void
  onStart: (goal: string, systemPromptExtra: string, contextFiles: string[]) => void
  /** Seeds the form on open — e.g. from an engram:// deep link, already
   * shape-guarded and filesystem-checked by main (see LearnSessionView's
   * modalPrefill). Prefill only: this modal still requires an explicit
   * Start click, same as a blank form — nothing here submits automatically. */
  initialGoal?: string
  initialInstructions?: string
  initialFiles?: string[]
  /** True when the initial values above came from OUTSIDE this app (an
   * engram:// deep link), not typed by the learner here. Drives three
   * review-gate changes — a visible provenance banner, a larger/resizable
   * review area for goal/instructions instead of the compact default (a
   * hostile 4000-char instructions value must not be able to hide content
   * below a 2-row fold), and full (not filename-truncated) context-file
   * paths — see the coordinator review this responds to for the concrete
   * attack this defends against: injected "standing instructions" padded
   * below the visible area of a small textarea. */
  externalOrigin?: boolean
  /** How many of the link's contextFiles entries were dropped by main's
   * filesystem validation (missing, wrong type, a symlink, a traversal
   * path, ...) — see shared/types.ts's NewTopicPrefill. Only meaningful
   * (and only rendered) when `externalOrigin` is true. */
  droppedContextFileCount?: number
  /** True while ANOTHER deep link arrived and was deliberately ignored
   * because this modal was already open (see LearnSessionView's
   * decideModalPrefillOnOpenSignal — the choice is to protect whatever the
   * learner may already be typing here over applying the newer link).
   * Read live from props every render (unlike goal/instructions/files,
   * which only ever seed once at mount) since it must update the ALREADY-
   * OPEN instance without a remount — that's the whole point of ignoring
   * the new prefill rather than applying it. Rendered regardless of
   * `externalOrigin`: the currently-shown content may be a manually-typed
   * blank form that a link arrived on top of, which is exactly the case
   * the learner most needs telling about. */
  newerLinkIgnored?: boolean
}

export function NewTopicModal({
  onClose,
  onStart,
  initialGoal,
  initialInstructions,
  initialFiles,
  externalOrigin,
  droppedContextFileCount,
  newerLinkIgnored,
}: NewTopicModalProps) {
  // Lazy initializers only — this component remounts fresh every time it
  // opens (see LearnSessionView's `{newTopicOpen && <NewTopicModal ... />}`),
  // so seeding state from props at mount time is enough; no effect needed
  // to re-sync on a later prop change.
  const [goal, setGoal] = useState(initialGoal ?? '')
  const [instructions, setInstructions] = useState(initialInstructions ?? '')
  const [files, setFiles] = useState<string[]>(initialFiles ?? [])

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
    // Cancel/Start buttons in the footer instead.
    <Modal
      open
      onClose={() => {}}
      title="Start a new topic"
      panelClassName={externalOrigin || newerLinkIgnored ? 'border-[var(--color-ink-warm-dim)]' : undefined}
      footer={
        <>
          <div className="flex gap-2">
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
          <span className="kbd-hint">↵ start</span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Provenance banner (Critical fix from coordinator review): this
            content was NOT typed by the learner in this window — it rode in
            on an engram:// link from another app. The learner must know
            that before reading anything below, since the fields read
            identically to a manually-typed form otherwise. Also carries the
            "a newer link arrived and was dropped" notice (NEW-2) when
            relevant — same visual treatment, same banner, so either or both
            can show without a second competing warning box. */}
        {(externalOrigin || newerLinkIgnored) && (
          <div className="panel px-3 py-2.5 flex flex-col gap-2 border-[var(--color-ink-warm-dim)] bg-[color-mix(in_srgb,var(--color-ink-warm)_8%,transparent)]">
            {externalOrigin && (
              <div className="flex items-start gap-2">
                <span aria-hidden className="text-[var(--color-ink-warm)] text-sm leading-none mt-0.5">
                  ⚠
                </span>
                <div className="text-xs text-[var(--color-ink-warm)] leading-relaxed">
                  <span className="font-medium">From an external link, not typed by you here.</span> Another
                  app (Observatory) sent this goal and instructions text. Read all of it — including
                  anything below the fold in the boxes below — before starting; nothing here runs
                  until you click Start.
                </div>
              </div>
            )}
            {newerLinkIgnored && (
              <div className="flex items-start gap-2">
                <span aria-hidden className="text-[var(--color-ink-warm)] text-sm leading-none mt-0.5">
                  ⚠
                </span>
                <div className="text-xs text-[var(--color-ink-warm)] leading-relaxed">
                  <span className="font-medium">A newer link just arrived and was NOT applied</span> — this
                  form stayed as you see it so nothing you’d already reviewed or typed gets overwritten.
                  Close this and re-open the link from Observatory if you want it instead.
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <div className="text-base text-[var(--color-text-primary)] mt-1">What do you want to learn?</div>
        </div>

        <p className="text-xs text-[var(--color-text-faint)]">
          Building the concept map takes a minute or two — the one slow step, then everything after is conversational.
          What do you want to be able to do with this, and by when (if there’s a deadline)?
        </p>

        <div className="flex flex-col gap-1">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={externalOrigin ? 6 : 4}
            autoFocus
            placeholder="e.g. “Understand special relativity well enough to derive time dilation from the postulates, for a qual exam in 6 weeks”"
            className={`focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] ${externalOrigin ? 'resize-y max-h-72' : 'resize-none'}`}
          />
          {externalOrigin && (
            <div className="text-[10px] text-[var(--color-text-faint)] text-right">
              {goal.length.toLocaleString()} characters — drag the corner to expand
            </div>
          )}
        </div>

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
            rows={externalOrigin ? 8 : 2}
            placeholder="e.g. “Use LaTeX for all equations; ground examples in rowing”"
            className={`focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] ${externalOrigin ? 'resize-y max-h-96' : 'resize-none'}`}
          />
          {externalOrigin && (
            <div className="text-[10px] text-[var(--color-text-faint)] text-right">
              {instructions.length.toLocaleString()} characters — drag the corner to expand
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-[var(--color-text-dim)]">Context files (optional) — syllabi, notes, past exams</div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((path) => (
                <span
                  key={path}
                  title={path}
                  className="label-data text-[10px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-dim)] inline-flex items-center gap-1"
                >
                  {/* Full absolute path when externally sourced — a
                      filename-only chip ("CLAUDE.md") hides which directory
                      a deep link pointed at (e.g. a dotfile under the
                      learner's home); a manually-picked file (via the
                      native file dialog below) is already something the
                      learner explicitly navigated to, so the shorter name
                      stays there. */}
                  <PaperclipIcon /> {externalOrigin ? path : fileName(path)}
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
          {externalOrigin && !!droppedContextFileCount && (
            <div className="text-[10px] text-[var(--color-ink-warm)]">
              {droppedContextFileCount} file{droppedContextFileCount === 1 ? '' : 's'} from the link couldn’t be
              included (missing, an unsupported type, or an unsafe path).
            </div>
          )}
          <button onClick={attach} className="focus-ring self-start text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] inline-flex items-center gap-1">
            <PaperclipIcon /> Attach files
          </button>
        </div>
      </div>
    </Modal>
  )
}
