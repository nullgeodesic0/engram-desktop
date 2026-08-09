import type { ReactElement, ReactNode } from 'react'

export interface MainMenuNavItem {
  id: string
  label: string
  hint: string
  icon: ReactElement
}

export type Group = 'study' | 'track' | 'explore' | 'system'

/** Purpose grouping — every non-Home NAV id assigned, none left ungrouped.
 * Study (Learn, Review) is the daily-use core and renders as a two-up of
 * card-scale entries; Track (Grades, Coach), Explore (Topic Map, Artifacts),
 * and System (Settings) follow as a quiet stacked index beneath it. */
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

/** Per-section ink. Every entry is a meaning the system already assigns, not
 * a colour picked to make the menu varied:
 *
 *   learn     warm    — controlChrome.ts's standing decree: Learn accents WARM
 *                       (encoding new ground), Review COOL (retrieval under
 *                       test). The menu is the door to both environments and
 *                       was painting both warm, so the one place the split
 *                       would actually orient you was the one place it was
 *                       missing.
 *   review    cool     — same decree, other half.
 *   dashboard violet   — Coach. Violet is "synthesis and creation: explorables,
 *                        threshold concepts, coach insight" — this surface is
 *                        named in that definition.
 *   artifacts violet   — explorables, likewise named.
 *
 * Everything else stays neutral ON PURPOSE. Grades has no single ink (its
 * letters carry their own), Topic Map is the atlas rather than a state, and
 * Settings is chrome. Inking them would be decoration, and the palette's
 * three standing rules — cool/warm means consolidation, danger means struggle,
 * violet stays off the axis — only hold their force while nothing wears an
 * ink it has not earned. */
const SECTION_INK: Record<string, string> = {
  learn: 'var(--color-ink-warm)',
  review: 'var(--color-ink-cool)',
  dashboard: 'var(--color-ink-violet)',
  artifacts: 'var(--color-ink-violet)',
}

/** An inked section shows its ink at rest; an un-inked one is dim and warms
 * to primary text on hover. Note what this hover is NOT: it used to go to
 * warm ink for every row, which now would read as "this is Learn" on a row
 * that is not Learn. Hover is chrome, so it resolves to the text ramp and
 * leaves the semantic inks alone — the same split the light theme makes when
 * it sends focus rings to the accent token and leaves the state inks amber. */
