import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { EnvironmentGate } from './components/EnvironmentGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BootSplash } from './components/BootSplash'
import { NaveGround } from './components/NaveGround'
import { applyStoredTheme, reapplyIfSystem } from './shared/theme'
import './index.css'
import './fonts'

// Applied synchronously, before ReactDOM even creates the root — a local
// module load has no network round-trip, so this lands well before the
// first paint and the app never flashes its Night Atlas dark palette before
// snapping to light (or vice versa). See shared/theme.ts.
applyStoredTheme()

/** Follows live OS theme changes while the user hasn't made an explicit
 * choice (reapplyIfSystem() is a no-op once they have). The Nave ground is
 * pure CSS, so it follows `data-theme` on its own — nothing remounts. */
/** `data-awake` on <html>: false while the window is unfocused or hidden, so
 * the ground's sway (index.css, nf-sway) holds still when nobody is looking. */
function syncAwake() {
  document.documentElement.dataset.awake = String(document.visibilityState === 'visible' && document.hasFocus())
}
syncAwake()
document.addEventListener('visibilitychange', syncAwake)
window.addEventListener('focus', syncAwake)
window.addEventListener('blur', syncAwake)

function ThemeRoot() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onSystemChange = () => reapplyIfSystem()
    media.addEventListener('change', onSystemChange)
    return () => media.removeEventListener('change', onSystemChange)
  }, [])

  return (
    <React.StrictMode>
      {/* The Nave ground: a still backdrop at the true root, behind
          everything. BootSplash is a conventional launch splash layered on
          top for a brief, fixed moment before fading away on its own. */}
      <NaveGround />
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
