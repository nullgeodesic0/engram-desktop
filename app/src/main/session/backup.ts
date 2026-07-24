import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir, rm, rename, cp, copyFile, mkdtemp, stat, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, basename, relative, isAbsolute } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { app, dialog } from 'electron'
import { engramLearningHome } from '../engramCli/readOnly'
import type { BackupInfo, BackupNowResult, DescribeArchiveResult, RestoreArchiveResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

/** The five userData JSON files this app owns (see topicSettings.ts,
 * sessionIndex.ts, mapAnnotations.ts, achievementsStore.ts, notifierState.ts)
 * — engram.py's own learning state lives under ~/.claude/learning and is
 * backed up separately (via engramLearningHome — never hardcoded). Order
 * matches the brief's tar command example; a fresh install may be missing
 * some of these, so every place that reads this list treats absence as
 * normal, not an error. */
export const USERDATA_BACKUP_FILES = [
  'topic-settings.json',
  'session-index.json',
  'map-annotations.json',
  'achievements.json',
  'notifier-state.json',
] as const

const LEARNING_ENTRY_PREFIX = '.claude/learning/'

function localStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

// ---------------------------------------------------------------------------
// Pure filesystem + tar mechanics — no Electron dependency below this line
// (aside from the type imports above). This is what a throwaway script can
// exercise directly against fabricated temp directories, never the app's
// real ~/.claude/learning or userData — see the round-trip test referenced
// in the task report.
// ---------------------------------------------------------------------------

/**
 * Builds and writes the tar.gz archive at `destDir`. Skips the learning dir
 * entirely if it doesn't exist and skips any of the five userData JSON files
 * that are absent, rather than failing the whole backup over one missing
 * file. Archive name is `engram-backup-<yyyy-mm-dd-hhmm>.tar.gz` in LOCAL
 * time (matches how a human will actually read a folder of these).
 */
export async function createBackupArchive(opts: {
  /** The user's home dir — used to make the learning-dir tar entry read as
   * `.claude/learning/...` (via `-C home .claude/learning`) rather than an
   * absolute path, matching the brief's tar command exactly. */
  home: string
  learningHome: string
  userDataDir: string
  destDir: string
  now?: Date
}): Promise<{ path: string; bytes: number }> {
  const { home, learningHome, userDataDir, destDir } = opts
  const now = opts.now ?? new Date()

  const args: string[] = []

  const relLearning = relative(home, learningHome)
  const learningIsUnderHome = relLearning !== '' && !relLearning.startsWith('..') && !isAbsolute(relLearning)
  if (existsSync(learningHome)) {
    if (learningIsUnderHome) {
      args.push('-C', home, relLearning)
    } else {
      // Fallback for a learning home that isn't nested under `home` — not
      // expected in practice (pluginResolver always nests it under the
      // user's home), but this keeps backup working rather than silently
      // dropping the learning data. Entries won't carry the
      // `.claude/learning/` prefix in this fallback case.
      args.push('-C', dirname(learningHome), basename(learningHome))
    }
  }

  const presentUserDataFiles = USERDATA_BACKUP_FILES.filter((name) => existsSync(join(userDataDir, name)))
  if (presentUserDataFiles.length > 0) {
    args.push('-C', userDataDir, ...presentUserDataFiles)
  }

  if (args.length === 0) {
    throw new Error('Nothing to back up — no learning data or app settings found.')
  }

  await mkdir(destDir, { recursive: true })
  const destPath = join(destDir, `engram-backup-${localStamp(now)}.tar.gz`)
  await execFileAsync('tar', ['-czf', destPath, ...args])
  const { size } = await stat(destPath)
  return { path: destPath, bytes: size }
}

/**
 * Lists an archive's contents (`tar -tzf`, never extracts) and validates it
 * actually looks like an Engram backup before anything downstream trusts it.
 * `archivedAt` prefers the timestamp encoded in the filename (the same local
 * stamp createBackupArchive wrote) and falls back to the file's own mtime for
 * an archive that was renamed or made by hand.
 */
export async function describeArchive(archivePath: string): Promise<DescribeArchiveResult> {
  if (!existsSync(archivePath)) return { ok: false, reason: 'Archive not found.' }

  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('tar', ['-tzf', archivePath], { maxBuffer: 32 * 1024 * 1024 }))
  } catch (err) {
    return { ok: false, reason: `Could not read archive: ${err instanceof Error ? err.message : String(err)}` }
  }

  const entries = stdout.split('\n').filter(Boolean)
  if (!entries.some((e) => e.includes(LEARNING_ENTRY_PREFIX))) {
    return { ok: false, reason: 'This does not look like an Engram backup — no learning data found inside.' }
  }

  const topics = entries.filter((e) => /\.claude\/learning\/graphs\/[^/]+\.json$/.test(e)).length
  const receipts = entries.filter((e) => /\.claude\/learning\/receipts\/[^/]+\.jsonl$/.test(e)).length

  const stampMatch = basename(archivePath).match(/^engram-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.tar\.gz$/)
  let archivedAt: string
  if (stampMatch) {
    const [, y, mo, d, hh, mm] = stampMatch
    archivedAt = `${y}-${mo}-${d}T${hh}:${mm}:00`
  } else {
    archivedAt = (await stat(archivePath)).mtime.toISOString()
  }

  return { ok: true, topics, receipts, archivedAt }
}

