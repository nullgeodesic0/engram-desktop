import type { ReactElement, ReactNode } from 'react'

export interface MainMenuNavItem {
  id: string
  label: string
  hint: string
  icon: ReactElement
}

export type Group = 'study' | 'track' | 'explore' | 'system'

/** Purpose grouping — every non-Home NAV id assigned, none left ungrouped.
 * Study (Learn, Review) is the daily-use core and leads with slightly larger
 * rows; Track (Grades, Coach), Explore (Topic Map, Artifacts), and System
 * (Settings) follow as quieter registers of the same plate. */
export const NAV_GROUPS: Record<string, Group> = {
  learn: 'study',
  review: 'study',
  grades: 'track',
  dashboard: 'track',
  topics: 'explore',
  artifacts: 'explore',
  settings: 'system',
}

export const GROUP_LABEL: Record<Group, string> = {
  study: 'Study',
  track: 'Track',
  explore: 'Explore',
  system: 'System',
}

export const GROUP_ORDER: Group[] = ['study', 'track', 'explore', 'system']

function NavIcon({ icon, size = 15 }: { icon: ReactElement; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--color-text-dim)] shrink-0"
      aria-hidden="true"
    >
      {icon}
    </svg>
  )
}

function ActivityDot({ busy }: { busy: boolean }) {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
      {busy && <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)] animate-consolidate-ping" />}
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-ink-warm)]" />
    </span>
  )
}

/** The sidebar's replacement — now ONE briefing plate in the exact grammar
 * ReadyRoomPlate established (the Review page's own card): a single
 * `tilt-card-soft panel` document, purpose groups as hairline-divided
 * registers, one ROW per section (icon + display-face name on the left, the
 * ⌘-hint in dim mono on the right), and each row's live teaser as the same
 * faint-mono indented second line the review plate uses for its due nodes'
 * names. Mounted as a section INSIDE HomeView — Home IS the menu ("the home
 * menu contains everything else accessible within it," per the user's own
 * framing); every other view returns via the single persistent title-bar
 * Home button.
 *
 * `.dogear` stays scarce by decree: only a row whose KeepMounted session is
 * actually alive right now earns the fold, reusing the app's existing
 * `activity`/`visited` state rather than inventing new tracking. */
export function MainMenuView({
  nav,
  teasers,
  activity,
  visited,
  onGoView,
}: {
  nav: MainMenuNavItem[]
  /** One line of richer content per section id — e.g. Learn's resumable
   * topic title, Review's due count, Grades' GPA letter. Absent/undefined
   * for a section with nothing worth teasing (Settings, by design). */
  teasers?: Partial<Record<string, ReactNode>>
  activity: Record<'learn' | 'review', { active: boolean; busy: boolean }>
  visited: Record<'learn' | 'review' | 'dashboard', boolean>
  onGoView: (id: string) => void
}) {
  // `home` is excluded outright — this plate IS the Home screen, and a
  // "Home" row pointing at the page you're already on is dead weight (it was
  // also silently landing in Explore via the `?? 'explore'` fallback, since
  // it never got a NAV_GROUPS assignment).
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: nav.filter((n) => n.id !== 'home' && (NAV_GROUPS[n.id] ?? 'explore') === group),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="tilt-card-soft panel px-6 py-6 flex flex-col gap-4">
      {grouped.map(({ group, items }, gi) => (
        <div key={group} className={`flex flex-col gap-1 ${gi > 0 ? 'pt-2' : ''}`}>
          {/* The TicketCard band's own register — warm tracked-uppercase with
              a hairline rule running out to the plate's edge — instead of a
              bare faint label that disappeared into the rows below it. The
              rule replaces the old border-t group divider (one line, doing
              both jobs, instead of two stacked ones). */}
          <div className="flex items-center gap-2.5 mb-1">
            <span className="label-data text-[10px] uppercase tracking-[0.28em] text-[var(--color-ink-warm)] shrink-0">
              {GROUP_LABEL[group]}
            </span>
            <span className="h-px flex-1 bg-[var(--color-hairline)]" aria-hidden="true" />
          </div>
          {items.map((n) => {
            const hero = group === 'study'
            const inProgress =
              (n.id === 'learn' || n.id === 'review' || n.id === 'dashboard') && visited[n.id as 'learn' | 'review' | 'dashboard']
            const pulsing = (n.id === 'learn' || n.id === 'review') && activity[n.id as 'learn' | 'review'].active
            return (
              <button
                key={n.id}
                onClick={() => onGoView(n.id)}
                // The same 1px edge line every card on this page draws
                // (`.panel`'s own border token) — a row is still a card,
                // just a full-width one inside the plate.
                className={`focus-ring relative text-left flex flex-col gap-0.5 px-3 py-2 border border-[var(--color-edge)] hover:bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] transition-colors duration-[var(--dur-fast)] ${
                  inProgress ? 'dogear' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <NavIcon icon={n.icon} size={hero ? 18 : 15} />
                    <span
                      className={`font-(family-name:--font-display) text-[var(--color-text-primary)] truncate ${hero ? 'text-base' : 'text-sm'}`}
                    >
                      {n.label}
                    </span>
                    {pulsing && <ActivityDot busy={activity[n.id as 'learn' | 'review'].busy} />}
                  </div>
                  <span className="label-data text-[10px] text-[var(--color-text-dim)] shrink-0">⌘{n.hint}</span>
                </div>
                {/* The review plate's own second-line register — faint mono,
                    indented past the icon, truncating — the same treatment
                    its due nodes' names get. */}
                {teasers?.[n.id] !== undefined && (
                  <div
                    className={`label-data text-[var(--color-text-dim)] truncate ${hero ? 'pl-[26px] text-[11px]' : 'pl-[23px] text-[10px]'}`}
                  >
                    {teasers[n.id]}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      ))}
      <div className="fig-caption">every part of the atlas, grouped by purpose</div>
    </div>
  )
}
