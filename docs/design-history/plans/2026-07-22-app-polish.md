# Night Atlas App Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the "Night Atlas" design language (spec: `docs/superpowers/specs/2026-07-22-app-polish-design.md`) — token/type overhaul, ink-drawn motif primitives, unified UI components — plus session continuity (stateful views stay mounted; explicit exits; sidebar live-session dots).

**Architecture:** Phase A adds foundation (tokens, fonts, `components/ui/` primitives) with no view changes. Phase B changes `App.tsx` mounting strategy and adds session-activity reporting from the chat views. Phase C migrates views onto the foundation, highest-traffic first.

**Tech Stack:** React 19 + Tailwind v4 (`@theme` tokens) + Vite (electron-vite). Fonts self-hosted via `@fontsource` packages (CSP is `font-src 'self' data:` — no external font loading).

## Global Constraints

- The learning-loop philosophy is sacred: no answer-peeking affordances in Review, no softening of grade language, no changes to beat-stepper or confidence-picker interaction semantics.
- No changes to main-process session logic, engram.py, IPC schemas, or the MCP bridge.
- No test framework exists. Every task verifies with `npm run typecheck && npm run build` (run from `app`) — both must be clean. `tsconfig` has `noUnusedLocals: true`: never leave an unused import/local.
- Work directly on `master`; commit per task with the message given in the task.
- Do not run `npm run dev` or any interactive verification — static verification only.
- All new UI components live in `app/src/renderer/src/components/ui/`; import CSS variables, never hard-coded hex (exception: the seeded irregularity math in InkNode).

---

### Task 1: Fonts + token overhaul

**Files:**
- Modify: `app/package.json` (deps)
- Modify: `app/src/renderer/src/index.css`

**Interfaces:**
- Produces CSS tokens later tasks use: `--color-ink-paper`, `--text-display/-heading/-body/-caption/-data` scale vars, `--font-serif`, class `.fig-caption`.

- [ ] **Step 1: Install self-hosted fonts**

Run in `app`:
```bash
npm install @fontsource/space-grotesk @fontsource/inter @fontsource/fraunces
```

- [ ] **Step 2: Import fonts and update tokens in `index.css`**

Replace the top of the file (the `@import 'tailwindcss'` line and the whole `@theme` block, lines 1–34) with:

```css
@import 'tailwindcss';
@import '@fontsource/space-grotesk/500.css';
@import '@fontsource/space-grotesk/600.css';
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/500.css';
@import '@fontsource/fraunces/400.css';
@import '@fontsource/fraunces/400-italic.css';
@import '@fontsource/fraunces/600.css';

@theme {
  /* "Night Atlas" — Cajal's sepia-ink neuron atlas inverted onto the night.
     The void warms slightly toward sepia; text is warm ink, not cold white. */
  --color-void: #0d0e12;
  --color-surface: #14151c;
  --color-surface-2: #1c1e28;
  --color-surface-3: #262937;
  --color-hairline: #262a36;

  /* Node-state duality: cool = not yet consolidated, warm = the surviving
     signal (an oscilloscope-phosphor amber, not a generic accent). */
  --color-ink-cool: #5b8fa8;
  --color-ink-cool-dim: #3a5a6b;
  --color-ink-warm: #e8a857;
  --color-ink-warm-dim: #8a6533;
  --color-ink-hot: #f0c24b;
  --color-ink-danger: #c4685a;
  --color-ink-danger-dim: #6b3d36;

  /* Third signal: synthesis/creation (artifact-smith explorables, coach insight) —
     sits between cool and warm rather than opposing them. */
  --color-ink-violet: #a78bda;
  --color-ink-violet-dim: #6b5490;

  /* Warm "paper ink" text ramp — Cajal sepia, inverted. */
  --color-ink-paper: #e6dfd0;
  --color-text-primary: #e6dfd0;
  --color-text-dim: #8b8878;
  --color-text-faint: #545248;

  --font-display: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
  --font-serif: 'Fraunces', Georgia, serif;
  --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-data: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;

  /* Type scale — the app's five text roles. Use these instead of ad-hoc sizes
     for headings/captions; body copy may still use Tailwind text-sm etc. */
  --text-display: 1.75rem;
  --text-heading: 1.25rem;
  --text-body: 0.875rem;
  --text-caption: 0.75rem;
  --text-data: 0.8125rem;
}
```

