import { useState } from 'react'

const DOTS: { key: 'close' | 'min' | 'zoom'; color: string; glyph: string; label: string }[] = [
  { key: 'close', color: 'var(--color-ink-danger)', glyph: 'M3.5 3.5 8.5 8.5 M8.5 3.5 3.5 8.5', label: 'Close window' },
  { key: 'min', color: 'var(--color-ink-warm)', glyph: 'M3 6 H9', label: 'Minimize window' },
  { key: 'zoom', color: 'var(--color-ink-cool)', glyph: 'M6 3 V9 M3 6 H9', label: 'Toggle fullscreen' },
]

/** Fully-frameless custom chrome: drag region + hand-drawn ink traffic dots.
 * The dots stay visible in fullscreen too — with frame:false there are no
 * native controls to defer to, so ours are the only pointer path out (the
 * (+) dot toggles fullscreen). Double-click on the bar maximizes, matching
 * native title-bar zoom. */
export function TitleBar() {
  const [hovered, setHovered] = useState(false)

  function act(key: 'close' | 'min' | 'zoom') {
    if (key === 'close') window.engram.windowClose()
    else if (key === 'min') window.engram.windowMinimize()
    else window.engram.windowZoom()
  }

  return (
    <div
      // Glass sweep: tier-1 alpha (74%), no backdrop-blur — this bar sits in
      // normal flow at the top of the window frame, nothing scrolls or
      // drifts behind it, so a blur would smooth nothing and just cost GPU.
      className="app-drag shrink-0 h-9 flex items-center px-3 gap-3 border-b border-[var(--color-hairline)] bg-[color-mix(in_srgb,var(--color-surface)_62%,transparent)]"
      onDoubleClick={() => window.engram.windowMaximize()}
    >
      <div
        className="app-no-drag flex items-center gap-2"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {DOTS.map((d) => (
          <button
            key={d.key}
            aria-label={d.label}
            onClick={() => act(d.key)}
            className="focus-ring no-press h-3.5 w-3.5 rounded-full flex items-center justify-center"
            style={{ background: 'transparent', border: `1.2px solid ${d.color}` }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ opacity: hovered ? 1 : 0 }}>
              <path d={d.glyph} stroke={d.color} strokeWidth="1.3" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 pointer-events-none select-none">
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-ink-warm)]" />
        </span>
        <span className="font-[var(--font-serif)] text-xs text-[var(--color-text-dim)] tracking-wide">Engram</span>
      </div>
    </div>
  )
}
