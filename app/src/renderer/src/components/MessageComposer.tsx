import { useMemo, useRef, useState } from 'react'
import { MarkdownPreview } from './MarkdownPreview'
import { LatexHighlightOverlay } from './LatexHighlightOverlay'
import { fileName } from './ChatMessageView'
import { CTRL_QUIET, ctrlFilled, type EnvAccent } from '../shared/controlChrome'
import { scanLatex, describeScan } from '../shared/latexSyntax'
import { onInsert, onBackspace, onCompletion, countUnicodeMath, unicodeToLatex } from '../shared/latexEditing'

interface MessageComposerProps {
  production: string
  onProductionChange: (v: string) => void
  attachedFiles: string[]
  onRemoveAttachment: (path: string) => void
  onAttach: () => void
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const filled = ctrlFilled(accent)

  // ── LaTeX editing surface ────────────────────────────────────────────────
  // `caret` drives only the match emphasis, so it is state rather than a ref;
  // null while unfocused, because an unfocused box glowing at a pair nobody
  // is looking at is just noise.
  const [caret, setCaret] = useState<number | null>(null)
  const scan = useMemo(() => scanLatex(production), [production])
  const status = useMemo(() => describeScan(scan), [scan])
  const unicodeCount = useMemo(() => countUnicodeMath(production), [production])
  // The highlighter only earns its keep once there IS math — before that it
  // would paint an ordinary sentence's parens, and the whole point of the
  // colour is that it means "you are inside an expression."
  const mathMode = scan.tokens.length > 0

  /** Apply a pure edit from shared/latexEditing.ts and restore the selection
   * the rule asked for. React controls the value, so the DOM selection has to
   * be set after the commit — `requestAnimationFrame` rather than a
   * `useEffect` keyed on the value, which would also fire for ordinary typing
   * and fight the caret. */
  function applyEdit(result: { text: string; selStart: number; selEnd: number }) {
    onProductionChange(result.text)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.setSelectionRange(result.selStart, result.selEnd)
      setCaret(result.selStart)
    })
  }

  function syncCaret() {
    const el = textareaRef.current
    if (el) setCaret(el.selectionStart)
  }

  function submit() {
    onSubmit()
    onChamberChange?.(false)
  }

  function useAssist() {
    if (!assist) return
    assist.onUse()
    // Prefill lands via the parent's state update; focus right away rather than
    // waiting on it — the value is already what onUse just set.
    textareaRef.current?.focus()
  }

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
        {/* The mirror and the textarea are siblings in one positioned box so
            they share a font context — see LatexHighlightOverlay's contract. */}
        <div className="relative w-full panel text-sm">
          {mathMode && <LatexHighlightOverlay text={production} caret={caret} />}
          <textarea
            ref={textareaRef}
            value={production}
            onChange={(e) => {
              onProductionChange(e.target.value)
              setCaret(e.target.selectionStart)
            }}
            onSelect={syncCaret}
            onClick={syncCaret}
            onFocus={syncCaret}
            onBlur={() => setCaret(null)}
            onScroll={(e) => {
              // Keep the mirror pinned to the textarea's scroll — it has
              // `overflow: hidden`, so this is the only thing moving it.
              const pre = e.currentTarget.previousElementSibling as HTMLElement | null
              if (pre?.classList.contains('latex-mirror')) {
                pre.scrollTop = e.currentTarget.scrollTop
                pre.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`
              }
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                if (production.trim()) submit()
                return
              }
              if (e.key === 'Escape') {
                ;(e.target as HTMLTextAreaElement).blur()
                return
              }
              // Editing aids never fight a modifier chord — ⌘V, ⌘A, ⌥←
              // must all behave exactly as they always have.
              if (e.metaKey || e.ctrlKey || e.altKey) return
              const el = e.currentTarget
              const state = { text: production, selStart: el.selectionStart, selEnd: el.selectionEnd }
              if (e.key === 'Backspace') {
                const r = onBackspace(state)
                if (r) {
                  e.preventDefault()
                  applyEdit(r)
                }
                return
              }
              if (e.key.length !== 1) return
              const r = onInsert(state, e.key)
              if (r) {
                e.preventDefault()
                applyEdit(r)
                return
              }
              // Completions read the text as it will be AFTER this key, so
              // they run on the projected state rather than the current one.
              const projected = {
                text: state.text.slice(0, state.selStart) + e.key + state.text.slice(state.selEnd),
                selStart: state.selStart + 1,
                selEnd: state.selStart + 1,
              }
              const c = onCompletion(projected, e.key)
              if (c) {
                e.preventDefault()
                applyEdit(c)
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            rows={chamber ? 12 : markdownPreview ? 8 : 4}
            className={`focus-ring px-4 py-3 text-sm resize-none w-full bg-transparent ${
              mathMode ? 'latex-input-transparent' : 'text-[var(--color-text-primary)]'
            }`}
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
          {unicodeCount > 0 && (
            <button
              onClick={() => applyEdit({ text: unicodeToLatex(production), selStart: production.length, selEnd: production.length })}
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
          <button onClick={onAttach} title="Attach files" className={CTRL_QUIET}>
            📎 Attach
          </button>
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