- [ ] **Step 3: Add the figure-caption class**

In the `@layer components` block, immediately after the `.focus-ring:focus-visible { ... }` rule, add:

```css
  /* "Fig. N —" atlas caption: italic serif, dim, used for stats and empty states. */
  .fig-caption {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: var(--text-caption);
    color: var(--color-text-dim);
    letter-spacing: 0.01em;
  }
  .font-serif-display {
    font-family: var(--font-serif);
  }
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build` — both clean. The build must show the fontsource woff2 files in the renderer assets output.

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/src/renderer/src/index.css
git commit -m "feat(polish): Night Atlas tokens, self-hosted fonts, type scale"
```

---

### Task 2: Ink motif primitives — InkNode + DendriteDivider

**Files:**
- Create: `app/src/renderer/src/components/ui/InkNode.tsx`
- Create: `app/src/renderer/src/components/ui/DendriteDivider.tsx`

**Interfaces:**
- Produces: `InkNode({ id: string; variant: 'filled' | 'outlined' | 'dashed'; color?: string; size?: number })` and `DendriteDivider({ className?: string })`. Consumed by Tasks 7–9.

- [ ] **Step 1: Write `InkNode.tsx`**

```tsx
/** Hand-drawn neuron cell-body glyph — the Night Atlas motif for "a node".
 * The outline is an irregular closed blob whose lumpiness is deterministic
 * per id (same seeding trick as graph3d/layout.ts's seeded()), so a given
 * node always draws the same cell. Variants map to node state:
 * filled = consolidated, outlined = new, dashed = threshold. */
function seeded(id: string, salt: number): number {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 10000) / 10000
}

function blobPath(id: string, r: number): string {
  const points = 8
  const cx = r + 2
  const cy = r + 2
  const coords: [number, number][] = []
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    const wobble = 1 + (seeded(id, i + 1) - 0.5) * 0.45
    coords.push([cx + Math.cos(angle) * r * wobble, cy + Math.sin(angle) * r * wobble])
  }
  let d = `M ${coords[0][0].toFixed(2)} ${coords[0][1].toFixed(2)}`
  for (let i = 0; i < points; i++) {
    const curr = coords[i]
    const next = coords[(i + 1) % points]
    const midX = (curr[0] + next[0]) / 2
    const midY = (curr[1] + next[1]) / 2
    d += ` Q ${curr[0].toFixed(2)} ${curr[1].toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`
  }
  return d + ' Z'
}

export function InkNode({
  id,
  variant,
  color = 'var(--color-ink-warm)',
  size = 14,
}: {
  id: string
  variant: 'filled' | 'outlined' | 'dashed'
  color?: string
  size?: number
}) {
  const r = size / 2 - 2
  const d = blobPath(id, r)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <path
        d={d}
        fill={variant === 'filled' ? color : 'none'}
        stroke={color}
        strokeWidth={1.2}
        strokeDasharray={variant === 'dashed' ? '2.5 2' : undefined}
        opacity={variant === 'filled' ? 0.9 : 0.8}
      />
    </svg>
  )
}
```

- [ ] **Step 2: Write `DendriteDivider.tsx`**

```tsx
/** A branching hairline — replaces straight rules under section headers.
 * One main axon line with two short dendrite branches; stretches to its
 * container width via preserveAspectRatio="none" on the trunk only, so
 * the branch geometry stays undistorted at the left edge. */
export function DendriteDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-0 ${className}`} aria-hidden="true">
      <svg width="46" height="10" viewBox="0 0 46 10" fill="none" className="shrink-0">
        <path
          d="M0 5 H18 M18 5 C24 5 26 2 32 1.5 M18 5 C25 5.5 28 8 34 8.5 M32 1.5 C36 1.2 38 2.5 41 2 M34 8.5 C38 8.8 41 7.5 45 8"
          stroke="var(--color-hairline)"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle cx="18" cy="5" r="1.6" fill="var(--color-text-faint)" />
      </svg>
      <div className="h-px flex-1 bg-[var(--color-hairline)]" />
    </div>
  )
}
```

