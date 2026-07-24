import type { ButtonHTMLAttributes } from 'react'

const VARIANT: Record<string, string> = {
  primary:
    'bg-[var(--color-ink-warm)] text-[var(--color-void)] hover:bg-[var(--color-ink-hot)] font-medium',
  ghost:
    'border border-[var(--color-hairline)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-faint)] bg-transparent',
  danger:
    'border border-[var(--color-ink-danger-dim)] text-[var(--color-ink-danger)] hover:bg-[var(--color-ink-danger-dim)]/30 bg-transparent',
}

export function Button({
  variant = 'ghost',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={`focus-ring rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  )
}
