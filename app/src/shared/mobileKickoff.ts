/**
 * The one composer for the kickoff that drains phone evidence into a session.
 *
 * COLLECTOR CONSTRAINT (read before editing the literal below): it must stay a
 * SINGLE template literal, under 400 characters in source with `${…}`
 * collapsed, containing NO backtick — that is the net checkDoctrine's D3
 * collector casts, and a literal that outgrows it silently escapes the pin.
 * It must also stay clear of the D4 blindness regex
 * (/assessor|rubric|when grading|grade (it|this|the)/i). mobileKickoff.test.ts
 * asserts all of this; keep it that way.
 *
 * VOICE. Same rule as every other kickoff: it may say WHICH skill and WHAT the
 * learner wants, in the learner's own navigational voice — never how to teach
 * or how to judge. Naming the mobile-walk protocol is licensed the same way
 * the checkpoint kickoff's naming is: the protocol is defined by the LEARN
 * skill itself, through the D5-pinned overlay. The skill owns everything
 * pedagogical about it; this sentence only elects it.
 *
 * WHY THE EVIDENCE IS A FILE. A sitting's worth of picks, assemblies and
 * productions does not fit in 400 characters, and inlining a learner's
 * production into a command line is exactly what the plugin's shell-safety
 * rule forbids. The batch is written to a tmpfile and the kickoff names the
 * path; the tutor reads it with the Read tool it already has.
 */

export interface MobileDrainOptions {
  topic: string
  /** Absolute path to the JSON batch written for this drain. */
  evidencePath: string
  itemCount: number
}

export function composeMobileDrainKickoff(options: MobileDrainOptions): string {
  const { topic, evidencePath, itemCount } = options
  return `/engram:learn ${topic} — I worked ${itemCount} card(s) on the Engram companion app, away from my desk, so this sitting is a mobile-surface one. What I picked and produced there is in ${evidencePath}. Please settle it and tell me where those nodes now stand.`
}

/**
 * The kickoff that asks a sitting to stock the phone.
 *
 * Same collector constraints as the drain kickoff above: ONE template
 * literal, under 400 characters with `${…}` collapsed, no backtick, and clear
 * of the §D4 blindness regex. Same voice rule too — it names the topic and
 * what the learner wants, never how to teach or how to judge. What a pack
 * must contain is the D5-pinned overlay's business, and `emit_card_pack`'s own
 * description carries it.
 */
export function composePackTopUpKickoff(options: {
  topic: string
  count: number
  /** True when this topic owes retrievals the phone has no pack for. */
  dueUnpacked?: boolean
}): string {
  const { topic, count, dueUnpacked } = options
  // Written as two WHOLE messages rather than one with a clause spliced in.
  // checkDoctrine's collector reduces every interpolation to `${}`, so a
  // sentence assembled into a variable would never appear in the pinned set —
  // a load-bearing line hidden from the audit that exists to read it. Both
  // forms are printed in full by the check, which is the point.
  // The skill's own gate — "if due >= 5, offer first: clear reviews first /
  // straight to new material" (skills/learn/SKILL.md) — is an interactive
  // choice meant for a learner sitting at the desk. This kickoff starts a
  // sitting nobody is sitting at: the pack scheduler runs on its own clock,
  // and the ASK button fires from the phone with no one watching the Mac's
  // window. A sitting that hit that gate would wait on an answer nobody is
  // there to give, and if the app ever supplied a default rather than
  // hanging, the wrong default would spend the whole sitting reviewing
  // instead of producing the new packs the phone actually asked for — the
  // one thing this surface must never do (see composePackTopUpKickoff's own
  // doc comment on `dueUnpacked`: due nodes are handled by their OWN path,
  // never by improvising review here). So every mobile pack request says so
  // plainly, in both forms, rather than leaving a background sitting to
  // discover the gate on its own.
  if (dueUnpacked) {
    return `/engram:learn ${topic} — before I next travel, please make sure about ${count} more node(s) here are ready to walk on my phone. I also have retrievals due here that I would like to be able to do away from the desk. Cover nodes I can actually take next, and stop when they are packed. Skip the clear-reviews-first gate — no one is at the desk to answer it; go straight to new material.`
  }
  return `/engram:learn ${topic} — before I next travel, please make sure about ${count} more node(s) here are ready to walk on my phone. Cover nodes I can actually take next, and stop when they are packed. Skip the clear-reviews-first gate — no one is at the desk to answer it; go straight to new material.`
}
