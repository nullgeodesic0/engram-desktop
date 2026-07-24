export type PulseKind = 'recalled' | 'streak' | 'capstone' | 'resolve' | 'synthesis'

type PulseListener = (kind: PulseKind) => void

const listeners = new Set<PulseListener>()

/** Minimal decoupled pub/sub so components far from `NeuralField` (mounted once
 * in App.tsx) can trigger a reactive pulse without prop-drilling — same shape
 * as the existing `window.engram.onNavigate` cross-tree signal. */
export function emitPulse(kind: PulseKind): void {
  for (const cb of listeners) cb(kind)
}

export function onPulse(cb: PulseListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

let ambientLevel = 0
const ambientListeners = new Set<(level: number) => void>()

/** Session momentum (0–1), separate from the one-shot pulses above — a slow
 * ambient brightening as a Learn session's recall streak builds, reset when
 * the user leaves the topic. */
export function setAmbientLevel(level: number): void {
  ambientLevel = Math.max(0, Math.min(1, level))
  for (const cb of ambientListeners) cb(ambientLevel)
}

export function onAmbientLevel(cb: (level: number) => void): () => void {
  ambientListeners.add(cb)
  cb(ambientLevel)
  return () => {
    ambientListeners.delete(cb)
  }
}