/** Moves a directory, falling back to copy+remove across filesystem
 * boundaries (`rename()` fails with EXDEV when src/dest are on different
 * devices — the OS temp dir isn't guaranteed to share a volume with the
 * destination). */
async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await cp(src, dest, { recursive: true })
    await rm(src, { recursive: true, force: true })
  }
}

/**
 * Extracts an archive to a temp staging dir, verifies it actually contains a
 * learning dir, then swaps it into place: the current learning dir is
 * renamed aside, the staged one moved in, and the aside copy deleted only
 * after that swap succeeds — so a failure partway through leaves the live
 * dir exactly where it started rather than deleted with nothing to replace
 * it. userData JSON files are copied over individually (no directory-level
 * swap needed for five flat files). Pure filesystem operation — no Electron
 * dependency, which is what lets the round-trip test exercise it directly
 * against fabricated temp dirs instead of the app's real ones.
 */
export async function restoreArchiveInto(opts: {
  archivePath: string
  learningHome: string
  userDataDir: string
}): Promise<void> {
  const { archivePath, learningHome, userDataDir } = opts
  const stagingDir = await mkdtemp(join(tmpdir(), 'engram-restore-'))
  try {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', stagingDir])

    const stagedLearning = join(stagingDir, '.claude', 'learning')
    if (!existsSync(stagedLearning)) {
      throw new Error('Archive did not contain a .claude/learning directory — refusing to restore.')
    }

    const asideDir = `${learningHome}.restore-aside-${Date.now()}`
    const hadExisting = existsSync(learningHome)
    if (hadExisting) await rename(learningHome, asideDir)
    try {
      await mkdir(dirname(learningHome), { recursive: true })
      await moveDir(stagedLearning, learningHome)
    } catch (err) {
      // Roll back — put the original learning dir back exactly where it was.
      // The live dir is never removed before its replacement is confirmed in place.
      if (hadExisting) await rename(asideDir, learningHome).catch(() => {})
      throw err
    }
    if (hadExisting) await rm(asideDir, { recursive: true, force: true })

    await mkdir(userDataDir, { recursive: true })
    for (const name of USERDATA_BACKUP_FILES) {
      const stagedFile = join(stagingDir, name)
      if (existsSync(stagedFile)) {
        await copyFile(stagedFile, join(userDataDir, name))
      }
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup — a leftover temp dir is harmless.
    })
  }
}

// ---------------------------------------------------------------------------
// IPC-facing entry points (see ipc/sessionHandlers.ts) — these resolve real
// paths via engramLearningHome()/app.getPath and own the native dialogs and
// remembered settings, then delegate to the pure functions above.
// ---------------------------------------------------------------------------

function backupStatePath(): string {
  return join(app.getPath('userData'), 'backup-state.json')
}

