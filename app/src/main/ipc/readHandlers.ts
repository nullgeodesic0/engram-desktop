import { ipcMain } from 'electron'
import { stat } from 'node:fs/promises'
import {
  engramRead,
  engramTopicStatusText,
  engramArtifactList,
  engramDirectMutate,
  readTopicGraph,
} from '../engramCli/readOnly'
import { buildDueArgs, buildDueCappedArgs } from '../engramCli/dueArgs'
import { getTopicsCached } from '../engramCli/topicsCache'
import { readReceiptsHistory } from '../engramCli/receiptsHistory'
import { readGraderAuditHistory } from '../engramCli/graderAuditHistory'
import { getMapAnnotations } from '../session/mapAnnotations'
import { getDisplayTitles } from '../session/topicSettings'
import { nodeProvenance } from '../session/sessionScan'
import { recordManualResolve, getManualResolves } from '../session/misconceptionResolves'
import { moveTopicToTrash } from '../session/topicTrash'
import { hasLiveSessions } from './sessionHandlers'
import type {
  TopicGraph,
  NodeProvenance,
  Misconception,
  ActiveExperiment,
  GraderHealthResult,
  GraderAuditFile,
  ArtifactEntry,
} from '../../shared/types'

// misconceptions.json is engine-written but hand-editable — shape-guard each
// row rather than trusting the file, and drop malformed entries instead of
// throwing (a partially-bad file shouldn't blank out the whole ledger).
function isMisconception(row: unknown): row is Misconception {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.ts === 'string' &&
    typeof r.topic === 'string' &&
    typeof r.node === 'string' &&
    typeof r.description === 'string' &&
    (r.status === 'open' || r.status === 'resolved') &&
    // resolved_ts: optional (open rows never carry it); a non-string value
    // is hand-edit damage and drops the row, same discipline as above.
    (r.resolved_ts === undefined || typeof r.resolved_ts === 'string')
  )
}

// experiments.json is engine-written but hand-editable, same discipline as
// isMisconception above — shape-guard each row and only trust one whose
// status is currently "active" (settled/never-started rows are cheap to
// hand-edit malformed and must not surface as a live banner).
function isActiveExperiment(row: unknown): row is ActiveExperiment {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>
  return (
    r.status === 'active' &&
    typeof r.id === 'string' &&
    typeof r.question === 'string' &&
    typeof r.started === 'string' &&
    typeof r.metric === 'string' &&
    Array.isArray(r.arms) &&
    r.arms.every((a) => typeof a === 'string')
  )
}

// `engramArtifactList()` already resolves engram.py's mixed absolute/
// learning-home-relative paths against the learning home (see readOnly.ts's
// doc comment) — this stats that RESOLVED path for a build date, since the
// engine itself records none (`artifact list` returns only
// `{topic, node, artifact, exists}`). Lives here, not in readOnly.ts, which
// stays a pure engram.py passthrough this project doesn't touch. A stat
// failure (exists: false, or a resolved path that still doesn't read) leaves
// `mtimeMs` null — absent, not guessed.
async function artifactListWithMtime(): Promise<ArtifactEntry[]> {
  const raw = (await engramArtifactList()) as Omit<ArtifactEntry, 'mtimeMs'>[]
  return Promise.all(
    raw.map(async (e) => {
      let mtimeMs: number | null = null
      try {
        mtimeMs = (await stat(e.artifact)).mtimeMs
      } catch {
        // not on disk, or the resolved path is otherwise unreadable
      }
      return { ...e, mtimeMs }
    }),
  )
}

