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
  /** pytest's node id, e.g. "hidden_m1.py::test_crossing_in_band". */
  id: string
  /** The test function's name, e.g. "test_crossing_in_band". */
  name: string
  /** The first line of the test's docstring: what it checks, in the pack's words. */
  about: string
  tier: CheckTier
  outcome: 'passed' | 'failed' | 'error' | 'skipped'
  /**
   * The first lines of the failure, empty when it passed. For a core test it
   * is blank on the wire until the milestone has passed: the learner sees
   * which behaviour failed (`about`), not the expected value.
   */
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

/** The confidence as one report token. */
export function confidenceToken(c: Confidence): string {
  return {
    Certain: 'certain',
    'Pretty sure': 'pretty-sure',
    'Half unsure': 'half-unsure',
    'Just guessing': 'guessing',
  }[c]
}

/** What the confidence picker asks: a prediction about the hidden tests, not a feeling. */
export const CONFIDENCE_QUESTION = 'How sure are you that the core tests pass?'

/** Asked after a resubmission instead of the milestone's own question. */
export const RESUBMIT_QUESTION = 'What failed last time, what did you change, and why should that fix it?'

/** Asked when a confident prediction turned out wrong: the moment errors are best corrected. */
export const REFLECT_QUESTION = 'You were sure, and a core test failed. Which assumption do you think broke?'

/** A high-confidence pick that a core failure contradicted. */
export function wantsReflection(confidence: Confidence | null, verdict: CheckVerdict | null): boolean {
  return (confidence === 'Certain' || confidence === 'Pretty sure') && (verdict === 'core' || verdict === 'broken')
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
  /** The explain-back question this Submit asked: the milestone's, or the resubmission one. */
  explainBackPrompt: string
  explainBack: string | null
  confidence: Confidence | null
  /** Set once unsealed when a confident pick met a core failure (see REFLECT_QUESTION). */
  reflectionPrompt: string | null
  reflection: string | null
  /** The help this attempt had, frozen at Submit: whether the partial solution was added, and how many worked steps were open. */
  rung: Rung
  help: number
  sealed: boolean
  /** Hidden tests have finished (known in main even while sealed). */
  finished: boolean
  run: CheckRun | null
  /** The signed one-line report, made at unseal so it carries the confidence and the explain-back's hash. */
  report: string | null
  verdict: CheckVerdict | null
}

/** full: written from scratch. completion: started from the pack's partial solution. */
export type Rung = 'full' | 'completion'

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
  /** A worked example of a sibling problem, Markdown; empty when the pack has none. */
  worked: string
  hasCompletion: boolean
  completionUsed: boolean
  stepsTotal: number
  /** The worked steps opened so far, in order. */
  steps: string[]
  /** The try that first passed its core tests, and whether it had help; null until then. */
  passedOn: { seq: number; unaided: boolean } | null
  /** The tutor topic's node this milestone exercises, or null. */
  node: string | null
  predict: PredictView[]
  /** How many practice variants the milestone has. */
  variants: number
}

/**
 * A predict-the-output item. Main sends `output` and `why` only once a guess
 * is locked in, so the answer is never on screen before the prediction.
 */
export interface PredictView {
  id: string
  prompt: string
  code: string
  guess: string | null
  output: string | null
  why: string | null
  correct: boolean | null
}

/**
 * Whether a predicted printout matches the real one: line endings, trailing
 * spaces on each line and trailing blank lines do not count, anything else does.
 */
export function samePrintout(guess: string, output: string): boolean {
  const norm = (t: string) =>
    t
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n')
      .replace(/\n+$/, '')
  return norm(guess) === norm(output)
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
  /** The tutor topic this lab belongs to, or null: "Discuss with the tutor" needs one. */
  topic: string | null
  milestones: MilestoneView[]
  submissions: Submission[]
}

/** A smoke run as the renderer sees it. Smoke checks are visible, so nothing is sealed. */
export interface SmokeResult {
  milestoneId: string
  run: CheckRun
  at: string
}

// ---------------------------------------------------------------------------
// Spaced, interleaved practice
// ---------------------------------------------------------------------------

/**
 * One milestone's practice: once it passes, its variants come back on a
 * growing interval, each time a different instance, written again from
 * memory in a separate notebook. App-side like the rest of a lab: these are
 * not engine reviews, and nothing here touches a rating or a schedule there.
 */
export interface PracticeItem {
  packId: string
  labId: string
  labTitle: string
  milestoneId: string
  milestoneTitle: string
  variantId: string
  variantTitle: string
  brief: string
  /** When it is due, ISO. */
  due: string
  /** Days the last result scheduled. */
  interval: number
  attempts: number
  last: PracticeAttempt | null
}

export interface PracticeAttempt {
  variantId: string
  at: string
  confidence: Confidence
  verdict: CheckVerdict
  run: CheckRun
  /** When the item comes back. */
  nextDue: string
}

export interface PracticeQueue {
  /** Due now, interleaved: consecutive items come from different milestones, and different labs where possible. */
  due: PracticeItem[]
  /** Not due yet, soonest first. */
  later: PracticeItem[]
}

export const PRACTICE_FIRST_DAYS = 1
export const PRACTICE_MAX_DAYS = 120

/** The next interval in days: a pass roughly triples it, anything else starts over at a day. */
export function nextPracticeInterval(previous: number, verdict: CheckVerdict): number {
  if (verdict !== 'passed' && verdict !== 'slip') return 1
  return Math.min(PRACTICE_MAX_DAYS, Math.max(PRACTICE_FIRST_DAYS, Math.round(previous * 3)))
}

/**
 * Orders due items so the same milestone never comes twice in a row, and the
 * same lab not either while another lab has items left. Most overdue first
 * otherwise. Interleaving makes each item a question of which method fits,
 * not only how to run the one just practised.
 */
export function interleave<T extends { labId: string; packId: string; milestoneId: string; due: string }>(
  items: T[],
): T[] {
  const left = [...items].sort((a, b) => a.due.localeCompare(b.due))
  const out: T[] = []
  while (left.length) {
    const prev = out[out.length - 1]
    let i = 0
    if (prev) {
      const lab = (x: T) => `${x.packId}/${x.labId}`
      i = left.findIndex((x) => lab(x) !== lab(prev))
      if (i < 0) i = left.findIndex((x) => x.milestoneId !== prev.milestoneId)
      if (i < 0) i = 0
    }
    out.push(left.splice(i, 1)[0])
  }
  return out
}
