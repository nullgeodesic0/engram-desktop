import { app, shell, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { cp, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { registerReadHandlers } from './ipc/readHandlers'
import { registerSessionHandlers, rebindWindow } from './ipc/sessionHandlers'
import { resolveEngramPlugin } from './session/pluginResolver'
import { resolveClaudeBinary } from './session/claudeResolver'
import { engramLearningHome } from './engramCli/readOnly'
import {
  registerExplorableSchemePrivileges,
  installExplorableProtocolHandler,
  registerExplorableRoot,
  resolveExplorablePath,
} from './explorableProtocol'
import { bridgeServer } from './bridge/bridgeServer'
import { getNotifierSettings, setNotifierSettings } from './session/notifierState'
import { getUnlockedAchievements, recordUnlocked } from './session/achievementsStore'
import { startReviewNotifier, stopReviewNotifier, checkReviewsNow, refreshDueCount } from './session/reviewNotifier'
import { checkForUpdate, getCachedUpdateCheck, maybeAutoCheckForUpdate } from './session/updateCheck'
import { restoreWindowState, trackWindowState } from './windowState'
import { installAppMenu } from './appMenu'
import type { EnvironmentCheckResult } from '../shared/types'

const execFileAsync = promisify(execFile)

// Set as early as possible so the app name is correct everywhere that reads
// it — the About panel, the menu bar's first item, dev-mode window chrome —
// not just once whenReady's menu installation runs.
app.setName('Engram Desktop')

// Must run before app is ready (Electron enforces this) — see explorableProtocol.ts
// for why explorables get a dedicated scheme instead of file://.
registerExplorableSchemePrivileges()

// Without this, a second launch (e.g. an impatient double-click while the first
// launch is still loading — startup does a `claude --version` exec plus other
// I/O before the window shows) boots a genuinely separate, independent process
// rather than focusing the existing one: confirmed live via debug logging that
// showed `app.whenReady().then()`'s startup callback firing twice, 8 seconds
// apart, each time creating a window from a null mainWindow — i.e. two real
// processes, not a bug in the tray/window-recreation logic. This must run
// before any other startup work.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  // A second launch attempt while we're already running — bring the existing
  // window forward instead of doing nothing (which is what silently let a
  // second process boot its own window before this fix existed).
  app.on('second-instance', () => focusOrCreateWindow())
}

/** Surfaces the two silent-failure modes a packaged app can hit (Engram plugin not
 * found, `claude` not resolvable outside a terminal's PATH) as real, checkable state
 * instead of a blank/broken window — see claudeResolver.ts for why the latter needs
 * more than a bare `spawn('claude', ...)`. */
async function checkEnvironment(): Promise<EnvironmentCheckResult> {
  const result: EnvironmentCheckResult = { pluginOk: false, claudeOk: false }
  try {
    const plugin = resolveEngramPlugin()
    result.pluginOk = true
    result.pluginVersion = plugin.version
  } catch (err) {
    result.pluginError = err instanceof Error ? err.message : String(err)
  }
  try {
    const claudeBin = await resolveClaudeBinary()
    await execFileAsync(claudeBin, ['--version'], { timeout: 8000 })
    result.claudeOk = true
    result.claudePath = claudeBin
  } catch (err) {
    result.claudeError = err instanceof Error ? err.message : String(err)
  }
  return result
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

/** Assets bundled via `extraResources` (see package.json) land beside the packaged
 * app's Resources folder; in dev they're still at the project root. */
function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(__dirname, '../../resources', name)
}

function sendNav(view: string): void {
  mainWindow?.webContents.send('app:navigate', view)
}

/** The sidebar due-badge's push side — see reviewNotifier's 5-min poll and
 * `refreshDueCount`'s freshness path. Mirrors `sendNav` exactly: reads the
 * live `mainWindow`, no-ops if it doesn't exist (tray-only, no window open). */
function sendDueCount(count: number): void {
  mainWindow?.webContents.send('engram:due-count', count)
}

/** Shared by the tray's "Open"/"Check reviews now" and a notification click —
 * brings the window forward (creating it if the app was running tray-only) and
 * optionally deep-links to a view once the renderer is actually ready for it. */
function focusOrCreateWindow(navigateTo?: string): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    if (navigateTo) sendNav(navigateTo)
    return
  }
  const win = createWindow()
  rebindWindow(win)
  if (navigateTo) win.webContents.once('did-finish-load', () => sendNav(navigateTo))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resourcePath('trayTemplate.png'))
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Engram Desktop')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: () => focusOrCreateWindow() },
      { label: 'Check reviews now', click: () => checkReviewsNow(() => focusOrCreateWindow('review')) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => focusOrCreateWindow())
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...restoreWindowState(),
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = win
  trackWindowState(win)

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.on('enter-full-screen', () => win.webContents.send('window:fullscreen', true))
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false))

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return // quitting already; don't do startup work on a losing second instance

  app.setAboutPanelOptions({
    applicationName: 'Engram Desktop',
    applicationVersion: app.getVersion(),
    credits:
      'First-principles learning, verified by free recall.\n' +
      'Built on the engram learning plugin (nagisanzenin).\n' +
      `© ${new Date().getFullYear()} Tyler Hadsell.`,
  })
  // Menu clicks route through focusOrCreateWindow (not raw sendNav) so a click
  // while the app is tray-only-with-no-window recreates the window first and
  // defers the nav until it's actually ready — see focusOrCreateWindow above.
  installAppMenu(focusOrCreateWindow)

  // Logged for diagnostics; the renderer's own first-run environment-check screen
  // (via engram:environmentCheck below) is what actually surfaces failures to the user.
  checkEnvironment().then((r) => {
    console.log('[engram-desktop] environment check:', r)
  })

  ipcMain.handle('engram:environmentCheck', () => checkEnvironment())

  registerReadHandlers()
  installExplorableProtocolHandler()

  // Explorable artifacts are self-contained HTML files the artifact-smith wrote to
  // arbitrary filesystem paths (not confined to ~/.claude/learning). Opening one in
  // its own window (rather than an iframe in the main renderer) sidesteps the main
  // window's CSP entirely and matches the explorable contract's "full attention"
  // predict/act/explain flow better than a cramped embedded frame.
  ipcMain.handle('engram:openArtifact', async (_e, absolutePath: string) => {
    const win = new BrowserWindow({
      width: 900,
      height: 720,
      title: 'Engram Explorable',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    try {
      await win.loadFile(absolutePath)
    } catch (err) {
      // Previously silent (unawaited loadFile rejection) — the window would open
      // and just sit blank with no visible sign of why. Root-caused live: some
      // artifact paths from engram.py's own `artifact list` are relative to the
      // learning home rather than absolute (now resolved before this handler ever
      // sees them — see engramArtifactList in readOnly.ts), but surfacing the
      // error here too means a genuinely missing/moved file fails loudly instead.
      dialog.showErrorBox('Couldn\'t open explorable', `${absolutePath}\n\n${err instanceof Error ? err.message : String(err)}`)
      win.close()
    }
  })

  // In-app viewer's counterpart to the above: resolves+validates a raw artifact
  // path (which, unlike engramArtifactList's output, may still be relative when
  // it comes straight from a topic graph's node.artifact field — see
  // resolveExplorablePath) and, on success, allow-lists its directory for the
  // explorable:// protocol handler before handing the renderer a URL to point
  // an iframe at. Never touches Node/fs from the renderer side — the renderer
  // only ever receives an explorable:// URL string, never a raw path back.
  ipcMain.handle(
    'engram:openExplorable',
    async (_e, rawPath: string): Promise<{ url: string; absolutePath: string } | { error: string }> => {
      const resolved = await resolveExplorablePath(rawPath)
      if (!resolved) return { error: `Explorable file not found: ${rawPath}` }
      registerExplorableRoot(resolved)
      return { url: `explorable://local${resolved}`, absolutePath: resolved }
    },
  )

  // File attachment support (mid-chat context, or a topic's "initial context" files —
  // see topicSettings.ts). We don't read/encode bytes ourselves: the model already has
  // the Read tool in its allowlist (see permissionConfig.ts), so a picked file's
  // absolute path gets woven into the message/system-prompt text and the model reads
  // it itself — no new tool surface, no binary-transport protocol to build.
  ipcMain.handle('dialog:pickFiles', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: 'Attach files',
    })
    return result.canceled ? [] : result.filePaths
  })

  // A plain filesystem copy of the Engram plugin's own storage (topics, receipts,
  // artifacts, learner-model.json) to a folder the user picks — this is now a real
  // personal record with no other in-app backup path, so a one-click snapshot matters.
  // engram.py's own lockfile protects against a concurrent live session writing mid-copy
  // being read torn — fs.cp isn't transactional, but a snapshot a few files out of sync
  // is a non-issue for a point-in-time backup.
  ipcMain.handle('engram:exportData', async () => {
    if (!mainWindow) return { canceled: true }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder to save your Engram backup into',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const home = await engramLearningHome()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(result.filePaths[0], `engram-learning-backup-${stamp}`)
    await mkdir(dest, { recursive: true })
    await cp(home, dest, { recursive: true })
    return { canceled: false, path: dest }
  })

  // Review-reminder settings + manual trigger (see notifierState.ts / reviewNotifier.ts).
  ipcMain.handle('notifier:getSettings', () => getNotifierSettings())
  ipcMain.handle(
    'notifier:setSettings',
    async (_e, patch: { remindersEnabled?: boolean; cadenceMinutes?: number; dockBadgeEnabled?: boolean }) => {
      const next = await setNotifierSettings(patch)
      // Clear right away rather than waiting for the next poll — a toggle the
      // user just flipped off should stop lying to them immediately.
      if (!next.dockBadgeEnabled) app.setBadgeCount(0)
      return next
    },
  )
  ipcMain.handle('notifier:checkNow', () => checkReviewsNow(() => focusOrCreateWindow('review'), sendDueCount))
  // Freshness path for the sidebar badge — App calls this on window focus and
  // when a review sitting ends, so the badge doesn't wait up to 5 minutes for
  // the background poll to notice a sitting just cleared the queue.
  ipcMain.handle('engram:refresh-due-count', () => refreshDueCount(sendDueCount))
  ipcMain.handle('app:getLoginItemSettings', () => ({ openAtLogin: app.getLoginItemSettings().openAtLogin }))
  ipcMain.handle('app:setLoginItemSettings', (_e, openAtLogin: boolean) => {
    app.setLoginItemSettings({ openAtLogin })
    return { openAtLogin }
  })
  ipcMain.handle('app:checkForUpdate', () => checkForUpdate())
  ipcMain.handle('app:getCachedUpdateCheck', () => getCachedUpdateCheck())
  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('achievements:getUnlocked', () => getUnlockedAchievements())
  ipcMain.handle('achievements:recordUnlocked', (_e, ids: string[]) => recordUnlocked(ids))

  // Frameless-shell window controls (see TitleBar.tsx) — always target the current
  // mainWindow, never a captured window, since the tray app can close and recreate it.
  ipcMain.handle('window:close', () => { mainWindow?.close() })
  ipcMain.handle('window:minimize', () => { mainWindow?.minimize() })
  // The (+) traffic dot mirrors the native macOS green button: toggle true
  // fullscreen (own Space), not a window-maximize.
  ipcMain.handle('window:zoom', () => {
    if (!mainWindow) return
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
  })
  // Title-bar double-click keeps the native "zoom" (maximize) behavior.
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })

  registerSessionHandlers(createWindow())
  createTray()
  startReviewNotifier(() => focusOrCreateWindow('review'), sendDueCount)

  // Once per launch, well after startup settles (30s — this is a `gh` network
  // call, no reason to compete with the `claude --version` probe and window
  // creation above). Skips entirely if already checked today; a user-triggered
  // re-check from Settings is always allowed regardless of this timer.
  setTimeout(() => {
    void maybeAutoCheckForUpdate()
  }, 30_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) rebindWindow(createWindow())
  })
})

// The tray (created above) is what keeps the app meaningfully "open" now — closing
// the window is no longer the same thing as quitting, matching a normal menu-bar
// app's convention. Only the tray's own Quit item or ⌘Q (which calls app.quit()
// directly, bypassing this handler entirely) actually exits.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  stopReviewNotifier()
  bridgeServer.stop()
})