export function registerReadHandlers(): void {
  ipcMain.handle('engram:topics', () => getTopicsCached())
  ipcMain.handle('engram:stats', () => engramRead('stats'))
  // Productions stashed but not yet graded. See readOnly.ts's per-action gate
  // for why only the count action is reachable.
  ipcMain.handle('engram:pendingProductions', () => engramRead('stash', ['count']))
  ipcMain.handle('engram:due', (_e, limit?: number, topic?: string) => engramRead('due', buildDueArgs({ limit, topic })))
  // The savings-ordered triage read (`due --cap`) — same allowlisted command,
  // different payload shape (DueCappedResult). Used by the review ready
  // plate's time picker; older engines without --cap reject the flag, which
  // surfaces as a rejected promise the caller must catch and fall back from.
  ipcMain.handle('engram:dueCapped', (_e, cap: number, topic?: string) => engramRead('due', buildDueCappedArgs(cap, topic)))
  ipcMain.handle('engram:decay', (_e, topic?: string, horizon?: number) => {
    const args: string[] = []
    if (topic) args.push('--topic', topic)
    if (horizon != null) args.push('--horizon', String(horizon))
    return engramRead('decay', args)
  })
  ipcMain.handle('engram:next', (_e, topic: string) => engramRead('next', ['--topic', topic]))
  ipcMain.handle('engram:doctor', () => engramRead('doctor'))
  ipcMain.handle('engram:model', () => engramRead('model'))
  // Already on the read-only allowlist (main/engramCli/readOnly.ts) with zero
  // call sites before this — see readOnly.ts's READ_ONLY_COMMANDS. Returns
  // the latest audit's full body, field-checked; see shared/types.ts's
  // GraderHealthResult for the two shapes (audited vs not) verified against
  // engram.py's own source.
  ipcMain.handle('engram:graderHealth', () => engramRead<GraderHealthResult>('grader-health'))
  // Direct read of ~/.claude/learning/audits/*.json, newest first — same
  // discipline as readTopicGraph below: a documented, engine-owned,
  // append-only directory, read and never written. Supplies `thresholds`
  // and `bias_note`, which `grader-health` omits (see graderAuditHistory.ts).
  ipcMain.handle('engram:graderAuditHistory', (): Promise<GraderAuditFile[]> => readGraderAuditHistory())
  ipcMain.handle('engram:topicStatusText', (_e, topic: string) => engramTopicStatusText(topic))
  // Display-rename overlay on the graph's own title too — same single-point
  // treatment getTopicsCached applies to the topics list, so every consumer
  // of either source (map header, Home's flashback, print export) shows the
  // learner's chosen name. The graph on DISK is never written (read-only
  // doctrine); only the IPC payload's `title` field is swapped in transit.
  ipcMain.handle('engram:topicGraph', async (_e, topic: string) => {
    const graph = (await readTopicGraph(topic)) as TopicGraph
    const rename = (await getDisplayTitles())[topic]
    return rename ? { ...graph, title: rename } : graph
  })
  ipcMain.handle('engram:artifactList', (): Promise<ArtifactEntry[]> => artifactListWithMtime())
  ipcMain.handle('engram:receiptsHistory', () => readReceiptsHistory())
  ipcMain.handle('engram:misconceptions', async (): Promise<Misconception[]> => {
    const rows = await engramRead<unknown[]>('misconception', ['list'])
    return Array.isArray(rows) ? rows.filter(isMisconception) : []
  })
  // `stats` only ever carries this experiment's `question` string (or null) —
  // see engram.py's compute_stats. The fuller record (started date, arms,
  // metric) requires the `experiment list` read path (Task 1's action map),
  // filtered here to whichever row is currently active.
  ipcMain.handle('engram:activeExperiment', async (): Promise<ActiveExperiment | null> => {
    const rows = await engramRead<unknown[]>('experiment', ['list'])
    return (Array.isArray(rows) ? rows.find(isActiveExperiment) : undefined) ?? null
  })
  ipcMain.handle('mapAnnotations:get', (_e, topicId: string) => getMapAnnotations(topicId))

  // Node ids come from the topic's own graph (same file readTopicGraph already
  // reads) — the scanner needs that set to attribute review-kind events, which
  // aren't topic-scoped in the session index (see sessionScan.ts).
  ipcMain.handle('engram:nodeProvenance', async (_e, topic: string): Promise<Record<string, NodeProvenance>> => {
    const graph = (await readTopicGraph(topic)) as TopicGraph
    return nodeProvenance(topic, Object.keys(graph.nodes))
  })

  // The narrow direct-mutation exception (settings only): visuals/focus/model --set/commit.
  ipcMain.handle('engram:visuals', (_e, mode: 'eager' | 'threshold' | 'off' | 'status') =>
    engramDirectMutate('visuals', [mode]),
  )
  ipcMain.handle('engram:focus', (_e, mode: 'on' | 'off' | 'status') =>
    engramDirectMutate('focus', [mode]),
  )
  ipcMain.handle('engram:modelSet', (_e, path: string, value: string) =>
    engramDirectMutate('model', ['--set', `${path}=${value}`]),
  )
  ipcMain.handle('engram:modelAddInterest', (_e, interest: string) =>
    engramDirectMutate('model', ['--add-interest', interest]),
  )
  ipcMain.handle('engram:commit', (_e, cue: string, action: string) =>
    engramDirectMutate('commit', ['--cue', cue, '--action', action]),
  )
  // The misconception-resolve door (action-gated inside engramDirectMutate —
  // resolve only, never add). Provenance is recorded app-side AFTER the
  // engine write succeeds, so a failed resolve never leaves a stray
  // "manual" label; the engine's own status/resolved_ts stay the single
  // source of truth for grading.
  ipcMain.handle('engram:misconceptionResolve', async (_e, id: string) => {
    if (!/^m_[A-Za-z0-9_]+$/.test(id)) throw new Error(`misconceptionResolve: malformed id "${id}"`)
    const result = await engramDirectMutate('misconception', ['resolve', '--id', id])
    await recordManualResolve(id)
    return result
  })
  ipcMain.handle('engram:misconceptionManualResolves', () => getManualResolves())
  // Whole-topic close-out — the engine's own reversible autonomy verb,
  // topic-shape-gated in engramDirectMutate (never per-node from the app).
  ipcMain.handle('engram:retireTopic', (_e, topic: string, restore: boolean) => {
    if (!/^[a-z0-9-]+$/.test(topic)) throw new Error(`retireTopic: malformed topic "${topic}"`)
    return engramDirectMutate('retire', restore ? ['--topic', topic, '--restore'] : ['--topic', topic])
  })
  // Whole-topic deletion — an app-side custody transfer into userData
  // topic-trash (see topicTrash.ts's doctrine header + D2.trashGate).
  ipcMain.handle('engram:deleteTopic', (_e, topic: string) => moveTopicToTrash(topic, hasLiveSessions))
}
