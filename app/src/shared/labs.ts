/**
 * Pack labs on the wire: what main tells the renderer about content packs,
 * their labs, check runs and submissions. See docs/content-packs.md.
 *
 * None of this is learning state. A lab milestone gets an app-side receipt
 * (tests, time, the explain-back); grades, ratings and schedules stay the
 * engine's, written only inside a tutor session.
 */

/** smoke: visible, runnable any time. core: the method is right. slip: execution details. */
export type CheckTier = 'smoke' | 'core' | 'slip'

export interface CheckOutcome {
  /** The test function's name, e.g. "test_crossing_in_band". */
  name: string
  tier: CheckTier
  outcome: 'passed' | 'failed' | 'error' | 'skipped'
  /** The first lines of the failure, empty when it passed. */
  message: string
}

export interface CheckRun {
  /** False when the run itself broke: the learner's cells raised while loading, it timed out, or pytest could not start. */
  completed: boolean
  /** Why the run did not complete, in one plain line. */
  error: string | null
  tests: CheckOutcome[]
  seconds: number
}

export interface TierCount {
  passed: number
  total: number
}

export function tally(tests: CheckOutcome[], tier: CheckTier): TierCount {
  const of = tests.filter((t) => t.tier === tier)
  return {
    passed: of.filter((t) => t.outcome === 'passed').length,
    total: of.length,
  }
}

/**
 * How a hidden run reads against the grading table:
 * - passed: every core and slip test passed
 * - slip: every core test passed, a slip test failed
 * - core: a core test failed
 * - broken: the run did not complete (the cells raised, or it timed out)
 */
export type CheckVerdict = 'passed' | 'slip' | 'core' | 'broken'

export function verdictOf(run: CheckRun): CheckVerdict {
  if (!run.completed) return 'broken'
  const core = tally(run.tests, 'core')
  if (core.passed < core.total) return 'core'
  const slip = tally(run.tests, 'slip')
  return slip.passed < slip.total ? 'slip' : 'passed'
}

/** The engine's own confidence ladder, in the picker's words. */
export const CONFIDENCE_LEVELS = ['Certain', 'Pretty sure', 'Half unsure', 'Just guessing'] as const
export type Confidence = (typeof CONFIDENCE_LEVELS)[number]

export function isConfidence(v: unknown): v is Confidence {
  return typeof v === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(v)
}

/**
 * One Submit. Results stay sealed in main until the explain-back is written
 * and a confidence is picked, in that order; until then `run` and `report`
 * are null on the wire whatever main already knows.
 */
export interface Submission {
  /** `<milestone>-<seq>`, also the folder holding the frozen lab.py. */
  id: string
  milestoneId: string
  seq: number
  submittedAt: string
  /** First 12 hex of the SHA-256 of the frozen lab.py. */
  codeHash: string
  explainBack: string | null
  confidence: Confidence | null
  sealed: boolean
  /** Hidden tests have finished (known in main even while sealed). */
  finished: boolean
  run: CheckRun | null
  /** The signed one-line report, once unsealed. */
  report: string | null
  verdict: CheckVerdict | null
}

/** locked: an earlier milestone with tests has not passed. brief: no hidden tests, nothing to submit. */
export type MilestoneStatus = 'locked' | 'open' | 'submitted' | 'passed' | 'brief'

export interface MilestoneView {
  id: string
  title: string
  brief: string
  hasSmoke: boolean
  hasHidden: boolean
  explainBack: string
  timeLimitS: number
  status: MilestoneStatus
}

export interface LabSummary {
  packId: string
  labId: string
  title: string
  kicker: string
  summary: string
  milestones: number
  passed: number
  /** The learner has opened it at least once. */
  started: boolean
}

export interface PackSummary {
  /** The folder the learner added; the key for removing it. */
  folder: string
  /** Null when pack.json could not be read. */
  id: string | null
  title: string
  version: string
  description: string
  /** The runtime layer the pack's labs run on: its own, or "base". */
  layer: string
  labs: LabSummary[]
  /** Why the pack, or one of its labs, did not load. */
  error: string | null
}

export interface LabView {
  packId: string
  labId: string
  workbenchId: string
  packTitle: string
  title: string
  kicker: string
  summary: string
  layer: string
  milestones: MilestoneView[]
  submissions: Submission[]
}

/** A smoke run as the renderer sees it. Smoke checks are visible, so nothing is sealed. */
export interface SmokeResult {
  milestoneId: string
  run: CheckRun
  at: string
}
