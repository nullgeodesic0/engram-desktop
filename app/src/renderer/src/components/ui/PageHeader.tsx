import type { ReactNode } from 'react'

/** One page grammar for every view's title — Fraunces `--text-display`,
 * matching HomeView's greeting (the app's one h1 that was already this
 * voice; see HomeView.tsx's `<h1>`). Optional dim body-size subtitle,
 * optional right-aligned cluster (stat chips, session controls, a search
 * box) for the views whose header carries more than a title. Applied to the
 * six "simple" view headers (TopicMap, Dashboard, Settings, ArtifactGallery,
 * Review, Home already matched); Learn's collapsing masthead keeps its own
 * grid machinery and just borrows the same type treatment in place. */
export function PageHeader({
  title,
  subtitle,
  right,
  className = '',
}: {
  title: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <header className={`flex items-center justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h1 className="font-[var(--font-serif)] text-[length:var(--text-display)] text-[var(--color-text-primary)]">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-[var(--color-text-dim)] mt-1">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-3 shrink-0">{right}</div>}
    </header>
  )
}
