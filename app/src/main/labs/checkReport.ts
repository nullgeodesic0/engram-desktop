import { createHmac, timingSafeEqual } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { CheckRun, CheckVerdict, Confidence, Rung } from '../../shared/labs'
import { confidenceToken, tally, verdictOf } from '../../shared/labs'

/**
 * The signed one-line report a Submit produces, e.g.
 *
 *     [engram-check v1 lab=pack/lab m=m3 sub=2 verdict=slip core=6/6 slip=2/3
 *      env=base-4b09c790529a code=9c1e04aa31f2 t=41s at=2026-11-09T14:52:03Z
 *      conf=pretty-sure eb=5d1c0e9a77b2 rung=full help=0 sig=…]
 *
 * (one line in practice). It is what the learner's turn to the tutor opens
 * with, ahead of the explain-back, and it stays under 400 characters so the
 * two fit one engine production. `sig` is an HMAC-SHA256 over everything
 * before it, keyed by a secret that never leaves this install, so a report
 * the app produced can be told from one typed by hand. It says nothing about
 * the learner's code beyond its hash: the grader never sees the code. `conf`
 * is the confidence picked before the results were shown, and `eb` the hash
 * of the explain-back written before them, so neither can be swapped after
 * the learner has seen how the tests went. `sub` is the try (1 is the first
 * attempt), `rung` says whether the code started from the pack's partial
 * solution, and `help` how many worked steps were open at Submit, so the
 * tutor can tell a first, unaided pass from one that was helped along.
 *
 * What the signature attests: that this app ran the pack's tests on code
 * with that hash and reported this. It does not attest that the code left
 * the test run alone: the learner's cells run in the same process as the
 * tests (see engram_check.py).
 *
 * Pure: the key is passed in (see labStore.checkKey), so this is tested directly.
 */

export const REPORT_PREFIX = '[engram-check v1 '
export const REPORT_MAX = 400
const SIG_HEX = 32

export interface ReportFields {
  lab: string
  milestone: string
  seq: number
  verdict: CheckVerdict
  core: string
  slip: string
  env: string
  code: string
  seconds: number
  at: string
  conf: string
  eb: string
  rung: string
  help: number
}

/** First 12 hex of the SHA-256 of the explain-back as stored. */
export function explainBackHash(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 12)
}

export function reportFields(input: {
  lab: string
  milestone: string
  seq: number
  run: CheckRun
  env: string
  codeHash: string
  at: Date
  confidence: Confidence
  explainBack: string
  rung: Rung
  help: number
}): ReportFields {
  const core = tally(input.run.tests, 'core')
  const slip = tally(input.run.tests, 'slip')
  return {
    lab: input.lab,
    milestone: input.milestone,
    seq: input.seq,
    verdict: verdictOf(input.run),
    core: `${core.passed}/${core.total}`,
    slip: `${slip.passed}/${slip.total}`,
    env: input.env,
    code: input.codeHash,
    seconds: Math.round(input.run.seconds),
    // Whole seconds: the report is for people, and shorter is better.
    at: input.at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    conf: confidenceToken(input.confidence),
    eb: explainBackHash(input.explainBack),
    rung: input.rung,
    help: input.help,
  }
}

function body(f: ReportFields): string {
  return (
    `${REPORT_PREFIX}lab=${f.lab} m=${f.milestone} sub=${f.seq} verdict=${f.verdict} core=${f.core} slip=${f.slip}` +
    ` env=${f.env} code=${f.code} t=${f.seconds}s at=${f.at} conf=${f.conf} eb=${f.eb} rung=${f.rung} help=${f.help}`
  )
}

function mac(key: Buffer, text: string): string {
  return createHmac('sha256', key).update(text, 'utf-8').digest('hex').slice(0, SIG_HEX)
}

export function signReport(f: ReportFields, key: Buffer): string {
  const b = body(f)
  const line = `${b} sig=${mac(key, b)}]`
  if (line.length > REPORT_MAX) throw new Error('The check report would run past its 400-character budget.')
  return line
}

const TOKEN = /^[A-Za-z0-9/_.:-]+$/

