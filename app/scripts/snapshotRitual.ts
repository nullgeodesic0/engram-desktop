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
import { join, resolve, dirname, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import type { ChatMessage } from '../src/shared/chatMessages'
import type { GradeResult } from '../src/shared/gradeResult'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECTS_ROOT = join(homedir(), '.claude', 'projects')

// Deliberately OUTSIDE the repo — see the header comment above.
//
// Derived from `homedir()` rather than hardcoded: the path embeds the account
// name, and this repo is public. Deriving it also makes the script work on any
// machine instead of exactly one. `ENGRAM_SNAPSHOT_DIR` overrides it outright
// for a run somewhere else entirely.
const SCRATCHPAD =
  process.env.ENGRAM_SNAPSHOT_DIR ??
  join(
    '/private/tmp/claude-501',
    `-Users-${basename(homedir())}`,
    '0cc99282-4681-4d7b-9670-e6286e0bdff0',
    'scratchpad',
  )
const SNAPSHOT_ROOT = join(SCRATCHPAD, 'ritual-snapshots')
const LATEST_POINTER = join(SNAPSHOT_ROOT, 'LATEST')

/** Verdict Anatomy (Wave 1) — per-file fingerprint proving `verdictSegments.ts`
 * behaves against every real transcript on this machine, the same standing
 * this file already gives `deriveRitualMarks`/`buildHistoryTimeline`. A NEW,
 * ADDITIVE field: nothing above (`derivedMarks`, `historyMarkKinds`,
 * `historyMessageCount`, `historyGradeCount`) is touched by computing this,
 * and `diffAgainst` below only ever compares it when BOTH sides of a diff
 * carry it — so a `--diff` run against a baseline taken BEFORE this field
 * existed still proves the pre-existing fields are byte-for-byte unchanged
 * (the actual regression proof Wave 1 needs), while a `--diff` run against a
 * baseline taken AFTER it exists also catches any future regression in
 * Wave 1's own module. */
interface VerdictFingerprint {
  /** Every `deriveVerdictRegions` region across every GradeBatch in this
   * transcript (including empty ones — see `emptyRegionCount`). */
  regionCount: number
  /** Regions whose `endIndex < startIndex` (a learner interjection landed
   * immediately at the left boundary, leaving nothing to segment). */
  emptyRegionCount: number
  /** Regions whose boundary message only contributed its
   * `splitAroundProbeHeader(...).before` prefix (see VerdictRegion's
   * doctrine comment). */
  boundaryPrefixOnlyCount: number
  /** `segmentVerdictText` segment-kind counts, summed across every
   * region-touched message in this transcript. */
  segmentKindCounts: Record<string, number>
  /** The RAW text of every schedule paragraph `shouldSuppressSchedule` would
   * hide on screen — listed individually (not just counted), so a diff shows
   * exactly WHICH paragraph a change newly suppresses or newly reveals, not
   * just a count that could hide a wash (one gained, one lost). Anchored to
   * each GradeBatch's own recorded `date` (never wall-clock "now" — same
   * replay discipline `ritualFromTranscript.ts`'s lapse-rite anchor uses);
   * a batch with no usable date can never suppress a date-stating paragraph,
   * by `scheduleMatchesReceipt`'s own "null anchorDate fails the check" rule. */
  suppressedParagraphRaws: string[]
  /** True iff `segmentVerdictText`'s byte-conservation invariant
   * (`segments.map(s => s.raw).join('') === input`) held for every
   * region-touched message in this transcript — a violation is ALSO pushed
   * to the run's hard assertion failures (see `main()`), which fails the
   * whole script; this field additionally makes the violation visible
   * per-file in the diff. */
  byteConservationOk: boolean
  /** True iff `shared/chatMessages.ts`'s `parseTranscriptToMessages` (the
   * LIVE message-shaping path) and `SessionHistoryDrawer.tsx`'s
   * `buildHistoryTimeline` (the REPLAY path) agree on this transcript's
   * message list (role + text, in order) — the two are meant to be kept in
   * careful sync by construction (see `buildHistoryTimeline`'s own doctrine
   * comment), and Verdict Anatomy's regions/segments are only ever as
   * trustworthy as that agreement, since a live sitting and a reopened one
   * must segment identically. A violation is ALSO pushed to the run's hard
   * assertion failures. */
  liveReplayParityOk: boolean
}

interface FileSnapshot {
  file: string
  lineCount: number
  parseErrors: number
  derivedMarks: unknown[]
  historyMarkKinds: string[]
  historyMessageCount: number
  historyGradeCount: number
  verdictFingerprint: VerdictFingerprint
}

/** 'YYYY-MM-DD' (GradeBatch.date's own format — see SessionHistoryDrawer.tsx's
 * `localDateFromIso`) parsed back into a local-midnight Date, the same
 * local-date discipline `lapseReturnDate` itself uses. Null on anything that
 * doesn't match — never a fabricated fallback to wall-clock "now". */
function isoLocalDateToAnchor(iso: string | null): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Computes one transcript's `VerdictFingerprint` and pushes a human-readable
 * line to `assertionFailures` for every byte-conservation or live/replay-
 * parity violation found — the hard assertions `main()` fails the whole run
 * on, regardless of baseline vs `--diff` mode. */
function computeVerdictFingerprint(
  fileLabel: string,
  liveMessages: ChatMessage[],
  replayMessages: ChatMessage[],
  grades: Array<{ id: string; atIndex: number; results: GradeResult[]; date: string | null }>,
  deriveVerdictRegions: (messages: ChatMessage[], gradeBatches: Array<{ id: string; atIndex: number }>) => Array<{
    batchId: string
    startIndex: number
    endIndex: number
    boundaryPrefixOnly: boolean
  }>,
  verdictRegionMessageTexts: (
    messages: ChatMessage[],
    region: { batchId: string; startIndex: number; endIndex: number; boundaryPrefixOnly: boolean },
  ) => string[],
  segmentVerdictText: (text: string) => Array<{ kind: string; raw: string }>,
  shouldSuppressSchedule: (segment: any, batchResults: GradeResult[], anchorDate: Date | null, isLiveStreamingTail: boolean) => boolean,
  assertionFailures: string[],
): VerdictFingerprint {
  let liveReplayParityOk = true
  if (liveMessages.length !== replayMessages.length) {
    liveReplayParityOk = false
  } else {
    for (let i = 0; i < liveMessages.length; i++) {
      if (liveMessages[i].role !== replayMessages[i].role || liveMessages[i].text !== replayMessages[i].text) {
        liveReplayParityOk = false
        break
      }
    }
  }
  if (!liveReplayParityOk) {
    assertionFailures.push(
      `LIVE/REPLAY PARITY VIOLATION in ${fileLabel}: parseTranscriptToMessages and buildHistoryTimeline disagree on this transcript's message list.`,
    )
  }

  const regions = deriveVerdictRegions(replayMessages, grades)
  const gradeById = new Map(grades.map((g) => [g.id, g] as const))
  const segmentKindCounts: Record<string, number> = {}
  const suppressedParagraphRaws: string[] = []
  let emptyRegionCount = 0
  let boundaryPrefixOnlyCount = 0
  let byteConservationOk = true

  for (const region of regions) {
    if (region.endIndex < region.startIndex) {
      emptyRegionCount++
      continue
    }
    if (region.boundaryPrefixOnly) boundaryPrefixOnlyCount++
    const batch = gradeById.get(region.batchId)
    const anchorDate = isoLocalDateToAnchor(batch?.date ?? null)
    const texts = verdictRegionMessageTexts(replayMessages, region)
    for (const text of texts) {
      const segments = segmentVerdictText(text)
      const rebuilt = segments.map((s) => s.raw).join('')
      if (rebuilt !== text) {
        byteConservationOk = false
        assertionFailures.push(
          `BYTE-CONSERVATION VIOLATION in ${fileLabel} (batch ${region.batchId}): segmentVerdictText output does not reconstruct its input exactly.`,
        )
      }
      for (const seg of segments) {
        segmentKindCounts[seg.kind] = (segmentKindCounts[seg.kind] ?? 0) + 1
        if (seg.kind === 'schedule' && batch) {
          const suppressed = shouldSuppressSchedule(seg, batch.results, anchorDate, false)
          if (suppressed) suppressedParagraphRaws.push(seg.raw)
        }
      }
    }
  }

  return {
    regionCount: regions.length,
    emptyRegionCount,
    boundaryPrefixOnlyCount,
    segmentKindCounts,
    suppressedParagraphRaws,
    byteConservationOk,
    liveReplayParityOk,
  }
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

async function computeSnapshots(): Promise<{ snapshots: FileSnapshot[]; assertionFailures: string[] }> {
  const { deriveRitualMarks } = await import('../src/shared/ritualFromTranscript')
  const { buildHistoryTimeline } = await import('../src/renderer/src/components/SessionHistoryDrawer')
  const { parseTranscriptToMessages } = await import('../src/shared/chatMessages')
  const { deriveVerdictRegions, verdictRegionMessageTexts, segmentVerdictText, shouldSuppressSchedule } = await import(
    '../src/shared/verdictSegments'
  )

  const files = findTranscripts()
  const snapshots: FileSnapshot[] = []
  const assertionFailures: string[] = []
  for (const file of files) {
    const { lines, parseErrors } = readTranscriptLines(file)
    const derivedMarks = deriveRitualMarks(lines)
    const timeline = buildHistoryTimeline(lines)
    const liveMessages = parseTranscriptToMessages(lines)
    const fileLabel = relative(PROJECTS_ROOT, file)
    const verdictFingerprint = computeVerdictFingerprint(
      fileLabel,
      liveMessages,
      timeline.messages,
      timeline.grades,
      deriveVerdictRegions,
      verdictRegionMessageTexts,
      segmentVerdictText,
      shouldSuppressSchedule,
      assertionFailures,
    )
    snapshots.push({
      file: fileLabel,
      lineCount: lines.length,
      parseErrors,
      derivedMarks,
      historyMarkKinds: timeline.marks.map((m) => m.kind),
      historyMessageCount: timeline.messages.length,
      historyGradeCount: timeline.grades.length,
      verdictFingerprint,
    })
  }
  return { snapshots, assertionFailures }
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

  // Verdict Anatomy (Wave 1) fingerprint — a SEPARATE, ADDITIVE comparison.
  // Only diffed when BOTH sides carry it: a baseline taken before this field
  // existed has `before.verdictFingerprint === undefined`, and that must
  // never itself count as a diff line — it's the exact case Wave 1's own
  // acceptance proof depends on (an empty diff against a PRE-CHANGE baseline
  // proves tasks 1-2 changed no PRE-EXISTING behavior; the fingerprint field
  // not existing yet on that baseline is expected, not a regression).
  for (const file of [...allFiles].sort()) {
    const before = baseline.get(file)?.verdictFingerprint
    const after = currentByFile.get(file)?.verdictFingerprint
    if (!before || !after) continue
    const beforeStr = JSON.stringify(before)
    const afterStr = JSON.stringify(after)
    if (beforeStr === afterStr) continue
    diffs.push(
      `${file}: verdictFingerprint changed — regions ${before.regionCount}->${after.regionCount} ` +
        `(empty ${before.emptyRegionCount}->${after.emptyRegionCount}, prefixOnly ${before.boundaryPrefixOnlyCount}->${after.boundaryPrefixOnlyCount}), ` +
        `segments ${formatCounts(before.segmentKindCounts)} -> ${formatCounts(after.segmentKindCounts)}, ` +
        `suppressed ${before.suppressedParagraphRaws.length}->${after.suppressedParagraphRaws.length}, ` +
        `byteConservationOk ${before.byteConservationOk}->${after.byteConservationOk}, ` +
        `liveReplayParityOk ${before.liveReplayParityOk}->${after.liveReplayParityOk}`,
    )
  }

  return { diffs, filesCompared: allFiles.size }
}

async function main(): Promise<void> {
  const isDiff = process.argv.includes('--diff')
  console.log(`scanning ${PROJECTS_ROOT} for real transcripts (read-only)...`)
  const { snapshots, assertionFailures } = await computeSnapshots()
  console.log(`computed derived marks + history timelines + verdict fingerprints for ${snapshots.length} transcript(s).`)

  // Verdict Anatomy's two HARD invariants — byte conservation and
  // live/replay parity — fail the run outright, in EITHER mode (baseline or
  // --diff), independent of whatever the diff mechanism below finds. A
  // baseline taken while either invariant is broken would just enshrine the
  // breakage as the new "expected" shape, which defeats the point of an
  // assertion; failing here instead means a broken invariant can never
  // silently become the new baseline.
  if (assertionFailures.length > 0) {
    console.error(`FAIL — ${assertionFailures.length} verdict-anatomy assertion violation(s):`)
    for (const f of assertionFailures) console.error(`  - ${f}`)
    process.exitCode = 1
    return
  }
  const totalRegions = snapshots.reduce((n, s) => n + s.verdictFingerprint.regionCount, 0)
  const totalSuppressed = snapshots.reduce((n, s) => n + s.verdictFingerprint.suppressedParagraphRaws.length, 0)
  console.log(
    `verdict anatomy: ${totalRegions} region(s) derived, 0 byte-conservation violations, ` +
      `0 live/replay-parity violations, ${totalSuppressed} schedule paragraph(s) would be suppressed on screen.`,
  )

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
