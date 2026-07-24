import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir, rm, rename, cp, copyFile, mkdtemp, stat, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, basename, relative, isAbsolute, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { app, dialog } from 'electron'
import { engramLearningHome } from '../engramCli/readOnly'
import type {
  BackupInfo,
  BackupNowResult,
  DescribeArchiveResult,
  RestoreArchiveResult,
  SafetySnapshotResult,
} from '../../shared/types'

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

function randomSuffix(): string {
  return randomBytes(4).toString('hex')
}

/** True if there is anything at all to back up — a missing learning dir AND
 * zero present userData files means a genuinely empty machine (e.g. before
 * its first-ever restore), which createSafetySnapshotArchive treats as a
 * special case rather than an error. */
function hasAnythingToBackUp(learningHome: string, userDataDir: string): boolean {
  if (existsSync(learningHome)) return true
  return USERDATA_BACKUP_FILES.some((name) => existsSync(join(userDataDir, name)))
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
 * file. Archive name defaults to `engram-backup-<yyyy-mm-dd-hhmm>.tar.gz` in
 * LOCAL time (matches how a human will actually read a folder of these);
 * `fileName` overrides that default — used by createSafetySnapshotArchive
 * below to produce a name that can never collide with a normal backup.
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
  fileName?: string
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
  const destPath = join(destDir, opts.fileName ?? `engram-backup-${localStamp(now)}.tar.gz`)
  await execFileAsync('tar', ['-czf', destPath, ...args])
  const { size } = await stat(destPath)
  return { path: destPath, bytes: size }
}

/**
 * Pre-restore safety snapshot of the CURRENT state, saved beside the archive
 * about to be restored from. Deliberately a DISTINCT naming scheme
 * (`engram-safety-<stamp>-<random>.tar.gz`, never `engram-backup-...`) plus a
 * random suffix, so it can't collide with a normal backup by name alone —
 * and as a hard backstop, the resolved destination path is checked against
 * the resolved archive path before anything is written: if they'd ever
 * coincide, this refuses outright rather than letting `tar -czf` silently
 * truncate the very archive being restored from (I-1).
 *
 * Special case: on a genuinely empty machine (no learning dir AND none of
 * the five userData files present — the state right before a machine's
 * first-ever restore, e.g. migrating to a new install), there is nothing a
 * snapshot could protect. The always-snapshot-first rule holds vacuously
 * rather than failing closed and blocking that restore outright: this
 * returns `{ ok: true, path: null, bytes: 0 }` without writing anything, and
 * the caller (restoreFromArchive) proceeds. Any single file or the learning
 * dir existing still makes the snapshot mandatory as before.
 *
 * Pure — no Electron dependency — so the round-trip test can force both the
 * collision path and the empty-machine path deterministically.
 */
