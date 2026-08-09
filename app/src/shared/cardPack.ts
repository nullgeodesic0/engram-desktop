import { z } from 'zod'

/**
 * One node's mobile walk, generated on the desk and carried to the phone.
 *
 * Two guards live here and they do different jobs. `parseCardPack` checks the
 * SHAPE — is this a card pack at all, and is it internally coherent (does a
 * ladder's answer come from its own pool?). `validateAgainstOverlay` checks the
 * PEDAGOGY: it is the executable form of
 * `plugin-overlays/engram/learn-skill.mobile-walk-protocol.md`.
 *
 * The second one matters more than it looks. The overlay is instructions to a
 * model, and a model can drift — it can serve SELF-EXPLAIN as a menu on a tired
 * afternoon, or hand a threshold node a chain of picks. Prose cannot stop that;
 * a validator can. A pack that breaks the bargain is refused at the door, so
 * the failure is a missing card the learner notices rather than a sitting that
 * quietly graded recognition as encoding.
 *
 * ON SEALED ANSWERS. `sealed` carries the reveal and the correct answer, and it
 * travels to the phone, because a pack that needs the network to reveal is not
 * an offline pack. Hashing would buy nothing — with four options a brute-force
 * is four tries. The real protection is structural and lives on the client: the
 * reveal is unreachable from a card view until a commitment is recorded, and
 * the pack is encrypted at rest. This comment exists so nobody later mistakes
 * the presence of `sealed` on the wire for an oversight.
 */

/** Grammar order. Every pack runs all eight; none may be skipped. */
export const BEAT_ORDER = [
  'open_gap',
  'predict',
  'struggle',
  'resolve',
  'self_explain',
  'connect',
  'verify',
  'close',
] as const
export type Beat = (typeof BEAT_ORDER)[number]

const optionSchema = z.object({ id: z.string().min(1), label: z.string().min(1).max(600) })

const proseCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal('prose'),
  content: z.string().min(1).max(4000),
})

const hintsCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal('hints'),
  /** One rung per card on the phone — the struggle budget is unchanged. */
  rungs: z.array(z.string().min(1).max(1000)).min(1).max(4),
})

const mcCard = z
  .object({
    beat: z.enum(BEAT_ORDER),
    kind: z.literal('mc'),
    stem: z.string().min(1).max(1200),
    options: z.array(optionSchema).min(2).max(4),
    sealed: z.object({
      correctOptionIds: z.array(z.string()).min(1),
      revealMarkdown: z.string().min(1).max(4000),
    }),
  })
  .refine((c) => c.sealed.correctOptionIds.every((id) => c.options.some((o) => o.id === id)), {
    message: 'the correct option must be one of the options offered',
  })

const ladderCard = z
  .object({
    beat: z.enum(BEAT_ORDER),
    kind: z.literal('ladder'),
    stem: z.string().min(1).max(1200),
    pool: z.array(optionSchema).min(2).max(24),
    sealed: z.object({
      orderedStepIds: z.array(z.string()).min(2),
      revealMarkdown: z.string().min(1).max(4000),
    }),
  })
  .refine((c) => c.sealed.orderedStepIds.every((id) => c.pool.some((o) => o.id === id)), {
    message: 'every true step must be drawn from the pool the learner is shown',
  })

const clozeCard = z
  .object({
    beat: z.enum(BEAT_ORDER),
    kind: z.literal('cloze'),
    /** `{{1}}` markers name the blanks, in order. */
    template: z.string().min(1).max(2000),
    palette: z.array(optionSchema).min(2).max(24),
    sealed: z.object({
      blankOptionIds: z.array(z.string()).min(1),
      revealMarkdown: z.string().min(1).max(4000),
    }),
  })
  .refine((c) => c.sealed.blankOptionIds.every((id) => c.palette.some((o) => o.id === id)), {
    message: 'every filled blank must be drawn from the palette the learner is shown',
  })

const recallCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal('recall'),
  stem: z.string().min(1).max(1200),
  sealed: z.object({ revealMarkdown: z.string().min(1).max(4000) }),
})

const cardSchema = z.union([proseCard, hintsCard, mcCard, ladderCard, clozeCard, recallCard])
export type Card = z.infer<typeof cardSchema>

const cardPackSchema = z.object({
  packId: z.string().uuid(),
  topic: z.string().min(1).max(120),
  node: z.string().min(1).max(200),
  nodeTitle: z.string().min(1).max(300),
  generatedAt: z.string().datetime(),
  /** Read from the CLI's `node_kind`, never the graph's raw `kind` — see the
   * spec's Evidence 2; 117 nodes carry no explicit kind and default via
   * `node_kind_of`. */
  eligibility: z.object({
    nodeKind: z.enum(['concept', 'fact', 'procedure']),
    threshold: z.boolean(),
    transferReady: z.boolean(),
    lapsed: z.boolean(),
    experimentArm: z.string().nullable(),
  }),
  beats: z.array(cardSchema).min(1),
})

export type CardPack = z.infer<typeof cardPackSchema>
export type Eligibility = CardPack['eligibility']

export function parseCardPack(raw: unknown): CardPack | null {
  const result = cardPackSchema.safeParse(raw)
  return result.success ? result.data : null
}

/** True for the nodes the overlay carves out of menu-served VERIFY: "a
 * threshold concept is exactly what recognition flatters", the problem grammar
 * owns procedures, a transfer probe asks whether the idea fires in new
 * clothes, and an arm item is stashed for the blind assessor by design. */
export function isCarvedOut(e: Eligibility): boolean {
  return e.threshold || e.transferReady || e.lapsed || e.nodeKind === 'procedure' || e.experimentArm !== null
}

/**
 * The overlay, executable. Returns every reason the pack breaks the bargain;
 * an empty array means it may be served.
 */
export function validateAgainstOverlay(pack: CardPack): string[] {
  const reasons: string[] = []
  const byBeat = new Map(pack.beats.map((c) => [c.beat, c]))

  for (const beat of BEAT_ORDER) {
    if (!byBeat.has(beat)) reasons.push(`missing beat: ${beat}`)
  }

  const present = pack.beats.map((c) => c.beat)
  const expected = BEAT_ORDER.filter((b) => present.includes(b))
  if (present.join(',') !== expected.join(',')) reasons.push('beats are not in grammar order')

  // "SELF-EXPLAIN … Never a plain menu" — recognition cannot carry the beat
  // where the learner says why it must be true.
  const selfExplain = byBeat.get('self_explain')
  if (selfExplain && !['ladder', 'cloze', 'recall'].includes(selfExplain.kind)) {
    reasons.push('self_explain may not be served as a menu')
  }

  // "VERIFY, everything else … step assembly or a real production only,
  // never a chain of picks."
  const verify = byBeat.get('verify')
  if (verify && isCarvedOut(pack.eligibility) && !['ladder', 'recall'].includes(verify.kind)) {
    reasons.push('verify on a carved-out node requires a ladder or a real production')
  }

  // "Pool ≥ 2N for N true steps. A chain that can be guessed is not evidence."
  for (const card of pack.beats) {
    if (card.kind === 'ladder' && card.pool.length < card.sealed.orderedStepIds.length * 2) {
      reasons.push('ladder pool must be at least 2N for N true steps')
    }
  }

  return reasons
}
