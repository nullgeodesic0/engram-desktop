/** Theme persistence + resolution — the light/dark toggle's one source of
 * truth. 'system' (the default until the user makes an explicit choice)
 * tracks the OS `prefers-color-scheme`; 'dark'/'light' are explicit
 * overrides that win regardless of OS setting. Read synchronously (no
 * async storage) so main.tsx can apply the resolved theme before React's
 * first render — see the call at the top of that file. */

export type ThemeChoice = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'engram-theme-choice'

export function getStoredThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // localStorage unavailable (rare, e.g. a locked-down profile) — fall
    // back to system, the same default a first-ever launch gets.
  }
  return 'system'
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return choice
}

/** Writes the resolved theme onto <html data-theme="…">. The CSS override
 * block in index.css keys off `:root[data-theme="light"]`; no attribute
 * (or "dark") means the app's default Night Atlas palette, so this never
 * needs to write "dark" explicitly. */
/** Fired whenever the resolved theme is (re)applied — main.tsx listens so it
 * can remount NeuralField with the freshly-resolved palette (see the
 * `ThemeRoot` wrapper there); nothing else needs to subscribe since every
 * other color reference is a CSS custom property that recomputes for free. */
export const THEME_CHANGE_EVENT = 'engram-theme-changed'

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved)
  window.dispatchEvent(new CustomEvent<ResolvedTheme>(THEME_CHANGE_EVENT, { detail: resolved }))
}

/** Reads the stored choice (or defaults to system) and applies it — the
 * one call main.tsx makes before first paint. */
export function applyStoredTheme(): ResolvedTheme {
  const resolved = resolveTheme(getStoredThemeChoice())
  applyResolvedTheme(resolved)
  return resolved
}

/** Re-resolves and re-applies the theme if (and only if) the stored choice
 * is still 'system' — called from a `prefers-color-scheme` change listener
 * so an explicit user override is never clobbered by an OS-level flip. */
export function reapplyIfSystem(): void {
  if (getStoredThemeChoice() === 'system') applyResolvedTheme(resolveTheme('system'))
}

export function setThemeChoice(choice: ThemeChoice): ResolvedTheme {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Best-effort persistence — the theme still applies for this session
    // even if it can't be saved for the next launch.
  }
  const resolved = resolveTheme(choice)
  applyResolvedTheme(resolved)
  return resolved
}
