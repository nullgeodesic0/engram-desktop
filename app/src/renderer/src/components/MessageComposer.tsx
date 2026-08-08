import { useMemo } from 'react'
import { MarkdownPreview } from './MarkdownPreview'
import { LatexEditor } from './LatexEditor'
import { fileName } from './ChatMessageView'
import { CTRL_QUIET, ctrlFilled, type EnvAccent } from '../shared/controlChrome'
import { scanLatex, describeScan } from '../shared/latexSyntax'
import { countUnicodeMath, unicodeToLatex } from '../shared/latexEditing'

interface MessageComposerProps {
  production: string
  onProductionChange: (v: string) => void
  attachedFiles: string[]
  onRemoveAttachment: (path: string) => void
  onAttach: () => void
  /** The handwriting flow — deliberately its OWN control rather than a file
   * type the generic paperclip happens to accept. The two do different things:
   * the paperclip hands the tutor a document to read for context, while this
   * asks for the learner's own work to be transcribed and returned for their
   * confirmation. Collapsing them into one button would hide a gate behind a
   * file extension. Omitted (and the button hidden) where there is no session
   * to ask. */
  onAttachHandwriting?: () => void
  markdownPreview: boolean
  onToggleMarkdownPreview: () => void
  onSubmit: () => void
  placeholder?: string
  /** Recall-chamber state (Task 7): when set, this composer offers a toggle that blurs
   * the transcript above it so free recall can't peek back at prior turns. Omit both
   * chamber props entirely to opt a call site out of the chamber button. */
  chamber?: boolean
  onChamberChange?: (on: boolean) => void
  /** Pulses the toggle to invite entry (e.g. at a verify beat) without forcing it. */
  inviteChamber?: boolean
  /** The honest-blank affordance (Task 2): a ghost button that prefills the composer
   * with an admission of "I don't know" and focuses it. Never submits — the rite and
   * assessor handle absolution, not this button. Caller (ReviewSessionView) owns the
   * 45s timer and passes null when it shouldn't show; omit entirely to opt out. */
  assist?: { label: string; onUse: () => void } | null
  /** Chat Presence Wave D Task 10 — a quiet, factual line naming why sending
   * would be premature right now ("the tutor is mid-thought", "the assessor
   * is examining your work", …), driven by `shared/tutorActivity.ts`'s
   * `composerDisabledReason`. `null`/omitted renders nothing and changes no
   * other behavior — this is additive labeling, never a new blocking gate of
   * its own (both session views still decide separately whether the composer
   * mounts at all). Never scolding: it names what's happening, not what the
   * learner should or shouldn't do. */
  disabledReason?: string | null
  /** Environment chrome identity (shared/controlChrome.ts) — Learn's warm is
   * the default, Review passes 'cool'. Colors only the FILLED chrome (Submit,
   * an active toggle); quiet controls stay neutral either way. */
  accent?: EnvAccent
}

/** The response box shared by Learn and Review: attachment chips, a textarea that
 * optionally splits into a live Markdown+LaTeX preview pane, and the attach/preview
 * toggle/submit row — the whole unit framed by one `--color-edge` border.
 *
 * The frame carries NO fill or blur of its own (nested-glass rule: the
 * textarea's own `.panel` supplies the glass, and stacking a second wash
 * would muddy it) and NO tilt — a plane that leans under a live caret is
 * hostile to typing. Controls speak the shared control-chrome idiom:
 * quiet bordered cards at rest, the environment's filled accent for Submit
 * and any toggle currently on. Kept as one component so both session views
 * stay in sync. */
