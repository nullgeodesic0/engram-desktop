import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { EnvironmentGate } from './components/EnvironmentGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BootSplash } from './components/BootSplash'
import './index.css'

// Code-split: NeuralField drags in `three` (the single heaviest dependency).
// It's purely decorative and fixed/pointer-events-none, so deferring its chunk
// behind Suspense costs nothing visually — the void background is already the
// resting state — and it's a sibling of App/BootSplash below, not an ancestor,
// so its suspension never blocks their first paint.
const NeuralField = lazy(() => import('./components/NeuralField').then((m) => ({ default: m.NeuralField })))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* NeuralField is mounted once, permanently, at the true root, in its normal
        ambient state from the first frame — no boot-specific behavior. BootSplash
        is a conventional logo/wordmark launch splash layered on top of everything
        for a brief, fixed moment before fading away on its own; it and the field
        are independent, not a hand-off between two states of one thing. */}
    <Suspense fallback={null}>
      <NeuralField />
    </Suspense>
    <ErrorBoundary>
      <EnvironmentGate>
        <App />
      </EnvironmentGate>
    </ErrorBoundary>
    <BootSplash />
  </React.StrictMode>,
)
