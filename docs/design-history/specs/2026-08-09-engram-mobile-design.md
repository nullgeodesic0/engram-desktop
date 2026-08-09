# Engram Mobile — The Sitting, Broken Into Cards

**Date:** 2026-08-09
**Status:** Approved design (new companion platform + supporting desktop work)

## Goal

An iOS companion to Engram Desktop that occupies the two-minute reach-for-the-phone
reflex — the slot a doomscroll currently owns — without becoming a second learning
engine, a flashcard app with engram branding, or a quiet downgrade of the evidence the
record is made of.

The desk is currently a hard requirement for every path into the loop. A sitting is
20–70 minutes with source material to hand. That is the right unit for real work and
the wrong unit for a train platform, so the loop simply does not run there. This
project makes it run, on a card grammar built for glass, feeding the same graph and
the same FSRS schedule — and stamps every gram of recognition-grade evidence so it
can never pass for desk-grade evidence in any stat, audit, or export that reads it.

The precedent is in this repo. **Checkpoint Review** (2026-08-03) licensed an opt-in
MCQ exception to the engine's menus ban, priced with a per-sitting election, a
permanent `--source quick-mc` stamp, capped ratings, a recall floor, carve-outs, and
audit exclusion, pinned by `checkDoctrine` §D5. Engram Mobile extends that charter.
It does not invent a new one.

## Evidence gathered before writing this spec

**1. A third of the corpus cannot take a multiple-choice chain, and it is not evenly
spread.** Measured across all 9 graphs in `~/.claude/learning/graphs/` — 358 nodes —
**53 are `threshold` and 81 are `node_kind: procedure`** (8 are both), so **126 nodes
(35%) fall inside the checkpoint overlay's existing carve-outs** and 232 (65%) do not.
The per-topic spread is the finding:

| topic | nodes | threshold | procedure | carved out |
|---|---:|---:|---:|---:|
| grad-statistical-mechanics | 36 | 9 | 30 | **92%** |
| grad-electrodynamics | 38 | 3 | 19 | **55%** |
| derivatives-product-mechanics | 121 | 14 | 27 | 33% |
| color-surface-depth-lower-bound | 21 | 2 | 3 | 24% |
| grad-quantum-mechanics | 33 | 8 | 0 | 24% |
| grad-classical-mechanics | 39 | 9 | 0 | 23% |
| quantum-codes-from-annealing | 30 | 3 | 2 | 17% |
| us-academic-labor-rights | 21 | 3 | 0 | 14% |
| lenin-what-is-to-be-done | 19 | 2 | 0 | 11% |
| **total** | **358** | **53** | **81** | **35%** |

A checkpoint-only mobile app would be **unable to touch 92% of statistical mechanics**.
This is the load-bearing argument for step assembly: it is not an alternative to
checkpoint chains, it is the only mobile-viable input for the third of the corpus
chains are forbidden from. Those 81 procedure nodes are not unserved today — the
problem grammar serves them at the desk (Evidence 7); they are unserved *by
recognition*, which is precisely why the phone needs a different input for them.

**2. The `node_kind: procedure` carve-out is live, not dead — verified, because the
field names differ.** Graph JSON stores `kind` (values: `concept` 151, `procedure` 81,
`fact` 9, with the remaining 117 nodes kindless); `engram.py` surfaces it as
`node_kind` via `node_kind_of()` (`engram.py:1165`, emitted at `:1480`), treating a
kindless node as `concept`, or `fact` when `arbitrary`. The overlay's wording is
correct against the CLI surface. Any mobile-side eligibility check must read the
CLI's `node_kind`, never the graph's raw `kind`, or it will misclassify 117 nodes.

**3. The checkpoint exception is real but small, and mobile will change that fast.**
Of 166 receipts on this machine: `self` 108, `assessor` 42, **`quick-mc` 16** — so
six days of checkpoint review produced under 10% of the record. Mobile stamps will
accumulate far faster than that, which makes the known retention-pool residual
(`cmd_refit`/`_fit_sample` do not filter by source) go from a disclosed footnote to a
material distortion. Sizing it is now part of this work.

