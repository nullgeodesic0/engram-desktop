import { existsSync } from 'node:fs'
import { mkdir, rm, rename, cp, copyFile, mkdtemp, stat, readFile, writeFile } from 'node:fs/promises'
import { join, dirname, basename, relative, isAbsolute, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { app, dialog } from 'electron'
import { engramLearningHome } from '../engramCli/readOnly'
import { execCli } from '../platform'
import type {
  BackupInfo,
  BackupNowResult,
  DescribeArchiveResult,
  RestoreArchiveResult,
  SafetySnapshotResult,
} from '../../shared/types'

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

/** Added 2026-11-15 — the learner's own records and work under app userData
 * that the original five-file list above predates: course records and
 * staged topic maps (courseStore.ts), every lab's workbench, submissions,
 * problems and oral-exam records (labStore.ts/problemStore.ts/oralExam.ts),
 * card-pack explorables (cardPackStore.ts), lecture notes
 * (lectureNotesStore.ts), normalized Codex transcript history
 * (codexTranscript.ts), and topics moved to trash rather than erased
 * (topicTrash.ts). Each is a whole directory, copied recursively; a fresh
 * install missing one is normal, exactly like the five files above. */
export const USERDATA_BACKUP_DIRS = [
  'courses',
  'labs',
  'card-packs',
  'lecture-notes',
  'codex-transcripts',
  'topic-trash',
] as const

/** Archive-relative folder holding full copies of the content packs the
 * learner added (packStore.ts's labs/packs.json), keyed by pack id rather
 * than by the original folder path — the whole point, since that absolute
 * path almost certainly doesn't exist on a different machine. Without this,
 * the `labs` directory above would carry packs.json's folder list to the
 * new machine, but every one of those folders would be missing. See
 * createBackupArchive's staging below and restorePackContent further down. */
const PACK_CONTENT_DIR = 'packs-content'
const PACK_CONTENT_MANIFEST = `${PACK_CONTENT_DIR}/manifest.json`
/** Pack ids are validated this way throughout the app (see contentPack.ts's
 * `slug`); re-checked here too since a pack id becomes a path segment both
 * inside the archive and, on restore, under app userData. */
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,31}$/

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
  if (USERDATA_BACKUP_FILES.some((name) => existsSync(join(userDataDir, name)))) return true
  return USERDATA_BACKUP_DIRS.some((name) => existsSync(join(userDataDir, name)))
}

/** Reads labs/packs.json (if present) and returns, for each added pack
 * folder that still resolves to a readable pack.json with a usable id, its
 * folder, id and title — best effort, same tolerance as everything else
 * here: a folder that's been moved or broken since it was added is simply
 * left out, not an error. Two added folders can't share an id in the first
 * place (packStore.ts's addPackFolder refuses that), so the first match
 * wins if packs.json were ever hand-edited into that state. */
