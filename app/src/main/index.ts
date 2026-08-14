import { app, shell, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { registerLinkHandlers, startLinkServer, stopLinkServer, autoSettle } from './link/linkService'
import { registerReadHandlers } from './ipc/readHandlers'
import { registerSessionHandlers, rebindWindow, abortAllSessions, onIdle } from './ipc/sessionHandlers'
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
import { getAuthSettings, setAuthMode, setLocalModelSettings, setOpencodeModelSettings } from './session/authSettings'
import { isLoopbackUrl, listLocalModels, probeLocalModel } from './session/localModel'
import { checkOpencodeSetup, probeOpencodeModel } from './session/opencodeCapability'
import { apiKeyStore, isPlausibleApiKey } from './session/auth'
import { getUnlockedAchievements, recordUnlocked } from './session/achievementsStore'
import { startReviewNotifier, stopReviewNotifier, checkReviewsNow, refreshDueCount } from './session/reviewNotifier'
import { startPackScheduler, stopPackScheduler, topUpPacksNow } from './session/packScheduler'
import { packSchedulerDeps } from './link/linkService'
import { checkForUpdate, getCachedUpdateCheck, maybeAutoCheckForUpdate } from './session/updateCheck'
import { restoreWindowState, trackWindowState } from './windowState'
import { installAppMenu } from './appMenu'
import { installGlobalErrorHandlers, getCrashLog } from './session/crashLog'
import { buildNewTopicPrefill } from './deepLink'
import { createDeepLinkQueue } from './deepLinkQueue'
import type { EnvironmentCheckResult } from '../shared/types'

const execFileAsync = promisify(execFile)

// Installed before anything else can throw — see crashLog.ts's own doctrine
// comment for why this exists (previously: zero handler at all, so a main-
// process crash left no trace anywhere the learner could find).
installGlobalErrorHandlers()

// Set as early as possible so the app name is correct everywhere that reads
// it — the About panel, the menu bar's first item, dev-mode window chrome —
// not just once whenReady's menu installation runs.
app.setName('Engram Desktop')

// Must run before app is ready (Electron enforces this) — see explorableProtocol.ts
// for why explorables get a dedicated scheme instead of file://.
registerExplorableSchemePrivileges()

// engram:// deep links — Observatory's paper→topic hand-off (see deepLink.ts
// for the pure parse/shape-guard and handleDeepLink below for delivery).
// macOS routes a click on a registered scheme to this event directly, and —
// per Electron's own docs — can deliver it BEFORE whenReady resolves on a
// cold launch, not merely require the listener to exist by then; that's
// exactly why both calls below must be made before whenReady rather than
// inside it. handleDeepLink itself guards against acting on a link before
// the app is actually ready (see its own comment) since creating a
// BrowserWindow that early throws. Windows/Linux instead relaunch the
// process with the URL on argv, handled by the second-instance branch below.
app.setAsDefaultProtocolClient('engram')
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

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
  // second process boot its own window before this fix existed). On
  // Windows/Linux this is also how an engram:// click reaches an already-
  // running instance: the OS relaunches the app with the URL as a plain
  // argv entry rather than firing 'open-url' (that event is macOS-only), so
  // it's scanned for here before falling back to the plain focus. The scan
  // is case-insensitive to match parseEngramDeepLink's own host comparison
  // (nothing about an OS-relaunch argv is guaranteed lowercase).
  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find((a) => a.toLowerCase().startsWith('engram://'))
    if (deepLink) handleDeepLink(deepLink)
    // Always bring the window forward, regardless of whether a deep link
    // was present or valid — this handler's whole reason to exist is "a
    // second launch attempt must not silently do nothing" (see the comment
    // above), and a malformed/rejected link must not regress that guarantee
    // back to silence. Harmless when handleDeepLink already succeeded: it
    // already called focusOrCreateWindow('learn') itself, so this is just
    // an idempotent re-focus of the same window, not a second one.
    focusOrCreateWindow()
  })
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
// Holds a deep-link URL for the narrow window between an 'open-url' arriving
// before app.whenReady() resolves (see handleDeepLink) and the startup
// sequence draining it (below, in app.whenReady().then()). Factored into
// deepLinkQueue.ts (plain, electron-free) specifically so this piece of the
// pre-ready crash fix has real test coverage — see that file's own tests.
const deepLinkQueue = createDeepLinkQueue()

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
 * optionally deep-links to a view once the renderer is actually ready for it.
 * Guards the existing-window nav send on `isLoading()`, not just "does
 * `mainWindow` already exist": a window can exist but still be mid-navigation
 * (e.g. handleDeepLink below delivering to the window app.whenReady() just
 * created, moments earlier, in the same startup) — sending before the
 * renderer's listener is attached would silently lose the message the same
 * way it would for a genuinely brand-new window. */
