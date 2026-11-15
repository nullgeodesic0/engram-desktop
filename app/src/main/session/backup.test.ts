import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createBackupArchive,
  createSafetySnapshotArchive,
  describeArchive,
  restoreArchiveInto,
} from './backup'

/**
 * Round-trip coverage for backup.ts's pure filesystem + tar mechanics — the
 * module's own doc comments have referenced "the round-trip test" since the
 * original five-file backup, but it never actually existed until this file.
 * Everything here runs against fabricated temp directories, never the app's
 * real ~/.claude/learning or userData. (Fixtures below are deliberately
 * named "learningDir", not "learningHome" — a stand-in path, not the real
 * learning home createBackupArchive/restoreArchiveInto take a parameter
 * named that; see scripts/checkDoctrine.ts's D2.learningHomeWrite, which
 * flags writes whose arguments literally name the learning home.)
 */

const roots: string[] = []
function freshRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'engram-backup-test-'))
  roots.push(r)
  return r
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

/** A from-scratch "old machine": a learning-home stand-in with one topic,
 * five userData files, every USERDATA_BACKUP_DIRS entry with one file
 * inside, and one added content pack whose folder lives OUTSIDE userData
 * (as a real pack folder does) so restore has to relocate it, not just copy
 * it back. */
function seedOldMachine() {
  const home = freshRoot()
  const learningDir = join(home, '.claude', 'learning')
  mkdirSync(join(learningDir, 'graphs'), { recursive: true })
  mkdirSync(join(learningDir, 'receipts'), { recursive: true })
  writeFileSync(join(learningDir, 'graphs', 'least-squares.json'), JSON.stringify({ topic: 'least-squares' }))
  writeFileSync(join(learningDir, 'receipts', 'least-squares.jsonl'), '{"node":"a"}\n')

  const userDataRoot = freshRoot()
  const userData = join(userDataRoot, 'userData')
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'topic-settings.json'), JSON.stringify({ 'least-squares': { folder: 'math' } }))

  mkdirSync(join(userData, 'courses', 'example-pack'), { recursive: true })
  writeFileSync(join(userData, 'courses', 'example-pack', 'records.json'), JSON.stringify({ attested: {} }))

  mkdirSync(join(userData, 'card-packs', 'least-squares'), { recursive: true })
  writeFileSync(join(userData, 'card-packs', 'least-squares', 'node.json'), '{}')

  mkdirSync(join(userData, 'lecture-notes', 'least-squares'), { recursive: true })
  writeFileSync(join(userData, 'lecture-notes', 'least-squares', 'intro.json'), '{}')

  mkdirSync(join(userData, 'codex-transcripts'), { recursive: true })
  writeFileSync(join(userData, 'codex-transcripts', 'sess-1.jsonl'), '{}\n')

  mkdirSync(join(userData, 'topic-trash', 'old-topic'), { recursive: true })
  writeFileSync(join(userData, 'topic-trash', 'old-topic', 'graphs.json'), '{}')

  // The pack itself lives wherever the learner put it — here, a sibling of
  // userData, nothing to do with it, exactly like a real git checkout.
  const packFolder = join(userDataRoot, 'wherever-the-pack-lives', 'example-pack')
  mkdirSync(join(packFolder, 'labs', 'lab-one'), { recursive: true })
  writeFileSync(join(packFolder, 'pack.json'), JSON.stringify({ id: 'example-pack', title: 'Example pack' }))
  writeFileSync(join(packFolder, 'labs', 'lab-one', 'lab.json'), JSON.stringify({ id: 'lab-one' }))
  mkdirSync(join(userData, 'labs'), { recursive: true })
  writeFileSync(join(userData, 'labs', 'packs.json'), JSON.stringify({ folders: [packFolder] }))

  return { home, learningDir, userData, packFolder }
}

