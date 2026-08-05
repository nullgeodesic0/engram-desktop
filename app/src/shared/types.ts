// Mirrors engram.py's JSON shapes. Kept intentionally loose (many optional
// fields) since the engine, not this app, owns the schema — see
// engram/1.0.x/scripts/engram.py and skills/_shared/dialogue-grammar.md.

/** One row of `engram.py stats`'s `topics` array (compute_stats) — the ONLY
 * three fields that subcommand actually emits per topic. Do not add
 * `due`/`goal`/`nodes` here: a prior version of this type declared all three
 * as required while `compute_stats` never sent them, so every read silently
 * evaluated to `undefined` and every `topic.due > 0` gate was permanently
 * false. Code that needs due count, goal text, or node count wants
 * `TopicListEntry` (`engram.py topics`) instead. */
export interface TopicSummary {
  topic: string
  title: string
  states: { review: number; learning: number; new: number }
}

/** One row of `engram.py topics`'s output (cmd_topics) — TopicSummary's
 * fields plus the three `compute_stats` never sends: `goal`, `nodes`
 * (its total node count), and `due` (computed fresh against today's date,
 * server-side, at call time). Fetched via `window.engram.topics()` /
 * `getTopicsCached`, never via `stats().topics`. */
export interface TopicListEntry extends TopicSummary {
  goal: string
  nodes: number
  due: number
  /** The engine's own generated title, preserved when a `displayTitle`
   * override — see TopicSettings — has replaced `title` for display. Set by
   * `getTopicsCached`'s overlay only in that case, so the settings modal
   * can still show what the engine calls this topic. */
  engineTitle?: string
  /** Count of retired nodes (engine `topics` output, v1.3+) — equal to
   * `nodes` when the whole topic is archived. Sparse: older engines omit
   * it; never assume. */
  retired?: number
  /** App-local folder this topic is filed under, overlaid by
   * `getTopicsCached` from topic-settings.json — NOT an engine field and
   * never written to any graph. Purely presentational grouping (see
   * TopicSettings.folder). Absent/null means unfiled. */
  folder?: string | null
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
  /** Present only on `due --cap` (savings-ordered) payloads — the engine's
   * own "so overdue it is effectively a relearn" flag. Sparse by nature:
   * absent on `--limit` reads and on older engines; never assume (same
   * discipline as every other sparse projection in this file). */
  effectively_relearn?: boolean
}

/** The `due --cap` payload shape (engine v1.3+): the same items, ranked by
 * expected 30-day retention saved per expected minute, plus the ranking's
 * own label. `--limit` reads return a bare DueItem[] instead — see
 * main/engramCli/dueArgs.ts for which caller wants which. */
