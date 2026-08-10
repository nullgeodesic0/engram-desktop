import { z } from 'zod'

/**
 * The wire format between the iOS companion and Engram Desktop.
 *
 * The phone is untrusted by construction: it is reachable over the LAN, and
 * what it sends becomes learner evidence in a real session. Two doctrine
 * rules are therefore enforced by the FORMAT, not by the UI that happens to
 * produce it —
 *
 *   1. **The phone never rates and never stamps.** The schema is `.strict()`,
 *      so an item carrying `rating` or `source` is rejected outright rather
 *      than having the field quietly dropped. A dropped field is a silent
 *      success for whoever sent it; a rejection is not.
 *   2. **The stamp is derived from the input kind**, here and nowhere else,
 *      so no payload can launder recognition evidence into the free-recall
 *      pool. `sourceStampFor` is the single place that mapping exists.
 *
 * Adding a stamp value is a doctrine change: checkDoctrine pins this table.
 */

export const MOBILE_INPUT_KINDS = ['checkpoint', 'connect', 'cloze', 'compose', 'match', 'sort', 'flaw', 'ladder', 'recall'] as const
export type MobileInputKind = (typeof MOBILE_INPUT_KINDS)[number]

/** The engine's own cap on a stored production (`PRODUCTION_MAX`). Mirrored,
 * not invented — an over-long production is rejected at the door rather than
 * silently truncated, so the learner is never graded on a sentence the record
 * lost the end of. */
export const PRODUCTION_MAX = 800

/**
 * Input kind → the `--source` value its rating carries forever.
 *
 * `recall` is deliberately `self`: a spoken or typed production on the phone
 * is ordinary free recall — it stashes, the blind assessor grades it, and its
 * rating is uncapped. Only the tap-derived kinds carry a mobile stamp and the
 * `good` ceiling. That asymmetry is the whole reason this surface is not a
 * permanent evidence downgrade.
 */
const SOURCE_STAMPS: Record<MobileInputKind, string> = {
  checkpoint: 'quick-mc',
  connect: 'mobile-mc',
  cloze: 'mobile-cloze',
  // A composed chain is production from a constrained alphabet, not a menu —
  // but it is still bounded by the palette, so it stays phone-stamped and
  // capped like every other tap-derived kind. Its own stamp, so the desk can
  // tell a composed derivation from an assembled one when it reads the record.
  compose: 'mobile-compose',
  match: 'mobile-match',
  sort: 'mobile-sort',
  flaw: 'mobile-flaw',
  ladder: 'mobile-ladder',
  recall: 'self',
}

export function sourceStampFor(kind: MobileInputKind): string {
  return SOURCE_STAMPS[kind]
}

/** True for every kind whose evidence is recognition-grade — capped rating,
 * mobile stamp, excluded from the assessor stash. */
export function isTapDerived(kind: MobileInputKind): boolean {
  return kind !== 'recall'
}

/**
 * The stamp the overlay puts on a NODE's encode receipt when the walk that
 * produced it used any tap-derived card.
 *
 * Distinct from the per-item stamps above and easy to overlook because of it:
 * the items carry their card kind, but the node — the thing FSRS schedules and
 * the thing "provisional" is a property of — carries this one. Named as a
 * constant rather than a literal so the set below cannot be assembled without
 * it again.
 */
export const WALK_SOURCE_STAMP = 'mobile-walk'

/**
 * The stamps that mark a rating as recognition-grade.
 *
 * Derived from the map above, PLUS the walk-level stamp. The derived half
 * alone was a real bug: the first end-to-end settle wrote
 * `--source mobile-walk` on both encode receipts, this set did not contain it,
 * and two nodes walked entirely on glass came back reading as desk-graded.
 * That is exactly the failure §D6.receiptsGradesOnly exists to prevent — a
 * node looking solidified without anyone having solidified it — arriving
 * through the one stamp the per-kind map does not hold.
 *
 * `self` is absent by construction, and that absence is the point: a spoken or
 * typed recall on the phone leaves no trace distinguishing it from one at the
 * desk, because there is no distinction to draw. Anything reading this set to
 * ask "did a phone do this" is really asking "was this recognition", which is
 * the question that matters.
 */
export const PHONE_SOURCE_STAMPS: readonly string[] = Object.freeze(
  [
    ...Object.entries(SOURCE_STAMPS)
      .filter(([kind]) => isTapDerived(kind as MobileInputKind))
      .map(([, stamp]) => stamp),
    WALK_SOURCE_STAMP,
  ].sort(),
)

const outboxItemSchema = z
  .object({
    /** Client-generated UUID. The dedupe key: a replayed batch is a no-op. */
    id: z.string().uuid(),
    topic: z.string().min(1).max(120),
    node: z.string().min(1).max(200),
    mode: z.enum(['learn', 'review']),
    kind: z.enum(MOBILE_INPUT_KINDS),
    /** The four-band pick, or null when the learner skipped it. Never a typed
     * number and never estimated — same rule as the desktop picker. */
    confidence: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.null()]),
    /** Human-readable input trail, destined for `--rubric-notes`. */
    trail: z.string().max(400),
    /** Present only on `recall`. */
    production: z.string().min(1).max(PRODUCTION_MAX).optional(),
    committedAt: z.string().datetime(),
  })
  .strict()
  .refine((v) => (v.kind === 'recall' ? typeof v.production === 'string' : v.production === undefined), {
    message:
      'a recall item must carry its production, and a tap-derived item must not: ' +
      'the blind assessor grades free text against criteria, and a trail of picks has no production to grade',
  })

export type OutboxItem = z.infer<typeof outboxItemSchema>

/** Parses one untrusted item. Returns null rather than throwing — a malformed
 * item is dropped and reported, never allowed to abort a whole batch. */
export function parseOutboxItem(raw: unknown): OutboxItem | null {
  const result = outboxItemSchema.safeParse(raw)
  return result.success ? result.data : null
}
