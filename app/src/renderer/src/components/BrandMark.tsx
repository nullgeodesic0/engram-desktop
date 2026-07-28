/** The neuron brand mark — the app icon's Cajal neuron miniaturized: lavender
 * dendrites reaching into a pair of concept nodes (the cream one is a
 * consolidated memory, same vocabulary as the icon and the Topic Map), with
 * the soma carrying the app's existing amber consolidate-ping — the same
 * "surviving signal" pulse the old dot-only mark had, now with the neuron it
 * belongs to. Shared by the sidebar brand header (App.tsx) and BootSplash so
 * the two lockups can never drift apart. */
export function NeuronMark({ size = 22 }: { size?: number }) {
  // Soma center lives at (9.5, 14.5) in the 24-unit viewBox; the ping dot is
  // positioned over it in percentage space so any `size` keeps them aligned.
  const dot = Math.max(6, Math.round(size * 0.3))
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="absolute inset-0">
        {/* Two-segment branches taper (thick near soma, thin at tip) — the
            same matte tapered-dendrite language as the icon and the sidebar
            footer, at glyph scale. */}
        <g stroke="var(--color-ink-lavender)" strokeLinecap="round">
          <path d="M10.5 12.8 C11.2 11.2 11.8 9.8 12.6 8.4" strokeWidth="1.7" />
          <path d="M12.6 8.4 C13.2 7.5 13.6 6.9 14 6.4" strokeWidth="1" />
          <path d="M8.2 13 C7.4 11.7 6.8 10.9 6.1 10" strokeWidth="1.7" />
          <path d="M6.1 10 C5.6 9.4 5.2 9 4.9 8.7" strokeWidth="1" />
          <path d="M10 12.6 C9.7 11.2 9.5 10.1 9.4 8.9" strokeWidth="1.2" />
          <path d="M9.4 8.9 C9.3 8.1 9.3 7.5 9.3 6.9" strokeWidth="0.7" />
          <path d="M11.8 16 C14.5 17.8 17.5 18.4 21.5 19" strokeWidth="1.5" />
        </g>
        <circle cx="14.8" cy="4.9" r="1.8" fill="var(--color-ink-paper)" />
        <circle cx="4.1" cy="7.3" r="1.4" fill="var(--color-ink-lavender)" />
      </svg>
      <span
        className="absolute"
        style={{ left: '39.6%', top: '60.4%', transform: 'translate(-50%, -50%)', width: dot, height: dot }}
      >
        <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)] animate-consolidate-ping" />
        <span className="relative inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)]" />
      </span>
    </span>
  )
}
