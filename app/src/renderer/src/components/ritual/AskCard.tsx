import { memo, useMemo, useRef, useState } from 'react'
import { useFocusTrap } from '../useFocusTrap'
import { MathRenderer } from '../MathRenderer'
import { isCheckpointHeader, parseCheckpointHeader } from '../../shared/checkpointHeader'

/** FNV-1a over the ask's own text — a STABLE seed, so one ask keeps one
 * order across re-renders, resume, and history replay (Math.random would
 * reshuffle under the learner's cursor on every state change). */
function askSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Fisher–Yates under a tiny LCG from the seed. Checkpoint asks only: models
 * put the correct option first far too often for a knowledge check to
 * survive it (observed live on day one — position was the tell). Answers
 * travel by LABEL, never index, so display order is the app's to own; the
 * tutor is told (overlay) to never reference options by position. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let state = seed || 1
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface AskCardOption {
  label: string
  description?: string
}

// Positional gradient stop for the confidence picker — index 0 (least
// confident) reads cool, the last option reads warm. Purely a color cue on
// top of the dialogue-grammar's fixed option order (never reordered here).
// Ported verbatim from the retired AskDialog.tsx modal.
const CONFIDENCE_STYLE = [
  { icon: '○', color: 'var(--color-ink-cool)' },
  { icon: '◔', color: 'var(--color-ink-cool)' },
  { icon: '◕', color: 'var(--color-ink-warm)' },
  { icon: '●', color: 'var(--color-ink-warm)' },
]

/** Chat Presence Wave E, Task 11 — the bridge:ask prompt as an in-transcript
 * card, replacing the old blocking `AskDialog` modal. The blocking contract
 * hasn't moved an inch: bridgeServer.ts still holds the tutor's HTTP response
 * open until `answerBridgeQuestion` resolves it (see that file's doctrine
 * comment) — only WHERE the question is drawn has changed, from an overlay to
 * a card that sits in the conversation like the rest of it.
 *
 * Three renderable states, driven by the mark's own `answer`/`live` (see
 * RitualMark's doctrine comment in Marks.tsx for exactly what each combination
 * means):
 *   - OPEN (`live && answer === null`) — interactive: the Confidence picker's
 *     2×2 icon grid (detected by `header === 'Confidence'`, exact match, same
 *     as the retired modal) or a generic option list + "Other…" free-text
 *     fallback. Faithfully ported interaction — a single click on an option
 *     answers immediately, same as the modal always did (this codebase's
 *     `multiSelect` flag has never actually driven a real multi-select UI;
 *     the modal ignored it too, so this is parity, not a regression).
 *   - ANSWERED (`answer !== null`) — settles into a quiet record: header,
 *     question, and the chosen answer(s) (or "skipped" for an explicit
 *     decline) — a filled-in form field in a lab notebook, not a decision
 *     still being litigated.
 *   - ORPHANED (`!live && answer === null`) — a replayed transcript whose ask
 *     never got an answer before the session that opened it ended. Rendered
 *     honestly as "no answer was given," never a pulsing "still waiting" —
 *     the HTTP promise behind it is long dead; nothing here could ever
 *     resolve it.
 *
 * Focus/keyboard: while OPEN, `useFocusTrap` (the same hook the old Modal
 * shell used for AskDialog and every other dialog in this app) moves focus
 * into the card the instant it mounts and cycles Tab within it — so it reads
 * as "the thing you must attend to" without a physical overlay. Escape is
 * deliberately NOT wired to anything here (no `onClose` exists to call): the
 * ask is blocking, same as the modal's own deliberate no-op `onClose`. */
