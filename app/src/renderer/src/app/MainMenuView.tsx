import type { ReactElement, ReactNode } from 'react'

export interface MainMenuNavItem {
  id: string
  label: string
  hint: string
  icon: ReactElement
}

type Group = 'study' | 'track' | 'explore' | 'system'

/** Purpose grouping — every non-Home NAV id assigned, none left ungrouped.
 * Study (Learn, Review) is the daily-use core and gets hero-sized tiles;
 * Track (Grades, Coach) and Explore (Topic Map, Artifacts) get the standard
 * tile grid; System (Settings) is a single quiet row, not a card — it's not
 * a "usage" surface the way the others are. */
const NAV_GROUPS: Record<string, Group> = {
  learn: 'study',
  review: 'study',
  grades: 'track',
  dashboard: 'track',
  topics: 'explore',
  artifacts: 'explore',
  settings: 'system',
}

const GROUP_LABEL: Record<Group, string> = {
  study: 'Study',
  track: 'Track',
  explore: 'Explore',
  system: 'System',
}

const GROUP_ORDER: Group[] = ['study', 'track', 'explore', 'system']

function NavIcon({ icon, size = 22 }: { icon: ReactElement; size?: number }) {
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
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {busy && <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)] animate-consolidate-ping" />}
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-ink-warm)]" />
    </span>
  )
}

/** The sidebar's replacement — a grid of large glass nav cards, mounted as
 * a section INSIDE HomeView (not its own routed screen — Home IS the menu:
 * "the home menu contains everything else accessible within it," per the
 * user's own framing, and every other view gets back to it via the single
 * persistent title-bar Home button, not a separate menu destination).
 *
 * Grouped by purpose (Study/Track/Explore/System, see NAV_GROUPS above) with
 * Study rendered as larger hero tiles — the user's own critique of the first
 * version ("ad hoc... not intelligently designed") asked for richer
 * per-card content, visual hierarchy, AND grouping together, not any one
 * alone. `teasers` carries that richer content per section (computed in
 * HomeView, kept out of this component so it stays presentational). The
 * currently-alive KeepMounted session (if any) gets its `.dogear`
 * (active-state corner-fold, reserved for exactly this by house-style
 * decree) so the hub itself signals "you have a session in progress here,"
 * reusing the app's existing `activity`/`visited` state rather than
 * inventing new tracking. */
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
  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: nav.filter((n) => (NAV_GROUPS[n.id] ?? 'explore') === group),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-col gap-5">
      {grouped.map(({ group, items }) => (
        <div key={group} className="flex flex-col gap-2">
          <span className="label-data text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">{GROUP_LABEL[group]}</span>
          {group === 'system' ? (
            <div className="flex flex-col gap-1.5">
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onGoView(n.id)}
                  className="panel px-4 py-2.5 flex items-center gap-3 text-left frame-hover"
                >
                  <NavIcon icon={n.icon} size={16} />
                  <span className="text-sm text-[var(--color-text-primary)]">{n.label}</span>
                  <span className="label-data text-[10px] text-[var(--color-text-faint)] ml-auto">⌘{n.hint}</span>
                </button>
              ))}
            </div>
          ) : (
            // `items-start` — the fix for the "dead real estate" the flat
            // stretch-to-tallest-row-member default produced: a card with a
            // one-word teaser ("D") no longer gets forced to the same height
            // as a sibling with a full sentence, leaving a visible gap of
            // nothing between the teaser and the ⌘-hint. Every card now sizes
            // to its own content, same as ReadyRoomPlate's own plate does.
            <div className={`grid grid-cols-1 items-start ${group === 'study' ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'} gap-4`}>
              {items.map((n) => {
                const inProgress = (n.id === 'learn' || n.id === 'review' || n.id === 'dashboard') && visited[n.id as 'learn' | 'review' | 'dashboard']
                const pulsing = (n.id === 'learn' || n.id === 'review') && activity[n.id as 'learn' | 'review'].active
                const hero = group === 'study'
                return (
                  <button
                    key={n.id}
                    onClick={() => onGoView(n.id)}
                    className={`tilt-card panel-raised text-left frame-hover flex flex-col gap-2 ${
                      hero ? 'px-6 py-6' : 'px-5 py-5'
                    } ${inProgress ? 'dogear' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <NavIcon icon={n.icon} size={hero ? 26 : 22} />
                      {pulsing && <ActivityDot busy={activity[n.id as 'learn' | 'review'].busy} />}
                    </div>
                    <div className={`font-(family-name:--font-display) text-[var(--color-text-primary)] ${hero ? 'text-xl' : 'text-lg'}`}>
                      {n.label}
                    </div>
                    {/* Same register as ReadyRoomPlate's own `.fig-caption`
                        ("a normal sitting covers about 12, most-overdue
                        first") — a quiet serif-italic aside, never a bold
                        colored stat-block readout competing with the label
                        above it. */}
                    {teasers?.[n.id] !== undefined && <div className="fig-caption">{teasers[n.id]}</div>}
                    <div className="label-data text-[10px] text-[var(--color-text-faint)] pt-1">⌘{n.hint}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