**4. `--source` is a free string, so the honesty mechanism needs no engine change.**
`engram.py:12315` — `sp.add_argument("--source", default="self")`. New stamps are
additive and cost nothing upstream.

**5. Two-thirds of nodes carry math, but notation style is topic-dependent.** 236/358
nodes (66%) contain LaTeX markup — but that is concentrated: electrodynamics 37/38,
statistical mechanics 35/36, derivatives 113/121, while **classical mechanics and
quantum mechanics have zero**, writing notation as plain text instead (`generalized
coordinates q_i`, `3N minus the number of holonomic constraints`). The ladder's step
renderer must treat LaTeX as optional, not assumed, or it will render two of the
five physics topics as broken math.

**6. The plumbing to extend already exists and is well-patterned.** 20 bridge tools
registered in `mcpBridgeWorker.mjs` via `server.registerTool`, all advisory and
fire-and-forget except `ask_user_question`. `bridgeServer.ts:38` binds
`127.0.0.1` on an ephemeral port — loopback by construction, so the phone needs a
separate server rather than an extension of that one. `checkDoctrine.ts:724–806`
already pins overlay hashes *and* asserts load-bearing sentences verbatim; a second
overlay is a repetition of an established pattern, not a new mechanism.
`topicSettings.ts` and `achievementsStore.ts` are the app-owned-store pattern for
anything that must not enter `~/.claude/learning/`.

**7. The plugin already has a ladder, and step assembly is its glass form — not a
rival.** `skills/_shared/problem-grammar.md` drives every `node_kind: procedure` node
through **L1 worked example → L2 completion → L3 faded → L4 cold solve**, replacing
beats 2–4. L1 already reads *"before each step is revealed, the learner predicts the
next move"* — a card interaction described in prose. L2 (execute the ending) and L3
(the principle-bearing interior step blanked) are a step assembly and a cloze
respectively. So mobile does not invent a ladder; it renders L1–L3. **L4 must stay a
real production** — an assembly is easier than a free solve, so rendering L4 as one
would invert the rungs. Two further rules bind mobile hard: fresh instances must have
**answer keys computed by execution before serving** (the file is explicit that a wrong
key becomes a false lapse), and the discrimination beat's naming step is **never a
menu**. The phone cannot execute, so it may never invent an instance or compute a key.

**8. State is small enough that sync is a non-problem.** All of
`~/.claude/learning/` is 2.8 MB. Nothing here justifies a server, an account, or a
cloud. Grading requires the Mac awake regardless, so LAN/Tailscale reconciliation is
sufficient by construction.

## Constraints (binding)

- **A window, never a second author — carried onto the phone unchanged.** The phone
  never mints a receipt, never calls `engram.py`, and ships no engine. Even when
  linked it sends an input trail; the Mac's live session runs `engram.py rate`.
- **Protect the retrieval.** A card's answer payload is sealed until the learner
  commits. Step *k+1*'s candidate pool is never rendered before step *k* commits —
  the pool itself leaks structure.
- **Honest or absent.** Every tap-derived rating carries a source stamp that
  distinguishes it from free recall forever. Provisional nodes are visibly
  provisional. No number is shown whose basis cannot be stated.
- **The sitting is still the unit** — just a six-minute one. Both feeds are finite and
  end. No streak pressure, no adaptive re-engagement timing, no loss-aversion copy.
- **The engine is untouched.** No `engram.py` edits, no plugin edits. Pedagogy changes
  go through an additive overlay under the existing constitutional-exception charter,
  pinned in the same commit.
- **100% local.** No server, no account, no telemetry, no Anthropic API key.
- **No computer control.** Verification is `npm run typecheck && npm run build`, both
  static checks, `swift test`, and reading real data on disk. Anything confirmable
  only by eye — scroll feel, print legibility, spoken-recall accuracy — is handed to
  the user.

