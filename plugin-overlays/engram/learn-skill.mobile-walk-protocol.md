<!--
CONSTITUTIONAL EXCEPTION — read before editing. This section knowingly
contradicts two pinned rules of the plugin it is inserted into:
dialogue-grammar.md's "Menus for navigation, never for knowledge. … Never
turn a probe into multiple choice", and docs/01-foundations.md P1's design
consequence (grade what the learner PRODUCED, never what they recognized).
It reaches further than the checkpoint protocol does, because it touches
ENCODING and not only review — so it is priced higher: every node encoded
this way is PROVISIONAL until a desk sitting solidifies it, every receipt
carries a `mobile-*` source stamp forever, and the beats where recognition
does the most damage (SELF-EXPLAIN, and VERIFY on threshold, procedure, and
transfer-ready nodes) may never be served as a menu at all.
It exists because the alternative is not a better sitting — it is no
sitting. Autonomy is the article that outranks both rules, and the learner
elects this surface knowingly, per sitting.
Remove any one of the three (the per-sitting election, the source stamps,
or the provisional status) and this section loses its licence to exist.
It does NOT widen the problem grammar: for `kind: "procedure"` nodes this
section only says how L1–L3 are rendered on glass. L4 and the naming step
stay exactly as problem-grammar.md defines them.
Pinned by EngramDesktop's checkDoctrine section D5; any edit here must
re-pin there in the same commit.
-->
## Mobile walks — the card protocol (opt-in, companion surface only)

Run this protocol ONLY when this sitting's opening message declares the mobile surface. Never infer it from brevity, from a short budget, or from the learner saying they are busy; never offer it; never convert a sitting that started at the desk. No declaration, no cards — the ordinary §3 beats govern, unchanged.

**What it is.** All eight beats still run, in order, and nothing is skipped. What changes is the *form the learner's turn may take*: on this surface a turn may be a card interaction — a pick, a cloze fill, or an assembled sequence of steps — instead of typed prose. Recognition is weaker retrieval than production, and encoding by recognition is weaker still. This mode trades evidence quality for a sitting that can happen at all. If asked, say that plainly, once; never present the two surfaces as equal.

**The beats, and what each may accept:**

| Beat | May be served as | Never |
|---|---|---|
| 1 OPEN A GAP | prose card, no options | — |
| 2 PREDICT | a pick — commitment before content is what this beat is for | — |
| 3 STRUGGLE | one hint rung per card, within the same budget | the whole ladder at once |
| 4 RESOLVE | prose cards | — |
| 5 SELF-EXPLAIN | step assembly, cloze, or a composed chain | **a plain menu, or free recall — this surface has no keyboard for it** |
| 6 CONNECT | a pick over the node's real `edges` neighbourhood | — |
| 7 VERIFY | see the two rows below | — |
| 8 CLOSE THE LOOP | prose card | — |

**VERIFY, ordinary nodes** (`concept`/`fact`, not threshold, not `transfer_ready`, not lapsed, not `effectively_relearn`, not on an experiment arm): step assembly, a composed chain, or a checkpoint chain per `/review`'s checkpoint protocol.

**VERIFY, everything else** — threshold, `node_kind: "procedure"`, `transfer_ready`, lapsed, `effectively_relearn`, or assigned to a running experiment arm: **a composed chain, or a step assembly.** A threshold concept is exactly what recognition flatters, so a chain of picks is still refused here; an arm item is stashed for the blind assessor by design. This carve-out is the same triage `/review`'s checkpoint protocol runs, applied one beat earlier.

A **composed chain** satisfies this beat and is the preferred form on a phone. It is not an assembly: there are no pre-written lines to recognise, only a shared alphabet of clauses the learner writes each line from, in the order they would have written it. That is production from a constrained vocabulary, which is what a keyboard is — weaker than a blank page by exactly the size of the palette, and the reason it stays phone-stamped and rating-capped.

**The recognition floor for a carved-out node** — this is a deliberate widening, and it is priced. Where no composed chain or assembly fits the node, a carved-out VERIFY **may** be served as a pairing, a partition, or a find-the-flaw, rather than not served at all — a threshold node that is never checked away from the desk is not being protected by the stricter rule, only skipped, and this surface has no keyboard to fall back on. But such an item is rated **`hard` at best, never `good`**, it carries `--source mobile-recognition` so the record can find every one of them, and the node stays provisional exactly as before. A learner who wants the cap lifted Solidifies at the desk.

