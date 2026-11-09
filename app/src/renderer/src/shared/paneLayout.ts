import { useCallback, useState } from 'react'

/**
 * Remembered pane sizes and collapsed states, by a stable key such as
 * "lab.rail". Per viewer, in localStorage, like the editor prefs.
 */

const PREFIX = 'engram.pane.'

export interface PaneState {
  size: number
  collapsed: boolean
}

export function clampSize(n: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, n)))
}

export function readPane(key: string, def: number, min: number, max: number): PaneState {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null') as Partial<PaneState> | null
    return {
      size: typeof raw?.size === 'number' && Number.isFinite(raw.size) ? clampSize(raw.size, min, max) : def,
      collapsed: raw?.collapsed === true,
    }
  } catch {
    return { size: def, collapsed: false }
  }
}

function writePane(key: string, s: PaneState): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(s))
  } catch {
    // Storage unavailable: the layout lasts this session only.
  }
}

export interface Pane extends PaneState {
  setSize: (n: number) => void
  toggle: () => void
  reset: () => void
  min: number
  max: number
}

export function usePane(key: string, def: number, min: number, max: number): Pane {
  const [state, setState] = useState(() => readPane(key, def, min, max))
  const apply = useCallback(
    (next: PaneState) => {
      setState(next)
      writePane(key, next)
    },
    [key],
  )
  return {
    ...state,
    min,
    max,
    setSize: (n) => apply({ size: clampSize(n, min, max), collapsed: false }),
    toggle: () => apply({ ...state, collapsed: !state.collapsed }),
    reset: () => apply({ size: def, collapsed: false }),
  }
}
