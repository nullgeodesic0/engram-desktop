export function ProviderModelBadge({ provider, model, className = '' }: { provider: string; model: string; className?: string }) {
  const label = `${provider} · ${model}`
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1 border border-[var(--color-edge)] bg-[color-mix(in_srgb,var(--color-surface-1)_88%,transparent)] px-1.5 py-0.5 label-data text-[9px] uppercase tracking-[0.12em] text-[var(--color-text-faint)] ${className}`}
      title={label}
      aria-label={label}
    >
      <span className="shrink-0 text-[var(--color-text-dim)]">{provider}</span>
      <span aria-hidden="true">·</span>
      <span className="truncate normal-case tracking-normal">{model}</span>
    </span>
  )
}
