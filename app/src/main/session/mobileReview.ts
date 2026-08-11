import { engramRead } from '../engramCli/readOnly'

/**
 * The floor under Review: what the phone can always open.
 *
 * ## Why this exists
 *
 * A review on the phone used to require a card pack, and a pack exists only
 * because some desk sitting authored one with `emit_card_pack`. Measured
 * against the real record that meant eleven due retrievals, eleven packs, and
 * not one pack in common with a due node — so Review could not open at all.
 * Not a scheduling accident either: both routes that produce a pack target
 * unencoded nodes, and a due node is by definition encoded. The two sets had
 * no reason to ever meet.
 *
 * The mistake underneath was treating a review as a walk. A learn walk is
 * eight authored beats and genuinely needs a tutor to write them. A REVIEW is
 * a retrieval — probe, production, grade — and the engine already holds the
 * probe for everything it says is due. Nothing needs authoring. The pack was
 * never the requirement; it was an optimisation that had become a gate.
 *
 * So: every due item can be served, always, as free recall on its own probe.
 * A pack, where one exists, is an *upgrade* on top of that floor — the
 * tap-derived cards that make the surface pleasant on a train. The floor is
 * what makes "I tried to open a review and couldn't" impossible.
 *
 * ## What crosses, and what cannot
 *
 * A due item carries `probe`, `claim` and `rubric`. The claim and the rubric
 * are the ANSWER, and they do not leave this machine — §D6 pins that, and this
 * module is pinned separately from the overview precisely because it is the
 * one place allowed to read a probe at all.
 *
 * The probe is the QUESTION. It is what the learner is shown at the desk, and
 * showing it is the entire act of asking for a retrieval. Shipping the
 * question is not shipping the answer, and a surface that could not ask a
 * question could not host a review.
 *
 * The projection is a whitelist typed here rather than a `Pick<>` off the full
 * item, for the same reason the graph projection is: an edit that wants
 * another field has to widen this type, which is a visible act in a diff, and
 * a widened read cannot happen by casting.
 */

/** Exactly what crosses to the phone for one due retrieval. */
export interface ReviewProbe {
  node: string
  /** Humanised, so the phone need not carry the naming rules. */
  nodeTitle: string
  /** The question. Never the claim, never the rubric. */
  probe: string
  /** Carve-out flags the phone needs to know it must not offer a menu here.
   * Booleans, not content. */
  threshold: boolean
  /** Days past due, for ordering. A number cannot leak an answer. */
  overdueDays: number
}

/** The narrow shape read off the CLI. Deliberately not the full `DueItem`:
 * naming only the fields wanted means `claim` and `rubric` are never in a
 * variable this module could accidentally forward. */
interface RawDue {
  topic: string
  id: string
  probe: string
  threshold: boolean
  overdue_days: number
}

/**
 * Every due retrieval for one topic, as questions.
 *
 * Ordered most overdue first, which is the engine's own triage order and the
 * order the desk works in.
 */
export async function buildReviewQueue(
  topic: string,
  humanize: (id: string) => string,
): Promise<ReviewProbe[]> {
  const due = await engramRead<RawDue[]>('due', ['--topic', topic, '--limit', '200']).catch(
    () => [] as RawDue[],
  )
  return due
    .filter((item) => item.topic === topic)
    .map((item) => ({
      node: item.id,
      nodeTitle: humanize(item.id),
      probe: item.probe,
      threshold: Boolean(item.threshold),
      overdueDays: Number(item.overdue_days ?? 0),
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays)
}