/** Reads a report back. Null unless it is well formed and its signature matches this install's key. */
export function verifyReport(line: string, key: Buffer): ReportFields | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith(REPORT_PREFIX) || !trimmed.endsWith(']')) return null
  const m = / sig=([0-9a-f]+)\]$/.exec(trimmed)
  if (!m || m[1].length !== SIG_HEX) return null
  const b = trimmed.slice(0, m.index)
  const want = Buffer.from(mac(key, b), 'hex')
  const got = Buffer.from(m[1], 'hex')
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  const kv = new Map<string, string>()
  for (const part of b.slice(REPORT_PREFIX.length).split(' ')) {
    const eq = part.indexOf('=')
    if (eq <= 0) return null
    const v = part.slice(eq + 1)
    if (!TOKEN.test(v)) return null
    kv.set(part.slice(0, eq), v)
  }
  const verdict = kv.get('verdict')
  const seconds = /^(\d+)s$/.exec(kv.get('t') ?? '')
  if (verdict !== 'passed' && verdict !== 'slip' && verdict !== 'core' && verdict !== 'broken') return null
  if (!seconds) return null
  const fields: ReportFields = {
    lab: kv.get('lab') ?? '',
    milestone: kv.get('m') ?? '',
    seq: Number(kv.get('sub')),
    verdict,
    core: kv.get('core') ?? '',
    slip: kv.get('slip') ?? '',
    env: kv.get('env') ?? '',
    code: kv.get('code') ?? '',
    seconds: Number(seconds[1]),
    at: kv.get('at') ?? '',
    conf: kv.get('conf') ?? '',
    eb: kv.get('eb') ?? '',
    rung: kv.get('rung') ?? '',
    help: Number(kv.get('help')),
  }
  // The signature covers the text, so this only guards against a report from a different format.
  return body(fields) === b ? fields : null
}

/**
 * A problem's report, with the same prefix, key and budget:
 *
 *     [engram-check v1 prob=pack/kl-conditions type=audit sub=1 verdict=slip
 *      score=3/4 false=1 t=612s at=2026-11-09T14:52:03Z conf=pretty-sure
 *      ans=5d1c0e9a77b2 help=0 sig=…]
 *
 * `score` is planted errors found (audit) or readings within tolerance
 * (figure), and `-` for a proof, which only the tutor grades. `false` counts
 * flags on passages with no planted error. `ans` hashes the answer and the
 * judgement exactly as recorded, so neither can be swapped after the results
 * were shown. `t` is the time from opening the problem to Submit.
 */
export interface ProblemReportFields {
  prob: string
  type: string
  seq: number
  verdict: string
  score: string
  falseFlags: number
  seconds: number
  at: string
  conf: string
  ans: string
  help: number
}

function problemBody(f: ProblemReportFields): string {
  return (
    `${REPORT_PREFIX}prob=${f.prob} type=${f.type} sub=${f.seq} verdict=${f.verdict} score=${f.score}` +
    ` false=${f.falseFlags} t=${f.seconds}s at=${f.at} conf=${f.conf} ans=${f.ans} help=${f.help}`
  )
}

export function signProblemReport(f: ProblemReportFields, key: Buffer): string {
  const b = problemBody(f)
  const line = `${b} sig=${mac(key, b)}]`
  if (line.length > REPORT_MAX) throw new Error('The problem report would run past its 400-character budget.')
  return line
}

/** True when a report line names a problem rather than a lab, before any check of its signature. */
export function isProblemReport(line: string): boolean {
  return line.trim().startsWith(`${REPORT_PREFIX}prob=`)
}

/** Reads a problem report back. Null unless it is well formed and signed by this install. */
export function verifyProblemReport(line: string, key: Buffer): ProblemReportFields | null {
  const trimmed = line.trim()
  if (!isProblemReport(trimmed) || !trimmed.endsWith(']')) return null
  const m = / sig=([0-9a-f]+)\]$/.exec(trimmed)
  if (!m || m[1].length !== SIG_HEX) return null
  const b = trimmed.slice(0, m.index)
  const want = Buffer.from(mac(key, b), 'hex')
  const got = Buffer.from(m[1], 'hex')
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  const kv = new Map<string, string>()
  for (const part of b.slice(REPORT_PREFIX.length).split(' ')) {
    const eq = part.indexOf('=')
    if (eq <= 0) return null
    const v = part.slice(eq + 1)
    if (!TOKEN.test(v)) return null
    kv.set(part.slice(0, eq), v)
  }
  const seconds = /^(\d+)s$/.exec(kv.get('t') ?? '')
  if (!seconds) return null
  const fields: ProblemReportFields = {
    prob: kv.get('prob') ?? '',
    type: kv.get('type') ?? '',
    seq: Number(kv.get('sub')),
    verdict: kv.get('verdict') ?? '',
    score: kv.get('score') ?? '',
    falseFlags: Number(kv.get('false')),
    seconds: Number(seconds[1]),
    at: kv.get('at') ?? '',
    conf: kv.get('conf') ?? '',
    ans: kv.get('ans') ?? '',
    help: Number(kv.get('help')),
  }
  return problemBody(fields) === b ? fields : null
}
