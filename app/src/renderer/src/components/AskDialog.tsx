import { useState } from 'react'
import type { BridgeAskRequest } from '../../../shared/bridgeProtocol'
import { Modal } from './ui/Modal'

interface AskDialogProps {
  request: BridgeAskRequest
  onAnswer: (chosen: string[] | null) => void
}

// Positional gradient stop for the confidence picker — index 0 (least
// confident) reads cool, the last option reads warm. Purely a color cue on
// top of the dialogue-grammar's fixed option order (never reordered here).
const CONFIDENCE_STYLE = [
  { icon: '○', color: 'var(--color-ink-cool)' },
  { icon: '◔', color: 'var(--color-ink-cool)' },
  { icon: '◕', color: 'var(--color-ink-warm)' },
  { icon: '●', color: 'var(--color-ink-warm)' },
]

/**
 * Renders a bridge:ask request. Detects the dialogue-grammar's fixed
 * Confidence picker by header === "Confidence" (exact match per
 * dialogue-grammar.md's ⚠ Confidence integrity spec) and gives it its own
 * calmer treatment; anything else (session logistics, mode choice, amnesty
 * offers) falls back to a generic menu — never a text-input picker, per the
 * grammar's "menus for navigation, never for knowledge" rule.
 */
export function AskDialog({ request, onAnswer }: AskDialogProps) {
  const [otherText, setOtherText] = useState('')
  const [showOther, setShowOther] = useState(false)
  const isConfidence = request.header === 'Confidence'

  return (
    <Modal
      open
      onClose={() => {}}
      title={request.header}
      panelClassName={isConfidence ? 'border-[var(--color-ink-warm-dim)]' : ''}
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-base text-[var(--color-text-primary)] mt-1">{request.question}</div>
        </div>

        {!showOther ? (
          isConfidence ? (
            <div className="grid grid-cols-2 gap-2">
              {request.options.map((opt, i) => {
                const style = CONFIDENCE_STYLE[i] ?? CONFIDENCE_STYLE[CONFIDENCE_STYLE.length - 1]
                return (
                  <button
                    key={opt.label}
                    onClick={() => onAnswer([opt.label])}
                    className="focus-ring panel px-3 py-3 flex flex-col items-center gap-1.5 text-center hover:bg-[var(--color-surface-3)] hover:border-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-base)]"
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
              {request.options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => onAnswer([opt.label])}
                  className="focus-ring panel px-4 py-2.5 text-left hover:bg-[var(--color-surface-3)] hover:border-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-base)]"
                >
                  <div className="text-sm text-[var(--color-text-primary)]">{opt.label}</div>
                  {opt.description && <div className="text-xs text-[var(--color-text-dim)] mt-0.5">{opt.description}</div>}
                </button>
              ))}
              <button
                onClick={() => setShowOther(true)}
                className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] mt-1 text-left px-4"
              >
                Other…
              </button>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder="Type an answer, or leave blank to skip"
              className="focus-ring panel px-3 py-2 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)]"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => onAnswer(null)}
                className="focus-ring text-xs text-[var(--color-text-faint)] px-3 py-1.5"
              >
                Skip
              </button>
              <button
                onClick={() => onAnswer(otherText ? [otherText] : null)}
                className="focus-ring text-xs text-[var(--color-ink-warm)] px-3 py-1.5"
              >
                Submit
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
