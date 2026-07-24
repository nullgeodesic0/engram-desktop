/** A branching hairline — replaces straight rules under section headers.
 * One main axon line with two short dendrite branches, rendered at a fixed
 * size on the left; the stretch to fill the container width comes from the
 * adjacent `h-px flex-1` div, so the branch geometry stays undistorted. */
export function DendriteDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-0 ${className}`} aria-hidden="true">
      <svg width="46" height="10" viewBox="0 0 46 10" fill="none" className="shrink-0">
        <path
          d="M0 5 H18 M18 5 C24 5 26 2 32 1.5 M18 5 C25 5.5 28 8 34 8.5 M32 1.5 C36 1.2 38 2.5 41 2 M34 8.5 C38 8.8 41 7.5 45 8"
          stroke="var(--color-hairline)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle cx="18" cy="5" r="1.6" fill="var(--color-text-faint)" />
      </svg>
      <div className="h-px flex-1 bg-[var(--color-hairline)]" />
    </div>
  )
}