function focusOrCreateWindow(navigateTo?: string): void {
  if (mainWindow) {
    const win = mainWindow
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (navigateTo) {
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', () => sendNav(navigateTo))
      } else {
        sendNav(navigateTo)
      }
    }
    return
  }
  const win = createWindow()
  rebindWindow(win)
  if (navigateTo) win.webContents.once('did-finish-load', () => sendNav(navigateTo))
}

/** Parses + validates an engram:// deep link and, if it survives, delivers a
 * prefill to the renderer's New Topic modal — PREFILL ONLY, this never
 * starts a session itself; the learner still has to review and hit Start
 * (see LearnSessionView's startNewTopic, which this changeset does not
 * touch). A malformed or hostile link is logged and dropped silently rather
 * than surfaced as an error dialog: the payload is untrusted input, and a
 * bad link someone else constructed is not the learner's problem to see. */
function deliverDeepLink(url: string): void {
  const prefill = buildNewTopicPrefill(url)
  if ('error' in prefill) {
    console.log('[engram-desktop] ignoring engram:// deep link —', prefill.error)
    return
  }
  focusOrCreateWindow('learn')
  const win = mainWindow
  if (!win) return // defensive only — focusOrCreateWindow always sets mainWindow once app is ready
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => win.webContents.send('app:new-topic-prefill', prefill))
  } else {
    win.webContents.send('app:new-topic-prefill', prefill)
  }
}

/** Entry point for both delivery paths ('open-url' and the second-instance
 * argv scan). Routed through `deepLinkQueue` first: macOS can fire
 * 'open-url' before whenReady resolves on a cold launch (see the comment
 * above `app.setAsDefaultProtocolClient`), and `deliverDeepLink` above
 * unconditionally creates a `BrowserWindow` when none exists yet — doing
 * that before the app is ready throws. `deepLinkQueue.handle` returns
 * `null` (and holds the URL) exactly when that's the case; the drain call
 * in app.whenReady().then() below is what surfaces it again once the
 * startup window already exists, calling `deliverDeepLink` directly rather
 * than back through this queue gate a second time. */