export function MessageComposer({
  production,
  onProductionChange,
  attachedFiles,
  onRemoveAttachment,
  onAttach,
  onAttachHandwriting,
  markdownPreview,
  onToggleMarkdownPreview,
  onSubmit,
  placeholder = 'Your answer…',
  chamber,
  onChamberChange,
  inviteChamber,
  assist,
  disabledReason,
  accent = 'warm',
}: MessageComposerProps) {
  const filled = ctrlFilled(accent)

  function submit() {
    onSubmit()
    onChamberChange?.(false)
  }

  function useAssist() {
    if (!assist) return
    assist.onUse()
  }

  // The delimiter scan still drives the composer's own status row and the
  // unicode offer; the caret model itself now lives inside LatexEditor.
  const scan = useMemo(() => scanLatex(production), [production])
  const status = useMemo(() => describeScan(scan), [scan])
  const unicodeCount = useMemo(() => countUnicodeMath(production), [production])
  const mathMode = scan.tokens.length > 0

  return (
    <div className="shrink-0 flex flex-col gap-2 border border-[var(--color-edge)] p-3">
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachedFiles.map((path) => (
            <span
              key={path}
              title={path}
              className="label-data text-[10px] px-1.5 py-0.5 border border-[var(--color-edge)] bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] text-[var(--color-text-dim)] flex items-center gap-1"
            >
              📎 {fileName(path)}
              <button
                onClick={() => onRemoveAttachment(path)}
                aria-label={`Remove attachment ${fileName(path)}`}
                className="focus-ring hover:text-[var(--color-ink-danger)]"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </span>
          ))}
        </div>
      )}
      {chamber && <div className="fig-caption">recall chamber — nothing to look back at</div>}
      {!chamber && disabledReason && (
        <div key={disabledReason} className="fig-caption activity-label-in">
          {disabledReason}
        </div>
      )}
      <div className={markdownPreview ? 'grid grid-cols-2 gap-3 w-full' : 'w-full'}>
        <div className="relative w-full panel text-sm">
          <LatexEditor
            value={production}
            onChange={onProductionChange}
            onSubmit={() => {
              if (production.trim()) submit()
            }}
            placeholder={placeholder}
            ariaLabel={placeholder}
            minRows={chamber ? 12 : markdownPreview ? 8 : 4}
            className="focus-ring px-4 py-3"
          />
        </div>
        {markdownPreview && (
          <div className="panel px-4 py-3 overflow-y-auto" style={{ maxHeight: '13rem' }}>
            <MarkdownPreview source={production} />
          </div>
        )}
      </div>

      {/* Transparency row — what the parser sees, in one line. Silent until
          there is math to say something about. */}
      {(status || unicodeCount > 0) && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {status ? (
            <span
              className={`fig-caption ${scan.problems.length > 0 ? 'text-[var(--color-ink-danger)]' : ''}`}
            >
              {status}
            </span>
          ) : (
            <span />
          )}
          {mathMode && scan.problems.length === 0 && (
            <span className="fig-caption hidden sm:inline">⇥ out of group · ⌘\\ match · ⌥↑ expand</span>
          )}
          {unicodeCount > 0 && (
            <button
              onClick={() => onProductionChange(unicodeToLatex(production))}
              title="Rewrite pasted unicode maths (ħ, ∂, ≥) as LaTeX so it sets as real math"
              className={CTRL_QUIET}
            >
              ∂ → \partial · convert {unicodeCount}
            </button>
          )}
        </div>
      )}
      <div className="detail-footer pt-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={onAttach} title="Attach files for the tutor to read for context" className={CTRL_QUIET}>
            📎 Attach
          </button>
          {onAttachHandwriting && (
            <button
              onClick={onAttachHandwriting}
              title="Photograph your handwritten work — it comes back as LaTeX for you to check before it counts"
              className={CTRL_QUIET}
            >
              ✍️ Handwriting
            </button>
          )}
          <button
            onClick={onToggleMarkdownPreview}
            title="Toggle a live rendered preview of your answer (Markdown + LaTeX) alongside the input"
            aria-pressed={markdownPreview}
            className={markdownPreview ? filled : CTRL_QUIET}
          >
            ◧ Preview
          </button>
          {onChamberChange && (
            <button
              onClick={() => onChamberChange(!chamber)}
              title="A blurred transcript, so recall comes from you, not the page above"
              aria-pressed={chamber}
              className={`${chamber ? filled : CTRL_QUIET} ${inviteChamber && !chamber ? 'chamber-invite' : ''}`}
            >
              {chamber ? '✕ Leave chamber' : '◐ Begin recall'}
            </button>
          )}
          {assist && (
            <button
              onClick={useAssist}
              title="Prefills an honest blank — you still have to send it yourself"
              className={CTRL_QUIET}
            >
              {assist.label}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="kbd-hint">⌘⏎</span>
          <button
            onClick={submit}
            disabled={!production.trim() || !!disabledReason}
            className={`${filled} disabled:opacity-40`}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}
