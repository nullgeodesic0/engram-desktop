import type { ReactElement } from 'react'

export interface MainMenuNavItem {
  id: string
  label: string
  hint: string
  icon: ReactElement
}

/** The sidebar's replacement — a grid of large glass nav cards, mounted as
 * a section INSIDE HomeView (not its own routed screen — Home IS the menu:
 * "the home menu contains everything else accessible within it," per the
 * user's own framing, and every other view gets back to it via the single
 * persistent title-bar Home button, not a separate menu destination). One
 * card per section; the currently-alive KeepMounted session (if any) gets
 * its `.dogear` (active-state corner-fold, reserved for exactly this by
 * house-style decree) so the hub itself signals "you have a session in
 * progress here," reusing the app's existing `activity`/`visited` state
 * rather than inventing new tracking. */
export function MainMenuView({
  nav,
  dueCount,
  activity,
  visited,
  onGoView,
}: {
  nav: MainMenuNavItem[]
  dueCount: number | null
  activity: Record<'learn' | 'review', { active: boolean; busy: boolean }>
  visited: Record<'learn' | 'review' | 'dashboard', boolean>
  onGoView: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {nav.map((n) => {
          const inProgress = (n.id === 'learn' || n.id === 'review' || n.id === 'dashboard') && visited[n.id as 'learn' | 'review' | 'dashboard']
          const pulsing = (n.id === 'learn' || n.id === 'review') && activity[n.id as 'learn' | 'review'].active
          return (
            <button
              key={n.id}
              onClick={() => onGoView(n.id)}
              className={`tilt-card panel-raised px-5 py-6 flex flex-col gap-3 text-left frame-hover ${inProgress ? 'dogear' : ''}`}
            >
              <div className="flex items-center justify-between">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[var(--color-text-dim)]"
                  aria-hidden="true"
                >
                  {n.icon}
                </svg>
                {pulsing && (
                  <span className="relative inline-flex h-2 w-2 shrink-0">
                    {activity[n.id as 'learn' | 'review'].busy && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)] animate-consolidate-ping" />
                    )}
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-ink-warm)]" />
                  </span>
                )}
              </div>
              <div className="font-(family-name:--font-display) text-lg text-[var(--color-text-primary)]">{n.label}</div>
              {n.id === 'review' && dueCount != null && dueCount > 0 && (
                <div className="figure-display text-[var(--color-ink-warm)] text-2xl">{dueCount}</div>
              )}
              <div className="label-data text-[10px] text-[var(--color-text-faint)] mt-auto">⌘{n.hint}</div>
            </button>
          )
      })}
    </div>
  )
}