function handleDeepLink(url: string): void {
  const ready = deepLinkQueue.handle(url, () => app.isReady())
  if (ready !== null) deliverDeepLink(ready)
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
  registerLinkHandlers()
  // The phone-facing server comes up with the app so an already-paired device
  // reaches the Mac with no ceremony — that is the whole point of it being a
  // service rather than a script. Loopback until the learner opts in: there is
  // no transport encryption yet, and binding every interface because someone
  // opened an app is not a choice they made.
  void startLinkServer().catch((err) => {
    console.error('[engram-desktop] link server failed to start:', err)
  })
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

  /** Write an image the learner pasted or dropped into the composer to a temp
   * file, and return its path.
   *
   * The handwriting flow is built entirely on PATHS — the tutor is handed
   * absolute paths and reads them itself, with no binary transport anywhere in
   * the bridge (see the pickFiles comment above). Clipboard and drag-drop
   * hand the renderer BYTES instead, so the one thing missing was somewhere to
   * put them. This is that, and nothing more: it does not touch the learning
   * home, and it writes only into the OS temp directory, which matches the
   * design's "the image is ephemeral" decision — the file outlives the paste
   * only long enough to be read.
   *
   * The extension is taken from the MIME type rather than trusted from a
   * filename, since a pasted screenshot has no name at all. */
  ipcMain.handle('dialog:saveIncomingImage', async (_e, payload: { mime: string; bytes: ArrayBuffer; name?: string }) => {
    const EXT: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/heic': 'heic',
      'image/heif': 'heif',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/tiff': 'tif',
    }
    const ext = EXT[payload.mime]
    if (!ext) return { error: `unsupported image type: ${payload.mime || 'unknown'}` }
    const bytes = Buffer.from(payload.bytes)
    // A guard, not a policy: a pasted screenshot is ~1-5 MB, and anything an
    // order of magnitude past that is a mis-paste rather than a page of work.
    if (bytes.byteLength === 0) return { error: 'empty image' }
    if (bytes.byteLength > 40 * 1024 * 1024) return { error: 'image is too large (over 40 MB)' }
    const dir = join(tmpdir(), 'engram-handwriting')
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safe = (payload.name ?? 'pasted').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)
    const path = join(dir, `${stamp}-${safe}.${ext}`)
    await writeFile(path, bytes)
    return { path }
  })

  // The handwriting picker. Separate from the generic one because the two
  // flows differ in kind: this one's files become the learner's own graded
  // production (via a transcription they confirm), so it is filtered to
  // images and titled to say what will happen to them. Multi-select is
  // ordered by the dialog, which is the page order the transcription uses.
  ipcMain.handle('dialog:pickHandwriting', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: 'Photograph pages of your handwritten work, in order',
      buttonLabel: 'Transcribe',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'gif', 'tif', 'tiff'] }],
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

  // Dual-mode auth (authSettings.ts / auth.ts / apiKeyStore.ts). The key
  // never crosses this boundary outward — status carries presence + last4.
  ipcMain.handle('auth:getSettings', () => getAuthSettings())
  ipcMain.handle('auth:setMode', (_e, mode: unknown) => {
    if (mode !== 'subscription' && mode !== 'apiKey' && mode !== 'local' && mode !== 'opencodeCursor') {
      throw new Error(`auth:setMode: invalid mode: ${JSON.stringify(mode)}`)
    }
    return setAuthMode(mode)
  })
  // Local models. The base URL is confined to loopback on purpose: this
  // setting picks where TUTORING goes, and a remote address here would
  // quietly turn a "100% local, nothing leaves the machine" app into one
  // that streams a learner's productions to a third party. Anyone wanting a
  // remote endpoint can say so explicitly; it should not be reachable by
  // typing a hostname into a box labelled "local model".
  ipcMain.handle('auth:setLocalModel', (_e, baseUrl: unknown, model: unknown) => {
    if (typeof baseUrl !== 'string' || typeof model !== 'string') throw new Error('auth:setLocalModel: baseUrl and model must be strings')
    if (baseUrl.trim() !== '' && !isLoopbackUrl(baseUrl)) {
      throw new Error('Local-model server must be on this machine (localhost or 127.0.0.1).')
    }
    return setLocalModelSettings(baseUrl, model)
  })
  ipcMain.handle('auth:listLocalModels', (_e, baseUrl: unknown) => {
    if (typeof baseUrl !== 'string' || !isLoopbackUrl(baseUrl)) return []
    return listLocalModels(baseUrl)
  })
  ipcMain.handle('auth:probeLocalModel', (_e, baseUrl: unknown, model: unknown) => {
    if (typeof baseUrl !== 'string' || typeof model !== 'string') throw new Error('auth:probeLocalModel: baseUrl and model must be strings')
    if (!isLoopbackUrl(baseUrl)) throw new Error('Local-model server must be on this machine (localhost or 127.0.0.1).')
    return probeLocalModel(baseUrl, model)
  })
  // OpenCode + Cursor. `checkOpencodeSetup` is free (shells out to `opencode
  // models`, no server); `probeOpencodeModel` is NOT — it runs one real turn
  // through the user's own Cursor plan and reports the real cost back, so it
  // is a Settings button the learner presses, never something this app runs
  // on their behalf automatically.
  ipcMain.handle('auth:opencodeSetup', () => checkOpencodeSetup())
  ipcMain.handle('auth:setOpencodeModel', (_e, model: unknown) => {
    if (typeof model !== 'string') throw new Error('auth:setOpencodeModel: model must be a string')
    return setOpencodeModelSettings(model)
  })
  ipcMain.handle('auth:probeOpencodeModel', (_e, model: unknown) => {
    if (typeof model !== 'string') throw new Error('auth:probeOpencodeModel: model must be a string')
    return probeOpencodeModel(model)
  })
  ipcMain.handle('auth:keyStatus', () => apiKeyStore().status())
  ipcMain.handle('auth:setApiKey', (_e, key: unknown) => {
    if (!isPlausibleApiKey(key)) throw new Error('auth:setApiKey: not a plausible API key (8–256 printable characters, no spaces)')
    apiKeyStore().set(key)
    return apiKeyStore().status()
  })
  ipcMain.handle('auth:clearApiKey', () => {
    apiKeyStore().set(null)
    return apiKeyStore().status()
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
  // The CACHED verdict — no network. Home reads this so an available update
  // is visible where the learner already is, instead of only inside Settings
  // behind a button they would have to think to press. The refresh itself
  // stays on the once-a-day auto-check and the explicit Settings button.
  ipcMain.handle('app:cachedUpdateCheck', () => getCachedUpdateCheck())
  ipcMain.handle('app:getCachedUpdateCheck', () => getCachedUpdateCheck())
  ipcMain.handle('app:getCrashLog', () => getCrashLog())
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
  // Keeps the phone stocked without anyone remembering to — and now, without
  // making anyone wait: the poll below is a safety net, but the real trigger
  // is `onIdle`, firing the instant the desk goes free (a sitting closes, an
  // abort lands) so a chain of under-stocked topics fills back-to-back rather
  // than one every ten minutes. See packScheduler.ts's module doc for why
  // restraint moved from TIME to CONTENTION.
  startPackScheduler(packSchedulerDeps())
  // Settle first, every tick — see autoSettle's own doc comment for the
  // starvation this fixes. A topic's speculative stock can always wait one
  // more tick; evidence the learner already produced should not wait on a
  // pack-topup chain that has no natural stopping point.
  onIdle(() => {
    void autoSettle()
      .then((settled) => (settled ? undefined : topUpPacksNow(packSchedulerDeps())))
      .catch(() => {})
  })

  // Drain a deep link that arrived before we were ready to act on it (see
  // deepLinkQueue + handleDeepLink/deliverDeepLink's own comments) — the
  // startup window above already exists by this point, so deliverDeepLink's
  // isLoading() check (not a "just created it" assumption) is what
  // correctly decides whether to wait for did-finish-load or send
  // immediately. Calls deliverDeepLink directly (not handleDeepLink) since
  // this URL already passed the queue gate once; app.isReady() is
  // trivially true here anyway.
  const drainedDeepLink = deepLinkQueue.drain()
  if (drainedDeepLink) deliverDeepLink(drainedDeepLink)

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
  stopPackScheduler()
  // Children FIRST, then the bridge: a tutor killed after its bridge is
  // gone can race one last doomed HTTP call into the void.
  abortAllSessions()
  bridgeServer.stop()
  void stopLinkServer()
})

/** Launch-time orphan sweep — the belt-and-suspenders half of
 * `abortAllSessions` above. `before-quit` never runs on a crash, a
 * force-kill, or an installer's pkill, and a surviving tutor child keeps
 * writing its session transcript and blocks that session's `--resume`
 * (observed live, 2026-08-03). Our children are unambiguously identifiable:
 * their argv carries the app's own per-instance MCP config path
 * (`engram-desktop-mcp-<random>/mcp-config.json`, see permissionConfig.ts)
 * — nothing else on the machine launches claude with that marker. At launch
 * this process owns zero children, so every match is an orphan. SIGTERM,
 * not SIGKILL: the CLI flushes its transcript on TERM. Best-effort — a
 * failed sweep must never block startup. */
function sweepOrphanTutors(): void {
  execFile('ps', ['ax', '-o', 'pid=,command='], (err, stdout) => {
    if (err) return
    for (const line of stdout.split('\n')) {
      if (!line.includes('engram-desktop-mcp-')) continue
      const pid = Number(line.trim().split(/\s+/, 1)[0])
      if (Number.isFinite(pid) && pid > 1 && pid !== process.pid) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // already gone, or not ours to signal — either way, done
        }
      }
    }
  })
}
sweepOrphanTutors()
