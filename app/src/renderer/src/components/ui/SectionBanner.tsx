import type { ReactNode } from 'react'

/** Extreme-tracked section header — mono, uppercase, hairline rules above
 * and below (see `.section-banner`/`.banner-count` in index.css). Reads as
 * a plate divider ("REVIEWS — 4/12") rather than a heading; `count` is
 * right-aligned in tighter tracking so it reads as a readout, not a label. */
export function SectionBanner({
  label,
  count,
  className = '',
}: {
  label: string
  count?: ReactNode
  className?: string
}) {
  return (
    <div className={`section-banner ${className}`}>
      <span>{label}</span>
      {count !== undefined && <span className="banner-count">{count}</span>}
    </div>
  )
}
