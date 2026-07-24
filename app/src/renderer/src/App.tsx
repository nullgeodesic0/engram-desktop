import { useEffect, useState, Suspense, lazy, type ReactElement } from 'react'
import { HomeView } from './app/HomeView'
import { DashboardView } from './app/DashboardView'
import { ReviewSessionView } from './app/ReviewSessionView'
import { LearnSessionView } from './app/LearnSessionView'
import { SettingsView } from './app/SettingsView'
import { CommandPalette } from './components/CommandPalette'
import { UpdateBanner } from './components/UpdateBanner'
import { TitleBar } from './components/TitleBar'
import { SkeletonBar, SkeletonGrid } from './components/Skeleton'

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
  const [deepLinkTopic, setDeepLinkTopic] = useState<string | null>(null)
  const [deepLinkNode, setDeepLinkNode] = useState<{ topicId: string; nodeId: string } | null>(null)
  // Tutor-initiated nudge to a specific node — pans the map if we're already
  // there, or badges the Topic Map nav item so the user can go look.
  const [pendingSpotlight, setPendingSpotlight] = useState<{ topicId: string; nodeId: string } | null>(null)
  // Bumped (never read for its value) whenever a ⌘N menu click should pop the
  // "New Topic" modal open on the Learn view — LearnSessionView watches for
  // this to change, not any particular number.
  const [newTopicRequest, setNewTopicRequest] = useState(0)

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
      if (v === 'home' || v === 'topics' || v === 'dashboard' || v === 'artifacts' || v === 'review' || v === 'learn' || v === 'settings') {
        setView(v)
      }
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return
      if (e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      const n = NAV.find((item) => item.hint === e.key)
      if (n) {
        e.preventDefault()
        setView(n.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function goToTopic(topicId: string) {
    setDeepLinkTopic(topicId)
    setView('learn')
  }

  function goToNode(topicId: string, nodeId: string) {
    setDeepLinkNode({ topicId, nodeId })
    setView('topics')
  }

  const collapsed = narrow && !pinnedOpen

  return (
    <div className="flex flex-col h-full">
      <TitleBar />
      <div className="flex flex-1 min-h-0 relative">
      <aside
        className={`shrink-0 border-r border-[var(--color-hairline)] bg-[var(--color-surface)] flex flex-col transition-[width] duration-[var(--dur-base)] ease-out ${
          collapsed ? 'w-14' : 'w-48'
        } ${narrow ? 'absolute inset-y-0 left-0 z-20 shadow-[8px_0_24px_rgba(0,0,0,0.4)]' : 'relative'}`}
      >
        <div className={`flex items-center gap-2 px-4 py-5 ${collapsed ? 'justify-center px-0' : ''}`}>
          <span className="relative inline-flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)] animate-consolidate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-ink-warm)]" />
          </span>
          {!collapsed && (
            <div>
              <div className="font-[var(--font-serif)] text-lg tracking-tight text-[var(--color-text-primary)] leading-none">
                Engram
              </div>
              <div className="text-xs text-[var(--color-text-dim)] label-data leading-none mt-1">desktop</div>
            </div>
          )}
        </div>
        <nav className="flex flex-col gap-0.5 px-2" aria-label="Primary">
          {NAV.map((n) => {
            const active = view === n.id
            return (
              <button
                key={n.id}
                title={collapsed ? `${n.label} (⌘${n.hint})` : undefined}
                aria-label={n.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setView(n.id)
                  if (narrow) setPinnedOpen(false)
                }}
                className={`focus-ring group relative flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm transition-colors duration-[var(--dur-fast)] ${
                  collapsed ? 'justify-center px-0' : ''
                } ${
                  active
                    ? 'bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]'
                    : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]'
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
        {narrow && (
          <button
            onClick={() => setPinnedOpen((v) => !v)}
            aria-label={pinnedOpen ? 'Collapse navigation' : 'Expand navigation'}
            className="focus-ring mt-auto mb-3 mx-2 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
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
        <UpdateBanner />
        {/* Stateful views (Learn/Review/Coach) mount on first visit and then stay
            mounted, hidden with display:none — leaving the tab must never destroy
            a live session's UI state. Cheap/stateless views (and the Map, whose
            WebGL scene must not run hidden) still unmount on switch. */}
        <div className="flex-1 min-h-0 relative">
          {view === 'home' && (
            <div key="home" className="view-transition h-full">
              <HomeView
                onGoReview={() => setView('review')}
                onGoCoach={() => setView('dashboard')}
                onGoTopic={goToTopic}
                onNewTopic={() => setView('learn')}
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
              <DashboardView onNewTopic={() => setView('learn')} />
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
        navCommands={NAV.map((n) => ({ id: `nav:${n.id}`, label: n.label, hint: `⌘${n.hint}`, action: () => setView(n.id) }))}
      />
      </div>
    </div>
  )
}
