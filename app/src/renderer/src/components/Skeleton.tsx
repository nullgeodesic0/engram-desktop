/** Shimmering placeholder blocks for loading states — echoes the app's particle
 * motif (a soft warm sweep) rather than a generic gray pulse. */
export function SkeletonBar({ width = '100%', height = 12 }: { width?: string | number; height?: number }) {
  return <div className="skeleton rounded" style={{ width, height }} />
}

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="panel px-4 py-3 flex flex-col gap-2">
      <SkeletonBar width="45%" height={10} />
      <SkeletonBar width="70%" height={18} />
      {lines > 2 && <SkeletonBar width="55%" height={10} />}
    </div>
  )
}

export function SkeletonGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
