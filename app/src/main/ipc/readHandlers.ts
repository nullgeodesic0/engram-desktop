import { ipcMain } from 'electron'
import {
  engramRead,
  engramTopicStatusText,
  engramArtifactList,
  engramDirectMutate,
  readTopicGraph,
} from '../engramCli/readOnly'
import { getTopicsCached } from '../engramCli/topicsCache'
import { readReceiptsHistory } from '../engramCli/receiptsHistory'
import { readGraderAuditHistory } from '../engramCli/graderAuditHistory'
import { getMapAnnotations } from '../session/mapAnnotations'
import { nodeProvenance } from '../session/sessionScan'
import type {
  TopicGraph,
  NodeProvenance,
  Misconception,
  ActiveExperiment,
  GraderHealthResult,
  GraderAuditFile,
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
    (r.status === 'open' || r.status === 'resolved')
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

export function registerReadHandlers(): void {
  ipcMain.handle('engram:topics', () => getTopicsCached())
  ipcMain.handle('engram:stats', () => engramRead('stats'))
  ipcMain.handle('engram:due', (_e, limit?: number, topic?: string) => {
    const args: string[] = []
    if (limit != null) args.push('--limit', String(limit))
    if (topic) args.push('--topic', topic)
    return engramRead('due', args)
  })
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
  ipcMain.handle('engram:topicGraph', (_e, topic: string) => readTopicGraph(topic))
  ipcMain.handle('engram:artifactList', () => engramArtifactList())
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
}