- [ ] **Step 3: Verify** — `npm run typecheck && npm run build` clean. (Both components are not yet imported anywhere; that is fine — `noUnusedLocals` applies to locals, not unused exports.)

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/src/components/ui/InkNode.tsx app/src/renderer/src/components/ui/DendriteDivider.tsx
git commit -m "feat(polish): InkNode and DendriteDivider ink-motif primitives"
```

---

### Task 3: Unified UI primitives — Button, Card, Modal, SegmentedControl, StatBlock

**Files:**
- Create: `app/src/renderer/src/components/ui/Button.tsx`
- Create: `app/src/renderer/src/components/ui/Card.tsx`
- Create: `app/src/renderer/src/components/ui/Modal.tsx`
- Create: `app/src/renderer/src/components/ui/SegmentedControl.tsx`
- Create: `app/src/renderer/src/components/ui/StatBlock.tsx`

**Interfaces:**
- Consumes: `useFocusTrap` from `../useFocusTrap` (existing).
- Produces (exact signatures used by Tasks 6–9):
  - `Button({ variant?: 'primary' | 'ghost' | 'danger'; className?; ...rest }: ButtonHTMLAttributes & { variant?; })`
  - `Card({ raised?: boolean; className?; children })`
  - `Modal({ open: boolean; onClose: () => void; title?: string; wide?: boolean; children })`
  - `SegmentedControl<T extends string>({ options: { value: T; label: string; description?: string }[]; value: T; onChange: (v: T) => void })`
  - `StatBlock({ label: string; value: string; tone?: 'warm' | 'cool' | 'violet' | 'neutral'; caption?: string })`

- [ ] **Step 1: Write `Button.tsx`**

```tsx
import type { ButtonHTMLAttributes } from 'react'

const VARIANT: Record<string, string> = {
  primary:
    'bg-[var(--color-ink-warm)] text-[var(--color-void)] hover:bg-[var(--color-ink-hot)] font-medium',
  ghost:
    'border border-[var(--color-hairline)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-faint)] bg-transparent',
  danger:
    'border border-[var(--color-ink-danger-dim)] text-[var(--color-ink-danger)] hover:bg-[var(--color-ink-danger-dim)]/30 bg-transparent',
}

