import React, { Suspense, lazy, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { EnvironmentGate } from './components/EnvironmentGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BootSplash } from './components/BootSplash'
import { applyStoredTheme, reapplyIfSystem, THEME_CHANGE_EVENT, type ResolvedTheme } from './shared/theme'
import './index.css'

// Applied synchronously, before ReactDOM even creates the root — a local
// module load has no network round-trip, so this lands well before the
// first paint and the app never flashes its Night Atlas dark palette before
// snapping to light (or vice versa). See shared/theme.ts.
const initialTheme = applyStoredTheme()

// Code-split: NeuralField drags in `three` (the single heaviest dependency).
// It's purely decorative and fixed/pointer-events-none, so deferring its chunk
// behind Suspense costs nothing visually — the void background is already the
// resting state — and it's a sibling of App/BootSplash below, not an ancestor,
// so its suspension never blocks their first paint.
const NeuralField = lazy(() => import('./components/NeuralField').then((m) => ({ default: m.NeuralField })))

/** Listens for `THEME_CHANGE_EVENT` (fired by shared/theme.ts's
 * setThemeChoice, from the Settings toggle) purely to remount NeuralField —
 * every other themed color in the app is a CSS custom property that
 * recomputes for free when `data-theme` changes, but NeuralField samples its
 * particle palette from those properties once, imperatively, at mount (see
 * cssColor() in components/NeuralField.tsx). Without this, flipping the
 * toggle mid-session would leave the field rendering the OTHER theme's ink
 * colors until a full app reload. */
function ThemeRoot() {
  const [theme, setTheme] = useState<ResolvedTheme>(initialTheme)
  useEffect(() => {
    function onChange(e: Event) {
      setTheme((e as CustomEvent<ResolvedTheme>).detail)
    }
    window.addEventListener(THEME_CHANGE_EVENT, onChange)
    // Live OS theme changes only matter while the user hasn't made an
    // explicit choice — reapplyIfSystem() is a no-op once they have.
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onSystemChange = () => reapplyIfSystem()
    media.addEventListener('change', onSystemChange)
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onChange)
      media.removeEventListener('change', onSystemChange)
    }
  }, [])

  return (
    <React.StrictMode>
      {/* NeuralField is mounted once per resolved theme, permanently, at the
          true root, in its normal ambient state from the first frame — no
          boot-specific behavior. BootSplash is a conventional logo/wordmark
          launch splash layered on top of everything for a brief, fixed
          moment before fading away on its own; it and the field are
          independent, not a hand-off between two states of one thing. */}
      <Suspense fallback={null}>
        <NeuralField key={theme} theme={theme} />
      </Suspense>
      <ErrorBoundary>
        <EnvironmentGate>
          <App />
        </EnvironmentGate>
      </ErrorBoundary>
      <BootSplash />
    </React.StrictMode>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<ThemeRoot />)
