# The learning loop

Engram Desktop's UI exists to serve a specific pedagogy — free recall before
recognition, honest grading, and no gamified pressure. That pedagogy is not
this app's invention: it comes from the installed engram plugin's
`skills/_shared/dialogue-grammar.md`, the shared discipline behind `/learn`
and `/review`. This document is the pedagogy read from the UI's side — what
each rule requires the interface to do (or refuse to do), and how the app's
components make that visible. For the wire mechanics behind these signals
(the MCP bridge tools, the loopback relay, the CLI invocation), see
[architecture.md](architecture.md); this page does not repeat that detail.

## Philosophy constraints

These are hard rules. The UI was built to make them true, not just to
display them.

### Free recall before recognition

The dialogue grammar's VERIFY beat probes "cold, as free recall" — never as a
multiple-choice test of knowledge ("menus for navigation, never for
knowledge," per the grammar file's hard rules). The composer
(`app/src/renderer/src/components/MessageComposer.tsx`) is a free-text field
with no built-in reveal or answer-key affordance: the model has no tool that
shows the learner a canonical answer before they've produced their own. The
one menu the UI does offer — the four-band confidence picker
(`AskDialog.tsx`, driven by the blocking `ask_user_question` bridge tool) —
is explicitly metadata about the learner's own certainty, not the knowledge
probe itself, and the grammar file is emphatic that this is the *only*
place a picker is allowed to stand in for typed prose.

### Honest grading, no pity passes

Grades never come from the tutoring turn itself. The dialogue grammar calls
this "separation of powers": the tutor stashes a production
(`engram.py stash add`) the moment it exists, and at session end spawns a
dedicated **engram-assessor** subagent — via the `Task` tool, one of the
four tools the session's `--tools` allowlist grants
(`MINIMAL_TOOLS = 'Bash,Write,Read,Task'` in
`app/src/main/session/permissionConfig.ts`) — with only the stash contents:
claim, rubric, probe, production, confidence, and the engine-minted `sid`.
The tutor's own read of "how it went," and the conversational dialogue
itself, are deliberately excluded from what the assessor sees. The UI
reflects this split rather than papering over it: `GradeResultCard.tsx`
renders each assessor verdict as its own artifact — grade, rating, and
`s_before`/`s_after` stability figures — appearing only once a
`receipt`-shaped tool result lands in the transcript, never inferred from
the tutor's prose. There is no "looks right, I'll wave it through" path in
the UI; a grade is either the assessor's or it doesn't exist yet.

### Advisory-only bridge signals, graceful degradation

Every UI-driving tool except `ask_user_question` is one-way and
non-blocking. In `mcpBridgeWorker.mjs`, `render_beat` posts to its own
`/bridge/:id/beat` endpoint with the same fire-and-forget shape — an inline
`postJson()` call that is `.catch(() => {})`'d and returns before the relay
responds — while the remaining six advisory tools (`session_phase`,
`beat_outcome`, `spotlight_node`, `show_figure`, `suggest_action`, and
`progress_note`) funnel through a shared `fireUi()` helper that POSTs the
same way to the generic `/bridge/:id/ui` endpoint. Either path returns
immediately without awaiting the response, so a relay failure never blocks
or breaks the dialogue. `permissionConfig.ts`'s `APPEND_SYSTEM_PROMPT` tells the model
this explicitly: these tools are optional, skipping any of them is fine, and
"the app degrades gracefully" when it does. The UI components hold up their
end of that promise — `PlainDialogueBlock` in `BeatCard.tsx` is the fallback
render path for any prose that never got a `render_beat` call, so an
untagged dialogue turn still shows as legible chat rather than a broken or
missing block, and `BeatStepper.tsx`'s own doc comment states the same
posture for state it can't confirm: "an unrecognized/mid-transition state
just shows nothing lit, never a wrong claim."

### No auto-send

`suggest_action` offers up to three one-click chips (`open_explorable`,
`show_on_map`, `go_review`, `prefill`), rendered by
`app/src/renderer/src/components/ritual/ActionChips.tsx`. Its own header
comment states the contract directly: "Acting on one never sends anything by
itself; at most it prefills the composer... the human still has to hit
send." The `prefill` kind's `arg` lands in the composer's text box exactly
like something the learner typed themselves — nothing about the tool schema
or the wiring gives the model a way to submit a turn without a human
pressing send.

### Momentum opt-out honored

The dialogue grammar's Pillar 13 growth line ("that went from holding ~2
days to ~9") is explicit that a `settings.momentum = "off"` learner gets
silence, not a suppressed-but-still-computed line. The desktop UI carries
the same switch into its own cosmetic layer: `ReviewSessionView.tsx` and
`LearnSessionView.tsx` both read `model.settings.momentum` into a local
`momentumOn` flag, and gate the ambient momentum-driven components
(`FlowChain`, `InkWell`) behind it — a code comment in `LearnSessionView.tsx`
notes this is "app-side cosmetic, but the learner's 'no momentum language'
choice governs" beyond just the dialogue text. `NeuralField.tsx`'s ambient
brightening on session momentum is the same idea applied to the topic map's
background visualization.

## The beat grammar

`dialogue-grammar.md` defines an eight-step encoding grammar per node: OPEN
A GAP, PREDICT/ATTEMPT, STRUGGLE, RESOLVE, SELF-EXPLAIN, CONNECT, VERIFY, and
CLOSE THE LOOP. The UI's beat vocabulary covers the six prose beats plus
VERIFY as an outcome-only signal (CLOSE THE LOOP has no dedicated UI
treatment — it's ordinary dialogue). Beat names are shared verbatim between
the plugin's grammar, the bridge's `BEATS` array in `mcpBridgeWorker.mjs`,
and every UI component below:

| Beat | Grammar meaning | BeatCard accent | Stepper position | Mark glyph |
|---|---|---|---|---|
| `open_gap` | Frame the node as a question, not a topic | cool ink | 1 (Gap) | open curve (◆ icon) |
| `predict` | Learner commits to a guess before any content | cool ink | 2 (Predict) | arrow (? icon) |
| `struggle` | Hint ladder, one rung at a time, within budget | danger ink | 3 (Hint) | jagged line (△ icon) |
| `resolve` | Tutor teaches, scaffolded to the learner's signals | warm ink | 4 (Resolve) | settling curve (● icon) |
| `self_explain` | Learner states why it must be true, in their own words | cool ink | 5 (Explain) | branching stem (» icon) |
| `connect` | Name one edge to another node out loud | hot ink | 6 (Connect) | linked arcs (↝ icon) |
| `verify` | Cold free-recall probe; outcome-only, never announced via `render_beat` | — (no BeatCard variant) | 7 (Verify) | shield-check (✓ icon) |

Two independent UI surfaces consume these names:

- **`BeatCard.tsx`** renders the *live* prose beat as it streams in, driven
  by the model's `render_beat` call (`beat`, `content`, optional `node` /
  `position`). Its `BEAT_STYLE` map covers exactly the six prose beats — one
  entry per `ProseBeat` union member — since `verify` never carries prose to
  render this way; a beat outside that set, or no `render_beat` call at all,
  falls back to `PlainDialogueBlock`.
- **`BeatStepper.tsx`** is the persistent progress strip for the *current
  node's* walk, with all seven positions (`open_gap` through `verify`) laid
  out in grammar order. It lights the current step, inks past steps in the
  node's `trail` by how `beat_outcome` resolved them (`confirmed` → bright
  warm, `partial`/`visited` → dim warm, `missed` → danger), and resets the
  trail at every node crossing.
