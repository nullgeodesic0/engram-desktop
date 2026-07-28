import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** A 32px hit target around a 16px stroked-SVG glyph — the app's one shape
 * for icon-only affordances (topic-card settings/refresh, dismiss buttons,
 * etc.), replacing ad-hoc text-glyph buttons (⚙, ↻, ×) with real SVG icons
 * at a consistent size. Per index.css's interaction-vocabulary comment
 * (L267-281): icon buttons get color-only hover at --dur-fast, never
 * background/border choreography — the app-wide button press scale and
 * --dur-fast color transition already come from the global `button` rule
 * (index.css), so this component applies automatically and adds nothing
 * beyond the hover color itself. */
export function IconButton({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      className={`focus-ring shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