describe('createBackupArchive + restoreArchiveInto round trip', () => {
  it('captures and restores courses, labs, card-packs, lecture notes, transcripts, trash and the pack itself', async () => {
    const { home, learningDir, userData, packFolder } = seedOldMachine()
    const destDir = freshRoot()

    const { path } = await createBackupArchive({ home, learningHome: learningDir, userDataDir: userData, destDir })
    expect(existsSync(path)).toBe(true)

    const described = await describeArchive(path)
    expect(described).toMatchObject({ ok: true, topics: 1, receipts: 1, packs: 1 })

    // A fresh "new machine" — nothing here resembles the old paths at all.
    const newHome = freshRoot()
    const newLearningDir = join(newHome, '.claude', 'learning')
    const newUserDataRoot = freshRoot()
    const newUserData = join(newUserDataRoot, 'userData')

    await restoreArchiveInto({ archivePath: path, learningHome: newLearningDir, userDataDir: newUserData })

    expect(JSON.parse(readFileSync(join(newLearningDir, 'graphs', 'least-squares.json'), 'utf-8'))).toEqual({
      topic: 'least-squares',
    })
    expect(readFileSync(join(newLearningDir, 'receipts', 'least-squares.jsonl'), 'utf-8')).toContain('"node":"a"')

    expect(
      JSON.parse(readFileSync(join(newUserData, 'courses', 'example-pack', 'records.json'), 'utf-8')),
    ).toEqual({ attested: {} })
    expect(existsSync(join(newUserData, 'card-packs', 'least-squares', 'node.json'))).toBe(true)
    expect(existsSync(join(newUserData, 'lecture-notes', 'least-squares', 'intro.json'))).toBe(true)
    expect(existsSync(join(newUserData, 'codex-transcripts', 'sess-1.jsonl'))).toBe(true)
    expect(existsSync(join(newUserData, 'topic-trash', 'old-topic', 'graphs.json'))).toBe(true)

    // The pack's own content is restored under app userData, keyed by id —
    // never at the old machine's absolute path, which doesn't exist here.
    const restoredPackDir = join(newUserData, 'packs', 'example-pack')
    expect(existsSync(join(restoredPackDir, 'pack.json'))).toBe(true)
    expect(existsSync(join(restoredPackDir, 'labs', 'lab-one', 'lab.json'))).toBe(true)
    expect(restoredPackDir).not.toBe(packFolder)

    const registry = JSON.parse(readFileSync(join(newUserData, 'labs', 'packs.json'), 'utf-8'))
    expect(registry.folders).toEqual([restoredPackDir])
    expect(registry.folders).not.toContain(packFolder)
  })

  it('leaves an existing, still-resolving pack folder alone instead of duplicating it', async () => {
    const { home, learningDir, userData } = seedOldMachine()
    const destDir = freshRoot()
    const { path } = await createBackupArchive({ home, learningHome: learningDir, userDataDir: userData, destDir })

    // Restoring onto the SAME machine: the original pack folder still
    // resolves to the same pack id, so the restored copy should replace it
    // in the registry, never leave both entries pointing at the one id.
    await restoreArchiveInto({ archivePath: path, learningHome: learningDir, userDataDir: userData })
    const registry = JSON.parse(readFileSync(join(userData, 'labs', 'packs.json'), 'utf-8'))
    expect(registry.folders).toHaveLength(1)
    expect(registry.folders[0]).toBe(join(userData, 'packs', 'example-pack'))
  })

  it('rolls the learning home back if the swap fails partway, and leaves other directories untouched', async () => {
    const { home, learningDir, userData } = seedOldMachine()
    const destDir = freshRoot()
    const { path } = await createBackupArchive({ home, learningHome: learningDir, userDataDir: userData, destDir })

    const newHome = freshRoot()
    const newLearningDir = join(newHome, '.claude', 'learning')
    mkdirSync(join(newLearningDir, 'graphs'), { recursive: true })
    writeFileSync(join(newLearningDir, 'graphs', 'already-here.json'), '{}')
    const newUserDataRoot = freshRoot()
    const newUserData = join(newUserDataRoot, 'userData')

    await expect(
      restoreArchiveInto({
        archivePath: path,
        learningHome: newLearningDir,
        userDataDir: newUserData,
        __beforeFinalMove: () => {
          throw new Error('injected failure')
        },
      }),
    ).rejects.toThrow('injected failure')

    // The original learning home is exactly as it was — never left half-swapped.
    expect(existsSync(join(newLearningDir, 'graphs', 'already-here.json'))).toBe(true)
    expect(existsSync(join(newLearningDir, 'graphs', 'least-squares.json'))).toBe(false)
  })
})

describe('createSafetySnapshotArchive', () => {
  it('is a documented no-op on a genuinely empty machine', async () => {
    const home = freshRoot()
    const learningDir = join(home, '.claude', 'learning')
    const userData = join(freshRoot(), 'userData')
    const result = await createSafetySnapshotArchive({
      home,
      learningHome: learningDir,
      userDataDir: userData,
      archivePath: join(freshRoot(), 'incoming.tar.gz'),
    })
    expect(result).toEqual({ ok: true, path: null, bytes: 0 })
  })

  it('refuses to write the snapshot over the archive being restored from', async () => {
    const { home, learningDir, userData } = seedOldMachine()
    const destDir = freshRoot()
    const archivePath = join(destDir, 'collide.tar.gz')
    const result = await createSafetySnapshotArchive({
      home,
      learningHome: learningDir,
      userDataDir: userData,
      archivePath,
      fileName: 'collide.tar.gz',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/Refusing to write the safety snapshot/)
  })
})
