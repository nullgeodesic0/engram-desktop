/** The one composer for every /engram:review kickoff the app can send.
 *
 * COLLECTOR CONSTRAINT (read before editing any literal here): every kickoff
 * variant below must be a SINGLE template literal, under 400 characters in
 * source with `${…}` collapsed, containing NO backtick — that is the net
 * checkDoctrine's D3.kickoff collector casts (it hashes every such literal
 * containing `/engram:`), and a literal that outgrows it silently escapes
 * the pin. Every variant must also stay clear of the D4 blindness regex
 * (/assessor|rubric|when grading|grade (it|this|the)/i). The test file
 * asserts all of this for every variant — keep it that way.
 *
 * Voice rule (checkDoctrine D3.kickoff): a kickoff may say WHICH skill and
 * WHAT the learner wants, in the learner's own navigational voice — never
 * how to teach or how to judge. The checkpoint kickoff names a protocol the
 * review skill itself defines (via the overlay pinned in D5) and the recall
 * floor the app computed; the skill owns everything pedagogical about both.
 *
 * Priority (one ask per kickoff, highest wins): retest > checkpoint >
 * time-adjusted standard > misconception digest > plain. Checkpoint and
 * time-adjusted sittings deliberately skip the digest — a re-shaped sitting
 * sends one clear navigational request, and misconception re-tests want free
 * recall, which the digest exists to invite. */

export type SittingStyle = 'standard' | 'checkpoint'
export type SittingMins = 5 | 10 | 25

/** Time → item cap, in the skill's own cap vocabulary (SKILL.md §1: quick=5,
 * Standard≈12, "longer catch-up" ≈ 2× the mode cap). Deliberately NOT a
 * minutes-per-item pace — the skill forbids the app quoting invented time
 * math; these are the three cap sizes the skill already names. */
export const TIME_CAPS: Record<SittingMins, number> = { 5: 5, 10: 12, 25: 24 }

export function capForMins(mins: SittingMins): number {
  return TIME_CAPS[mins]
}

export function coveredCount(cap: number, totalDue: number): number {
  return Math.min(cap, totalDue)
}

export interface RetestRequest {
  id: string
  topic: string
  node: string
  description: string
}

export interface ComposeOptions {
  style: SittingStyle
  mins: SittingMins
  totalDue: number
  /** Node ids on the recall floor (checkpoint-reviewed twice consecutively) —
   * interpolated into the checkpoint kickoff so the tutor knows which nodes
   * are recall-only this sitting. The app computes this from receipt sources;
   * the due payload carries no receipt history, so the tutor cannot. */
  recallDueNodes: string[]
  retest: RetestRequest | null
  /** Pre-formatted misconception digest lines (the caller owns the ledger
   * read and its best-effort failure handling). Empty array = no digest. */
  digestLines: string[]
  /** The learner chose to work one topic at a time. Null for a mixed queue,
   * which stays the default. */
  focusTopic?: string | null
  /** How many items actually fit the budget, measured from this learner's own
   * pace (shared/sittingPace.ts). Undefined falls back to the flat TIME_CAPS
   * table — which measurement showed over-promises by up to 6×, so this is
   * the path that should normally be taken. */
  plannedItems?: number
}

export function composeReviewKickoff(opts: ComposeOptions): string {
  const { style, mins, totalDue, recallDueNodes, retest, digestLines, focusTopic } = opts

  if (retest) {
    return `/engram:review

Re-test request — I picked one open misconception from my ledger in the app and want this sitting to cover it:
[${retest.id}] topic "${retest.topic}", node "${retest.node}": ${retest.description}
It is filed open; "misconception resolve --id ${retest.id}" records a demonstrated correction. Please also run the normal review flow for whatever is due.`
  }

  const n = opts.plannedItems ?? coveredCount(capForMins(mins), totalDue)

  if (style === 'checkpoint') {
    const floor = recallDueNodes.length > 0 ? ` These nodes need the normal style this time: ${recallDueNodes.join(', ')}.` : ''
    return `/engram:review quick

I have about ${mins} minutes. Please work in triage order and cover what fits — roughly ${n} items. For eligible items I would like the checkpoint style described in the review skill (chains of small choices); anything threshold, lapsed, or effectively past quick review should stay normal free recall.${floor}`
  }

  // One topic at a time. A mixed queue is engine-ordered by savings, which is
  // correct for retention and brutal for a human: a real sitting went from
  // stat-mech straight into quantum mechanics between two items. This is a
  // FILTER the learner chose, not a reordering — the engine still sequences
  // within the topic, and everything else simply stays due. Placed after the
  // checkpoint branch so an elected checkpoint sitting keeps its protocol.
  if (focusTopic) {
    return `/engram:review

Just ${focusTopic} today — I want one topic at a time, and everything else can stay due. I have about ${mins} minutes, so please size it with due --topic ${focusTopic} --cap ${n} and run the normal review flow.`
  }

  if (mins !== 10) {
    return `/engram:review

I have about ${mins} minutes today. A capped set of about ${n} items fits — please size the sitting with due --cap ${n} and run the normal review flow; whatever does not fit just stays due.`
  }

  if (digestLines.length > 0) {
    return `/engram:review

Open misconceptions currently filed in the engine's ledger for topics in this due queue:
${digestLines.join('\n')}
These are filed open for this queue's nodes; "misconception resolve --id <ID>" records a demonstrated correction. I'd like the chance to show these are fixed where they naturally come up.`
  }

  return '/engram:review'
}

