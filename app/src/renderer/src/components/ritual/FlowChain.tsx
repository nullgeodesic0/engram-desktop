import { memo } from 'react'

const MAX_LINKS = 6

/** The sitting's flow made visible: one ink link per consecutive recall,
 * shown from the second link on. A miss never "breaks" anything on screen —
 * the chain simply unrenders and a new one begins when flow returns. */
export const FlowChain = memo(function FlowChain({ chain }: { chain: number }) {
  if (chain < 2) return null
  const links = Math.min(chain, MAX_LINKS)
  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={`${chain} recalled in a row`}
      aria-label={`${chain} recalled in a row`}
    >
      <svg width={links * 9 + 4} height="12" viewBox={`0 0 ${links * 9 + 4} 12`} aria-hidden="true">
        {Array.from({ length: links }, (_, i) => (
          <ellipse
            key={i}
            cx={7 + i * 9}
            cy="6"
            rx="5"
            ry="3.2"
            transform={`rotate(${i % 2 === 0 ? 24 : -24} ${7 + i * 9} 6)`}
            stroke="var(--color-ink-warm)"
            strokeWidth="1.1"
            fill="none"
            className={i === links - 1 ? 'chain-link-in' : undefined}
            opacity={0.85}
          />
        ))}
      </svg>
      {chain > MAX_LINKS && (
        <span className="label-data text-[10px] text-[var(--color-ink-warm)]">×{chain}</span>
      )}
    </span>
  )
})
