import { app, Menu } from 'electron'

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
