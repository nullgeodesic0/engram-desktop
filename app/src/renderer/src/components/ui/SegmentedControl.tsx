export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; description?: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--color-hairline)] overflow-hidden">
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
