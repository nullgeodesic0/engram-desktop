// Mirrors engram.py's JSON shapes. Kept intentionally loose (many optional
// fields) since the engine, not this app, owns the schema — see
// engram/1.0.x/scripts/engram.py and skills/_shared/dialogue-grammar.md.

export interface TopicSummary {
  topic: string
  title: string
  goal: string
  nodes: number
  states: { review: number; learning: number; new: number }
  due: number
}

export type NodeState = 'new' | 'learning' | 'review'

export interface NodeEdges {
  requires: string[]
  derives_from: string[]
  contrasts_with: string[]
  analogous_to: string[]
}

export interface NodeViz {
  affordance: 'high' | 'some' | 'none'
  kind: 'causal-parameter' | 'dynamic-process' | 'structural' | 'distributional' | 'procedural' | 'comparative'
  hook: string
}

export interface NodeFsrs {
  s: number | null
  d: number | null
  due: string | null
  last: string | null
  reps: number
  lapses: number
}

export interface EngramNode {
  claim: string
  probe: string
  rubric: string[]
  transfer_probe: string | null
  why_chain: string[]
  edges: NodeEdges
  arbitrary: boolean
  threshold: boolean
  viz: NodeViz | null
  fsrs: NodeFsrs
  state: NodeState
  artifact: string | null
  capstone?: boolean
}

export interface NextNodeResult {
  topic: string
  id: string | null
  node?: EngramNode
  requires_claims?: Record<string, string>
}

export interface TopicGraph {
  topic: string
  title: string
  goal: string
  schema: number
  created: string
  order: string[]
  nodes: Record<string, EngramNode>
}

/** LaTeX overrides for a single Topic Map node, set by the advisory
 * `annotate_node` bridge tool — see main/session/mapAnnotations.ts. Both
 * fields optional individually, but the bridge tool requires at least one. */
export interface MapAnnotation {
  latexLabel?: string
  latexClaim?: string
}

/** One topic's node annotations, keyed by node id — the shape returned by
 * window.engram.mapAnnotations(topic). */
export type MapAnnotations = Record<string, MapAnnotation>

export interface DueItem {
  topic: string
  id: string
  probe: string
  claim: string
  rubric: string[]
  threshold: boolean
  arbitrary: boolean
  artifact: boolean
  due: string
  overdue_days: number
  last: string | null
  s: number
  reps: number
  lapses: number
  transfer_ready: boolean
  transfer_probe: string | null
  capstone: boolean
}

export interface EngramStats {
  receipts: number
  reviews: number
  adherence: {
    loop_closure: { encoded_past_due: number; first_review_done: number; rate: number; read: string }
    return: { sessions_7d: number; sessions_30d: number; days_since_last_session: number; median_gap_days: number; reviews_due_now: number }
    funnel: Record<string, number>
  }
  retention: {
    grader_unvalidated: boolean
    grader_verdict: string
    buckets: Record<string, { recalled: number; partial: number; lapsed: number; n: number; rate: number | null }>
    read: string
  }
  transfer: { n: number; owned_rate: number | null; insufficient_data: boolean; read: string }
  grader_health: { audited: boolean; verdict: string; stamp: string }
  calibration: { brier: number | null; bias: number | null; n: number; read: string | null }
  streak_days: number
  momentum: {
    window_days: number
    reviews_7d: number
    recalled_7d: number
    stability_gained_7d: number
    most_durable: { node: string; stability_days: number } | null
    retained_total: number
  }
  modality: Record<string, unknown>
  due_now: number
  pending_verify: number
  topics: TopicSummary[]
  misconceptions_open: number
  active_experiment: unknown
}

/** One row from engram.py's misconceptions.json, as returned by
 * `misconception list` — window.engram.misconceptions() surfaces the whole
 * ledger (open + resolved). Note the file can also carry a `resolved_ts`
 * field on resolved rows; not modeled here since nothing in this app reads
 * it yet. */
export interface Misconception {
  id: string
  ts: string
  topic: string
  node: string
  description: string
  status: 'open' | 'resolved'
}

export interface TopicSettings {
  systemPromptExtra: string
  contextFiles: string[]
}

export interface ArtifactEntry {
  topic: string
  node: string
  artifact: string
  exists: boolean
}

export interface LearnerModelSettings {
  default_mode: 'sprint' | 'standard' | 'deep'
  artifacts: 'eager' | 'threshold-only' | 'off'
  ambient: string
  momentum: 'on' | 'off'
  profile: 'adhd' | null
  commitment: { cue: string; action: string; set: string } | null
  decay_notice: 'on' | 'off'
}

export interface LearnerModel {
  schema: number
  created: string
  memory: { fsrs_params: unknown; desired_retention: number; interval_multiplier: number; last_refit: string | null }
  challenge_band: { target_success: number; hint_budget: number }
  interests: string[]
  goals: string[]
  strategy_weights: { derivation_first: number; example_first: number }
  settings: LearnerModelSettings
  rhythms: Record<string, unknown>
  accessibility: string[]
}

