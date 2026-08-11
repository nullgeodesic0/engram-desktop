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

/**
 * A display figure a prose beat may carry, mirroring the desktop's own
 * `render_*` bridge cards one for one.
 *
 * The phone had exactly one way to say anything: a markdown blob. At the desk
 * the same tutor can set a display equation with its symbols glossed, lay a
 * derivation out as rungs, or put two cases side by side — and a learner who
 * met a concept that way at the desk meets a wall of prose about it on the
 * train. Parity here is not decoration; it is the same explanation surviving
 * the trip.
 *
 * These are display, never input. The walk's own cards (mc, ladder, cloze,
 * recall) are what the learner answers with; a figure is what they are shown.
 * Keeping that line means a figure can never become an ungraded answer.
 */
const figureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('formula'),
    latex: z.string().min(1).max(600),
    caption: z.string().max(300).nullable().optional(),
    where: z
      .array(z.object({ symbol: z.string().max(60), meaning: z.string().max(200) }))
      .max(12)
      .optional(),
  }),
  z.object({
    kind: z.literal('steps'),
    title: z.string().max(200).nullable().optional(),
    steps: z
      .array(z.object({ text: z.string().min(1).max(400), note: z.string().max(300).optional() }))
      .min(1)
      .max(12),
  }),
  z.object({
    kind: z.literal('comparison'),
    title: z.string().max(200).nullable().optional(),
    left: z.object({ label: z.string().max(80), body: z.string().min(1).max(800) }),
    right: z.object({ label: z.string().max(80), body: z.string().min(1).max(800) }),
  }),
  z.object({
    kind: z.literal('checks'),
    title: z.string().max(200).nullable().optional(),
    checks: z
      .array(
        z.object({
          check: z.string().min(1).max(300),
          expect: z.string().min(1).max(300),
          note: z.string().max(300).optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
  z.object({
    kind: z.literal('timeline'),
    title: z.string().max(200).nullable().optional(),
    events: z
      .array(
        z.object({
          when: z.string().min(1).max(80),
          what: z.string().min(1).max(300),
          note: z.string().max(300).optional(),
        }),
      )
      .min(1)
      .max(14),
  }),
  z.object({
    kind: z.literal('definition'),
    term: z.string().min(1).max(120),
    definition: z.string().min(1).max(800),
    aka: z.string().max(200).nullable().optional(),
    notToBeConfusedWith: z.string().max(300).nullable().optional(),
  }),
  z.object({
    kind: z.literal('citation'),
    label: z.string().min(1).max(200),
    locator: z.string().max(120).nullable().optional(),
    note: z.string().max(300).nullable().optional(),
  }),
  z.object({
    kind: z.literal('plot'),
    title: z.string().max(200).nullable().optional(),
    series: z
      .array(
        z.object({
          label: z.string().max(80),
          points: z.array(z.tuple([z.number(), z.number()])).min(2).max(200),
          dashed: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(4),
    markers: z
      .array(z.object({ x: z.number(), label: z.string().max(60).nullable().optional() }))
      .max(4)
      .optional(),
  }),
])

export type CardFigure = z.infer<typeof figureSchema>

const proseCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal('prose'),
  content: z.string().min(1).max(4000),
  /** Optional. Prose stays the carrier; a figure is what the prose is about. */
  figure: figureSchema.optional(),
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

/**
 * The step composer: writing a derivation with a keyboard that only has the
 * right keys.
 *
 * Not an assembly. An assembly hands over whole pre-written lines and asks
 * which goes where — recognition, with the right answer on screen wearing the
 * same clothes as the wrong ones, which is why the overlay bans it at L4. A
 * composer has no pre-written lines: the learner builds each one token by
 * token from a palette shared across the entire chain, in the order they would
 * have written it. That is production from a constrained alphabet, which is
 * what a keyboard is.
 *
 * The palette is shared on purpose. Per-step palettes leak the shape of each
 * line — three tokens offered means a three-token step — and would turn one
 * composition into a sequence of small multiple choices.
 *
 * Weaker than a blank page, and priced as such: still phone-stamped, still
 * capped. The palette's size is the measure of how much easier it is.
 */
const composeCard = z
  .object({
    beat: z.enum(BEAT_ORDER),
    kind: z.literal('compose'),
    stem: z.string().min(1).max(2000),
    /**
     * Every token the learner may tap, for the WHOLE chain.
     *
     * Twelve, not forty. The first packs allowed a token to be a word, and a
     * four-line argument then needed sixteen keys on screen at once — which
     * reads as a word search rather than as writing, and buries the two or
     * three keys that carry the actual claim among a dozen connectives.
     *
     * A token is a CLAUSE. "meet the employer as", "cannot supply a theory of
     * the whole society" — the unit a person composing a sentence actually
     * reaches for. Fewer, heavier keys mean each tap is a real decision, and
     * the distractor floor below still guarantees spare pieces.
     */
    palette: z.array(optionSchema).min(6).max(12),
    sealed: z.object({
      /** Each step, as the ordered palette ids that spell it. */
      steps: z
        .array(
          z.object({
            // Two or three clauses to a line. One is a menu pick wearing a
            // composer's clothes; four or more is the granularity that made
            // the palette unreadable.
            tokens: z.array(z.string()).min(2).max(3),
            /** The "why this line" aside, shown only in the reveal. */
            note: z.string().max(300).optional(),
          }),
        )
        .min(2)
        .max(4),
      revealMarkdown: z.string().min(1).max(4000),
    }),
  })
  .refine(
    (c) => c.sealed.steps.every((s) => s.tokens.every((t) => c.palette.some((o) => o.id === t))),
    { message: 'every token of every step must exist in the palette the learner is shown' },
  )
  .refine(
    (c) => {
      // Distractor floor. A palette holding only the tokens the answer needs
      // is a jigsaw with no spare pieces: the learner can finish it without
      // composing anything, by elimination. Same reasoning as the ladder's
      // pool >= 2N rule, applied to the alphabet instead of the lines.
      const used = new Set(c.sealed.steps.flatMap((s) => s.tokens))
      return c.palette.length >= used.size + Math.max(3, Math.ceil(used.size / 2))
    },
    {
      message:
        'the palette must carry competitive distractor tokens — sign flips, wrong operators, symbols from a neighbouring derivation — not only the tokens the answer uses',
    },
  )
  .refine(
    (c) => new Set(c.sealed.steps.flatMap((s) => s.tokens)).size <= 8,
    {
      // The ceiling that makes the palette cap reachable. Eight answer tokens
      // demand twelve keys once the distractor floor is applied, which is
      // exactly the cap — so a chain wanting a ninth cannot be given its
      // spare pieces, and the honest failure is here rather than a palette
      // the learner has to read twice.
      message:
        'a composed chain may spend at most 8 distinct tokens: write in clauses, not words — ' +
        'two or three per line, three or four lines',
    },
  )

/** Guessing must be hopeless where a card carries SELF-EXPLAIN. 24 is 4!, the
 * smallest match this admits, and every other kind is held to the same bar —
 * the ladder's "pool >= 2N" rule expressed as an answer-space floor so the
 * kinds can be compared to each other rather than each inventing a threshold. */
const SELF_EXPLAIN_MIN_SPACE = 24

/**
 * Pair each item with what it belongs to.
 *
 * Not a menu: an n-pair match has n! orderings, so four pairs is already 24
 * ways to be wrong and six is 720. What makes it evidence rather than a
 * puzzle is that the pairing IS the knowledge — symbol to meaning, case to
 * principle, term to the thing it is most often confused with.
 */
const matchCard = z
  .object({
    beat: z.enum(BEAT_ORDER),
    kind: z.literal('match'),
    stem: z.string().min(1).max(2000),
    /** Shown in the order given; the phone shuffles neither side, because a
     * generator that pre-shuffled and a client that shuffled again would
     * disagree about what the learner saw. */
    left: z.array(optionSchema).min(3).max(8),
    right: z.array(optionSchema).min(3).max(8),
    sealed: z.object({
      /** left id -> right id. Every left item pairs exactly once. */
      pairs: z.array(z.object({ left: z.string(), right: z.string() })).min(3).max(8),
      revealMarkdown: z.string().min(1).max(4000),
    }),
  })
  .refine(
    (c) =>
      c.sealed.pairs.every(
        (p) => c.left.some((o) => o.id === p.left) && c.right.some((o) => o.id === p.right),
      ),
    { message: 'every pair must join two items the learner can actually see' },
  )
  .refine((c) => c.sealed.pairs.length === c.left.length, {
    message: 'every left item must be paired — an unpairable item is a trick, not a distractor',
  })
  .refine((c) => c.beat !== 'self_explain' || factorial(c.sealed.pairs.length) >= SELF_EXPLAIN_MIN_SPACE, {
    message: 'a match carrying self_explain needs at least four pairs, or guessing it is not hopeless',
  })

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1)
}

/**
 * Put each item in the bucket it belongs to.
 *
 * k buckets and n items is k^n ways to be wrong, so the floor is on the
 * product rather than on either count. Good where the knowledge IS the
 * partition: conserved or not, spontaneous or imported, public sector or
 * private.
 */
const sortCard = z
  .object({
    beat: z.enum(BEAT_ORDER),
    kind: z.literal('sort'),
    stem: z.string().min(1).max(2000),
    buckets: z.array(optionSchema).min(2).max(4),
    items: z.array(optionSchema).min(4).max(14),
    sealed: z.object({
      /** item id -> bucket id, for every item. */
      placements: z.array(z.object({ item: z.string(), bucket: z.string() })).min(4).max(14),
      revealMarkdown: z.string().min(1).max(4000),
    }),
  })
  .refine(
    (c) =>
      c.sealed.placements.every(
        (p) => c.items.some((o) => o.id === p.item) && c.buckets.some((b) => b.id === p.bucket),
      ),
    { message: 'every placement must name an item and a bucket the learner can see' },
  )
  .refine((c) => c.sealed.placements.length === c.items.length, {
    message: 'every item must have a home — an unplaceable item is a trick, not a distractor',
  })
  .refine(
    (c) => c.beat !== 'self_explain' || Math.pow(c.buckets.length, c.items.length) >= SELF_EXPLAIN_MIN_SPACE,
    { message: 'a sort carrying self_explain needs a larger answer space — more items, or more buckets' },
  )

/**
 * One step in a chain is wrong. Find it.
 *
 * RECOGNITION, and priced as such: one of six steps is a 17% guess, which is
 * nowhere near the bar the other kinds clear. It is barred from SELF-EXPLAIN
 * and from a carved-out VERIFY for exactly the reason a menu is — those beats
 * are where recognition does the most damage.
 *
 * Where it earns its place is STRUGGLE and CONNECT, and it earns it well: a
 * learner who can point at the broken line in someone else's derivation is
 * doing something a multiple-choice stem cannot ask for.
 */
const flawCard = z
  .object({
    beat: z.enum(BEAT_ORDER),
    kind: z.literal('flaw'),
    stem: z.string().min(1).max(2000),
    /** The chain as written, flaw included. */
    steps: z.array(z.object({ text: z.string().min(1).max(400) })).min(3).max(8),
    sealed: z.object({
      /** Zero-based index of the step that breaks. */
      flawedIndex: z.number().int().min(0),
      /** What is wrong with it — shown only after the commitment. */
      why: z.string().min(1).max(600),
      revealMarkdown: z.string().min(1).max(4000),
    }),
  })
  .refine((c) => c.sealed.flawedIndex < c.steps.length, {
    message: 'the flawed step must be one of the steps shown',
  })
  .refine((c) => c.beat !== 'self_explain', {
    message:
      'a flaw card may not carry self_explain: picking one step of six is recognition, ' +
      'and recognition cannot carry the beat the overlay protects most',
  })

const recallCard = z.object({
  beat: z.enum(BEAT_ORDER),
  kind: z.literal('recall'),
  stem: z.string().min(1).max(1200),
  sealed: z.object({ revealMarkdown: z.string().min(1).max(4000) }),
})

const cardSchema = z.union([
  proseCard, hintsCard, mcCard, ladderCard, clozeCard, composeCard,
  matchCard, sortCard, flawCard, recallCard,
])
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

  // No typed or spoken input on this surface, at any beat — not just at
  // SELF_EXPLAIN and VERIFY, the only two beats a tutor has ever actually
  // reached for `recall` in practice. A phone keyboard is friction this
  // product exists to remove, and it is a rule about the SURFACE, not about
  // which beat happens to be asking. Checked once, up front, rather than
  // trusting every future beat-specific rule below to remember it.
  for (const card of pack.beats) {
    if (card.kind === 'recall') {
      reasons.push(`${card.beat} may not be served as free recall — no typed or spoken input on mobile`)
    }
  }

  // "SELF-EXPLAIN … Never a plain menu" — recognition cannot carry the beat
  // where the learner says why it must be true.
  const selfExplain = byBeat.get('self_explain')
  // `compose` joins the permitted set here because it is not a menu: there is
  // no pre-written line on screen to recognise, only an alphabet to write
  // with. The rule the overlay states is about menus, and a token palette is
  // not one.
  //
  // `recall` does NOT — a mobile-companion product decision, not a doctrine
  // reversal: a phone keyboard (or its dictation) is friction this surface
  // exists to remove, and every one of these five kinds already reaches
  // production-or-better without it. A pack authored before this rule that
  // still carries a recall card fails validation here and gets rewritten by
  // its next sitting, same as any other overlay violation.
  if (selfExplain && !['ladder', 'cloze', 'compose', 'match', 'sort'].includes(selfExplain.kind)) {
    reasons.push('self_explain may not be served as a menu, or as free recall')
  }

  // "VERIFY, everything else … step assembly or a real production only,
  // never a chain of picks."
  const verify = byBeat.get('verify')
  // A carved-out VERIFY wants an assembly or a composed chain — a token
  // alphabet, not a template on screen to recognise — or one of the priced
  // recognition forms below. `recall` is excluded for the same reason as
  // SELF_EXPLAIN above: no typed or spoken input on this surface, ever.
  //
  // `match`, `sort` and `flaw` are admitted here as the overlay's PRICED
  // widening, not as an equal. The alternative on a phone is not free recall,
  // it is nothing — and a threshold node never checked away from the desk is
  // not being protected by the stricter rule, only skipped. The price is paid
  // elsewhere and must be: `mobile-recognition` on the receipt, `hard` at
  // best, provisional unchanged. A plain menu is still refused, because a
  // four-option pick is a coin flip wearing a checkmark.
  if (verify && isCarvedOut(pack.eligibility)) {
    if (!['ladder', 'compose', 'match', 'sort', 'flaw'].includes(verify.kind)) {
      reasons.push(
        'verify on a carved-out node requires a composed chain, an assembly, ' +
          'or one of the priced recognition forms (match, sort, flaw) — never free recall or a chain of picks',
      )
    }
  }

  // "Pool ≥ 2N for N true steps. A chain that can be guessed is not evidence."
  for (const card of pack.beats) {
    if (card.kind === 'ladder' && card.pool.length < card.sealed.orderedStepIds.length * 2) {
      reasons.push('ladder pool must be at least 2N for N true steps')
    }
  }

  return reasons
}