## 1. Link: two channels, deliberately asymmetric

A new LAN-bound `LinkServer` in the desktop main process, separate from the loopback
`bridgeServer` and never merged with it. Bonjour advertisement, TLS with a pinned
self-signed cert, paired by a QR code carrying `{host, port, secret, certFingerprint}`.
Tailscale needs no special support — it is one more routable address.

- **Outbox** — append-only, ordered, durable. Everything the phone produces: picks,
  ladder placements, recall audio and text, confidence, timings. Replayable across a
  cold launch. Drains whenever the link is up.
- **LiveLink** — request/response, best-effort, card generation only.

**"Live mode" is not a mode.** It is the outbox draining fast and the branch tree
being deeper. The phone's UI is identical online and offline apart from a link
indicator and how quickly a grade lands. This is what keeps the hybrid from doubling
every state in the app.

## 2. The card grammar

| Kind | Input | Evidence | Source stamp | Assessor | Rating cap |
|---|---|---|---|---|---|
| `checkpoint` | 2–4 conditioned MC | recognition | `quick-mc` *(existing)* | no | `good` |
| `connect` | pick the true graph neighbour among plausible non-neighbours | recognition | `mobile-mc` | no | `good` |
| `cloze` | tap symbols/terms into a formula from a palette | mid | `mobile-cloze` | no | `good` |
| `ladder` | assemble an ordered derivation from a candidate pool | near-production | `mobile-ladder` | no | `good` |
| `recall` | spoken (on-device Speech) or typed free text | **production** | `self` | **yes** | uncapped |

The last row is load-bearing and must not be quietly dropped for schedule. **A spoken
recall on the phone is doctrinally identical to a typed recall at the desk** — it
stashes, the blind assessor grades it, `--confidence` is recorded, ratings are
uncapped, `easy` is reachable. Mobile is second-class only on the tap path. That is
what keeps this app from being a permanent evidence downgrade, and it gives the
learner a real lever rather than a consolation prize.

## 3. Step assembly

The desktop's `render_steps` bridge tool *shows* a step ladder. Mobile inverts it into
an input. The tutor emits a step graph: N canonical steps in order plus ≥N distractor
steps; the learner builds the chain top-down from a shuffled pool.

**On procedure nodes this is not a new mechanism — it is `problem-grammar.md`'s L1–L3
rendered on glass** (Evidence 7). L1's predict-the-next-move, L2's execute-the-ending,
and L3's blanked principle-bearing step are assembly and cloze interactions already;
rung selection stays the worked-drive signals as written. **L4 cold solve is never an
assembly** — it is a produced fresh-instance solve, spoken, typed, or photographed.
The discrimination beat's naming step stays typed or spoken; the problem grammar bars
a menu there and this design does not touch that.

**Fresh instances arrive with execution-verified keys or they are not served.** The
phone cannot execute, so it never invents an instance and never computes a key;
variants are generated and checked on the desk before packing. The
`unverified-by-execution` fallback is a desk affordance and does not extend to a
surface that cannot check its own arithmetic — a wrong key is a false lapse on the
learner's schedule.

These rules are the bargain, and become the overlay's asserted sentences:

1. **Pool ≥ 2N.** Guessing a whole chain must be combinatorially hopeless — unlike a
   four-option pick, where a lucky run is ordinary.
2. **Distractors must be competitive:** sign flips, right-step-wrong-order, a step
   lifted from a neighbouring derivation, and — where the ledger has entries for this
   node — the learner's own recorded misconceptions in their own wording. Never filler.
3. **No lookahead.** Step *k+1*'s pool is not rendered until step *k* commits.
4. **No backtracking.** Placements lock on commit; backtracking turns retrieval into
   search.
5. **Follow the error.** A wrong placement makes the next pool probe what that
   specific wrong step implies. This is the live-generation moment.
6. **Rating map mirrors the checkpoint cap exactly** — flawless → `good`, never
   `easy`; any wrong placement → `hard` at best; first step wrong or ≥half wrong →
   `again`. The placement trail rides `--rubric-notes`.

