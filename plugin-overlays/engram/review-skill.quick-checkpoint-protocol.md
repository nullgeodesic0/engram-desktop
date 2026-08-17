<!--
CONSTITUTIONAL EXCEPTION — read before editing. This section knowingly
contradicts two pinned rules of the plugin it is inserted into:
dialogue-grammar.md's "Menus for navigation, never for knowledge. … Never
turn a probe into multiple choice", and docs/01-foundations.md P1's design
consequence (grade what the learner PRODUCED, never what they recognized).
It exists anyway because the learner may elect it, per sitting, with the
trade named — autonomy is the article that outranks both — and because
every receipt it produces carries `--source quick-mc`, so its evidence
stays distinguishable from free-recall evidence forever, in every stat,
audit, and export that ever reads it. Remove either half of that bargain
(the per-sitting opt-in, or the source stamp) and this section loses its
licence to exist. Pinned by EngramDesktop's checkDoctrine section D5;
any edit here must re-pin there in the same commit.
-->
## Quick sittings — the checkpoint protocol (opt-in)

Run this protocol ONLY when the learner's opening message for this sitting explicitly asks for the checkpoint style (chains of small choices). The word "quick" alone is NOT that request — a bare `/review quick` is a short sitting of normal free recall, exactly as §1 already defines it. No opening request, no checkpoints; never offer this mid-sitting, and never convert a sitting that started as free recall.

**What it is.** For eligible items only, the single free-recall probe is replaced by a chain of **2–4 small choices** that walk the same claim — its criteria, or the steps of its derivation, in order. Recognition is weaker retrieval than production; the bar every option list here must clear is docs/01's own: *"MCQ earns its keep only with competitive, plausible distractors."* This mode trades evidence quality for a sitting the learner can actually have today. If asked, say that trade plainly, once; never present the two styles as equal.

**Eligibility — the triage stays honest.** Work the served order. An item is eligible only if NONE of these hold; anything below gets the normal §2 protocol, unchanged:
- `threshold: true` — a threshold concept is exactly what recognition flatters;
- currently lapsed, or `effectively_relearn: true` — these need re-derivation, not picks;
- `transfer_ready: true` — a transfer probe asks whether the idea fires in new clothes; a menu would answer it;
- `node_kind: "procedure"` — the problem grammar owns these;
- assigned to a running experiment arm — arm items are stashed for the blind assessor by design, and a pick chain would break both arms' treatment fidelity;
- named in the learner's opening message as needing the normal style this time — those nodes are on a recall floor and the floor is the deal.

**The all-node-types widening (a second, priced, opt-in layer).** Run this ONLY when the learner's opening message for this sitting ALSO explicitly states that the checkpoint-on-every-node setting is turned on (e.g. "I have turned on checkpoints for every node in Settings"). This is a second election on top of the first — a bare checkpoint request without this sentence stays under the ordinary Eligibility triage above, unchanged. When it IS present: the first five bullets of Eligibility above — `threshold`, lapsed/`effectively_relearn`, `transfer_ready`, `node_kind: "procedure"`, and experiment-arm items — are ALL waived; every one of those node types may now be walked as a checkpoint chain. The sixth bullet does NOT waive: a node named in the learner's opening message as needing the normal style this time is still on its recall floor and still gets normal §2 free recall, no exception, because the recall floor is what keeps this widening from becoming a way to never produce a threshold concept from memory again. Nothing else about the protocol changes — the same confidence-first order, the same rating cap (`good` at best, never `easy`), the same `--source quick-mc` stamp, and the same §3 audit exclusion apply to a widened-eligibility item exactly as to an ordinary one. This setting is a persistent app preference (off by default), not a per-sitting toggle in itself — the per-sitting act that licenses it here is the learner's own opening sentence naming it, every single time, same as the base protocol's own opt-in above.

**Per eligible item:**
1. Show the standard progress marker (`[n/N] · node`) and the node's territory, then collect the confidence pick FIRST — the standard four-band Confidence `AskUserQuestion`, before the first checkpoint. Sureness must be priced before any option list leaks structure. The pick steers the dialogue (a Certain + wrong first pick is the hypercorrection moment — treat it as one); it is NOT calibration data here, so **omit `--confidence` from the rate call**: a feeling-of-knowing before seeing options is a different quantity from confidence in one's own production, and pooling them would corrupt the calibration ledger.
2. The chain: 2–4 `AskUserQuestion` steps, **at most 4 options each**, each step conditioned on the previous pick — a wrong pick at step k shapes what step k+1 probes; follow the error, never ignore it. Every distractor must be competitive and plausible: a real misconception (check the ledger for this node's open entries — the learner's own recorded wrong models are the best distractors available), a near-miss, a sign flip — never filler. The question `header` MUST be exactly `Checkpoint k/n` (e.g. `Checkpoint 2/3`) — the desktop app styles on that exact prefix. One ask per turn; checkpoint content lives only inside the ask, never previewed in prose. Two rendering facts about ask fields: they are NOT markdown, so write LaTeX with single backslashes (`$\langle T\rangle$`, never `\\langle` — a doubled backslash is a KaTeX line break and renders as letter soup); and the app **shuffles the display order of checkpoint options**, so never reference an option by its position ("the first option") in any later prose — name its content.
3. On a wrong pick, one neutral line before moving on: was that what you thought, or a guess? A confirmed belief is located evidence — file it with `misconception add`, using the distractor's own wording as the description. A guess files nothing.
4. After the chain completes: reveal and a one-line gap analysis, as §2 step 3 — and the reveal must state per-checkpoint correctness plainly (which steps were right, which wrong), so the sitting's record can be audited later.
5. Rate immediately, mapping the whole chain to one rating:
   - every step right → `good`. NEVER `easy` — a flawless chain of picks is not "instant, complete, correct" production, and easy's interval jump must stay unreachable from recognition evidence;
   - any wrong pick → `hard` at best;
   - first step wrong, or half or more of the steps wrong → `again`.
   Commit with `--kind review` and `--source quick-mc` — never `--source self` — and put the pick trail in `--rubric-notes` (e.g. `picks 2/3`). The source stamp is the honesty mechanism; it rides the receipt forever.
6. Checkpoint items are **EXCLUDED from the §3 assessor-audit stash**, and they do not count toward §3's trigger conditions — a checkpoint `hard` is partial-rated but is not a "partial" for audit purposes. The blind assessor's contract takes a free-text production graded against criteria; a transcript of picks has no production to grade, and stashing one hands the auditor a shape it cannot honestly judge. Free-recall items in the same sitting stash and audit exactly as normal.

**At the close**, the receipt strip must state how many items went which way — e.g. `receipts 7 graded → 5 checkpoint (quick-mc) · 2 free recall` — so the sitting's own record says what kind of evidence it produced. These nodes return on schedule as normal free recall; say so once, flatly, if the learner asks what the trade cost.
