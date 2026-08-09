import { describe, it, expect } from 'vitest'
import {
  composeReviewKickoff,
  composeResumeNudge,
  detectResumeState,
  capForMins,
  coveredCount,
  type SittingMins,
  type SittingStyle,
} from './reviewKickoff'

// Built by concatenation so checkDoctrine's D3.kickoff collector (which
// hashes every literal containing the skill marker) never collects test
// fixtures — the dodge is deliberate; only real injected messages belong in
// the pin.
const MARKER = '/engram' + ':review'

const RETEST = {
  id: 'M-abc123',
  topic: 'grad-classical-mechanics',
  node: 'hamilton-jacobi-theory',
  description: 'treated dS/dalpha as a differential equation instead of an algebraic output',
}

const DIGEST = ['- [M-1] t / n: believed the short side must be owned', '- [M-2] t / n2: conflated delivery obligation with entry prerequisite']

const BLINDNESS = /assessor|rubric|when grading|grade (it|this|the)/i

function allVariants(): Array<{ label: string; kickoff: string }> {
  const out: Array<{ label: string; kickoff: string }> = []
  for (const style of ['standard', 'checkpoint'] as SittingStyle[]) {
    for (const mins of [5, 10, 25] as SittingMins[]) {
      for (const digestLines of [[], DIGEST]) {
        for (const retest of [null, RETEST]) {
          for (const recallDueNodes of [[], ['binet-equation', 'virial-theorem']]) {
            out.push({
              label: `${style}/${mins}/${digestLines.length ? 'digest' : 'no-digest'}/${retest ? 'retest' : 'no-retest'}/${recallDueNodes.length ? 'floor' : 'no-floor'}`,
              kickoff: composeReviewKickoff({ style, mins, totalDue: 43, recallDueNodes, retest, digestLines }),
            })
          }
        }
      }
    }
  }
  return out
}