export async function createSafetySnapshotArchive(opts: {
  home: string
  learningHome: string
  userDataDir: string
  /** The archive about to be restored from — the snapshot must never land here. */
  archivePath: string
  now?: Date
  /** Overrides the generated filename. Production never sets this (the
   * random suffix makes a real collision astronomically unlikely); the
   * round-trip test uses it to deterministically force the collision so the
   * refusal path itself gets exercised. */
  fileName?: string
}): Promise<SafetySnapshotResult> {
  const { home, learningHome, userDataDir, archivePath } = opts

  if (!hasAnythingToBackUp(learningHome, userDataDir)) {
    return { ok: true, path: null, bytes: 0 }
  }

  const now = opts.now ?? new Date()
  const destDir = dirname(archivePath)
  const fileName = opts.fileName ?? `engram-safety-${localStamp(now)}-${randomSuffix()}.tar.gz`
  const destPath = join(destDir, fileName)

  if (resolve(destPath) === resolve(archivePath)) {
    return {
      ok: false,
      reason: `Refusing to write the safety snapshot to the same path as the archive being restored (${destPath}). Nothing was changed.`,
    }
  }

  try {
    const { path, bytes } = await createBackupArchive({ home, learningHome, userDataDir, destDir, now, fileName })
    return { ok: true, path, bytes }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/** Runs `tar -tzf` and returns the raw entry list — shared by describeArchive
 * (summary counts) and restoreArchiveInto (pre-extraction validation) so
 * there's exactly one place that knows how to list an archive. */
async function listArchiveEntries(archivePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync('tar', ['-tzf', archivePath], { maxBuffer: 32 * 1024 * 1024 })
  return stdout.split('\n').filter(Boolean)
}

/** Rejects an archive containing a path-traversal or absolute-path entry
 * (leading `/`, or any `..` path segment) — checked BEFORE extraction, not
 * after (I-3). A well-formed backup from createBackupArchive above can never
 * produce such an entry; this guards against a hand-crafted or corrupted
 * archive being fed to restore. */
function validateEntryNames(entries: string[]): void {
  for (const entry of entries) {
    if (entry.startsWith('/') || entry.split('/').includes('..')) {
      throw new Error(`Archive contains an unsafe path entry ("${entry}") — refusing to restore.`)
    }
  }
}

/**
 * Lists an archive's contents (`tar -tzf`, never extracts) and validates it
 * actually looks like a safe Engram backup before anything downstream trusts
 * it — both the entry-name safety check (I-3) and the `.claude/learning/`
 * content check. `archivedAt` prefers the timestamp encoded in the filename
 * (the same local stamp createBackupArchive wrote) and falls back to the
 * file's own mtime for an archive that was renamed or made by hand.
 */
export async function describeArchive(archivePath: string): Promise<DescribeArchiveResult> {
  if (!existsSync(archivePath)) return { ok: false, reason: 'Archive not found.' }

  let entries: string[]
  try {
    entries = await listArchiveEntries(archivePath)
  } catch (err) {
    return { ok: false, reason: `Could not read archive: ${err instanceof Error ? err.message : String(err)}` }
  }

  try {
    validateEntryNames(entries)
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }

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

/**
 * Extracts an archive to a temp staging dir, validates entry names (I-3),
 * verifies it actually contains a learning dir, then swaps it into place.
 *
 * The staged learning dir is first copied onto the SAME volume as
 * `learningHome` (a `.incoming-*` sibling under its own parent dir) — so the
 * actual live swap is a guaranteed-atomic `rename()`, never a cross-device
 * copy that could leave `learningHome` half-populated mid-swap (I-2). The
 * current learning dir (if any) is renamed aside first; the aside copy is
 * deleted only after the swap into place succeeds. If anything fails after
 * the aside-rename, rollback clears whatever (if anything) landed at
 * `learningHome` and renames the aside copy back — so the live dir is never
 * left removed with nothing valid in its place. If rollback itself fails,
 * the thrown error names the aside dir explicitly so nothing is silently
 * lost. userData JSON files are copied over individually (no directory-level
 * swap needed for five flat files).
 *
 * Pure filesystem operation — no Electron dependency, which is what lets the
 * round-trip test exercise it directly against fabricated temp dirs instead
 * of the app's real ones.
 */
export async function restoreArchiveInto(opts: {
  archivePath: string
  learningHome: string
  userDataDir: string
  /** Test-only fault injection: if provided, it's called right after the
   * live learning dir has been renamed aside (if it existed) and right
   * before the staged replacement is moved into place — throwing there
   * exercises the rollback path deterministically, without needing real
   * filesystem-permission trickery. Production callers (restoreFromArchive
   * below, and ipc/sessionHandlers.ts) never pass this. */
  __beforeFinalMove?: () => Promise<void> | void
}): Promise<void> {
  const { archivePath, learningHome, userDataDir } = opts

  const entries = await listArchiveEntries(archivePath)
  validateEntryNames(entries)

  const tmpStagingDir = await mkdtemp(join(tmpdir(), 'engram-restore-'))
  const unique = `${Date.now()}-${randomSuffix()}`
  const onVolumeStaging = `${learningHome}.incoming-${unique}`
  const asideDir = `${learningHome}.restore-aside-${unique}`
  let renamedAside = false

  try {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', tmpStagingDir])

    const stagedLearning = join(tmpStagingDir, '.claude', 'learning')
    if (!existsSync(stagedLearning)) {
      throw new Error('Archive did not contain a .claude/learning directory — refusing to restore.')
    }

    await mkdir(dirname(learningHome), { recursive: true })
    // Same-volume staging (see doc comment above) — this cp is temp-dir to
    // sibling-of-learningHome and may itself cross devices, but nothing live
    // has been touched yet at this point, so a failure here is a clean no-op.
    await cp(stagedLearning, onVolumeStaging, { recursive: true })

    const hadExisting = existsSync(learningHome)
    if (hadExisting) {
      await rename(learningHome, asideDir)
      renamedAside = true
    }

    if (opts.__beforeFinalMove) await opts.__beforeFinalMove()

    // Guaranteed same volume (onVolumeStaging is a sibling of learningHome) —
    // this rename is atomic, never a partial cross-device copy.
    await rename(onVolumeStaging, learningHome)

    if (renamedAside) {
      await rm(asideDir, { recursive: true, force: true })
      renamedAside = false
    }

    await mkdir(userDataDir, { recursive: true })
    for (const name of USERDATA_BACKUP_FILES) {
      const stagedFile = join(tmpStagingDir, name)
      if (existsSync(stagedFile)) {
        await copyFile(stagedFile, join(userDataDir, name))
      }
    }
  } catch (err) {
    if (renamedAside) {
      // learningHome is missing or (in principle) partially written — clear
      // it before restoring the original, so the two copies never coexist
      // under the same path.
      await rm(learningHome, { recursive: true, force: true }).catch(() => {})
      try {
        await rename(asideDir, learningHome)
      } catch (rollbackErr) {
        throw new Error(
          `Restore failed AND automatic rollback failed — your original learning dir was NOT restored to its ` +
            `usual location; it is preserved at ${asideDir}. ` +
            `Original error: ${err instanceof Error ? err.message : String(err)}. ` +
            `Rollback error: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}.`,
        )
      }
    }
    throw err
  } finally {
    await rm(tmpStagingDir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup — a leftover temp dir is harmless.
    })
    if (existsSync(onVolumeStaging)) {
      await rm(onVolumeStaging, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup — only reachable if the final rename never ran.
      })
    }
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

/** Last-backup info for the Settings panel's "last backed up" line. Only
 * user-initiated backups (backupNow below) update this — a restore's safety
 * snapshot does not, since it isn't the thing the user thinks of as "my last
 * backup" (see createSafetySnapshotArchive, which never touches this file). */
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
 *      before any extraction (via createSafetySnapshotArchive — distinctly
 *      named, collision-checked, see I-1), and its path is always returned
 *      — even on failure — so the user always has a hand-recovery path. The
 *      one exception is a genuinely empty machine (nothing exists to
 *      snapshot yet, e.g. before the first-ever restore): the snapshot step
 *      is a documented no-op there (safetyPath comes back `null`), never a
 *      blocker — see createSafetySnapshotArchive's doc comment.
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

  let home: string
  let learningHome: string
  let userDataDir: string
  try {
    home = homedir()
    learningHome = await engramLearningHome()
    userDataDir = app.getPath('userData')
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }

  // Safety snapshot of the CURRENT state, always, before touching anything.
  const safety = await createSafetySnapshotArchive({ home, learningHome, userDataDir, archivePath })
  if (!safety.ok) {
    return {
      ok: false,
      reason: `Could not create a safety snapshot before restoring — nothing was changed. (${safety.reason})`,
    }
  }

  try {
    await restoreArchiveInto({ archivePath, learningHome, userDataDir })
    return { ok: true, safetyPath: safety.path }
  } catch (err) {
    const snapshotNote = safety.path
      ? `the safety snapshot was saved to ${safety.path}`
      : 'no safety snapshot was needed — nothing existed to protect before this restore'
    return {
      ok: false,
      reason: `Restore failed after ${snapshotNote}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