export function Button({
  variant = 'ghost',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={`focus-ring rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  )
}
```

- [ ] **Step 2: Write `Card.tsx`**

```tsx
import type { ReactNode } from 'react'

export function Card({
  raised = false,
  className = '',
  children,
}: {
  raised?: boolean
  className?: string
  children: ReactNode
}) {
  return <div className={`${raised ? 'panel-raised' : 'panel'} ${className}`}>{children}</div>
}
```

- [ ] **Step 3: Write `Modal.tsx`**

```tsx
import { useRef, type ReactNode } from 'react'
import { useFocusTrap } from '../useFocusTrap'

/** The one modal shell: dim scrim, focus trap, escape-to-close, panel chrome.
 * Content owns its own internal layout; the shell owns positioning and a11y. */
export function Modal({
  open,
  onClose,
  title,
  wide = false,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  wide?: boolean
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, open)
  if (!open) return null
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`panel-raised max-h-[85vh] overflow-y-auto p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        {title && (
          <h2 className="font-[var(--font-display)] text-[length:var(--text-heading)] text-[var(--color-text-primary)] mb-4">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write `SegmentedControl.tsx`**

```tsx
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; description?: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--color-hairline)] overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.description}
          onClick={() => onChange(o.value)}
          className={`focus-ring px-3 py-1.5 text-xs transition-colors ${
            o.value === value
              ? 'bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]'
              : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Write `StatBlock.tsx`**

```tsx
const TONE: Record<string, string> = {
  warm: 'text-[var(--color-ink-warm)]',
  cool: 'text-[var(--color-ink-cool)]',
  violet: 'text-[var(--color-ink-violet)]',
  neutral: 'text-[var(--color-text-primary)]',
}

export function StatBlock({
  label,
  value,
  tone = 'neutral',
  caption,
}: {
  label: string
  value: string
  tone?: 'warm' | 'cool' | 'violet' | 'neutral'
  caption?: string
}) {
  return (
    <div className="panel p-3">
      <div className="text-[length:var(--text-caption)] text-[var(--color-text-dim)] label-data uppercase tracking-wider">
        {label}
      </div>
      <div className={`label-data text-lg mt-0.5 ${TONE[tone]}`}>{value}</div>
      {caption && <div className="fig-caption mt-1">{caption}</div>}
    </div>
  )
}
```

- [ ] **Step 6: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/renderer/src/components/ui/
git commit -m "feat(polish): unified Button/Card/Modal/SegmentedControl/StatBlock primitives"
```

---

### Task 4: Keep stateful views mounted (App.tsx)

**Files:**
- Modify: `app/src/renderer/src/App.tsx:206-231` (the `<main>` view-switch block)

**Interfaces:**
- Produces: Learn/Review/Dashboard views stay mounted once visited, hidden with `display:none`. Each stateful view receives `visible: boolean`. Task 5 consumes the same block for activity dots; Tasks 4 and 5 both touch `App.tsx` — Task 5's Find blocks reflect this task's output.

- [ ] **Step 1: Replace the view-switch block**

In `App.tsx`, find:

```tsx
        <div key={view} className="view-transition flex-1 min-h-0">
          {view === 'home' && (
            <HomeView
              onGoReview={() => setView('review')}
              onGoCoach={() => setView('dashboard')}
              onGoTopic={goToTopic}
              onNewTopic={() => setView('learn')}
            />
          )}
          {view === 'learn' && (
            <LearnSessionView deepLinkTopicId={deepLinkTopic} onDeepLinkConsumed={() => setDeepLinkTopic(null)} />
          )}
          {view === 'review' && <ReviewSessionView />}
          {view === 'topics' && (
            <TopicMapView deepLinkNode={deepLinkNode} onDeepLinkConsumed={() => setDeepLinkNode(null)} />
          )}
          {view === 'dashboard' && <DashboardView />}
          {view === 'artifacts' && <ArtifactGalleryView />}
          {view === 'settings' && <SettingsView />}
        </div>
```

Replace with:

```tsx
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
          {visited.learn && (
            <div className={view === 'learn' ? 'view-transition h-full' : 'hidden'}>
              <LearnSessionView deepLinkTopicId={deepLinkTopic} onDeepLinkConsumed={() => setDeepLinkTopic(null)} />
            </div>
          )}
          {visited.review && (
            <div className={view === 'review' ? 'view-transition h-full' : 'hidden'}>
              <ReviewSessionView />
            </div>
          )}
          {view === 'topics' && (
            <div key="topics" className="view-transition h-full">
              <TopicMapView deepLinkNode={deepLinkNode} onDeepLinkConsumed={() => setDeepLinkNode(null)} />
            </div>
          )}
          {visited.dashboard && (
            <div className={view === 'dashboard' ? 'view-transition h-full' : 'hidden'}>
              <DashboardView />
            </div>
          )}
          {view === 'artifacts' && (
            <div key="artifacts" className="view-transition h-full">
              <ArtifactGalleryView />
            </div>
          )}
          {view === 'settings' && (
            <div key="settings" className="view-transition h-full">
              <SettingsView />
            </div>
          )}
        </div>
```

- [ ] **Step 2: Add the `visited` tracker**

Immediately after `const [view, setView] = useState<View>('home')` add:

```tsx
  // Which stateful views have ever been opened — they mount lazily on first
  // visit, then stay mounted for session continuity (hidden, not unmounted).
  const [visited, setVisited] = useState({ learn: false, review: false, dashboard: false })
  useEffect(() => {
    if (view === 'learn' || view === 'review' || view === 'dashboard') {
      setVisited((v) => (v[view] ? v : { ...v, [view]: true }))
    }
  }, [view])
```

- [ ] **Step 3: Visibility-discipline check (read-only)**

Confirm no hidden-view CPU burn: CSS animations do not run under `display:none`, and none of the three kept-mounted views run their own requestAnimationFrame loops (the ambient NeuralField is mounted globally in `main.tsx` and already pauses itself). Verify by grepping the three views for `requestAnimationFrame` — expect zero hits; if a hit exists, gate that loop on the wrapper's visibility instead of shipping silently.

- [ ] **Step 4: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/src/App.tsx
git commit -m "feat(continuity): keep Learn/Review/Coach mounted across tab switches"
```

---

### Task 5: Sidebar live-session dots + explicit "All topics" exit

**Files:**
- Modify: `app/src/renderer/src/App.tsx` (as produced by Task 4)
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx` (session-activity reporting + exit button label)
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx` (session-activity reporting)

**Interfaces:**
- Produces: `LearnSessionView`/`ReviewSessionView` accept optional `onActivity?: (a: { active: boolean; busy: boolean }) => void`, called whenever session-active or busy state changes. `App.tsx` holds `activity: Record<'learn' | 'review', { active: boolean; busy: boolean }>`.

- [ ] **Step 1: App state + prop plumbing**

In `App.tsx`, after the `visited` tracker from Task 4, add:

```tsx
  // Live-session activity reported by the chat views — drives the sidebar
  // ink-dots ("a session is alive in there" / pulsing while the model responds).
  const [activity, setActivity] = useState<Record<'learn' | 'review', { active: boolean; busy: boolean }>>({
    learn: { active: false, busy: false },
    review: { active: false, busy: false },
  })
```

Pass to the views (Task 4's block): add `onActivity={(a) => setActivity((prev) => ({ ...prev, learn: a }))}` to `<LearnSessionView ... />` and `onActivity={(a) => setActivity((prev) => ({ ...prev, review: a }))}` to `<ReviewSessionView />`.

- [ ] **Step 2: Render dots in the nav**

In the nav-item button (inside `NAV.map`), find:

```tsx
                {!collapsed && <span className="truncate">{n.label}</span>}
```

Replace with:

```tsx
                {!collapsed && <span className="truncate">{n.label}</span>}
                {(n.id === 'learn' || n.id === 'review') && activity[n.id].active && !active && (
                  <span className="relative inline-flex h-1.5 w-1.5 ml-auto shrink-0">
                    {activity[n.id].busy && (
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-ink-warm)] animate-consolidate-ping" />
                    )}
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-ink-warm)]" />
                  </span>
                )}
```

Note: the existing `⌘{n.hint}` span uses `ml-auto`; when the dot renders, the dot carries `ml-auto` instead — move the hint span after the dot and drop its `ml-auto` conditionally by changing the hint span's class from `ml-auto text-[10px] ...` to `text-[10px] ...` and adding `ml-auto` only when no dot is shown; simplest exact form — wrap dot+hint:

```tsx
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
                    <span className="text-[10px] label-data text-[var(--color-text-faint)] opacity-0 group-hover:opacity-100 transition-opacity">
                      ⌘{n.hint}
                    </span>
                  </span>
                )}
```

(This replaces BOTH the `{!collapsed && <span className="truncate">…` line's following hint block and the standalone hint span — the truncate label line stays.)

- [ ] **Step 3: Report activity from LearnSessionView**

Add to the props interface: `onActivity?: (a: { active: boolean; busy: boolean }) => void`. Then add one effect near the other effects:

```tsx
  useEffect(() => {
    onActivity?.({ active: started && sessionId != null, busy })
  }, [started, sessionId, busy])
```

(Use the view's real state names — `started`/`sessionId`/`busy` all exist in LearnSessionView. In ReviewSessionView the equivalent is `phase === 'in-session'` for active and its `busy` state; adapt: `onActivity?.({ active: phase === 'in-session', busy })` with deps `[phase, busy]`.)

- [ ] **Step 4: Rename the Learn exit button**

In `LearnSessionView.tsx`'s session header, find the button labeled `← Topics` (it calls `backToTopics`) and change its visible label to `All topics` with the same arrow glyph, and add `title="Leave this session view (the session keeps running)"`.

- [ ] **Step 5: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/renderer/src/App.tsx app/src/renderer/src/app/LearnSessionView.tsx app/src/renderer/src/app/ReviewSessionView.tsx
git commit -m "feat(continuity): sidebar live-session dots and explicit All-topics exit"
```

---

### Task 6: Migrate the four modals to the Modal shell

**Files:**
- Modify: `app/src/renderer/src/components/AskDialog.tsx`
- Modify: `app/src/renderer/src/components/TopicSettingsModal.tsx`
- Modify: `app/src/renderer/src/components/NewTopicModal.tsx`
- Modify: `app/src/renderer/src/components/SessionHistoryModal.tsx`

**Interfaces:**
- Consumes: `Modal` from `../ui/Modal` (Task 3). Each modal's external props are unchanged.

- [ ] **Step 1: Convert each modal**

For each of the four files: the current pattern is a hand-rolled `<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">` scrim wrapping a panel div (AskDialog and SessionHistoryModal also call `useFocusTrap` themselves). Replace the scrim + outer panel div with the shared `Modal` shell:

- Import: `import { Modal } from '../ui/Modal'`
- The component's early-return (`if (!request) return null` / `if (!open) return null` etc.) is replaced by passing the boolean to `Modal`'s `open` prop (e.g. `open={request != null}`); keep a guard so content that dereferences the value only renders when present.
- Remove the local `useFocusTrap` call and `containerRef` where present (Modal owns them); remove the now-unused imports (`useFocusTrap`, `useRef`) — `noUnusedLocals` will fail otherwise.
- `onClose`: AskDialog's scrim currently does NOT close on click (a bridge question must be answered) — for AskDialog pass `onClose={() => {}}` and keep its explicit skip/dismiss control as-is. The other three close on scrim click as they do today.
- `title`: pass the modal's existing heading text (AskDialog: its `header` value; TopicSettingsModal: "Topic settings"; NewTopicModal: "Start a new topic"; SessionHistoryModal: "Session history") and delete the old inline heading element.
- `wide`: `true` for SessionHistoryModal and TopicSettingsModal, `false` otherwise (match each modal's current max-width intent).
- Keep ALL inner content markup unchanged — this task migrates the shell only. AskDialog's confidence-picker branch must be byte-identical after the shell swap.

- [ ] **Step 2: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/renderer/src/components/AskDialog.tsx app/src/renderer/src/components/TopicSettingsModal.tsx app/src/renderer/src/components/NewTopicModal.tsx app/src/renderer/src/components/SessionHistoryModal.tsx
git commit -m "refactor(polish): all four modals adopt the shared Modal shell"
```

---

### Task 7: HomeView — the morning page

**Files:**
- Modify: `app/src/renderer/src/app/HomeView.tsx`

**Interfaces:**
- Consumes: `InkNode`, `DendriteDivider` (Task 2), `StatBlock`, `Button`, `Card` (Task 3), `.fig-caption` / `--font-serif` (Task 1).

- [ ] **Step 1: Restyle**

Read the file first; apply these concrete conversions (structure/arrangement unchanged):

1. The greeting heading adopts the serif display: className gains `font-[var(--font-serif)] text-[length:var(--text-display)]` replacing its current font/size classes.
2. Streak + due-count numbers become `StatBlock`s (`tone="warm"` for streak, `tone="cool"` for due) in a `grid grid-cols-2 gap-3 max-w-xs`; the streak StatBlock gets `caption={'Fig. 1 — days of uninterrupted recall'}`, due gets `caption={'Fig. 2 — items awaiting free recall'}`.
3. Every section heading ("Continue learning", the coach row, the flashback card header) gets a `DendriteDivider className="mb-3"` directly beneath it, replacing any existing `border-b`/`border-t` hairline on that header.
4. Each topic card in the continue-learning grid gets an `<InkNode id={topic.topic} variant={/* 'filled' if due>0 or review count>0, else 'outlined' */} size={16} />` at the start of its title row. Use the card's existing counts to pick the variant: `filled` when the topic has any reviewed/consolidated nodes, `outlined` otherwise (exact expression depends on the TopicSummary fields used in the card — pick the field the card already renders as its review count).
5. The primary "Clear today's reviews" CTA becomes `<Button variant="primary">` (keeping its onClick); secondary actions in the view become `<Button variant="ghost">`.
6. Do not change data fetching, achievement toasts, or pulse logic.

- [ ] **Step 2: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/renderer/src/app/HomeView.tsx
git commit -m "feat(polish): HomeView morning-page restyle with ink motifs"
```

---

### Task 8: Sidebar + CommandPalette flagship treatment

**Files:**
- Modify: `app/src/renderer/src/App.tsx` (sidebar chrome only)
- Modify: `app/src/renderer/src/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: `InkNode` (Task 2), serif tokens (Task 1).

- [ ] **Step 1: Sidebar wordmark**

In `App.tsx`'s aside header, the `Engram` wordmark div: replace `font-[var(--font-display)] text-lg tracking-tight` with `font-[var(--font-serif)] text-lg tracking-tight` (the wordmark goes serif; nav items stay Space Grotesk).

- [ ] **Step 2: CommandPalette**

Read the file; apply:

1. The palette panel keeps its current structure; section headers ("Views", "Topics", "Nodes" — whatever the current group labels are) become `fig-caption` styled (`className="fig-caption px-3 pt-2 pb-1"` replacing their current label classes).
2. Node-result rows get `<InkNode id={nodeId} variant="outlined" color="var(--color-ink-cool)" size={12} />` as a leading glyph (before the node label). Topic rows get `<InkNode id={topicId} variant="filled" size={12} />`.
3. The input placeholder becomes `Search the atlas…`.
4. No behavioral changes: fuzzy matching, keyboard nav, and actions untouched.

- [ ] **Step 3: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/src/App.tsx app/src/renderer/src/components/CommandPalette.tsx
git commit -m "feat(polish): serif wordmark and atlas-styled command palette"
```

---

### Task 9: Dashboard/Settings/Artifacts token + component migration

**Files:**
- Modify: `app/src/renderer/src/app/DashboardView.tsx`
- Modify: `app/src/renderer/src/app/SettingsView.tsx`
- Modify: `app/src/renderer/src/app/ArtifactGalleryView.tsx`

**Interfaces:**
- Consumes: `StatBlock`, `Button`, `SegmentedControl` (Task 3), `DendriteDivider` (Task 2), `.fig-caption` (Task 1).

- [ ] **Step 1: DashboardView**

Read the file; apply: header stat trio (due/pending/streak) becomes three `StatBlock`s in a `grid grid-cols-3 gap-3`; each `Section`-style heading gets a `DendriteDivider className="mb-3"`; existing StatCards inside sections are left as-is unless they are plain divs duplicating StatBlock's shape — in that case convert them to `StatBlock`. Structural layout, charts, and CoachSessionPanel untouched.

- [ ] **Step 2: SettingsView**

Read the file; its ToggleRow segmented pickers (session mode, explorables, focus, momentum, decay) convert to `SegmentedControl` with the same option values/labels/descriptions and the same onChange handlers. Any custom-styled action buttons ("Check for reviews now", "Export", etc.) become `Button variant="ghost"` (destructive ones, if any, `variant="danger"`). Panel headers get `DendriteDivider`.

- [ ] **Step 3: ArtifactGalleryView**

Read the file; each artifact card's "Open explorable →" affordance becomes `Button variant="ghost"` (keeping onClick); the card title row gets `<InkNode id={nodeId} variant="filled" color="var(--color-ink-violet)" size={14} />` (violet = synthesis signal); empty state gets a `fig-caption` line: `Fig. — no explorables built yet; threshold concepts earn them.`

- [ ] **Step 4: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/src/app/DashboardView.tsx app/src/renderer/src/app/SettingsView.tsx app/src/renderer/src/app/ArtifactGalleryView.tsx
git commit -m "feat(polish): Dashboard/Settings/Artifacts migrate to shared primitives"
```

---

## Final verification (after all tasks + whole-branch review)

1. `npm run typecheck && npm run build` clean.
2. Interactive pass (with the user or via the packaged app): visit every view; start a Learn session, switch to Topic Map and back — transcript scroll, composer draft, and banner state intact; sidebar Learn dot visible while away and pulsing while the model responds; "All topics" exits explicitly; all four modals render via the shared shell; confidence picker and beat stepper interaction unchanged.
3. Packaged rebuild/reinstall via the standard sequence (check for live sessions first: `ps aux | grep -- "--tools Bash,Write,Read,Task" | grep -v grep`).