**Steps render as text that may or may not be LaTeX** (Evidence 5). Plain-text
notation is a first-class case, not a fallback.

**Latency.** Pre-pack a two-deep branch tree per node so common wrong paths resolve
offline and instantly; keep a warm `claude -p` session per active topic so a live
branch is one turn against primed context, not a cold start. Cards render
optimistically from the pre-pack and upgrade in place if the live branch arrives in
time. *This is the design's shakiest technical bet; if warm sessions prove too heavy,
the fallback is a deeper pre-packed tree — shallower branching, feature intact.*

## 4. Learn mode — the mobile walk

All eight beats survive; none are dropped.

| Beat | Mobile form |
|---|---|
| OPEN A GAP | A card posing the question. No options. Explicit tap to engage. |
| PREDICT | Confidence pick first (four-band, per the overlay), then MC — the one beat where a menu is least harmful, because the point is commitment before content. |
| STRUGGLE | Wrong pick → one hint rung per card, budgeted, one at a time. |
| RESOLVE | Prose cards. Night Atlas serif, math where the node has it. Read-only. |
| SELF-EXPLAIN | **Ladder** (derivational), **cloze** (definitional), or spoken recall. Never a plain MC — recognition cannot carry this beat. |
| CONNECT | `connect` card over the learner's real graph neighbourhood. |
| VERIFY | Cold. Ordinary nodes: ladder or checkpoint chain. **Threshold, procedure, and transfer-ready nodes: ladder or spoken/typed recall only — never a chain.** |
| CLOSE THE LOOP | Ceremony card: what moved, what is next, and the provisional stamp stated plainly. |

The heavier walk is a stricter loop rather than a gate: nothing stalls, and the phone
never advances a topic's frontier by recognition alone on the 35% of nodes the
existing overlay says recognition flatters most.

### Provisional and Solidify

- The Mac commits with `--source mobile-walk` and the full input trail in
  `--rubric-notes` (`ladder 5/6 · connect ok · verify quick-mc 2/3`).
- A `provisional` set lives **app-side**, keyed `topic:node`, in Engram Desktop's own
  store — never in `~/.claude/learning/`, because the app must not author engine
  state. The atlas draws these hollow; topic counts read `34 nodes · 5 provisional`.
- **Solidify** is a real desktop `/learn` session in a new mode: skips OPEN A GAP and
  RESOLVE, runs full STRUGGLE depth, a graded free-recall VERIFY, and a transfer
  probe. Completion clears the mark. The engine sees an ordinary learn receipt —
  **zero engine changes**.
- Offered in the Ready Room and on the node's atlas card. **Never nagged.**

## 5. Review mode

The existing checkpoint protocol at one card per screen, every term preserved, and the
carve-outs enforced **client-side as well as in the prompt**: threshold, lapsed,
`effectively_relearn`, `transfer_ready`, `node_kind: procedure` (read from the CLI
surface, per Evidence 2), and experiment-arm items are served as `recall` or `ladder`,
never as a chain. The recall floor is the same rule as `checkpointEvidence.ts`.

**Anti-drift device:** that logic now exists in two languages. Extract the rules into
a shared JSON fixture suite consumed by both the TypeScript and Swift test suites.
Neither implementation may drift without turning the other red.

## 6. Feed shape, ending, and re-entry

Two modes, tab-switched, never interleaved. One card per screen, advanced only by an
explicit committing action — **never by swiping past**, because a card you can skip is
a card you can avoid producing for.

Both feeds are finite, and **ending is the feature**: Review ends when the queue
empties; Learn ends at a budget declared on entry. The end is a ceremony card, the
measured facts, and **no "keep going" affordance**. The scroll runs out. That is the
anti-doomscroll argument expressed as an interaction rather than a slogan.

**Re-entry:** WidgetKit widgets stating measured facts only (`11 due · ~7 min`; medium
adds next topic and provisional count). One optional notification at a learner-set
time, off by default, worded as measurement.

