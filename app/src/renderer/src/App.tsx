import { useEffect, useState, Suspense, lazy, type ReactElement } from 'react'
import { HomeView } from './app/HomeView'
import { DashboardView } from './app/DashboardView'
import { ReviewSessionView } from './app/ReviewSessionView'
import { LearnSessionView } from './app/LearnSessionView'
import { SettingsView } from './app/SettingsView'
import { CommandPalette } from './components/CommandPalette'
import { SessionHistoryDrawer, ALL_HISTORY_KEY } from './components/SessionHistoryDrawer'
import { TitleBar } from './components/TitleBar'
import { SkeletonBar, SkeletonGrid } from './components/Skeleton'
import { HelpSheet } from './components/HelpSheet'
import { NeuronMark } from './components/BrandMark'

// Code-split: both views unmount on tab switch already (they're not inside
// KeepMounted — see the comment on `main` below), so there's no "resolve once,
// stay mounted" state to worry about, just a plain lazy import per visit. The
// map additionally drags in nothing heavy itself, but keeping it split alongside
// Artifacts keeps the initial bundle limited to the views a fresh session
// actually needs (Home first, then whichever tab is clicked).
const TopicMapView = lazy(() => import('./app/TopicMapView').then((m) => ({ default: m.TopicMapView })))
const ArtifactGalleryView = lazy(() =>
  import('./app/ArtifactGalleryView').then((m) => ({ default: m.ArtifactGalleryView })),
)

type View = 'home' | 'topics' | 'dashboard' | 'artifacts' | 'review' | 'learn' | 'settings'

const NAV: { id: View; label: string; hint: string; icon: ReactElement }[] = [
  {
    id: 'home',
    label: 'Home',
    hint: '0',
    icon: <path d="M3 9.5 10 3l7 6.5M5 8v8h10V8" />,
  },
  {
    id: 'learn',
    label: 'Learn',
    hint: '1',
    icon: (
      <path d="M3 4.5 10 2l7 2.5v9L10 16l-7-2.5v-9Z M3 4.5 10 7l7-2.5 M10 7v9" />
    ),
  },
  {
    id: 'review',
    label: 'Review',
    hint: '2',
    icon: <path d="M4 10a6 6 0 1 1 1.8 4.3M4 10V5.5M4 10h4.5" />,
  },
  {
    id: 'topics',
    label: 'Topic Map',
    hint: '3',
    icon: <path d="M10 3v4M5 14l3.2-4.6M15 14l-3.2-4.6M3 16h4M13 16h4M10 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
  },
  {
    id: 'dashboard',
    label: 'Coach',
    hint: '4',
    icon: <path d="M3 16V9m4.5 7V5m4.5 11v-8m4.5 8V7" />,
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    hint: '5',
    icon: <path d="M4 6.5 10 3l6 3.5v7L10 17l-6-3.5v-7Zm6 3.5 6-3.5M10 10v7M10 10 4 6.5" />,
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: '6',
    icon: (
      <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z M15.8 12.2a1.4 1.4 0 0 0 .28 1.55l.05.05a1.7 1.7 0 1 1-2.4 2.4l-.05-.05a1.4 1.4 0 0 0-1.55-.28 1.4 1.4 0 0 0-.85 1.28V17.3a1.7 1.7 0 0 1-3.4 0v-.08a1.4 1.4 0 0 0-.9-1.27 1.4 1.4 0 0 0-1.55.28l-.05.05a1.7 1.7 0 1 1-2.4-2.4l.05-.05a1.4 1.4 0 0 0 .28-1.55 1.4 1.4 0 0 0-1.28-.85H2.7a1.7 1.7 0 0 1 0-3.4h.08a1.4 1.4 0 0 0 1.27-.9 1.4 1.4 0 0 0-.28-1.55l-.05-.05a1.7 1.7 0 1 1 2.4-2.4l.05.05a1.4 1.4 0 0 0 1.55.28h.07a1.4 1.4 0 0 0 .85-1.28V2.7a1.7 1.7 0 0 1 3.4 0v.08a1.4 1.4 0 0 0 .85 1.28 1.4 1.4 0 0 0 1.55-.28l.05-.05a1.7 1.7 0 1 1 2.4 2.4l-.05.05a1.4 1.4 0 0 0-.28 1.55v.07a1.4 1.4 0 0 0 1.28.85h.08a1.7 1.7 0 0 1 0 3.4h-.08a1.4 1.4 0 0 0-1.28.85Z" />
    ),
  },
]

/** Collapses the rail to icon-only below this window width — a real breakpoint
 * here since the Electron window itself is the viewport, not a component. */