export const AskCard = memo(function AskCard({
  header,
  question,
  options,
  answer,
  live,
  onAnswer,
}: {
  header: string
  question: string
  options: AskCardOption[]
  answer: string[] | null
  live: boolean
  /** Present only when this card can actually be answered right now — i.e.
   * the live session views wire it in; SessionHistoryDrawer's replay never
   * passes it (see MarkView's doctrine comment). Even when present, AskCard
   * only ever calls it while the card is genuinely OPEN. */
  onAnswer?: (chosen: string[] | null) => void
}) {
  const [otherText, setOtherText] = useState('')
  const [showOther, setShowOther] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const isConfidence = header === 'Confidence'
  // A checkpoint-chain step (the overlay's mandated `Checkpoint k/n` header)
  // — cool ink, because a pick is recognition-grade evidence, the same
  // register as not-yet nodes. Confidence's exact match above always wins;
  // the two sniffs are disjoint by construction (checkpointHeader.ts).
  const checkpoint = !isConfidence ? parseCheckpointHeader(header) : null
  const isCheckpoint = !isConfidence && isCheckpointHeader(header)
  const isOpen = live && answer === null
  const isOrphaned = !live && answer === null
  const headerInk = isCheckpoint ? 'text-[var(--color-ink-cool)]' : 'text-[var(--color-ink-warm)]'
  // Checkpoint options render in a seeded-shuffled order (see seededShuffle's
  // doctrine comment) — everything else keeps the tutor's own order (the
  // confidence picker's band order is semantic and must never move).
  const displayOptions = useMemo(
    () => (isCheckpoint ? seededShuffle(options, askSeed(`${header}${question}`)) : options),
    [isCheckpoint, options, header, question],
  )

  useFocusTrap(containerRef, isOpen)

  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div
        ref={containerRef}
        tabIndex={-1}
        role={isOpen ? 'group' : undefined}
        aria-label={isOpen ? `${header}: ${question}` : undefined}
        className={`tilt-card-soft max-w-[92%] flex flex-col gap-3 rounded-md border px-4 py-3 ${
          isOpen ? 'ask-card-pending' : 'ask-card-settle'
        }`}
        style={{ borderColor: isOpen ? (isCheckpoint ? 'var(--color-ink-cool-dim)' : 'var(--color-ink-warm-dim)') : 'var(--color-hairline)' }}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`label-data text-[10px] tracking-[0.14em] ${headerInk}`}>
              {header.toUpperCase()}
            </span>
            {checkpoint && (
              <span
                className="label-data text-[9px] tracking-[0.14em] px-1.5 py-px border shrink-0"
                style={{
                  color: 'var(--color-ink-cool)',
                  borderColor: 'var(--color-ink-cool-dim)',
                  background: 'color-mix(in srgb, var(--color-ink-cool) 16%, transparent)',
                }}
              >
                {checkpoint.step}/{checkpoint.total}
              </span>
            )}
          </div>
          <MathRenderer text={question} inlineOnly className="text-sm text-[var(--color-text-primary)]" />
        </div>

        {isOpen && !showOther && (
          isConfidence ? (
            <div className="grid grid-cols-2 gap-2">
              {options.map((opt, i) => {
                const style = CONFIDENCE_STYLE[i] ?? CONFIDENCE_STYLE[CONFIDENCE_STYLE.length - 1]
                return (
                  <button
                    key={opt.label}
                    onClick={() => onAnswer?.([opt.label])}
                    className="focus-ring panel px-3 py-3 flex flex-col items-center gap-1.5 text-center hover:bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] hover:border-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-base)]"
                  >
                    <span className="text-lg leading-none" aria-hidden="true" style={{ color: style.color }}>
                      {style.icon}
                    </span>
                    <div className="text-sm text-[var(--color-text-primary)]">{opt.label}</div>
                    {opt.description && <div className="text-xs text-[var(--color-text-dim)]">{opt.description}</div>}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {displayOptions.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => onAnswer?.([opt.label])}
                  className={`focus-ring panel px-4 py-2.5 text-left hover:bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] transition-colors duration-[var(--dur-base)] ${
                    isCheckpoint ? 'hover:border-[var(--color-ink-cool-dim)]' : 'hover:border-[var(--color-ink-warm-dim)]'
                  }`}
                >
                  <MathRenderer text={opt.label} inlineOnly className="text-sm text-[var(--color-text-primary)]" />
                  {opt.description && (
                    <MathRenderer text={opt.description} inlineOnly className="text-xs text-[var(--color-text-dim)] mt-0.5" />
                  )}
                </button>
              ))}
              <button
                onClick={() => setShowOther(true)}
                className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] mt-1 text-left"
              >
                Other…
              </button>
            </div>
          )
        )}

        {isOpen && showOther && (
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder="Type an answer, or leave blank to skip"
              className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)]"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => onAnswer?.(null)} className="focus-ring text-xs text-[var(--color-text-faint)] px-3 py-1.5">
                Skip
              </button>
              <button
                onClick={() => onAnswer?.(otherText ? [otherText] : null)}
                className="focus-ring text-xs text-[var(--color-ink-warm)] px-3 py-1.5"
              >
                Submit
              </button>
            </div>
          </div>
        )}

        {!isOpen && answer !== null && (
          // The chosen label is option text and option text is routinely
          // LaTeX-laden (checkpoint distractors especially: "$\{Q,P\}$
          // brackets preserved") — it goes through the same renderer the
          // options themselves used, or the settled record shows raw TeX
          // right under a typeset question.
          <div className="fig-caption">
            {answer.length > 0 ? (
              <span className="inline-flex items-baseline gap-1 flex-wrap">
                chosen: <MathRenderer text={answer.join(', ')} inlineOnly className="inline" />
              </span>
            ) : (
              'skipped'
            )}
          </div>
        )}
        {isOrphaned && <div className="fig-caption text-[var(--color-text-faint)]">no answer was given</div>}
      </div>
    </div>
  )
})
