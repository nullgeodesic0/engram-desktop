/** Three staggered pulsing dots, replacing the old static "…" busy text.
 * `label` names who's working, in the fig-caption voice — defaults to the
 * tutor since that's the common case (Learn, Review); callers with a
 * different actor (Coach) pass their own. */
export function TypingIndicator({ label = 'the tutor is writing…' }: { label?: string } = {}) {
  return (
    <div className="flex items-center gap-2 px-1 py-2" aria-label={label}>
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[var(--color-ink-warm)] animate-bounce"
            style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
          />
        ))}
      </div>
      <span className="fig-caption">{label}</span>
    </div>
  )
}
