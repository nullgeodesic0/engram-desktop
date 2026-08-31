/**
 * Which OS the renderer is running on, and the two presentation decisions
 * that follow from it.
 *
 * The value comes from the preload bridge (`window.engram.platform`), not
 * from `navigator.userAgent` — the bridge reads Node's own `process.platform`
 * in the main-world-adjacent preload, which is the authoritative answer, and
 * doesn't force this module to parse a UA string that Chromium reserves the
 * right to freeze or lie about.
 *
 * Defaults to macOS-shaped output when the bridge is absent so that unit
 * tests (jsdom, no preload) and any future non-Electron host render something
 * coherent rather than throwing on `undefined`.
 */

function platform(): NodeJS.Platform {
  return (typeof window !== 'undefined' && window.engram?.platform) || 'darwin'
}

export function isMacUI(): boolean {
  return platform() === 'darwin'
}

export function isWindowsUI(): boolean {
  return platform() === 'win32'
}

/**
 * Rewrites a macOS shortcut string for the current platform, so the help
 * sheet and the command palette hints tell a Windows user the truth.
 *
 * The app's shortcut tables are authored in macOS glyphs (`⇧⌘H`) because
 * that's the platform it was built on and the glyphs are the compact form.
 * Everywhere else, ⌘ is Ctrl and ⌥ is Alt, and the convention is words joined
 * by `+` rather than glyphs run together — `Ctrl+Shift+H`, not `⇧CtrlH`,
 * which is why this is a real translation and not a character substitution.
 */
export function shortcutLabel(macGlyphs: string, mac: boolean = isMacUI()): string {
  if (mac) return macGlyphs
  const parts: string[] = []
  let rest = ''
  for (const ch of macGlyphs) {
    if (ch === '⌘') parts.push('Ctrl')
    else if (ch === '⇧') parts.push('Shift')
    else if (ch === '⌥') parts.push('Alt')
    else if (ch === '⌃') parts.push('Ctrl')
    else rest += ch
  }
  // Modifier order is the platform's own convention, not the order the glyphs
  // happened to be written in: Windows and most Linux DEs write Ctrl first,
  // then Shift, then Alt.
  const order = ['Ctrl', 'Shift', 'Alt']
  const mods = order.filter((m) => parts.includes(m))
  const key = rest
    .replace(/⏎/g, 'Enter')
    .replace(/↩/g, 'Enter')
    .replace(/⌫/g, 'Backspace')
    .replace(/⎋/g, 'Esc')
  return [...mods, key].filter(Boolean).join('+')
}

/**
 * What to call the machine the app is running on, in prose.
 *
 * Several strings in Settings said "this Mac" — accurate on one platform and
 * simply wrong on the other two, in a product whose whole voice depends on
 * never telling the learner something untrue. "PC" is the word Windows users
 * use for their own machine; Linux has no such settled shorthand, so it gets
 * the neutral one.
 */
export function deviceNoun(): string {
  if (isMacUI()) return 'Mac'
  if (isWindowsUI()) return 'PC'
  return 'computer'
}

/**
 * The commands that build and install a newer build, for the platform the
 * user is actually on. Mirrors docs/development.md's "Packaged install flow";
 * keep the two in step.
 */
export function updateCommands(): string[] {
  if (isWindowsUI()) {
    return ['git pull', 'npm run dist:win', 'Run app\\dist\\Engram Desktop Setup <version>.exe']
  }
  if (isMacUI()) {
    return ['git pull', 'npm run dist:mac', 'cp -R "app/dist/mac-arm64/Engram Desktop.app" /Applications/']
  }
  return ['git pull', 'npm run dist:linux', 'chmod +x "app/dist/Engram Desktop-<version>.AppImage" && ./"Engram Desktop-<version>.AppImage"']
}
