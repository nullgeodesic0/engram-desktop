import type { ReactNode } from 'react'

/** "n/m" stat readout — bold-primary numerator over a faint denominator
 * (see `.stat-fraction`/`.frac-n`/`.frac-d` in index.css). Used directly in
 * topicShelf chips, queue counts, banner counts, NodeTable; StatBlock also
 * parses `n/m`-shaped values into this same markup so existing callers
 * upgrade without touching their call sites (see StatBlock.tsx). */
export function StatFraction({
  n,
  d,
  className = '',
}: {
  n: ReactNode
  d: ReactNode
  className?: string
}) {
  return (
    <span className={`stat-fraction ${className}`}>
      <span className="frac-n">{n}</span>
      <span className="frac-slash">/</span>
      <span className="frac-d">{d}</span>
    </span>
  )
}