async function readAddedPackFolders(
  userDataDir: string,
): Promise<{ folder: string; id: string; title: string }[]> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(userDataDir, 'labs', 'packs.json'), 'utf-8'))
  } catch {
    return []
  }
  const folders = Array.isArray((raw as { folders?: unknown })?.folders)
    ? (raw as { folders: unknown[] }).folders.filter((f): f is string => typeof f === 'string')
    : []
  const out: { folder: string; id: string; title: string }[] = []
  const seen = new Set<string>()
  for (const folder of folders) {
    try {
      const manifest = JSON.parse(await readFile(join(folder, 'pack.json'), 'utf-8')) as {
        id?: unknown
        title?: unknown
      }
      if (typeof manifest.id !== 'string' || !PACK_ID.test(manifest.id) || seen.has(manifest.id)) continue
      seen.add(manifest.id)
      out.push({ folder, id: manifest.id, title: typeof manifest.title === 'string' ? manifest.title : manifest.id })
    } catch {
      // Moved, deleted, or not a pack folder any more — nothing to capture;
      // packs.json itself still comes along via the `labs` directory above,
      // so Settings shows the same "folder is missing" it already would.
    }
  }
  return out
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
  const presentUserDataDirs = USERDATA_BACKUP_DIRS.filter((name) => existsSync(join(userDataDir, name)))
  if (presentUserDataFiles.length > 0 || presentUserDataDirs.length > 0) {
    args.push('-C', userDataDir, ...presentUserDataFiles, ...presentUserDataDirs)
  }

  // Full copies of the added content packs themselves, staged under a temp
  // dir so the archive can hold them at `packs-content/<id>/` regardless of
  // where each pack actually lives on disk — tar's own -C only lets one
  // base directory map straight onto the archive root, so getting a nested
  // prefix for several unrelated source folders needs this staging copy.
  const addedPacks = await readAddedPackFolders(userDataDir)
  let packStagingDir: string | null = null
  try {
    if (addedPacks.length > 0) {
      packStagingDir = await mkdtemp(join(tmpdir(), 'engram-backup-packs-'))
      const packsRoot = join(packStagingDir, PACK_CONTENT_DIR)
      await mkdir(packsRoot, { recursive: true })
      const captured: { id: string; title: string }[] = []
      for (const p of addedPacks) {
        await cp(p.folder, join(packsRoot, p.id), { recursive: true })
        captured.push({ id: p.id, title: p.title })
      }
      await writeFile(join(packsRoot, 'manifest.json'), JSON.stringify(captured, null, 2), 'utf-8')
      args.push('-C', packStagingDir, PACK_CONTENT_DIR)
    }

    if (args.length === 0) {
      throw new Error('Nothing to back up — no learning data or app settings found.')
    }

    await mkdir(destDir, { recursive: true })
    const destPath = join(destDir, opts.fileName ?? `engram-backup-${localStamp(now)}.tar.gz`)
    // `tar` is a real executable on all three platforms (bsdtar.exe has shipped
    // in System32 since Windows 10 1803), so this needs no CLI resolution the
    // way `claude`/`opencode`/`python3` do — execCli is used only for the
    // uniform error shape, not to get around a batch-shim problem.
    await execCli('tar', ['-czf', destPath, ...args])
    const { size } = await stat(destPath)
    return { path: destPath, bytes: size }
  } finally {
    if (packStagingDir) await rm(packStagingDir, { recursive: true, force: true }).catch(() => {})
  }
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
  const { stdout } = await execCli('tar', ['-tzf', archivePath], { maxBuffer: 32 * 1024 * 1024 })
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
  const packs = new Set(
    entries
      .filter((e) => e.startsWith(`${PACK_CONTENT_DIR}/`) && e !== PACK_CONTENT_MANIFEST)
      .map((e) => e.split('/')[1])
      .filter((id) => id && id !== 'manifest.json'),
  ).size

  const stampMatch = basename(archivePath).match(/^engram-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.tar\.gz$/)
  let archivedAt: string
  if (stampMatch) {
    const [, y, mo, d, hh, mm] = stampMatch
    archivedAt = `${y}-${mo}-${d}T${hh}:${mm}:00`
  } else {
    archivedAt = (await stat(archivePath)).mtime.toISOString()
  }

  return { ok: true, topics, receipts, packs, archivedAt }
}

/**
 * Atomically swaps `stagedDir` into `liveDir`: same-volume staging beside
 * `liveDir` (so the final move is a guaranteed-atomic rename, never a
 * partial cross-device copy), the current occupant (if any) renamed aside
 * first, deleted only once the swap into place has succeeded. Any failure
 * rolls `liveDir` back to whatever was there before — this one directory
 * only. A failure that reaches further than that is backstopped by the
 * pre-restore safety snapshot (see restoreFromArchive), not by composing
 * rollbacks across directories here.
 *
 * A `stagedDir` that doesn't exist is a no-op: every caller below is
 * restoring one of several optional directories a backup may or may not
 * have captured, same tolerance as everything else in this file.
 */
async function swapDirectoryIn(
  stagedDir: string,
  liveDir: string,
  /** Test-only fault injection: called right after the live directory has
   * been renamed aside (if it existed) and right before the staged
   * replacement is moved into place — throwing there exercises the
   * rollback path deterministically. Production callers never pass this. */
  beforeFinalMove?: () => Promise<void> | void,
): Promise<void> {
  if (!existsSync(stagedDir)) return

  const unique = `${Date.now()}-${randomSuffix()}`
  const onVolumeStaging = `${liveDir}.incoming-${unique}`
  const asideDir = `${liveDir}.restore-aside-${unique}`
  let renamedAside = false

  try {
    await mkdir(dirname(liveDir), { recursive: true })
    // Temp-dir to sibling-of-liveDir may itself cross devices, but nothing
    // live has been touched yet at this point, so a failure here is a clean
    // no-op.
    await cp(stagedDir, onVolumeStaging, { recursive: true })

    const hadExisting = existsSync(liveDir)
    if (hadExisting) {
      await rename(liveDir, asideDir)
      renamedAside = true
    }

    if (beforeFinalMove) await beforeFinalMove()

    // Guaranteed same volume (onVolumeStaging is a sibling of liveDir) —
    // this rename is atomic, never a partial cross-device copy.
    await rename(onVolumeStaging, liveDir)

    if (renamedAside) {
      await rm(asideDir, { recursive: true, force: true })
      renamedAside = false
    }
  } catch (err) {
    if (renamedAside) {
      // liveDir is missing or (in principle) partially written — clear it
      // before restoring the original, so the two copies never coexist
      // under the same path.
      await rm(liveDir, { recursive: true, force: true }).catch(() => {})
      try {
        await rename(asideDir, liveDir)
      } catch (rollbackErr) {
        throw new Error(
          `Restore failed AND automatic rollback failed for ${liveDir} — the original was NOT restored to its ` +
            `usual location; it is preserved at ${asideDir}. ` +
            `Original error: ${err instanceof Error ? err.message : String(err)}. ` +
            `Rollback error: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}.`,
        )
      }
    }
    throw err
  } finally {
    if (existsSync(onVolumeStaging)) {
      await rm(onVolumeStaging, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup — only reachable if the final rename never ran.
      })
    }
  }
}

