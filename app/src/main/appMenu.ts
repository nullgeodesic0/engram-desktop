import { app, Menu } from 'electron'
import { showPairingCode } from './link/linkService'
import { isMac } from './platform'

/** The native menu bar — the single loudest "this is a real app" signal on
 * macOS. Actions route through `focusOrCreateWindow`, the same deep-link
 * entry point the tray and review notifications already use, so a menu click
 * works even when the window has been closed (tray-only mode) and needs to
 * be recreated first.
 *
 * The Help menu below opens the in-app help sheet, not a link out — that
 * distinction is why it exists now when it didn't before. This app has no
 * `homepage`/`repository` in package.json, so an external "visit our docs"
 * link would either be a placeholder or dead on arrival — worse than no menu
 * item at all. A keyboard reference and glossary rendered from the app's own
 * data has no such dependency, so that reasoning never applied to it.
 * Deliberately no accelerator here: the sheet's other entry point is `?`,
 * bound in the renderer (App.tsx) where it can check focus state before
 * firing. An Electron-level accelerator can't do that — it would fire while
 * the learner is mid-sentence in the composer, "?" and all. */
export function installAppMenu(focusOrCreateWindow: (navigateTo?: string) => void): void {
  // Windows and Linux get NO application menu, deliberately.
  //
  // The window is `frame: false` on every platform (TitleBar.tsx draws its own
  // chrome), and a frameless window on Windows/Linux has nowhere to render a
  // menu bar — Electron neither draws one nor fires its accelerators. Leaving
  // the macOS template installed there would therefore ship a menu that is
  // invisible AND inert: every item below would silently do nothing, and the
  // half of the template that is macOS-only (`about`, `hide`, `hideOthers`,
  // `unhide`, and every `Cmd+…` accelerator, which Electron does not map to
  // Ctrl off macOS) would be dead weight on top of that.
  //
  // So those platforms clear the menu outright — which also removes the
  // default Electron menu, whose stray items (a devtools toggle in a shipped
  // build) have no business in this app — and the accelerators the menu owns
  // on macOS are re-homed to the renderer's own keydown handler instead. See
  // the `isMacUI()` block in App.tsx; the two lists must stay in step.
  if (!isMac) {
    Menu.setApplicationMenu(null)
    return
  }

  const isDev = !app.isPackaged
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => focusOrCreateWindow('settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    // Without an Edit menu, macOS has no route for the standard clipboard
    // accelerators — ⌘C/⌘V/⌘X/⌘A silently die in every text field.
    { role: 'editMenu' },
    {
      label: 'Session',
      submenu: [
        { label: 'New Topic', accelerator: 'Cmd+N', click: () => focusOrCreateWindow('learn:new-topic') },
        { label: 'Resume Last Learn', accelerator: 'Cmd+L', click: () => focusOrCreateWindow('learn') },
        { label: 'Review Now', accelerator: 'Shift+Cmd+R', click: () => focusOrCreateWindow('review') },
        { type: 'separator' },
        { label: 'Session History…', accelerator: 'Shift+Cmd+H', click: () => focusOrCreateWindow('history:all') },
        { type: 'separator' },
        // The link server is already listening — a paired phone needs nothing
        // from this menu. This is only for admitting a NEW device, which is
        // why it opens a short-lived code rather than living in Settings as a
        // toggle: pairing is an event, not a state.
        { label: 'Link a Phone…', click: () => void showPairingCode() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'Cmd+0', click: () => focusOrCreateWindow('home') },
        { label: 'Learn', accelerator: 'Cmd+1', click: () => focusOrCreateWindow('learn') },
        { label: 'Review', accelerator: 'Cmd+2', click: () => focusOrCreateWindow('review') },
        { label: 'Topic Map', accelerator: 'Cmd+3', click: () => focusOrCreateWindow('topics') },
        { label: 'Coach', accelerator: 'Cmd+4', click: () => focusOrCreateWindow('dashboard') },
        { label: 'Artifacts', accelerator: 'Cmd+5', click: () => focusOrCreateWindow('artifacts') },
        { label: 'Grades', accelerator: 'Cmd+7', click: () => focusOrCreateWindow('grades') },
        { type: 'separator' },
        ...(isDev ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as Electron.MenuItemConstructorOptions[]) : []),
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [{ label: 'Keyboard Shortcuts && Glossary', click: () => focusOrCreateWindow('help') }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
