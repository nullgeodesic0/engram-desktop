import { useState } from 'react'

/** Copy-to-clipboard affordance shared by dialogue prose (BeatCard/PlainDialogueBlock,
 * hover-revealed via the parent's `group` class) and onboarding's copyable install
 * commands (always visible — there's no natural "hover the row" cue in a guided
 * setup card, and the whole point is that the command is copyable exactly). */
export function CopyButton({ text, alwaysVisible = false }: { text: string; alwaysVisible?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      title="Copy"
      className={`focus-ring no-press ${alwaysVisible ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-[var(--dur-fast)] shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] text-xs`}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}
