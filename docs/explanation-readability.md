# Explanation readability

Engram's tutor, assessor and coach write text for a learner who is reading new
material. This page covers the rules that keep those sentences easy to follow
on the first read, where they live, and the one mechanical check the app runs.

## Where the rules come from, and what is ours

Clark, Martin & Mahowald, "Why is AI-generated language so hard to
understand?" (arXiv 2610.29162), compared text from 14 language models with
human text in chat, coding and essay settings, and with meaning-preserving
paraphrases of each model's own output. Most frontier models overused six
constructions that earlier psycholinguistic studies link to slower reading:

1. inanimate subjects with agent verbs ("the phase eats the sign"),
2. rare word pairings ("a load-bearing assumption"),
3. reduced object relatives, i.e. a missing "that" ("the state the circuit prepares"),
4. denominal verbs ("gate the next step on…"),
5. long subject–verb or verb–object dependencies,
6. stacks of three or more nouns ("syndrome extraction circuit depth bound").

The paper measures and explains. It gives no editing advice and did not test
human readers. Everything about *how to edit* (the fixes, the priorities, the
"leave it when" exceptions, the over-correction check) is this app's own
application of those findings, adapted from a line-editing skill. The list of
habits to drop ("It's important to note…", "delve", wrap-up lines) comes from
general editing practice, not from the paper, and the overlays label it that
way.

## Where the rules live

Engram never calls a model directly; every learner-facing sentence comes from
the engram plugin's skills running under `claude -p`. So the rules are plugin
overlays (see [`plugin-overlays/README.md`](../plugin-overlays/README.md)),
all presentation-only under the default charter and all hash-pinned in
`checkDoctrine.ts` D5:

| Text the learner reads | Written by | Overlay |
|---|---|---|
| RESOLVE, hints, CONNECT, the close | tutor (`/learn`, `/review`) | `dialogue-grammar.readable-sentences.md`, right after `dialogue-grammar.explanation-style.md` |
| Lecture notes | tutor, via `publish_lecture_notes` | the same section, plus the tool's own description and the check below |
| `feedback_line` on a graded answer | `engram-assessor` subagent | `assessor.feedback-line-style.md` (a paragraph added to the existing wording rule) |
| Check-ins and stats explanations | coach (`/coach`) | `coach.readable-sentences.md` (a short copy; the coach never reads the grammar) |

`explanation-style` (message length, one step per message, terms and notation)
and `readable-sentences` (the sentence itself) are deliberately separate
sections at two levels, so neither repeats the other.

What every copy keeps fixed: equations, code and inline code, identifiers,
quoted text (the learner's own words, a rubric, an error message), defined
terms under their one name, numbers, and the strength of every hedge.

Not covered: the curriculum architect's node claims and probes, the artifact
smith's explorables, and handwriting or oral-exam transcriptions (which must
stay verbatim). Codex and OpenCode sessions use their own plugin installs,
which `apply:plugin-overlay` does not touch today.

## The lecture-notes check

A dialogue turn streams to the learner as it is written, so there is no cheap
point to review it afterwards; the dialogue relies on the prompt alone. Lecture
notes are different: they arrive in one `publish_lecture_notes` call before the
learner sees anything, so the app checks them there.

`app/src/shared/readability.ts` flags only what a regex can catch without many
false alarms:

- a sentence over 40 words of prose (a proxy for a long dependency),
- words the notes' language rules already forbid ("simply", "obviously", "clearly", "trivially"),
- stock filler ("It's important to note", "delve", "great question", a leading "In short,"),
- a paragraph with three or more dashes.

Math (`$…$`, `$$…$$`, `\[…\]`), code blocks and inline code are replaced with
placeholders first, so an equation counts as one word and is never judged.
Headings, tables, block quotes and bold step labels are skipped, because
fragments are expected there. Missing "that", noun stacks and agent verbs
need a parser or a reader, so they are left to the tutor's own reread.

If anything is flagged, the notes come back unsaved with up to eight
sentences and an instruction to fix only what needs it. The tutor's next call
with `readability_reviewed: true` is saved as sent, so the check costs at most
one extra tool call and can never loop. The app never rewrites the notes
itself.

## Before and after

Each pair below is one run of the same prompt through `claude -p` (the
default model in the build environment on 2026-11-21), with the relevant
overlay-applied skill file as the system prompt. "Before" is the plugin with
PR #17's explanation-style rules; "after" adds this change. These are single
samples, so part of each difference is ordinary run-to-run variation. The
honest summary: with the explanation-style rules already in place, the
dialogue was mostly readable before, and the clearest gains are in the
one-sentence feedback line and in small fixes like a restored "that".

**Assessor `feedback_line`** (learner gave a†a the same cross term as aa†):

> **Before:** Line 2 copied Line 1's cross term, but expanding (x − ip)(x + ip) gives i(xp − px), which is the opposite sign; redo Line 2 with that sign, use [x, p] = i to rewrite the cross terms as +1/2 in a a† and −1/2 in a† a, and subtract to get [a, a†] = 1.
>
> **After:** Line 2 gives a†a the same cross term as a a†. Expanding (x − ip)(x + ip) actually gives +i(xp − px), the opposite sign, so the two cross terms don't cancel. Redo line 2 with that sign, then use [x, p] = i to turn the cross terms into +1/2 and −1/2, which makes [a, a†] = 1.

The before sentence runs about 55 words with three clauses chained by a semicolon
and commas; the lecture-notes check flags it. The after version says the same
thing in three sentences, and adds why the error matters ("the two cross terms
don't cancel").

**Coach check-in** (loop closure 12 of 20, 30-day recall 0.71):

> **Before:** Before anything else: of the 20 concepts you've been scheduled to review, you came back for 12 at least once. That's 0.6. The loop is closing, and every other number here depends on it.
>
> **After:** You came back for 12 of the 20 concepts that the schedule brought due, so the loop is closing more often than not. The other 8 haven't been reviewed even once since they came due.

The after version restores "that", backticks the engine's node id
(`pauli-group`), and drops the bare "That's 0.6." The before run kept one
thing the after run lost: the line that every other number depends on loop
closure. That sentence comes from the coach skill itself, so its absence here
is run-to-run variation, not something this change asks for.
The after run also added a judgement the data does not support ("a pass but
not a high one, so read the borderline grades a little more loosely"). The
rules forbid new claims and hedges; this is the kind of drift to watch for in
review.

**Tutor RESOLVE** (learner predicted the bit-flip code also corrects Z errors):

> **Before:** Your rule treats a check as something that catches any change on its qubits. That's the part that fails. From stabilizer-measurement, a check reads −1 only when the error **anticommutes** with it.
>
> **After:** Your claim misses one thing. By your stabilizer-measurement receipt, a syndrome bit reads −1 only when the error **anticommutes** with that stabilizer. An error that commutes with every stabilizer leaves both syndrome bits at +1.

Both runs were already readable. The after run names the actual objects
("a syndrome bit", "that stabilizer") where the before run said "a check",
and it hands the Z₁ syndrome to the learner as their next move instead of
working it.

**Lecture notes, "The idea" for Knill–Laflamme**: both runs passed the
mechanical check with no findings. Neither had a dropped "that" or a noun
stack; the main difference was the worked case each chose.
