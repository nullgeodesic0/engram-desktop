import { app, Menu } from 'electron'

/** The native menu bar — the single loudest "this is a real app" signal on
 * macOS. Actions route through `focusOrCreateWindow`, the same deep-link
 * entry point the tray and review notifications already use, so a menu click
 * works even when the window has been closed (tray-only mode) and needs to
 * be recreated first.
 *
 * No Help menu: package.json has no `homepage`/`repository` to link to, and
 * a wrong/placeholder URL is worse than no Help menu at all. */
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
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
