/** Thumb tack in the ink language: flat head, shoulder, needle — lies at a
 * tilt when loose, stands upright and fills when driven in. Shared by the
 * session ticket and the masthead pin toggles. */
export function PinTackIcon({ pinned, size = 12 }: { pinned: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g transform={pinned ? undefined : 'rotate(-35 8 8)'}>
        <path
          d="M5.4 2.5 H10.6 L9.7 6.2 H6.3 Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          fill={pinned ? 'currentColor' : 'none'}
        />
        <path d="M4.6 6.2 H11.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M8 6.2 V13.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </g>
    </svg>
  )
}