function NavIcon({ icon, size = 15, ink }: { icon: ReactElement; size?: number; ink?: string }) {
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
      className={`shrink-0 transition-colors duration-[var(--dur-base)] ${
        ink ? '' : 'text-[var(--color-text-dim)] group-hover:text-[var(--color-text-primary)]'
      }`}
      style={ink ? { color: ink } : undefined}
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
 * `tilt-card-soft panel` document with purpose groups as hairline-divided
 * registers. TWO registers, not one: Study is a two-up of card-scale entries
 * (26px instrument in the section's own ink, heading-scale name, its live
 * fact at body size, the shortcut as a key cap), and every other group is a compact row (icon +
 * display-face name left, ⌘-hint right, live teaser as the faint-mono
 * indented second line the review plate uses for its due nodes' names).
 *
 * The split is the whole point of the surface. `hero` has always named the
 * Study group, but it used to buy 3px of type and 1px of padding, so seven
 * near-identical full-width strips read as a settings list rather than a main
 * menu. Both registers keep the SAME interaction vocabulary — edge line,
 * warm-dim border shift at --dur-base, rail-tier tilt — so scale is the only
 * thing that differs and the plate still reads as one menu.
 *
 * Mounted as a section INSIDE HomeView — Home IS the menu ("the home
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
      {grouped.map(({ group, items }, gi) => {
        // Resolved per GROUP now, not per item — the wrapper below needs it to
        // choose its layout, and it was always a property of the group anyway.
        const hero = group === 'study'
        return (
        <div key={group} className={`flex flex-col gap-1 ${gi > 0 ? 'pt-2' : ''}`}>
          {/* Tracked-uppercase label with a hairline rule running out to the
              plate's edge — the rule doing the group-divider job a border-t
              used to (one line, both jobs).

              The band is NEUTRAL. It used to be warm for every group,
              which was harmless while the items were warm too — but with
              Learn warm and Review cool sitting under it, a warm band reads
              as a label for the warm one. A divider must not take sides
              between the things it divides. */}
          <div className="flex items-center gap-2.5 mb-1">
            <span className="label-data text-[10px] uppercase tracking-[0.28em] text-[var(--color-text-dim)] shrink-0">
              {GROUP_LABEL[group]}
            </span>
            <span className="h-px flex-1 bg-[var(--color-hairline)]" aria-hidden="true" />
          </div>
          {/* Study is a two-up of card-scale entries; every other group stays a
              stacked row. `hero` already existed and already named exactly
              this distinction — it just cashed out as 3px of type and 1px of
              padding, which is not a hierarchy, it is a rounding error. Seven
              near-identical full-width strips read as a settings list; a main
              menu should say what you came here to do before it lists what
              else exists. */}
          <div className={hero ? 'grid grid-cols-1 sm:grid-cols-2 gap-2' : 'flex flex-col gap-1'}>
          {items.map((n) => {
            const inProgress =
              (n.id === 'learn' || n.id === 'review' || n.id === 'dashboard') && visited[n.id as 'learn' | 'review' | 'dashboard']
            const pulsing = (n.id === 'learn' || n.id === 'review') && activity[n.id as 'learn' | 'review'].active
            if (hero) {
              return (
                <button
                  key={n.id}
                  onClick={() => onGoView(n.id)}
                  // Same interaction vocabulary as the rows below — edge line,
                  // warm-dim border shift at --dur-base, rail-tier tilt. Only
                  // the scale changes, so the two registers still read as one
                  // menu rather than two components.
                  className={`group focus-ring tilt-card-rail relative text-left flex flex-col gap-2.5 px-5 py-4 border border-[var(--color-edge)] hover:border-[var(--color-ink-warm-dim)] hover:bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] transition-colors duration-[var(--dur-base)] ${
                    inProgress ? 'dogear' : ''
                  }`}
                >
                  {/* Instrument left, status right. The live dot belongs in
                      this cluster, not beside the name: at heading scale a dot
                      trailing the label reads as "Learn •", a stray bullet
                      rather than "a session is running". */}
                  <div className="flex items-start justify-between gap-3">
                    <NavIcon icon={n.icon} size={26} ink={SECTION_INK[n.id]} />
                    <div className="flex items-center gap-2 shrink-0">
                      {pulsing && <ActivityDot busy={activity[n.id as 'learn' | 'review'].busy} />}
                      {/* The shortcut as a real key cap rather than loose mono —
                          a menu that can be driven from the keyboard should
                          look like one. Existing chip recipe, no new primitive. */}
                      <span className="label-data text-[10px] px-1.5 py-0.5 border border-[var(--color-edge)] text-[var(--color-text-faint)]">
                        ⌘{n.hint}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-(family-name:--font-display) text-[length:var(--text-heading)] leading-none text-[var(--color-text-primary)] truncate">
                      {n.label}
                    </span>
                    {/* At this scale the teaser is the card's live fact, not a
                        footnote — body-adjacent size and dim ink, not 10px faint. */}
                    {teasers?.[n.id] !== undefined && (
                      <div className="label-data text-xs text-[var(--color-text-dim)] truncate">{teasers[n.id]}</div>
                    )}
                  </div>
                </button>
              )
            }
            return (
              <button
                key={n.id}
                onClick={() => onGoView(n.id)}
                // The same 1px edge line every card on this page draws
                // (`.panel`'s own border token) — a row is still a card,
                // just a full-width one inside the plate.
                //
                // Two idioms this row used to opt out of, both already
                // written down. index.css's interaction vocabulary defines a
                // row's hover as "a background-color AND a warm-dim border
                // shift, timed at --dur-base (200ms)" — this had the
                // background half only, at --dur-fast, which is the BUTTON
                // timing. And the tilt doctrine names "the sidebar nav
                // buttons" as the rail-tier tilt surface; these rows are what
                // replaced that sidebar, so they take the tier that was
                // written for them.
                className={`group focus-ring tilt-card-rail relative text-left flex flex-col gap-0.5 px-3 border border-[var(--color-edge)] hover:border-[var(--color-ink-warm-dim)] hover:bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] py-2 transition-colors duration-[var(--dur-base)] ${
                  inProgress ? 'dogear' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <NavIcon icon={n.icon} size={15} ink={SECTION_INK[n.id]} />
                    <span className="font-(family-name:--font-display) text-sm text-[var(--color-text-primary)] truncate">
                      {n.label}
                    </span>
                    {pulsing && <ActivityDot busy={activity[n.id as 'learn' | 'review'].busy} />}
                  </div>
                  <span className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0">⌘{n.hint}</span>
                </div>
                {/* The review plate's own second-line register — faint mono,
                    indented past the icon, truncating — the same treatment
                    its due nodes' names get. */}
                {teasers?.[n.id] !== undefined && (
                  <div className="label-data text-[10px] text-[var(--color-text-dim)] truncate pl-[23px]">
                    {teasers[n.id]}
                  </div>
                )}
              </button>
            )
          })}
          </div>
        </div>
        )
      })}
      <div className="fig-caption">every part of the atlas, grouped by purpose</div>
    </div>
  )
}
