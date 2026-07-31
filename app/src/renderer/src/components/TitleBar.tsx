import { useState } from 'react'
import { GROUP_LABEL, GROUP_ORDER, NAV_GROUPS, type MainMenuNavItem } from '../app/MainMenuView'

const DOTS: { key: 'close' | 'min' | 'zoom'; color: string; glyph: string; label: string }[] = [
  { key: 'close', color: 'var(--color-ink-danger)', glyph: 'M3.5 3.5 8.5 8.5 M8.5 3.5 3.5 8.5', label: 'Close window' },
  { key: 'min', color: 'var(--color-ink-warm)', glyph: 'M3 6 H9', label: 'Minimize window' },
  { key: 'zoom', color: 'var(--color-ink-cool)', glyph: 'M6 3 V9 M3 6 H9', label: 'Toggle fullscreen' },
]

/** Fully-frameless custom chrome: drag region + hand-drawn ink traffic dots.
 * The dots stay visible in fullscreen too — with frame:false there are no
 * native controls to defer to, so ours are the only pointer path out (the
 * (+) dot toggles fullscreen). Double-click on the bar maximizes, matching
 * native title-bar zoom.
 *
 * `onGoHome` — the ONE persistent affordance that survives the sidebar's
 * removal. Home IS the menu now (see HomeView.tsx's own nav-grid section) —
 * a sidebar is a persistent LIST of destinations, this is a single button
 * back to the one screen that contains links to everything else, which is
 * not the same thing. It's the "get back to the hub from deep inside a
 * Learn/Review session without losing your place" path, a plain view switch
 * that never touches KeepMounted state. Optional so this component still
 * renders standalone (e.g. a future secondary window) without wiring it.
 *
 * `nav`/`onGoView`/`currentView` — the quick-switch dropdown beside the
 * Home button, shown only when NOT on Home (on Home the Sections grid
 * itself is the navigation; a second menu there would just duplicate the
 * page). Same section registry the palette and Sections grid read (App's
 * NAV), same goToView path, so KeepMounted sessions survive a switch. */
export function TitleBar({
  onGoHome,
  nav,
  onGoView,
  currentView,
}: {
  onGoHome?: () => void
  nav?: MainMenuNavItem[]
  onGoView?: (id: string) => void
  currentView?: string
} = {}) {
  const [hovered, setHovered] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

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
        <span className="font-(family-name:--font-serif) text-xs text-[var(--color-text-dim)] tracking-wide">Engram</span>
      </div>
      <div className="ml-auto flex items-center gap-1.5 relative app-no-drag">
        {/* Quick-switch dropdown — only away from Home (Home's own Sections
            grid IS the navigation there). */}
        {nav && onGoView && currentView !== 'home' && (
          <>
            <button
              onClick={() => setNavOpen((v) => !v)}
              aria-label="Switch section"
              aria-expanded={navOpen}
              title="Switch section"
              className="focus-ring no-press h-6 w-6 flex items-center justify-center text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
                <path d="M5 8l5 5 5-5" />
              </svg>
            </button>
            {navOpen && (
              <>
                {/* Click-outside catcher — transparent, beneath the menu. */}
                <button aria-hidden="true" tabIndex={-1} onClick={() => setNavOpen(false)} className="fixed inset-0 z-40 cursor-default" />
                <div
                  role="menu"
                  // Always warm — global shell chrome sits outside any
                  // environment, so the dropdown never takes a session's
                  // cool identity.
                  className="absolute right-0 top-8 z-50 panel-raised border border-[var(--color-edge)] py-1 min-w-52 flex flex-col"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setNavOpen(false)
                  }}
                >
                  {GROUP_ORDER.map((group, gi) => {
                    // Same registry the Home Sections plate reads — the
                    // dropdown is that plate in miniature, purpose groups
                    // and all (home itself filtered out: it has its own
                    // button beside this menu).
                    const items = nav.filter((n) => n.id !== 'home' && (NAV_GROUPS[n.id] ?? 'explore') === group)
                    if (items.length === 0) return null
                    return (
                      <div key={group} className={gi > 0 ? 'border-t border-[var(--color-hairline)] mt-1 pt-1' : ''}>
                        <div className="label-data text-[9px] uppercase tracking-[0.28em] text-[var(--color-text-faint)] px-3 pt-1 pb-0.5">
                          {GROUP_LABEL[group]}
                        </div>
                        {items.map((n) => {
                          const active = n.id === currentView
                          return (
                            <button
                              key={n.id}
                              role="menuitem"
                              onClick={() => {
                                setNavOpen(false)
                                onGoView(n.id)
                              }}
                              className={`focus-ring tilt-card-rail w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:text-[var(--color-ink-warm)] transition-colors duration-[var(--dur-fast)] ${
                                active
                                  ? 'text-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-ink-warm)_10%,transparent)] shadow-[inset_2px_0_0_var(--color-ink-warm-dim)]'
                                  : 'text-[var(--color-text-primary)]'
                              }`}
                            >
                              <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-80" aria-hidden="true">
                                {n.icon}
                              </svg>
                              <span className="font-(family-name:--font-display) truncate">{n.label}</span>
                              <span className="label-data text-[10px] text-[var(--color-text-faint)] ml-auto">⌘{n.hint}</span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
        {onGoHome && (
          <button
            onClick={onGoHome}
            aria-label="Home"
            title="Home"
            className="focus-ring no-press h-6 w-6 flex items-center justify-center rounded text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
              <path d="M3 9.5 10 3l7 6.5M5 8v8h10V8" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