export interface DueCappedResult {
  order: string
  order_basis: string
  cap: number
  n: number
  items: DueItem[]
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
 * ledger (open + resolved). */
export interface Misconception {
  id: string
  ts: string
  topic: string
  node: string
  description: string
  status: 'open' | 'resolved'
  /** Local YYYY-MM-DD the engine stamped when `misconception resolve` ran —
   * absent on open rows. The engine always writes it on resolve, so a
   * resolved row WITHOUT one can only come from hand-editing the file;
   * consumers treat that case as resolved-at-`ts` (the conservative read —
   * see computeHistoricalTopicGrade). */
  resolved_ts?: string
}

/** The engine's one-active-experiment-at-a-time record, as `engram.py`
 * writes it into experiments.json when `experiment start` runs (see
 * cmd_experiment's "start" action) — id, seed, and question are set once and
 * never edited afterwards. `EngramStats.active_experiment` only ever carries
 * this record's `question` string (or null); this fuller shape comes from
 * `experiment list` filtered to `status === "active"`, the read path Task 1's
 * action map already allows.
 *
 * UNVERIFIED against live data as of this writing — no experiment has ever
 * run on this install (`stats().active_experiment` and `experiment status`
 * both read null/"no active experiment" here). This type mirrors exactly
 * what cmd_experiment's "start" action constructs and writes; it has not
 * been seen populated. */
export interface ActiveExperiment {
  id: string
  question: string
  /** ISO date (YYYY-MM-DD) the design was registered — `today().isoformat()`. */
  started: string
  arms: string[]
  metric: string
}

export interface TopicSettings {
  systemPromptExtra: string
  contextFiles: string[]
  /** Local YYYY-MM-DD deadline the learner set for this topic, or null/absent
   * if none — mirrors main/session/topicSettings.ts's own TopicSettings (see
   * that file's doc comment for why this app keeps two structurally-matched
   * declarations rather than a shared import across the main/renderer
   * boundary). Optional for the same reason `contextFiles` predates some
   * saved settings on disk. */
  targetDate?: string | null
  /** App-side display name shown in place of the engine's own generated
   * title — purely presentational, never written to the graph file, never
   * seen by the engine. Null/absent = use the engine's title. */
  displayTitle?: string | null
  /** App-side folder for grouping topic lists in the UI. Same
   * purely-presentational contract as `displayTitle`: nothing moves on disk
   * and the engine never sees it. Null/absent = unfiled. */
  folder?: string | null
}

export interface ArtifactEntry {
  topic: string
  node: string
  artifact: string
  exists: boolean
  /** File mtime in epoch ms, stat'd (main-side) from the RESOLVED path —
   * `engramArtifactList` already resolves engram.py's mixed absolute/
   * learning-home-relative paths (see readOnly.ts's doc comment). The engine
   * itself records no build date at all (`artifact list` returns only
   * `{topic, node, artifact, exists}`), and a failed stat (exists: false, or
   * a resolved path that still doesn't read) leaves this null rather than
   * guessing a date. */
  mtimeMs: number | null
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

/** Dual-mode auth (suite doctrine, mirrored from Observatory Desktop).
 * `subscription` = the CLI's own Claude Code login, with stray
 * ANTHROPIC_API_KEY/AUTH_TOKEN stripped from session spawns so a shell
 * export can never silently flip tutoring onto per-token billing.
 * `apiKey` = same binary billed against the key in the encrypted store
 * (`session/apiKeyStore.ts` — never plaintext, never in a settings file). */
export type AuthMode = 'subscription' | 'apiKey'

export interface AuthSettings {
  authMode: AuthMode
}

/** What the renderer may know about the stored API key: presence and the
 * last four characters for the Settings readout. Never the key itself —
 * that stays main-process-only. */
export interface ApiKeyStatus {
  present: boolean
  last4: string | null
}

export interface EnvironmentCheckResult {
  pluginOk: boolean
  pluginVersion?: string
  pluginError?: string
  claudeOk: boolean
  claudePath?: string
  claudeError?: string
}

/** engram.py's own health check (`doctor`) — state-dir writability, the
 * learner model, and every topic graph on disk, walked node by node. Shells
 * out and re-reads every graph file, so this only ever runs on demand (a
 * button), never on mount. See engram.py's cmd_doctor for the exact fields
 * written; verified live against this machine's real state. */
export interface DoctorResult {
  python: string
  home: string
  writable: boolean
  model_ok: boolean
  topics: number
  nodes: number
  receipts: number
  pending_verify: number
  artifacts: number
  issues: string[]
  notes: string[]
  ok: boolean
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

/** Mirrors main/engramCli/receiptsHistory.ts's RawReceipt — see that file for
 * why this is unwindowed (unlike `days`/`weeks` below) and what each field
 * is for. Consumed only by shared/topicMetrics.ts. */
export interface RawReceipt {
  id: string | null
  ts: string
  topic: string
  node: string
  kind: string | null
  grade: string | null
  rating: string | null
  sBefore: number | null
  sAfter: number | null
  /** engram.py stamps this `true` only on a capstone node's own receipts
   * (cmd_learn's extra = {**extra, "capstone": True}) — never present, so
   * never `true`, on any other receipt. shared/topicMetrics.ts's
   * `groupByNode` needs it to recognize a capstone's first receipt (always
   * `kind: transfer`, never an encode) as a genuine retrieval rather than
   * silently swallowing it. */
  capstone: boolean
  /** The FSRS interval (days) this receipt's own rating set — engram.py's
   * `interval_days`, present on every real receipt checked. */
  intervalDays: number | null
  /** The exact due-date this receipt scheduled the node's next review for —
   * engram.py's `due_next`, a local 'YYYY-MM-DD' string. See
   * `shared/topicGrade.ts`'s punctuality metric. */
  dueNext: string | null
  /** engram.py's relearn-retry marker — excluded by the engine from every
   * retention-family population; ports must filter it the same way. */
  relearn: boolean
  /** Free-text provenance (`rate --source`): "self" on ordinary tutored
   * reviews, "assessor" on assessor receipts, "quick-mc" on checkpoint
   * sittings. Sparse — old rows lack it; never assume, never read null as
   * "self". */
  source: string | null
}

export interface ReceiptsHistory {
  days: DayActivity[]
  weeks: WeekRetention[]
  receipts: RawReceipt[]
}

/** `direction` on both `grader-health` and a raw audit file — how often the
 * grader's judgment moved AWAY from the gold rating, split by which way it
 * moved. `graded_up` is the only direction that can flatter a learner out of
 * a review they need, which is why GraderAudit.tsx renders it first. */
export interface GraderDirection {
  graded_up: number
  graded_down: number
  exact: number
  judgments: number
  note: string
}

/** One `by_case_type` entry — a trap category from the adversarial gold set
 * (e.g. `partial-credit-boundary`), not a topic. This is the field that
 * names *where* grading is least reliable. */
export interface GraderCaseTypeStats {
  items: number
  judgments: number
  agreement: number
  leniency_bias: number
}

/** engram.py `grader-health` when no audit has ever run, or the newest audit
 * file on disk is corrupt. This shape is never guessed — read directly from
 * `compute_grader_health`'s own source (engram.py, both early-return
 * branches): exactly these five keys, nothing else. Real audits exist on
 * this machine, so the branch itself isn't exercised live here, but the
 * source is unambiguous and this app must never move or delete
 * `~/.claude/learning/audits/*.json` to force it. `grader_unvalidated` is
 * always `true` here — an unaudited oracle makes every number downstream
 * unearned. */
export interface GraderHealthUnaudited {
  audited: false
  verdict: 'unaudited' | 'unreadable'
  grader_unvalidated: true
  stamp: string
  read: string
}

/** engram.py `grader-health` once at least one readable audit exists — the
 * latest audit's full body, field-checked and with `grader_unvalidated`
 * DERIVED from `verdict` (never trusted from the file). Verified live
 * against both real audits on disk (2026-07-19-01.json, 2026-07-23-01.json)
 * via `python3 engram.py grader-health`, 2026-07-27. Note what this does
 * NOT carry: `thresholds` and `bias_note` are written to every audit file
 * but omitted from this payload — see main/engramCli/graderAuditHistory.ts,
 * which reads them directly from the newest file on disk. */
export interface GraderHealthAudited {
  audited: true
  ts: string | null
  grader: string | null
  n: number | null
  runs: number | null
  qwk: number | null
  exact_agreement: number | null
  leniency_bias: number | null
  test_retest: number | null
  direction: GraderDirection | null
  by_case_type: Record<string, GraderCaseTypeStats>
  gold_source: string | null
  /** Both real audits are `"authored"`, never `"human"` — the gold set was
   * written, not independently adjudicated, and GraderAudit.tsx must render
   * its caveat at the same weight as the numbers whenever this isn't
   * `"human"`. */
  gold_adjudication: string
  gold_modified: boolean
  identical_runs: boolean
  /** The engine's own caveats, verbatim — never paraphrased into something
   * softer. Both real audits carry the "GOLD SET IS AUTHORED..." reason. */
  reasons: string[]
  verdict: string
  grader_unvalidated: boolean
  stamp: string | null
  read: string
}

export type GraderHealthResult = GraderHealthUnaudited | GraderHealthAudited

/** Mirrors main/engramCli/graderAuditHistory.ts's GraderAuditFile — see that
 * file for why only these fields are read directly from disk rather than via
 * `grader-health` (which omits `thresholds`/`bias_note` entirely). */
export interface GraderAuditThresholds {
  qwk_floor: number
  qwk_target: number
  bias_max: number
  min_n: number
  min_runs: number
  paradox_retest: number
}

export interface GraderAuditFile {
  ts: string
  verdict: string
  qwk: number | null
  n: number | null
  runs: number | null
  thresholds: GraderAuditThresholds | null
  bias_note: string | null
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

export interface CrashLogEntry {
  timestamp: string
  source: 'uncaughtException' | 'unhandledRejection'
  message: string
  stack?: string
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

/** IPC `map:export`'s request — the renderer builds the self-contained print
 * HTML (shared/mapToPrintHtml.ts) exactly the way it already builds a
 * sitting's `printHtml` for ExportSittingRequest, and hands main a finished
 * document; main never re-derives a plate from a graph itself. Reuses
 * ExportSittingResult (below) rather than a parallel result type since the
 * shape — ok+path, or ok:false+reason — is identical. */
export interface ExportMapRequest {
  /** Seeds the save dialog's suggested filename only. */
  title: string
  printHtml: string
}

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

/** Prefill delivered by an `engram://new-topic` deep link (Observatory's
 * paper→topic hand-off — see main/deepLink.ts's parseEngramDeepLink and
 * main/index.ts's handleDeepLink, which shape-guards and filesystem-checks
 * everything before this ever reaches the renderer). A deadline, if the
 * link carried one, is already folded into `instructions` by the time this
 * exists — the renderer never sees a separate deadline field.
 *
 * Prefill ONLY: this seeds the New Topic modal's fields for the learner to
 * review; nothing may use it to auto-start a session. */
export interface NewTopicPrefill {
  goal: string
  instructions: string
  contextFiles: string[]
  /** How many of the link's ORIGINAL contextFiles entries were dropped by
   * main/deepLink.ts's validateContextFiles (missing, wrong type, a
   * symlink, a traversal path, ...) — set by buildNewTopicPrefill so the
   * modal can say "N files couldn't be included" instead of silently
   * showing fewer files than the link actually carried. `undefined` (not 0)
   * when this prefill didn't go through that composition at all (there is
   * currently no other producer of NewTopicPrefill, but the field is
   * optional rather than required so a future one isn't forced to fabricate
   * a count it has no way to compute). */
  droppedContextFileCount?: number
}