// ---- NDJSON stream event shapes (subset actually consumed by the app) ----

export interface StreamToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface StreamTextBlock {
  type: 'text'
  text: string
}

export interface RateLimitInfo {
  status: 'allowed' | string
  resetsAt: number
  rateLimitType: string
  overageStatus?: string
  isUsingOverage?: boolean
}

export interface NotifierSettings {
  remindersEnabled: boolean
  cadenceMinutes: number
  dockBadgeEnabled: boolean
}

export interface EnvironmentCheckResult {
  pluginOk: boolean
  pluginVersion?: string
  pluginError?: string
  claudeOk: boolean
  claudePath?: string
  claudeError?: string
}

export interface ReceiptItem {
  topic: string
  node: string
  grade: string | null
}

export interface DayActivity {
  date: string
  count: number
  items: ReceiptItem[]
}

export interface WeekRetention {
  weekStart: string
  total: number
  recalled: number
  rate: number | null
}

export interface ReceiptsHistory {
  days: DayActivity[]
  weeks: WeekRetention[]
}

export interface UpdateCheckResult {
  state: 'current' | 'behind' | 'unknown'
  buildCommit: string
  buildDate: string
  remoteCommit?: string
  remoteDate?: string
  checkedAt: string
  reason?: string
}

export interface SessionIndexEntry {
  sessionId: string
  key: string
  startedAt: string
}

export interface UnlockedAchievement {
  id: string
  unlockedAt: string
}

export interface DecayNodeEntry {
  topic: string
  node: string
  due: boolean
  s: number | null
  r_now: number
  r_no_review: number
  r_if_reviewed: number
  s_if_reviewed: number | null
}

export interface DecayResult {
  topic: string
  horizon_days: number
  encoded: number
  due_now: number
  nodes: DecayNodeEntry[]
}

/** One graded moment recovered from a Claude Code session transcript — the
 * transcript's own line order is the only ordering authority (see
 * main/session/sessionScan.ts), never re-derived from FSRS state. `anchor` is
 * the 0-based index (in the array `session:transcript` returns) of the
 * tool_result entry the grade was parsed from — enough for the UI to jump
 * straight to that point in a transcript replay. */
export interface ProvenanceEvent {
  sessionId: string
  /** YYYY-MM-DD, taken from the transcript entry's own timestamp — not the
   * session's startedAt, since a resumed session can span multiple days. */
  date: string
  anchor: number
  kind: 'encode' | 'pretest' | 'review'
  grade: string | null
}

/** One node's provenance within a topic — window.engram.nodeProvenance(topic)
 * returns `Record<nodeId, NodeProvenance>` for every node in that topic's graph. */
export interface NodeProvenance {
  firstEncoded: ProvenanceEvent | null
  reviews: ProvenanceEvent[]
}

export type ExportSittingFormat = 'md' | 'pdf'

/** IPC `exportSitting`'s request — the renderer owns all the shaping (it
 * already has the drawer's timeline-building and the print-HTML pipeline, see
 * shared/sittingToMarkdown.ts) and hands main a finished document to write;
 * main never re-derives content from a transcript itself. Exactly one of
 * `markdown`/`printHtml` is populated, matching `format` — see
 * main/session/exportSitting.ts. */
export interface ExportSittingRequest {
  format: ExportSittingFormat
  /** Seeds the save dialog's suggested filename only. */
  title: string
  markdown?: string
  printHtml?: string
}

export type ExportSittingResult = { ok: true; path: string } | { ok: false; reason: string }

// ---- Backup & restore (see main/session/backup.ts) ----

export type BackupNowResult = { ok: true; path: string; bytes: number } | { ok: false; reason: string }

export type DescribeArchiveResult =
  | { ok: true; topics: number; receipts: number; archivedAt: string }
  | { ok: false; reason: string }

/** Result of the pre-restore safety snapshot. `path` is `null` only for the
 * genuinely-empty-machine case (no learning dir, no userData files at all —
 * e.g. before a machine's first-ever restore): there's nothing a snapshot
 * could protect, so the always-snapshot-first rule is satisfied vacuously
 * rather than blocking the restore. */
export type SafetySnapshotResult = { ok: true; path: string | null; bytes: number } | { ok: false; reason: string }

/** `safetyPath` is `null` exactly when `SafetySnapshotResult.path` was null
 * above — the renderer should show "no safety snapshot was needed" rather
 * than a path in that case. */
export type RestoreArchiveResult = { ok: true; safetyPath: string | null } | { ok: false; reason: string }

/** Remembered backup destination + last-run info, persisted in this app's
 * userData as backup-state.json — surfaced in Settings as the "last backed
 * up" line. */
export interface BackupInfo {
  lastDestDir: string | null
  lastBackupAt: string | null
  lastBackupPath: string | null
}
