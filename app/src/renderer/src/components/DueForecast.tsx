import { memo } from 'react'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Tomorrow's pull, visible today: seven thin ink bars of due counts over the
 * coming week (bucket 0 = today, overdue folded in). Computed renderer-side
 * from the topic graphs' own fsrs.due dates — the engine's `due` command has
 * no future horizon, but the graphs on disk already know. */
export const DueForecast = memo(function DueForecast({ buckets }: { buckets: number[] }) {
  const max = Math.max(...buckets, 1)
  const total = buckets.reduce((a, b) => a + b, 0)
  if (total === 0) {
    return <div className="fig-caption">nothing scheduled this week — the frontier awaits</div>
  }
  let peakIdx = 0
  for (let i = 1; i < buckets.length; i++) if (buckets[i] > buckets[peakIdx]) peakIdx = i
  const today = new Date()
  const peakDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + peakIdx)
  const flat = buckets.every((b) => b === buckets[0])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-1 h-8">
        {buckets.map((count, i) => (
          <div
            key={i}
            title={`${i === 0 ? 'today' : DAY_LABELS[new Date(today.getFullYear(), today.getMonth(), today.getDate() + i).getDay()]}: ${count} due`}
            className="w-3 rounded-t-sm"
            style={{
              height: `${Math.max(count > 0 ? 12 : 4, (count / max) * 100)}%`,
              background: i === 0 ? 'var(--color-ink-warm)' : 'var(--color-ink-cool-dim)',
              opacity: count > 0 ? 0.9 : 0.25,
            }}
          />
        ))}
      </div>
      <div className="label-data text-[10px] text-[var(--color-text-faint)]">
        today {buckets[0]}
        {!flat && peakIdx > 0 && ` · peak ${DAY_LABELS[peakDay.getDay()]} ${buckets[peakIdx]}`}
      </div>
    </div>
  )
})