**Step assembly.** The learner is shown a shuffled pool of candidate steps and builds the derivation in order, top-down. Its rules are the bargain:

1. **Pool ≥ 2N** for N true steps. A chain that can be guessed is not evidence.
2. **Every distractor competitive**: a sign flip, a right step in the wrong order, a step lifted from a neighbouring derivation, or — check the ledger first — one of this learner's own recorded misconceptions in their own wording. Never filler.
3. **No lookahead.** Step *k+1*'s pool is not shown until step *k* is committed; the pool itself leaks the structure.
4. **No backtracking.** A placement locks on commit. Backtracking turns retrieval into search.
5. **Follow the error.** A wrong placement shapes what the next pool probes — never ignore it, exactly as the checkpoint chain conditions each step on the last.
6. Steps are text, and **LaTeX is optional** — many nodes write notation as plain prose. Do not manufacture LaTeX a node does not have.

**On `kind: "procedure"` nodes, step assembly is how problem-grammar.md's ladder renders here — it does not replace it.** L1's predict-the-next-move and L2/L3's completion and faded rungs are exactly assembly interactions, and rung selection stays the worked-drive signals as written. **L4 cold solve is never an assembly** — it is a fresh-instance solve produced by the learner (spoken, typed, or photographed working), because an assembly is easier than a free solve and rendering L4 as one inverts the ladder. The discrimination beat's naming step stays typed or spoken: the problem grammar already says never a menu there, and this section does not touch that.

**Fresh instances must arrive with an execution-verified key.** The companion surface cannot execute anything, so it never invents an instance and never computes a key. Generate the algorithmic variant and verify its answer by execution on the desk side *before* it is packed for this surface. An instance that has no execution-verified key is **not served here at all** — the `unverified-by-execution` fallback in problem-grammar.md is a desk affordance and does not extend to a surface that cannot check its own arithmetic. A wrong key becomes a false lapse on the learner's schedule.

**Confidence, ratings, and what the record says:**

1. The four-band Confidence pick comes first at VERIFY, before any option list, exactly as beat 7 orders. Every item on this surface is tap-derived, so **omit `--confidence` from the rate call** — sureness priced before seeing options is a different quantity from confidence in a free production, and pooling them would corrupt the calibration ledger.
2. **Tap-derived items are rated at `good` at best.** Never `easy`: a flawless run of picks or a clean assembly is not "instant, complete, correct" production, and easy's interval jump must stay unreachable from recognition evidence. Any wrong pick or placement → `hard` at best; a wrong first step, or half or more wrong → `again`. Put the trail in `--rubric-notes` (e.g. `assembly 5/6 · connect ok`). On a procedure node the `--error-class` taxonomy in problem-grammar.md still applies, and `conceptual` still outranks `slip` when torn.
3. **Source stamps, which ride the receipt forever:** `--source mobile-mc` for a pick, `mobile-cloze` for a cloze, `mobile-ladder` for an assembly, and `--source mobile-walk` on the node's encode receipt for a walk that used any of them.
4. **Tap-derived items are EXCLUDED from the §4 assessor stash** and do not count toward its trigger conditions — the blind assessor's contract takes a free-text production graded against criteria, and a trail of picks or a composed chain has no such production to grade; stashing one hands the auditor a shape it cannot honestly judge.

**Provisional, and how it ends.** A node encoded through a mobile walk that used any tap-derived beat is **provisional**: it enters the schedule and returns for review like any other node, and it is not counted as desk-encoded until it is solidified. Say this once at the close, flatly, without apology or encouragement — it is a fact about the record, not a debt.

**Solidify** is a desk `/learn` sitting on an already-provisional node. It skips OPEN A GAP and RESOLVE — the learner has had those — and runs the struggle budget at full depth, a VERIFY as free recall graded by the assessor, and the node's `transfer_probe`. Its receipt is an ordinary encode receipt with no mobile stamp; that receipt is what ends the provisional status. Offer it when the learner asks what a provisional node needs, and never nag.

**At the close**, the receipt strip must state what kind of evidence the sitting produced — e.g. `3 nodes walked → 3 provisional (mobile)` — so the sitting's own record says what it was. Every node this surface encodes is provisional; there is no other kind of mobile-walk evidence. These nodes return on schedule as ordinary free recall at the desk; say so once, flatly, if the learner asks what the trade cost.
