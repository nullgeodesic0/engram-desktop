const STEPS: { key: string; label: string; icon: string }[] = [
  { key: 'open_gap', label: 'Gap', icon: '◆' },
  { key: 'predict', label: 'Predict', icon: '?' },
  { key: 'struggle', label: 'Hint', icon: '△' },
  { key: 'resolve', label: 'Resolve', icon: '●' },
  { key: 'self_explain', label: 'Explain', icon: '»' },
  { key: 'connect', label: 'Connect', icon: '↝' },
  { key: 'verify', label: 'Verify', icon: '✓' },
]

export type BeatOutcome = 'visited' | 'confirmed' | 'partial' | 'missed'

/** A persistent strip showing where the current node's dialogue-grammar walk is —
 * gap → predict → struggle → resolve → self-explain → connect → verify — since
 * scrollback alone doesn't answer "how far along am I." Best-effort, same as the
 * beat cards themselves: an unrecognized/mid-transition state just shows nothing
 * lit, never a wrong claim.
 *
 * `trail` inks non-current beats already visited within THIS node's walk (reset
 * at every node crossing) by how they resolved: `confirmed` (bright warm),
 * `partial`/`visited` (dim warm — a step was taken but no outcome landed yet),
 * `missed` (danger). Beats absent from the trail keep the plain dim default —
 * same "never claim what we don't know" posture as the rest of this strip. */
export function BeatStepper({ current, trail }: { current: string | null; trail?: Map<string, BeatOutcome> }) {
  const idx = STEPS.findIndex((s) => s.key === current)
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {STEPS.map((s, i) => {
        const active = i === idx
        const outcome = !active ? trail?.get(s.key) : undefined
        const outcomeClass =
          outcome === 'confirmed'
            ? 'text-[var(--color-ink-warm)]'
            : outcome === 'partial' || outcome === 'visited'
              ? 'text-[var(--color-ink-warm-dim)]'
              : outcome === 'missed'
                ? 'text-[var(--color-ink-danger)]'
                : 'text-[var(--color-text-faint)]'
        return (
          <div key={s.key} className="flex items-center gap-1 shrink-0">
            <div
              title={s.label}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] label-data transition-colors duration-[var(--dur-base)] ${
                active ? 'bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]' : outcomeClass
              }`}
            >
              <span className="relative inline-flex w-4 shrink-0 justify-center">
                {active && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)] opacity-40 animate-consolidate-ping" />
                )}
                <span className="relative">{s.icon}</span>
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <span className="w-3 h-px bg-[var(--color-hairline)] shrink-0" />}
          </div>
        )
      })}
    </div>
  )
}
