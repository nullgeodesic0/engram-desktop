/** A model-suggested next step surfaced via the suggest_action bridge:ui tool —
 * ghost chips above the composer. Acting on one never sends anything by itself;
 * at most it prefills the composer (see LearnSessionView's handleSuggestedAction) —
 * the human still has to hit send. */
export type SuggestedAction = {
  label: string
  kind: 'open_explorable' | 'show_on_map' | 'go_review' | 'prefill'
  arg?: string
}

export function ActionChips({
  actions,
  onAct,
}: {
  actions: SuggestedAction[]
  onAct: (a: SuggestedAction) => void
}) {
  if (actions.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="fig-caption shrink-0">the tutor suggests —</span>
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={() => onAct(a)}
          className="focus-ring rounded-full border border-[var(--color-hairline)] px-3 py-1 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-ink-warm)] hover:border-[var(--color-ink-warm-dim)]"
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