- **`Marks.tsx`** supplies the small hand-drawn glyphs (`BEAT_GLYPHS`,
  16×16 stroke-only SVGs) used as inline transcript markers — one entry per
  beat name including `verify`, since a mark records that a beat happened at
  all, prose or not.

## Session shapes

The app hosts three session kinds — `learn`, `review`, `coach` — one
`SessionManager` child process per live session (see architecture.md's
session engine section). Each drives a different slice of the UI.

### Learn walk

`/learn` runs the full phase sequence the bridge's `session_phase` tool
enumerates: **intake** (new-topic interview) → **pretest** → **walk**
(teaching nodes through the beat grammar above) → **grading** (the
engram-assessor subagent runs) → **closing**. `LearnSessionView.tsx` stages
its chrome to these phase transitions and shows:

- The **beat stepper** (`BeatStepper.tsx`), live throughout the walk phase.
- The **session ticket** (`TicketCard.tsx`), opening every session per the
  grammar's fixed ticket format — `engram · learn · <mode>`, topic and
  frontier position, perforated-edge styling.
- **Grade-result cards** (`GradeResultCard.tsx`) as the assessor's receipt
  batch lands, stacked with a running `GradeTally`.
- The **ceremony** (`Bookends.tsx`'s `SessionOpenPlate` and
  `SessionCeremony`) — an opening fig-caption plate acknowledging the prior
  sitting's recap, and a closing ledger of stability movements
  (`s_before` → `s_after`), next-due interval, and any signed return
  commitment, mirroring the grammar's mandated receipt strip.
- Ambient **momentum** components (`FlowChain`, `InkWell`,
  `NeuralField`'s ambient brightening), gated by the opt-out above.

### Review audit

`/review` is the spaced-repetition retrieval loop: due items surfaced one at
a time, free-recalled cold, confidence collected before any reveal, graded
by the same assessor path. `ReviewSessionView.tsx` reuses the same
grade-result and ceremony surfaces as Learn (`GradeResultCard`,
`SessionCeremony`) since both terminate in the identical assessor →
`receipt` → `stash clear` mechanics, but has no beat stepper or `render_beat`
usage — review items are graded individually rather than walked through the
full six-beat node grammar, so the UI shows a loop-position indicator
(`[3/6]`-style) instead of a stepper.

### Coach

`/coach` is a read-only dashboard, not a live dialogue turn-by-turn session
in the same sense — `CoachSessionPanel.tsx` and `DashboardView.tsx` surface
retention stats, calibration, momentum aggregates (`stats.momentum`:
reviews cleared, stability gained, most-durable memory), and standing
learning strategy. It has no beat stepper, ticket, or ceremony of its own;
it narrates the aggregate of what Learn and Review sessions already
produced.

## Source of the beat semantics

The prose descriptions of each beat above are drawn from the engram
plugin's own `skills/_shared/dialogue-grammar.md` (found under
`~/.claude/plugins/cache/engram/engram/1.0.7/skills/_shared/dialogue-grammar.md`
and mirrored at the `1.0.2` cache and the plugin marketplace checkout). The
UI accents, stepper positions, and mark glyphs are drawn directly from the
component source listed above.
