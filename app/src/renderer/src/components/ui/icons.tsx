/** Small stroked-SVG glyphs replacing color emoji as UI content — same
 * conventions as TopicCard.tsx's RefreshIcon/GearIcon: 16px, viewBox 0 0 16
 * 16, `currentColor` stroke at 1.4, round caps/joins, no fill. Emoji render
 * in whatever font/skin-tone/color the OS supplies and clash with the
 * app's own narrow-band ink palette; these instead inherit the surrounding
 * text color like every other icon in the app already does. */

export function PaperclipIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M11.5 4.5 6.2 9.8a2.2 2.2 0 0 0 3.1 3.1l5.1-5.1a3.6 3.6 0 0 0-5.1-5.1L3.9 8.1a5 5 0 0 0 7.1 7.1"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A pen nib over a short baseline — the handwriting-attach action. */
export function HandwritingIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10.6 2.4a1.7 1.7 0 0 1 2.4 2.4L5.6 12.2l-3 .8.8-3z"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M2.5 14.5h11" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
    </svg>
  )
}

/** An open-armed ring — the app's own mark vocabulary (marks.ts) already
 * uses a plain ring for "settled"/consolidated state; this is that same
 * shape read as a trophy body, so an unlocked achievement stays in the
 * app's own visual language rather than borrowing an emoji's. */
export function TrophyIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 3h6v3.2A3 3 0 0 1 8 9.2 3 3 0 0 1 5 6.2z"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <path d="M5 4H3.2A1.2 1.2 0 0 0 2 5.2v.3A2.5 2.5 0 0 0 4.5 8" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
      <path d="M11 4h1.8A1.2 1.2 0 0 1 14 5.2v.3A2.5 2.5 0 0 1 11.5 8" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
      <path d="M8 9.2V12M5.5 14h5M6.3 12h3.4" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
    </svg>
  )
}

export function LockIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x={3.2} y={7.2} width={9.6} height={7} rx={0} stroke="currentColor" strokeWidth={1.3} />
      <path d="M5.2 7.2V5a2.8 2.8 0 0 1 5.6 0v2.2" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  )
}