/** Scans a raw resumed transcript for the two facts the resume flow needs:
 * whether the tail leaves an ask unanswered (its tool_use has no
 * tool_result — the bridge request died with the old child), and whether
 * the sitting had elected checkpoint mode (a Checkpoint-headed ask or a
 * quick-mc rate anywhere in it). Pure; tolerant of any line shape. */
export function detectResumeState(lines: unknown[]): { trailingOpenAsk: boolean; checkpoint: boolean } {
  let checkpoint = false
  const openAsks = new Set<string>()
  const askIds = new Set<string>()
  let repairedAsk = false
  for (const raw of lines) {
    const content = (raw as { message?: { content?: unknown } })?.message?.content
    if (!Array.isArray(content)) continue
    for (const b of content as Array<Record<string, unknown>>) {
      if (b?.type === 'tool_use' && typeof b.name === 'string') {
        if (b.name.endsWith('ask_user_question') && typeof b.id === 'string') {
          openAsks.add(b.id)
          askIds.add(b.id)
          const header = (b.input as Record<string, unknown> | undefined)?.header
          if (typeof header === 'string' && header.startsWith('Checkpoint')) checkpoint = true
        }
        if (b.name === 'Bash') {
          const cmd = String((b.input as Record<string, unknown> | undefined)?.command ?? '')
          if (cmd.includes('--source quick-mc')) checkpoint = true
        }
      }
      if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        openAsks.delete(b.tool_use_id)
        // The CLI's --resume repair "answers" a dead ask with a synthetic
        // rejection so the transcript parses — observed verbatim: content
        // "The user doesn't want to proceed with this tool use…" followed by
        // a user text "[Request interrupted by user for tool use]". That is
        // NOT an answer; the learner never saw a working card. Counting it
        // as one made the second resume skip the nudge entirely (observed
        // live, 2026-08-03: resume pressed, nothing fired). Any rejection-
        // shaped result on an ASK id keeps the re-pose obligation alive.
        if (askIds.has(b.tool_use_id) && String(JSON.stringify(b.content ?? '')).includes("doesn't want to proceed")) {
          repairedAsk = true
        }
      }
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.includes('[Request interrupted by user for tool use]')) {
        // The repair's companion marker — belt-and-suspenders for a future
        // CLI that words the synthetic result differently.
        if (askIds.size > 0) repairedAsk = true
      }
    }
  }
  return { trailingOpenAsk: openAsks.size > 0 || repairedAsk, checkpoint }
}

/** The resume re-pose nudge — sent automatically after a resume WHEN the
 * replayed transcript's tail is an unanswered ask (the bridge request died
 * with the old child process, so the tutor is waiting on an answer that can
 * never arrive and the learner is staring at an orphaned card; observed
 * live in the first resumed checkpoint sitting). Kickoff-class plumbing:
 * app-synthesized, navigational voice, and it names the skill marker in
 * PROSE (not as a command line) precisely so the D3 collector pins it —
 * re-invoking the skill would restart §1's queue load mid-sitting. */
export function composeResumeNudge(checkpoint: boolean): string {
  if (checkpoint) {
    return `Resuming this /engram:review sitting — the app was closed while a question was open, so your last ask never reached me. Please pose it again and continue; I still want the checkpoint style described in the review skill for eligible items.`
  }
  return `Resuming this /engram:review sitting — the app was closed while a question was open, so your last ask never reached me. Please pose it again and continue from where we stopped.`
}
