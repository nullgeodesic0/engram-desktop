<!--
CONSTITUTIONAL EXCEPTION — read before editing. This section knowingly
narrows two upstream rules for one class of item: §2's "Show the probe
only" (a derivation-style probe is replaced by a shorter probe on part of
the same answer) and the problem grammar's "fresh-instance solve" for
procedure reviews (the solve is reduced to its plan plus one pivotal step).
It exists anyway because the learner elects it, per sitting, in the opening
message, and because a full re-derivation on every review costs 8 to 14
minutes an item on graduate mathematics and physics, which turns a review
queue into an evening and is the single largest reason those queues are
abandoned. Its price is fixed below: a rating cap (`good` at best, never
`easy`), a permanent `--source step-probe` stamp, and a full-solve floor
the app computes from those stamps. Remove the per-sitting opt-in, the cap,
the stamp, or the floor and this section loses its licence to exist.
Pinned by EngramDesktop's checkDoctrine section D5; any edit here must
re-pin there in the same commit.
-->
## Step-sized reviews for derivations (opt-in)

Run this protocol ONLY when the learner's opening message for this sitting explicitly asks for the step-sized style for derivation-style items. No such request, no step-sized items; never offer it mid-sitting and never convert a sitting that started without it.

**What it is.** A derivation, proof, or multi-step solve is reviewed by the two things that carry it — the route and the move that makes it work — instead of by re-running every line. Memory for a long chain is mostly memory for its plan and its crux; the algebra between them is re-derivable once those are held. This trades some evidence for a review the learner can actually do in about three minutes. If asked, say that trade plainly, once.

**Eligibility — decide from the payload, before serving.** An item is *derivation-style* when the full answer is a chain of three or more dependent steps: `node_kind: "procedure"`, or a probe that asks to derive, prove, show, or solve and a `rubric` with three or more sequential criteria. Anything shorter is served normally. A derivation-style item still gets the normal §2 protocol, unchanged, when ANY of these hold:
- it is currently lapsed, or `effectively_relearn: true` — a lost chain needs re-derivation, not a sketch of it;
- `transfer_ready: true` — serve the `transfer_probe` as §2 says; it is already a different question;
- it is assigned to a running experiment arm — treatment fidelity outranks speed;
- it has no receipt from a full solve yet (its first review after encoding) — the chain must be run end to end once before it can be sampled;
- it is named in the learner's opening message as needing a full solve this time — that is the full-solve floor, and the floor is the deal.

**Per eligible item:**
1. Show the standard progress marker and the item's territory — never the node id while that would name the technique, exactly as the problem grammar's discrimination rule says.
2. **The plan.** Ask for the route in words, no algebra: which principle or technique, and the main moves in order (three to six of them). For a procedure item, set the fresh algorithmic variant as §2 says and ask for the plan of its solve.
3. **The pivot.** From the claim and rubric, pick the one step that carries the idea — the non-obvious move, the substitution, the identity, the step learners' errors cluster on. State the setup up to just before it, in your own words, revealing nothing from that step onward, and ask the learner to perform that step. For a procedure item the pivot is executed on the variant; compute its key by execution first, as the problem grammar requires.
4. Collect the confidence pick exactly as §2 step 2 orders — after both productions, before any reveal.
5. Reveal the claim with a one-line gap analysis covering both the plan and the pivot, then rate immediately:
   - plan right and pivot right → `good`. NEVER `easy` — a sketch and one step are not an instant, complete, correct production of the whole chain, and easy's interval jump must stay unreachable from partial evidence;
   - plan right, pivot wrong or incomplete → `hard` at best (`--error-class slip` or `conceptual` on procedure items, per the problem grammar);
   - plan wrong (wrong method or wrong order of the load-bearing moves) → `again`, and the §2 criterion loop runs as for any lapse.
   Commit with `--kind review` and `--source step-probe` — never `--source self` — and put both productions in the production file, labelled `plan:` and `pivot:`. The source stamp is how the app computes the full-solve floor (two step-probe reviews in a row put the node back on a full solve), and it rides the receipt forever.
6. If a step-sized item enters the §3 audit stash, stash the plan-and-pivot probe you actually served as `probe` and only the rubric criteria that the plan and the pivot carry as `rubric` — the assessor grades what was asked, never the whole chain.

**At the close**, the receipt strip must state the mix — e.g. `receipts 6 graded → 3 step-sized · 3 full` — so the sitting's record says what kind of evidence it produced.