const COLLAPSE_WIDTH = 760

/** Wrapper for the keep-mounted views (Learn/Review/Coach — see `visited` below):
 * those divs never unmount once visited, they just toggle visibility, so the
 * `view-transition` class must be applied once at mount and never removed —
 * toggling it back on with every switch would re-run the entrance fade on
 * every visit instead of only the first. Visibility is controlled separately
 * via `hidden` so the className itself stays constant. */
function KeepMounted({ active, children }: { active: boolean; children: ReactElement }) {
  return (
    <div className="view-transition h-full" hidden={!active}>
      {children}
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<View>('home')
  // Which stateful views have ever been opened — they mount lazily on first
  // visit, then stay mounted for session continuity (hidden, not unmounted).
  const [visited, setVisited] = useState({ learn: false, review: false, dashboard: false })
  useEffect(() => {
    if (view === 'learn' || view === 'review' || view === 'dashboard') {
      setVisited((v) => (v[view] ? v : { ...v, [view]: true }))
    }
  }, [view])
  // Live-session activity reported by the chat views — drives the sidebar
  // ink-dots ("a session is alive in there" / pulsing while the model responds).
  const [activity, setActivity] = useState<Record<'learn' | 'review', { active: boolean; busy: boolean }>>({
    learn: { active: false, busy: false },
    review: { active: false, busy: false },
  })
  const [narrow, setNarrow] = useState(window.innerWidth < COLLAPSE_WIDTH)
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Owned at the App level, not any one view — the drawer it opens spans
  // every topic and both loops, so it isn't scoped to whichever view is
  // active. Reachable from the Session menu and the command palette.
  const [allHistoryOpen, setAllHistoryOpen] = useState(false)
  // The help sheet (keyboard reference + glossary) — reachable from the app
  // menu (a plain navigateTo('help'), see onNavigate below) and from `?`
  // (the keydown listener further down, which is careful never to fire while
  // a text field has focus). Owned here, not inside any one view, since both
  // entry points are global rather than scoped to whatever's on screen.
  const [helpOpen, setHelpOpen] = useState(false)
  // Deep-link into the "All Sessions" drawer from a recently-viewed sitting
  // (Home's quiet row, the palette's empty-query state) — cleared on close so
  // a later plain open (Session menu, ⇧⌘H) always falls back to the drawer's
  // own default "most recent" behavior instead of re-landing on a stale sitting.
  const [historyDeepLinkSession, setHistoryDeepLinkSession] = useState<string | null>(null)
  const [deepLinkTopic, setDeepLinkTopic] = useState<string | null>(null)
  const [deepLinkNode, setDeepLinkNode] = useState<{ topicId: string; nodeId: string } | null>(null)
  // Tutor-initiated nudge to a specific node — pans the map if we're already
  // there, or badges the Topic Map nav item so the user can go look.
  const [pendingSpotlight, setPendingSpotlight] = useState<{ topicId: string; nodeId: string } | null>(null)
  // Bumped (never read for its value) whenever a ⌘N menu click should pop the
  // "New Topic" modal open on the Learn view — LearnSessionView watches for
  // this to change, not any particular number.
  const [newTopicRequest, setNewTopicRequest] = useState(0)
  // Bumped (never read for its value, same idiom as newTopicRequest above)
  // every time Coach is navigated to from OUTSIDE the dashboard itself — the
  // rail nav item, Home's "Coach →", the command palette, ⌘4, a tray/
  // notification deep link. DashboardView is `KeepMounted`, so its own
  // `openTopic` drilldown state otherwise survives switching away and back —
  // meaning the rail's "Coach" item, clicked while a drilldown was left open,
  // silently reopened the drilldown instead of Coach's own overview, with the
  // drilldown's in-page "back" as the only way out. Every external "go to
  // Coach" trigger goes through `goToView` below, which bumps this on every
  // click (not gated on `view` actually changing — clicking Coach while
  // already ON Coach, mid-drilldown, must still jump back to the overview).
  const [coachHomeSignal, setCoachHomeSignal] = useState(0)

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < COLLAPSE_WIDTH)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Deep-link target from a tray click or a background review-due notification —
  // fires even if this window was just recreated (see main/index.ts's focusOrCreateWindow).
  useEffect(() => {
    return window.engram.onNavigate((v) => {
      if (v === 'learn:new-topic') {
        setView('learn')
        setNewTopicRequest((n) => n + 1)
        return
      }
      if (v === 'history:all') {
        setAllHistoryOpen(true)
        return
      }
      if (v === 'help') {
        setHelpOpen(true)
        return
      }
      if (v === 'home' || v === 'topics' || v === 'dashboard' || v === 'artifacts' || v === 'review' || v === 'learn' || v === 'settings') {
        goToView(v)
      }
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // F9: none of this global nav/help wiring should fire while a
      // `ui/Modal` instance (Help itself, the confidence/menu picker, session
      // history, …) is already open — `?` used to stack a second HelpSheet
      // at the same z-50 over a live confidence prompt, and `⌘0`-`⌘6` used to
      // switch the view behind it. A DOM query, not lifted state: the
      // confidence picker lives deep inside whatever Learn/Review session
      // happens to be live, well below anything App itself tracks, and a
      // query against Modal.tsx's own `data-app-modal` marker needs no new
      // plumbing through every view that can open one. CommandPalette is a
      // deliberately separate, hand-rolled overlay (not `ui/Modal`) and is
      // NOT marked, so its own `⌘K` toggle and nav-while-searching are
      // untouched by this guard.
      if (document.querySelector('[data-app-modal="true"]')) return
      // `?` opens Help — but never while the learner is typing. A bare
      // `e.key === '?'` check alone would fire on every "?" typed into the
      // composer, a settings field, or the palette's search box, so this is
      // gated on the focused element rather than on a modifier key (there
      // isn't one to gate on: `?` is Shift+/ on a US layout, and `e.key`
      // already reports the shifted character either way). `isContentEditable`
      // covers a contenteditable region; INPUT/TEXTAREA covers everything
      // else in this app that accepts free text.
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        const el = document.activeElement as HTMLElement | null
        const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
        if (!typing) {
          e.preventDefault()
          setHelpOpen((v) => !v)
        }
        return
      }
      if (!e.metaKey && !e.ctrlKey) return
      if (e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      const n = NAV.find((item) => item.hint === e.key)
      if (n) {
        e.preventDefault()
        goToView(n.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Every external trigger that can land on a nav tab goes through here —
  // never a bare `setView` — so "go to Coach" always bumps coachHomeSignal
  // (see that state's own doc comment) regardless of which trigger fired it.
  // Plain pass-through for every other view; `setView` itself already bails
  // out on a no-op value, so calling this with the CURRENT view is harmless.
  function goToView(v: View) {
    if (v === 'dashboard') setCoachHomeSignal((n) => n + 1)
    setView(v)
  }

  function goToTopic(topicId: string) {
    setDeepLinkTopic(topicId)
    setView('learn')
  }

  function goToNode(topicId: string, nodeId: string) {
    setDeepLinkNode({ topicId, nodeId })
    setView('topics')
  }

  function goToSitting(sessionId: string) {
    setHistoryDeepLinkSession(sessionId)
    setAllHistoryOpen(true)
  }

  const collapsed = narrow && !pinnedOpen

  return (
    <div className="flex flex-col h-full">
      <TitleBar />
      <div className="flex flex-1 min-h-0 relative">
      <aside
        className={`shrink-0 border-r border-[var(--color-hairline)] sidebar-nocturne flex flex-col transition-[width] duration-[var(--dur-base)] ease-out ${
          collapsed ? 'w-14' : 'w-48'
        } ${narrow ? 'absolute inset-y-0 left-0 z-20 shadow-[8px_0_24px_rgba(0,0,0,0.4)]' : 'relative'}`}
      >
        <div className={`relative z-10 flex items-center gap-2.5 px-4 py-5 ${collapsed ? 'justify-center px-0' : ''}`}>
          <NeuronMark size={22} />
          {!collapsed && (
            <div>
              {/* font-serif-display, NOT font-[var(--font-serif)] — the arbitrary
                  form compiles to an invalid font-weight and never applies Fraunces. */}
              <div className="font-serif-display font-semibold text-[15px] tracking-[0.16em] text-[var(--color-text-primary)] leading-none">
                ENGRAM
              </div>
              <div className="text-[8.5px] whitespace-nowrap text-[var(--color-ink-lavender-dim)] label-data leading-none mt-1.5">learn anything. keep it.</div>
            </div>
          )}
        </div>
        <nav className="relative z-10 flex flex-col gap-0.5 px-2" aria-label="Primary">
          {NAV.map((n) => {
            const active = view === n.id
            return (
              <button
                key={n.id}
                title={collapsed ? `${n.label} (⌘${n.hint})` : undefined}
                aria-label={n.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  goToView(n.id)
                  if (narrow) setPinnedOpen(false)
                }}
                className={`focus-ring group relative flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm transition-colors duration-[var(--dur-fast)] ${
                  collapsed ? 'justify-center px-0' : ''
                } ${
                  active
                    ? 'bg-[color-mix(in_srgb,var(--color-ink-lavender)_14%,transparent)] text-[var(--color-ink-warm)]'
                    : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-ink-lavender)_8%,transparent)]'
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-[var(--color-ink-warm)]" aria-hidden="true" />
                )}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 opacity-80 group-hover:opacity-100"
                  aria-hidden="true"
                >
                  {n.icon}
                </svg>
                {!collapsed && <span className="truncate">{n.label}</span>}
                {!collapsed && (
                  <span className="ml-auto flex items-center gap-1.5">
                    {(n.id === 'learn' || n.id === 'review') && activity[n.id].active && !active && (
                      <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
                        {activity[n.id].busy && (
                          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)] animate-consolidate-ping" />
                        )}
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-ink-warm)]" />
                      </span>
                    )}
                    {n.id === 'topics' && pendingSpotlight != null && !active && (
                      <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-ink-warm)]" />
                      </span>
                    )}
                    <span className="text-[10px] label-data text-[var(--color-text-faint)] opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--dur-fast)]">
                      ⌘{n.hint}
                    </span>
                  </span>
                )}
              </button>
            )
          })}
        </nav>
        {/* Dendrite constellation footer — the icon's neuron, quieted: an axon
            entering from the edge, a small soma branching up into a few nodes
            (one consolidated cream, one amber spark on the axon). Pure
            imagery: aria-hidden, pointer-events-none, behind the nav (z-0 vs
            z-10) so it never competes with a hit target. Hidden while
            collapsed — at rail width it would just read as noise. */}
        {!collapsed && (
          <svg viewBox="0 0 192 230" className="pointer-events-none select-none absolute bottom-0 inset-x-0 z-0" aria-hidden="true">
            <defs>
              <radialGradient id="sb-halo-cream" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--color-ink-paper)" stopOpacity="0.4" />
                <stop offset="100%" stopColor="var(--color-ink-paper)" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="sb-halo-amber" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--color-ink-warm)" stopOpacity="0.45" />
                <stop offset="100%" stopColor="var(--color-ink-warm)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <g opacity="0.55">
              <g stroke="var(--color-ink-lavender)" strokeOpacity="0.5" strokeWidth="1" fill="none">
                <path d="M58 124 L50 106 M104 128 L112 104 M36 152 L22 138 M50 106 L78 88 M112 104 L146 92 M78 88 L120 62 M146 92 L170 120" />
              </g>
              <circle cx="78" cy="88" r="13" fill="url(#sb-halo-cream)" />
              <circle cx="34" cy="222" r="11" fill="url(#sb-halo-amber)" />
              <g stroke="var(--color-ink-lavender)" strokeWidth="2" strokeLinecap="round" fill="none">
                <path d="M-8 232 C40 224 58 206 76 186" />
                <path d="M80 168 C74 150 66 138 58 124" />
                <path d="M92 168 C98 152 102 142 104 128" />
                <path d="M76 172 C62 166 50 162 36 152" />
              </g>
              <circle cx="84" cy="176" r="9" fill="var(--color-nocturne-lo)" stroke="var(--color-ink-lavender)" strokeWidth="2" />
              <circle cx="84" cy="176" r="2.5" fill="var(--color-ink-lavender)" fillOpacity="0.8" />
              <g fill="var(--color-ink-lavender)">
                <circle cx="50" cy="106" r="3.5" />
                <circle cx="22" cy="138" r="3" />
                <circle cx="146" cy="92" r="3.5" />
                <circle cx="120" cy="62" r="2.5" />
                <circle cx="170" cy="120" r="2.5" />
              </g>
              <circle cx="78" cy="88" r="4" fill="var(--color-ink-paper)" />
              <g transform="rotate(45 34 222)" stroke="var(--color-ink-warm)" strokeWidth="1.6" strokeLinecap="round">
                <path d="M27.5 222 L31 222 M37 222 L40.5 222 M34 215.5 L34 219 M34 225 L34 228.5" />
              </g>
              <circle cx="34" cy="222" r="1.5" fill="var(--color-ink-warm)" />
            </g>
          </svg>
        )}
        {narrow && (
          <button
            onClick={() => setPinnedOpen((v) => !v)}
            aria-label={pinnedOpen ? 'Collapse navigation' : 'Expand navigation'}
            className="focus-ring relative z-10 mt-auto mb-3 mx-2 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-ink-lavender)_8%,transparent)]"
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              {pinnedOpen ? <path d="M12.5 5 7.5 10l5 5" /> : <path d="M7.5 5 12.5 10l-5 5" />}
            </svg>
            {!collapsed && (pinnedOpen ? 'Collapse' : 'Expand')}
          </button>
        )}
      </aside>
      {narrow && pinnedOpen && (
        <button
          aria-label="Close navigation"
          onClick={() => setPinnedOpen(false)}
          className="absolute inset-0 z-10 bg-black/40 backdrop-blur-[1px]"
        />
      )}
      {/* Each view now owns its own scroll region (h-full + overflow-y-auto, or a
          flex column with an internal scrollable pane like LearnSessionView) so a
          chat-style view can anchor its header/input and scroll only the middle. */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {/* Update availability now lives in Settings (a quiet status line + manual
            re-check), not a floating banner — see updateCheck.ts. */}
        {/* Stateful views (Learn/Review/Coach) mount on first visit and then stay
            mounted, hidden with display:none — leaving the tab must never destroy
            a live session's UI state. Cheap/stateless views (and the Map, whose
            WebGL scene must not run hidden) still unmount on switch. */}
        <div className="flex-1 min-h-0 relative">
          {view === 'home' && (
            <div key="home" className="view-transition h-full">
              <HomeView
                onGoReview={() => goToView('review')}
                onGoCoach={() => goToView('dashboard')}
                onGoTopic={goToTopic}
                onNewTopic={() => setView('learn')}
                onGoNode={goToNode}
                onGoSitting={goToSitting}
              />
            </div>
          )}
          {(visited.learn || view === 'learn') && (
            <KeepMounted active={view === 'learn'}>
              <LearnSessionView
                deepLinkTopicId={deepLinkTopic}
                onDeepLinkConsumed={() => setDeepLinkTopic(null)}
                onActivity={(a) => setActivity((prev) => ({ ...prev, learn: a }))}
                onSpotlight={(s) => setPendingSpotlight(s)}
                onGoReview={() => setView('review')}
                openNewTopicSignal={newTopicRequest}
              />
            </KeepMounted>
          )}
          {(visited.review || view === 'review') && (
            <KeepMounted active={view === 'review'}>
              <ReviewSessionView onActivity={(a) => setActivity((prev) => ({ ...prev, review: a }))} />
            </KeepMounted>
          )}
          {view === 'topics' && (
            <div key="topics" className="view-transition h-full">
              <Suspense fallback={<div className="h-full p-6"><SkeletonBar height={220} /></div>}>
                <TopicMapView
                  deepLinkNode={deepLinkNode}
                  onDeepLinkConsumed={() => setDeepLinkNode(null)}
                  onGoTopic={goToTopic}
                  onNewTopic={() => setView('learn')}
                  spotlightNode={pendingSpotlight}
                  onSpotlightConsumed={() => setPendingSpotlight(null)}
                />
              </Suspense>
            </div>
          )}
          {(visited.dashboard || view === 'dashboard') && (
            <KeepMounted active={view === 'dashboard'}>
              <DashboardView
                onNewTopic={() => setView('learn')}
                onGoNode={goToNode}
                onGoArtifacts={() => setView('artifacts')}
                coachHomeSignal={coachHomeSignal}
              />
            </KeepMounted>
          )}
          {view === 'artifacts' && (
            <div key="artifacts" className="view-transition h-full">
              <Suspense fallback={<div className="h-full p-6"><SkeletonGrid /></div>}>
                <ArtifactGalleryView onGoLearn={() => setView('learn')} onOpenNode={goToNode} />
              </Suspense>
            </div>
          )}
          {view === 'settings' && (
            <div key="settings" className="view-transition h-full">
              <SettingsView />
            </div>
          )}
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onGoTopic={goToTopic}
        onGoNode={goToNode}
        onGoSitting={goToSitting}
        navCommands={[
          ...NAV.map((n) => ({ id: `nav:${n.id}`, label: n.label, hint: `⌘${n.hint}`, action: () => goToView(n.id) })),
          { id: 'nav:history', label: 'Session History', hint: '⇧⌘H', action: () => setAllHistoryOpen(true) },
        ]}
      />
      <SessionHistoryDrawer
        historyKey={ALL_HISTORY_KEY}
        title="All Sessions"
        open={allHistoryOpen}
        onClose={() => {
          setAllHistoryOpen(false)
          setHistoryDeepLinkSession(null)
        }}
        initialSessionId={historyDeepLinkSession ?? undefined}
      />
      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  )
}