## 7. Doctrine work

Not paperwork. The bargain is settled in writing before code exists to rationalise
around it.

1. New overlay `plugin-overlays/engram/learn-skill.mobile-walk-protocol.md` under the
   existing charter, same constitutional-exception header form. Load-bearing
   sentences: the provisional stamp, the rating cap, the six ladder rules, the
   threshold/procedure heavier-walk rule, and the definition of Solidify.
2. New sibling `plugin-overlays/engram/dialogue-grammar.mobile-walk-exception.md`
   naming the second exception — kept as its own file rather than folded into
   `dialogue-grammar.checkpoint-exception.md`, so each exception stays paired with the
   one protocol that licenses it and either can be removed without stranding the
   other's sentence. Same licence, same pin, same removal rule.
3. `checkDoctrine` §D5: pin the new overlay's hash and assert its sentences verbatim,
   exactly as `:724–806` handles the checkpoint overlay today.
4. **`checkDoctrine` new §D6 — the mobile boundary.** Pin the `LinkServer` payload
   shapes, the assertion that no mobile code path invokes `engram.py`, the card-pack
   store path, and the mobile source-stamp constant set. A new stamp must be a
   deliberate, re-pinned edit.
5. Swift-side doctrine test: no code path renders a card's answer payload before a
   commit is recorded, and no code path writes learning state.

## 8. The retention-pool residual, resized

Evidence 3 changes the status of a known issue. `cmd_refit`/`_fit_sample` pool
receipts without filtering `source`, so `quick-mc` evidence already contributes to
retention fitting; at 16 of 166 receipts that was a disclosed footnote. Mobile will
add `mobile-mc`, `mobile-cloze`, `mobile-ladder`, and `mobile-walk` at a much higher
rate. **Before Learn mode ships, measure the stamped share of the receipt corpus and
state it on the retention surface.** The honest fix remains an upstream PR filtering
non-free-recall sources (matching upstream's existing relearn-filter precedent); it is
not to be worked around from the app side.

## Out of scope

An Android client. Any cloud sync, account, or hosted service. iPad-specific layouts
and Apple Pencil input — the card grammar makes handwriting less necessary than it
first appeared; revisit once step assembly is real. Editing the graph from the phone.
Coach mode on mobile. Any notification not explicitly enabled by the learner at a time
they chose. Changing `engram.py` or any plugin skill file.

## Build order

1. Spec, overlays, doctrine pins.
2. `LinkServer` + pairing + Outbox, no UI. Prove one rating round-trips to a real
   `engram.py rate` receipt.
3. Card format + `emit_card_pack` bridge tool + pre-pack store.
4. SwiftUI feed shell + Night Atlas Swift tokens. Scroll and commit ergonomics first —
   this has to beat a doomscroll and cannot be retrofitted.
5. Review mode (smallest doctrine surface — rides the existing exception).
6. Learn mode + step assembly.
7. Provisional + Solidify on the desktop.
8. Widgets + voice recall.

## Verification

- `npm run typecheck && npm run build` in `app/`; no interactive `npm run dev`.
- `npm run check:doctrine` must **fail** when an overlay hash, an asserted sentence,
  or a mobile constant drifts — confirmed by deliberately breaking each and observing
  a red, not by assuming.
- `swift test`: answer-sealing, outbox durability and replay across cold launch,
  rating-cap mapping, carve-out enforcement against the CLI's `node_kind`, ladder
  scoring.
- Shared-fixture conformance run from both sides; change one implementation and
  confirm the other goes red.
- **End-to-end on real hardware:** pair by QR, airplane-mode the phone, walk one node
  to completion, reconnect, and confirm via `engram.py receipt` that a real receipt
  landed carrying `--source mobile-walk` and the full trail, with the node hollow in
  the desktop atlas.
- **Adversarial:** with the phone offline, confirm no card's answer payload is
  readable in the on-disk store before commit, and that no path produces a receipt
  without the Mac.