const EMPTY_BACKUP_INFO: BackupInfo = { lastDestDir: null, lastBackupAt: null, lastBackupPath: null }

async function readBackupState(): Promise<BackupInfo> {
  try {
    return { ...EMPTY_BACKUP_INFO, ...JSON.parse(await readFile(backupStatePath(), 'utf-8')) }
  } catch {
    return { ...EMPTY_BACKUP_INFO }
  }
}

async function writeBackupState(state: BackupInfo): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(backupStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

/** Last-backup info for the Settings panel's "last backed up" line. */
export async function getBackupInfo(): Promise<BackupInfo> {
  return readBackupState()
}

/**
 * IPC-facing `backupNow` (see ipc/sessionHandlers.ts's `backup:now`).
 * Resolves the real learning home (engramLearningHome — never hardcoded)
 * and this app's own userData dir, picks a destination folder via a native
 * dialog on first use (remembered afterwards in backup-state.json so repeat
 * backups are one click), and delegates the actual archive-writing to
 * createBackupArchive above.
 */
export async function backupNow(destDir?: string): Promise<BackupNowResult> {
  const state = await readBackupState()
  let dir = destDir ?? state.lastDestDir ?? undefined
  if (!dir) {
    const result = await dialog.showOpenDialog({
      title: 'Choose a folder for Engram backups',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: 'canceled' }
    dir = result.filePaths[0]
  }

  try {
    const home = homedir()
    const learningHome = await engramLearningHome()
    const userDataDir = app.getPath('userData')
    const { path, bytes } = await createBackupArchive({ home, learningHome, userDataDir, destDir: dir })
    await writeBackupState({ lastDestDir: dir, lastBackupAt: new Date().toISOString(), lastBackupPath: path })
    return { ok: true, path, bytes }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/** File picker for the Restore flow's first step — a plain archive chooser,
 * distinct from `backupNow`'s destination-folder dialog. */
export async function pickBackupArchivePath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose an Engram backup to restore',
    properties: ['openFile'],
    filters: [
      { name: 'Engram backup (.tar.gz)', extensions: ['gz'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/**
 * IPC-facing `restoreFromArchive` (see ipc/sessionHandlers.ts's
 * `backup:restore`). This is the one destructive-capable flow in the app —
 * three non-negotiables, all enforced here in MAIN regardless of what the
 * renderer already checked:
 *   1. `confirmation` must be the literal string 'restore'.
 *   2. Refuses while any session is live — `isSessionActive` is
 *      sessionHandlers.ts's own `sessions.size > 0`, the same source of
 *      truth `session:anyActive` reports, passed in rather than duplicated
 *      or re-derived here.
 *   3. A pre-restore safety snapshot of the CURRENT state is always taken
 *      before any extraction (via backupNow, saved beside the archive being
 *      restored from), and its path is always returned — even on failure —
 *      so the user always has a hand-recovery path.
 */
export async function restoreFromArchive(
  archivePath: string,
  confirmation: string,
  isSessionActive: () => boolean = () => false,
): Promise<RestoreArchiveResult> {
  if (confirmation !== 'restore') {
    return { ok: false, reason: 'Type "restore" to confirm — nothing was changed.' }
  }
  if (isSessionActive()) {
    return { ok: false, reason: 'A learning session is active — finish or close it before restoring.' }
  }

  const described = await describeArchive(archivePath)
  if (!described.ok) return described

  // Safety snapshot of the CURRENT state, always, before touching anything.
  const safety = await backupNow(dirname(archivePath))
  if (!safety.ok) {
    return {
      ok: false,
      reason: `Could not create a safety snapshot before restoring — nothing was changed. (${safety.reason})`,
    }
  }

  try {
    const learningHome = await engramLearningHome()
    const userDataDir = app.getPath('userData')
    await restoreArchiveInto({ archivePath, learningHome, userDataDir })
    return { ok: true, safetyPath: safety.path }
  } catch (err) {
    return {
      ok: false,
      reason: `Restore failed after the safety snapshot was saved to ${safety.path}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
