/**
 * THE REGRESSION SNAPSHOT HARNESS for the Chat Presence wave (see
 * `.superpowers/sdd/chat-wave-a-report.md`). This wave touches
 * `shared/ritualFromTranscript.ts`'s `parseAuditNotification` (extracting it
 * into `shared/taskNotification.ts` pieces) and `SessionManager.ts`'s
 * `user`-branch dispatch — both of which sit directly upstream of every
 * derived ritual mark and every replayed chat message a real sitting has ever
 * produced. A "pure extraction" or "additive branch" claim about either file
 * is only as good as its proof against real data, so this script IS that
 * proof: it runs `deriveRitualMarks` and `buildHistoryTimeline` against every
 * real transcript on this machine, before and after a change, and diffs them.
 *
 * READ-ONLY: only ever reads `~/.claude/projects/**\/*.jsonl`. Never writes
 * there, never writes anywhere under `~/.claude/`. Snapshots land under the
 * SCRATCHPAD, never in this repo (see SNAPSHOT_ROOT below) — they're a
 * throwaway verification aid, not a fixture this repo owns or ships.
 *
 * Usage:
 *   tsx scripts/snapshotRitual.ts            take a new baseline snapshot
 *   tsx scripts/snapshotRitual.ts --diff      compare current output against
 *                                             the last baseline; per-file,
 *                                             per-mark-kind diff summary
 * (wired as `npm run check:ritual-snapshot` / `-- --diff`.)
 *
 * Why a custom ESM loader hook: `buildHistoryTimeline` lives in
 * SessionHistoryDrawer.tsx, a React component file, and its component-tree
 * imports pull in real `.css`/`?raw` CSS assets (katex's stylesheet,
 * print.css) that only exist as vite-bundler concepts — plain Node/tsx has no
 * loader for them and throws ERR_UNKNOWN_FILE_EXTENSION. The hook below stubs
 * every CSS specifier (by URL pathname, so `?raw`/`?inline` query suffixes
 * still match) to an empty module. This changes NOTHING about the functions
 * under test — neither one touches styling — it only lets Node import the
 * module at all.
 */
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function load(url, context, nextLoad) {
         let p
         try { p = new URL(url).pathname } catch { p = url }
         if (p.endsWith('.css')) {
           return { format: 'module', source: 'export default {}', shortCircuit: true }
         }
         return nextLoad(url, context)
       }`,
    ),
  import.meta.url,
)

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECTS_ROOT = join(homedir(), '.claude', 'projects')

// Deliberately OUTSIDE the repo — see the header comment above.
const SCRATCHPAD =
  '/private/tmp/claude-501/-Users-learner/0cc99282-4681-4d7b-9670-e6286e0bdff0/scratchpad'
const SNAPSHOT_ROOT = join(SCRATCHPAD, 'ritual-snapshots')
const LATEST_POINTER = join(SNAPSHOT_ROOT, 'LATEST')

interface FileSnapshot {
  file: string
  lineCount: number
  parseErrors: number
  derivedMarks: unknown[]
  historyMarkKinds: string[]
  historyMessageCount: number
  historyGradeCount: number
}

/** Every real transcript on this machine, read-only. */
function findTranscripts(): string[] {
  if (!existsSync(PROJECTS_ROOT)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (entry.endsWith('.jsonl')) out.push(full)
    }
  }
  walk(PROJECTS_ROOT)
  return out.sort()
}

/** Parses a transcript's NDJSON lines, tolerating any malformed line (a
 * malformed line is not this harness's concern — both functions under test
 * already tolerate garbage input by construction; a parse error here just
 * means fewer lines make it into the array either function sees). */
function readTranscriptLines(path: string): { lines: unknown[]; parseErrors: number } {
  const raw = readFileSync(path, 'utf-8')
  const lines: unknown[] = []
  let parseErrors = 0
  for (const rawLine of raw.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed))
    } catch {
      parseErrors++
    }
  }
  return { lines, parseErrors }
}

async function computeSnapshots(): Promise<FileSnapshot[]> {
  const { deriveRitualMarks } = await import('../src/shared/ritualFromTranscript')
  const { buildHistoryTimeline } = await import('../src/renderer/src/components/SessionHistoryDrawer')

  const files = findTranscripts()
  const snapshots: FileSnapshot[] = []
  for (const file of files) {
    const { lines, parseErrors } = readTranscriptLines(file)
    const derivedMarks = deriveRitualMarks(lines)
    const timeline = buildHistoryTimeline(lines)
    snapshots.push({
      file: relative(PROJECTS_ROOT, file),
      lineCount: lines.length,
      parseErrors,
      derivedMarks,
      historyMarkKinds: timeline.marks.map((m) => m.kind),
      historyMessageCount: timeline.messages.length,
      historyGradeCount: timeline.grades.length,
    })
  }
  return snapshots
}

function snapshotDirFor(timestamp: string): string {
  return join(SNAPSHOT_ROOT, timestamp)
}

function writeSnapshots(dir: string, snapshots: FileSnapshot[]): void {
  mkdirSync(dir, { recursive: true })
  for (const snap of snapshots) {
    // Sanitize the relative path into a flat filename — real project dirs
    // and session ids never contain characters that collide once slashes
    // become underscores.
    const flatName = snap.file.replace(/[\\/]/g, '__') + '.json'
    writeFileSync(join(dir, flatName), JSON.stringify(snap, null, 2), 'utf-8')
  }
  writeFileSync(join(dir, '_index.json'), JSON.stringify(snapshots.map((s) => s.file), null, 2), 'utf-8')
}

function readSnapshotDir(dir: string): Map<string, FileSnapshot> {
  const out = new Map<string, FileSnapshot>()
  for (const entry of readdirSync(dir)) {
    if (entry === '_index.json' || entry === 'LATEST') continue
    if (!entry.endsWith('.json')) continue
    const snap = JSON.parse(readFileSync(join(dir, entry), 'utf-8')) as FileSnapshot
    out.set(snap.file, snap)
  }
  return out
}

/** Per-mark-kind counts, for a compact diff line instead of a full structural
 * dump — e.g. `beat:12 crossing:3 audit:1` — with a separate structural
 * equality check catching anything a count alone would miss (reordering, a
 * changed field within a same-count mark list). */
function kindCounts(marks: Array<{ kind: string }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of marks) out[m.kind] = (out[m.kind] ?? 0) + 1
  return out
}

function formatCounts(counts: Record<string, number>): string {
  const keys = Object.keys(counts).sort()
  if (keys.length === 0) return '(none)'
  return keys.map((k) => `${k}:${counts[k]}`).join(' ')
}

function diffAgainst(baselineDir: string, current: FileSnapshot[]): { diffs: string[]; filesCompared: number } {
  const baseline = readSnapshotDir(baselineDir)
  const diffs: string[] = []
  const currentByFile = new Map(current.map((s) => [s.file, s] as const))
  const allFiles = new Set([...baseline.keys(), ...currentByFile.keys()])

  for (const file of [...allFiles].sort()) {
    const before = baseline.get(file)
    const after = currentByFile.get(file)
    if (!before) {
      diffs.push(`NEW FILE (not in baseline): ${file} — marks ${formatCounts(kindCounts(after!.derivedMarks as Array<{ kind: string }>))}`)
      continue
    }
    if (!after) {
      diffs.push(`REMOVED (was in baseline, gone now): ${file}`)
      continue
    }
    const beforeCounts = kindCounts(before.derivedMarks as Array<{ kind: string }>)
    const afterCounts = kindCounts(after.derivedMarks as Array<{ kind: string }>)
    const beforeStr = JSON.stringify(before.derivedMarks)
    const afterStr = JSON.stringify(after.derivedMarks)
    const beforeTimelineStr = JSON.stringify({
      historyMarkKinds: before.historyMarkKinds,
      historyMessageCount: before.historyMessageCount,
      historyGradeCount: before.historyGradeCount,
    })
    const afterTimelineStr = JSON.stringify({
      historyMarkKinds: after.historyMarkKinds,
      historyMessageCount: after.historyMessageCount,
      historyGradeCount: after.historyGradeCount,
    })
    if (beforeStr === afterStr && beforeTimelineStr === afterTimelineStr) continue

    const countsLine =
      JSON.stringify(beforeCounts) === JSON.stringify(afterCounts)
        ? `same counts (${formatCounts(afterCounts)}) but structural diff`
        : `${formatCounts(beforeCounts)} -> ${formatCounts(afterCounts)}`
    diffs.push(`${file}: ${countsLine}`)
    if (beforeTimelineStr !== afterTimelineStr) {
      diffs.push(
        `  buildHistoryTimeline: messages ${before.historyMessageCount}->${after.historyMessageCount}, ` +
          `grades ${before.historyGradeCount}->${after.historyGradeCount}, ` +
          `markKinds [${before.historyMarkKinds.join(',')}] -> [${after.historyMarkKinds.join(',')}]`,
      )
    }
  }
  return { diffs, filesCompared: allFiles.size }
}

async function main(): Promise<void> {
  const isDiff = process.argv.includes('--diff')
  console.log(`scanning ${PROJECTS_ROOT} for real transcripts (read-only)...`)
  const snapshots = await computeSnapshots()
  console.log(`computed derived marks + history timelines for ${snapshots.length} transcript(s).`)

  if (!isDiff) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = snapshotDirFor(timestamp)
    writeSnapshots(dir, snapshots)
    mkdirSync(SNAPSHOT_ROOT, { recursive: true })
    writeFileSync(LATEST_POINTER, timestamp, 'utf-8')
    console.log(`baseline snapshot written: ${dir}`)
    console.log(`(LATEST pointer updated — future --diff runs compare against this baseline)`)
    return
  }

  if (!existsSync(LATEST_POINTER)) {
    console.error('no baseline snapshot found — run `tsx scripts/snapshotRitual.ts` (no --diff) first.')
    process.exitCode = 1
    return
  }
  const baselineTimestamp = readFileSync(LATEST_POINTER, 'utf-8').trim()
  const baselineDir = snapshotDirFor(baselineTimestamp)
  if (!existsSync(baselineDir)) {
    console.error(`LATEST points at ${baselineDir}, which no longer exists.`)
    process.exitCode = 1
    return
  }

  const { diffs, filesCompared } = diffAgainst(baselineDir, snapshots)
  if (diffs.length === 0) {
    console.log(`OK — EMPTY DIFF against baseline ${baselineTimestamp} (${filesCompared} files compared).`)
  } else {
    console.log(`DIFF against baseline ${baselineTimestamp} (${filesCompared} files compared, ${diffs.length} line(s)):`)
    for (const d of diffs) console.log(`  ${d}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('snapshotRitual crashed:', e)
  process.exitCode = 1
})