/**
 * Restores copies of the content packs the backed-up machine had added (see
 * createBackupArchive's packs-content capture) into this machine's own app
 * userData, then points labs/packs.json (already restored verbatim via the
 * `labs` directory in USERDATA_BACKUP_DIRS) at the restored copies instead
 * of whatever absolute folder paths the old machine used, which almost
 * certainly don't exist here. A pack whose folder wasn't captured at backup
 * time (broken or moved even on the old machine) is left exactly as the
 * restored packs.json already has it — unresolved, same as any pack whose
 * folder later moves; Settings already shows that as "the folder is
 * missing" rather than erroring.
 */
async function restorePackContent(tmpStagingDir: string, userDataDir: string): Promise<void> {
  const manifestPath = join(tmpStagingDir, PACK_CONTENT_MANIFEST)
  if (!existsSync(manifestPath)) return

  let captured: unknown
  try {
    captured = JSON.parse(await readFile(manifestPath, 'utf-8'))
  } catch {
    return
  }
  if (!Array.isArray(captured)) return

  const packsRoot = join(userDataDir, 'packs')
  const restoredFolders = new Map<string, string>()
  for (const entry of captured) {
    const id = (entry as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || !PACK_ID.test(id)) continue
    const staged = join(tmpStagingDir, PACK_CONTENT_DIR, id)
    if (!existsSync(staged)) continue
    const dest = join(packsRoot, id)
    await swapDirectoryIn(staged, dest)
    restoredFolders.set(id, dest)
  }
  if (restoredFolders.size === 0) return

  const registryPath = join(userDataDir, 'labs', 'packs.json')
  let folders: string[] = []
  try {
    const raw = JSON.parse(await readFile(registryPath, 'utf-8')) as { folders?: unknown }
    folders = Array.isArray(raw.folders) ? raw.folders.filter((f): f is string => typeof f === 'string') : []
  } catch {
    // labs/ wasn't in the archive, or packs.json is missing/unreadable — the
    // restored pack copies still exist on disk; without a registry entry
    // they just aren't added yet, same as any pack folder the learner
    // hasn't pointed Settings at.
  }

  // Keep every folder except one superseded by a pack id we just restored a
  // fresh copy for — an unresolvable folder is left exactly as it was,
  // never guessed away.
  const kept: string[] = []
  for (const folder of folders) {
    try {
      const raw = await readFile(join(folder, 'pack.json'), 'utf-8')
      const id = (JSON.parse(raw) as { id?: unknown }).id
      if (typeof id === 'string' && restoredFolders.has(id)) continue
    } catch {
      // Can't resolve it from here — leave it exactly as restored.
    }
    kept.push(folder)
  }

  const next = [...kept, ...restoredFolders.values()]
  await mkdir(dirname(registryPath), { recursive: true })
  const tmp = `${registryPath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify({ folders: next }, null, 2), 'utf-8')
  await rename(tmp, registryPath)
}

/**
 * Extracts an archive to a temp staging dir, validates entry names (I-3),
 * verifies it actually contains a learning dir, then swaps everything in:
 * the learning home, every directory in USERDATA_BACKUP_DIRS, the five flat
 * userData JSON files (copied individually, no swap needed), and finally
 * any captured content-pack copies (restorePackContent, which also points
 * labs/packs.json's folder list at them). Each directory swap
 * (swapDirectoryIn) rolls back on its own if it fails; a failure that
 * reaches further than one directory is backstopped by the pre-restore
 * safety snapshot in restoreFromArchive below, not by anything in here.
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

  try {
    await execCli('tar', ['-xzf', archivePath, '-C', tmpStagingDir])

    const stagedLearning = join(tmpStagingDir, '.claude', 'learning')
    if (!existsSync(stagedLearning)) {
      throw new Error('Archive did not contain a .claude/learning directory — refusing to restore.')
    }

    await swapDirectoryIn(stagedLearning, learningHome, opts.__beforeFinalMove)

    await mkdir(userDataDir, { recursive: true })
    for (const name of USERDATA_BACKUP_DIRS) {
      await swapDirectoryIn(join(tmpStagingDir, name), join(userDataDir, name))
    }
    for (const name of USERDATA_BACKUP_FILES) {
      const stagedFile = join(tmpStagingDir, name)
      if (existsSync(stagedFile)) {
        await copyFile(stagedFile, join(userDataDir, name))
      }
    }

    await restorePackContent(tmpStagingDir, userDataDir)
  } finally {
    await rm(tmpStagingDir, { recursive: true, force: true }).catch(() => {
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
