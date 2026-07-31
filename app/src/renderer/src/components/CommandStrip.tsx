import { GROUP_LABEL, GROUP_ORDER, NAV_GROUPS, type MainMenuNavItem } from '../app/MainMenuView'

/** The command strip — the always-available navigation band under the title
 * bar. A slim tracked-uppercase tab row in the glass grammar: HOME leads,
 * then the purpose groups (Study / Track / Explore / System) divided by
 * vertical hairline rules, Settings seated quietly at the right edge.
 *
 * Deliberately HIDDEN on Home (App gates the render): Home's Sections grid
 * IS the navigation there, and a second copy of the same registry would just
 * shout. Everywhere else it renders as app chrome ABOVE <main>, which is
 * what keeps it visible above the chat mastheads — including while a
 * masthead is folded mid-sitting.
 *
 * Glass tier matches the TitleBar (74%-ish color-mix, no backdrop-blur —
 * this band sits at the top of the frame in normal flow; nothing ever
 * scrolls behind it, so a blur would smooth nothing and just cost GPU).
 * Tabs ride the rail tilt tier (small chrome tilts MORE, by standing
 * decree). Navigation goes through the same goToView path every other nav
 * surface uses, so KeepMounted sessions survive a switch by construction. */
export function CommandStrip({
  nav,
  currentView,
  onGoView,
  activity,
  dueCount,
}: {
  nav: MainMenuNavItem[]
  currentView: string
  onGoView: (id: string) => void
  /** App's live-session state — the warm "a sitting is alive in there" dot
   * the old sidebar carried, revived on the Learn/Review tabs. */
  activity: Record<'learn' | 'review', { active: boolean; busy: boolean }>
  /** Engine due count (null until first read) — badges the Review tab. */
  dueCount: number | null
}) {
  const home = nav.find((n) => n.id === 'home')

  function tab(n: MainMenuNavItem) {
    const active = n.id === currentView
    const live = n.id === 'learn' || n.id === 'review' ? activity[n.id] : null
    return (
      <button
        key={n.id}
        onClick={() => onGoView(n.id)}
        className={`focus-ring tilt-card-rail label-data text-[10px] uppercase tracking-[0.2em] px-3 py-2 inline-flex items-center gap-1.5 transition-colors duration-[var(--dur-fast)] ${
          active
            ? 'text-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-ink-warm)_10%,transparent)] shadow-[inset_0_-2px_0_var(--color-ink-warm-dim)]'
            : 'text-[var(--color-text-dim)] hover:text-[var(--color-ink-warm)]'
        }`}
      >
        {n.label}
        {n.id === 'review' && dueCount !== null && dueCount > 0 && (
          <span className="text-[var(--color-ink-warm)]">· {dueCount}</span>
        )}
        {live?.active && (
          <span
            className={`h-[5px] w-[5px] rounded-full bg-[var(--color-ink-warm)] shrink-0 ${live.busy ? 'animate-pulse' : ''}`}
            aria-label="session live"
          />
        )}
      </button>
    )
  }

  return (
    <div className="shrink-0 flex items-stretch gap-0.5 px-3 border-b border-[var(--color-hairline)] bg-[color-mix(in_srgb,var(--color-surface)_62%,transparent)]">
      {home && tab(home)}
      {GROUP_ORDER.map((group) => {
        const items = nav.filter((n) => n.id !== 'home' && (NAV_GROUPS[n.id] ?? 'explore') === group)
        if (items.length === 0) return null
        const system = group === 'system'
        return (
          <div key={group} className={`flex items-stretch gap-0.5 ${system ? 'ml-auto' : ''}`} title={GROUP_LABEL[group]}>
            {!system && <span className="w-px my-2 bg-[var(--color-hairline)] mx-1" aria-hidden="true" />}
            {items.map(tab)}
          </div>
        )
      })}
    </div>
  )
}