describe('composeReviewKickoff', () => {
  it('every variant opens with the review skill invocation, has no backtick, and stays clear of the blindness regex', () => {
    for (const { label, kickoff } of allVariants()) {
      expect(kickoff.startsWith(MARKER), label).toBe(true)
      expect(kickoff.includes('`'), label).toBe(false)
      expect(BLINDNESS.test(kickoff), label).toBe(false)
    }
  })

  it('retest beats everything, and is byte-identical to the legacy literal', () => {
    const kickoff = composeReviewKickoff({ style: 'checkpoint', mins: 5, totalDue: 43, recallDueNodes: ['x'], retest: RETEST, digestLines: DIGEST })
    expect(kickoff).toBe(`${MARKER}

Re-test request — I picked one open misconception from my ledger in the app and want this sitting to cover it:
[${RETEST.id}] topic "${RETEST.topic}", node "${RETEST.node}": ${RETEST.description}
It is filed open; "misconception resolve --id ${RETEST.id}" records a demonstrated correction. Please also run the normal review flow for whatever is due.`)
  })

  it('checkpoint style invokes the quick argument, names the style, and carries the recall floor when present', () => {
    const kickoff = composeReviewKickoff({ style: 'checkpoint', mins: 5, totalDue: 43, recallDueNodes: ['binet-equation'], retest: null, digestLines: DIGEST })
    expect(kickoff.startsWith(MARKER + ' quick')).toBe(true)
    expect(kickoff).toContain('the checkpoint style described in the review skill (chains of small choices)')
    expect(kickoff).toContain('These nodes need the normal style this time: binet-equation.')
    expect(kickoff).toContain('roughly 5 items')
    expect(kickoff).not.toContain('Open misconceptions')
  })

  it('checkpoint without a floor omits the floor sentence entirely', () => {
    const kickoff = composeReviewKickoff({ style: 'checkpoint', mins: 10, totalDue: 43, recallDueNodes: [], retest: null, digestLines: [] })
    expect(kickoff).not.toContain('normal style this time')
  })

  it('time-adjusted standard names the cap in the skill vocabulary and suppresses the digest', () => {
    const kickoff = composeReviewKickoff({ style: 'standard', mins: 25, totalDue: 43, recallDueNodes: [], retest: null, digestLines: DIGEST })
    // 25, not the old table's 24: with budgets now derived from the queue,
    // the no-measured-pace fallback is a flat ~1 item/minute rather than a
    // hand-tuned row. A real sitting passes `plannedItems` and overrides this.
    expect(kickoff).toContain('due --cap 25')
    expect(kickoff).not.toContain('Open misconceptions')
  })

  it('default shape (standard/10) with a digest is byte-identical to the legacy digest literal', () => {
    const kickoff = composeReviewKickoff({ style: 'standard', mins: 10, totalDue: 43, recallDueNodes: [], retest: null, digestLines: DIGEST })
    expect(kickoff).toBe(`${MARKER}

Open misconceptions currently filed in the engine's ledger for topics in this due queue:
${DIGEST.join('\n')}
These are filed open for this queue's nodes; "misconception resolve --id <ID>" records a demonstrated correction. I'd like the chance to show these are fixed where they naturally come up.`)
  })

  it('default shape with no digest is the bare invocation', () => {
    expect(composeReviewKickoff({ style: 'standard', mins: 10, totalDue: 0, recallDueNodes: [], retest: null, digestLines: [] })).toBe(MARKER)
  })

  it('resume nudges: prose marker, no command line, pinned-net compliant', () => {
    for (const checkpoint of [true, false]) {
      const nudge = composeResumeNudge(checkpoint)
      expect(nudge.includes('/engram' + ':review'), String(checkpoint)).toBe(true)
      expect(nudge.startsWith('/engram'), 'must not re-invoke the skill').toBe(false)
      expect(nudge.includes('`')).toBe(false)
      expect(BLINDNESS.test(nudge)).toBe(false)
      expect(nudge.length).toBeLessThan(400)
    }
    expect(composeResumeNudge(true)).toContain('checkpoint style')
    expect(composeResumeNudge(false)).not.toContain('checkpoint style')
  })

  it('detectResumeState: trailing open ask and checkpoint election', () => {
    const askUse = (id: string, header: string) => ({
      message: { content: [{ type: 'tool_use', id, name: 'mcp__engram-ui-bridge__ask_user_question', input: { header } }] },
    })
    const result = (id: string) => ({ message: { content: [{ type: 'tool_result', tool_use_id: id }] } })
    const rate = (cmd: string) => ({ message: { content: [{ type: 'tool_use', id: 'r1', name: 'Bash', input: { command: cmd } }] } })
    expect(detectResumeState([askUse('a', 'Checkpoint 1/3')])).toEqual({ trailingOpenAsk: true, checkpoint: true })
    expect(detectResumeState([askUse('a', 'Confidence'), result('a')])).toEqual({ trailingOpenAsk: false, checkpoint: false })
    expect(detectResumeState([askUse('a', 'Confidence'), result('a'), rate('engram rate --rating good --source quick-mc')])).toEqual({
      trailingOpenAsk: false,
      checkpoint: true,
    })
    expect(detectResumeState([])).toEqual({ trailingOpenAsk: false, checkpoint: false })
  })

  it('detectResumeState: the CLI resume-repair synthetic rejection keeps the ask open', () => {
    const askUse = (id: string, header: string) => ({
      message: { content: [{ type: 'tool_use', id, name: 'mcp__engram-ui-bridge__ask_user_question', input: { header } }] },
    })
    // The verbatim repair pair a --resume writes over a dead ask: a
    // rejection-shaped tool_result plus the interrupt marker text.
    const repaired = {
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: "The user doesn't want to proceed with this tool use. The tool use was rejected." },
        ],
      },
    }
    const marker = { message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }
    expect(detectResumeState([askUse('a', 'Checkpoint 1/3'), repaired, marker])).toEqual({ trailingOpenAsk: true, checkpoint: true })
    // A genuinely answered ask stays closed even in a sitting that once had one.
    const realResult = { message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: '{"chosen":["Certain"]}' }] } }
    expect(detectResumeState([askUse('a', 'Confidence'), realResult])).toEqual({ trailingOpenAsk: false, checkpoint: false })
  })

  it('coverage math: cap clamps to totalDue', () => {
    // `capForMins` is now the FALLBACK for a learner with no measured pace —
    // the same ~1 item/minute the old {5:5, 10:12, 25:24} table encoded, but
    // defined for any budget, since the offered budgets are derived from the
    // queue rather than enumerated. Real sittings pass `plannedItems` from
    // measured pace and never reach this.
    expect(capForMins(5)).toBe(5)
    expect(capForMins(25)).toBe(25)
    expect(capForMins(70)).toBe(70)
    expect(coveredCount(25, 7)).toBe(7)
    const kickoff = composeReviewKickoff({ style: 'checkpoint', mins: 25, totalDue: 7, recallDueNodes: [], retest: null, digestLines: [] })
    expect(kickoff).toContain('roughly 7 items')
  })
})

describe('composeReviewKickoff — one topic at a time', () => {
  const base = { style: 'standard' as const, mins: 10 as const, totalDue: 12, recallDueNodes: [], retest: null, digestLines: [] }

  it('names the topic and scopes the engine call to it', () => {
    const m = composeReviewKickoff({ ...base, focusTopic: 'grad-statistical-mechanics' })
    expect(m).toContain('/engram:review')
    expect(m).toContain('Just grad-statistical-mechanics today')
    expect(m).toContain('due --topic grad-statistical-mechanics --cap')
  })

  it('says the rest stays due — it filters, it does not discard', () => {
    expect(composeReviewKickoff({ ...base, focusTopic: 't' })).toContain('stay due')
  })

  it('never tells the tutor how to teach or grade', () => {
    const m = composeReviewKickoff({ ...base, focusTopic: 't' }).toLowerCase()
    for (const forbidden of ['rubric', 'claim', 'grade ', 'skip', 'easier', 'hint']) {
      expect(m, forbidden).not.toContain(forbidden)
    }
  })

  it('leaves a mixed queue exactly as before', () => {
    expect(composeReviewKickoff({ ...base, focusTopic: null })).toBe(composeReviewKickoff(base))
  })

  it('yields to an elected checkpoint sitting', () => {
    // Checkpoint carries its own protocol; the focus clause must not displace it.
    const m = composeReviewKickoff({ ...base, style: 'checkpoint', focusTopic: 't' })
    expect(m).toContain('/engram:review quick')
  })
})
