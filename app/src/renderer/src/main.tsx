import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { EnvironmentGate } from './components/EnvironmentGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NeuralField } from './components/NeuralField'
import { BootSplash } from './components/BootSplash'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* NeuralField is mounted once, permanently, at the true root, in its normal
        ambient state from the first frame — no boot-specific behavior. BootSplash
        is a conventional logo/wordmark launch splash layered on top of everything
        for a brief, fixed moment before fading away on its own; it and the field
        are independent, not a hand-off between two states of one thing. */}
    <NeuralField />
    <ErrorBoundary>
      <EnvironmentGate>
        <App />
      </EnvironmentGate>
    </ErrorBoundary>
    <BootSplash />
  </React.StrictMode>,
)
