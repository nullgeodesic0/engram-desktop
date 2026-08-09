/** A row of mutually-exclusive toggles. `aria-pressed` marks the live one
 * (a toggle group, not a listbox — every option is visible and one click
 * commits, so the pressed-button semantic is the honest one).
 *
 * `ariaLabelledBy`/`ariaLabel` name the GROUP: without one, a screen reader
 * announces four unrelated buttons ("Due", "A–Z", …) with no clue what they
 * order. Optional so the existing settings call sites, which sit under their
 * own visible row labels, keep rendering exactly as before. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  ariaLabelledBy,
}: {
  options: { value: T; label: string; description?: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel?: string
  ariaLabelledBy?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      // No `overflow-hidden`. It was clipping `.focus-ring`'s 2px outline on
      // the first and last segment — the same trap index.css documents for the
      // frame vocabulary, arriving here through `outline` instead of a
      // pseudo-element. Radii are zeroed app-wide by decree, so nothing needed
      // clipping to a rounded corner in the first place.
      className="inline-flex rounded-lg border border-[var(--color-hairline)]"
    >
      {options.map((o) => (
        <button
          key={o.value}
          title={o.description}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`focus-ring px-3 py-1.5 text-xs transition-colors ${
            o.value === value
              ? 'bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] text-[var(--color-ink-warm)]'
              : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
