# Lecture notes

An opt-in way to meet a brand-new concept: the tutor writes short notes, the
learner reads them, and then the usual eight-beat walk runs. Off by default.
Turn it on in **Settings → Lecture notes**.

## Why it exists

The loop is generation-first: the learner attempts before anything is
explained. For material that is genuinely new, that can mean struggling with
nothing to generate from, and learning only arrives at review. The evidence
backs instruction-first for novices: the worked-example effect (Sweller and
colleagues) is strongest for learners with little prior knowledge, and
productive failure works best when the learner already has something to
reason with. Lecture notes give a first pass at the idea and keep everything
that makes the loop work: the attempt, the struggle, and a cold final check.

## The flow

1. The Settings toggle turns into a sentence in the learner's own opening
   message (`app/src/shared/lectureNotesKickoff.ts`). It is never added to the
   system prompt, and it is never inferred.
2. For a node the learner has never encoded (never the capstone, never in
   `/review`), the tutor writes notes and calls the `publish_lecture_notes`
   bridge tool. The app checks them, saves them to
   `userData/lecture-notes/<topic>/<node>.json`, renders a PDF beside them, and
   returns refusal reasons if something is wrong so the tutor can fix it.
3. The session shows a notes card and opens the reader beside the transcript.
   The card's "I've read them, start the concept" button sends that sentence as
   the learner's turn.
4. The walk runs all eight beats. PREDICT and STRUGGLE move to an instance the
   notes did not work. RESOLVE is shorter.
5. When the tutor opens the cold VERIFY (`**VERIFY — cold, no notes.**`), the
   reader closes and the notes buttons lock until the beat moves on.
6. The notes stay with the node: the topic map's node drawer has a Lecture
   notes section with Read notes and Open PDF.

## What good notes look like

The shape and language rules live in the learn-skill overlay
(`plugin-overlays/engram/learn-skill.lecture-notes-protocol.md`) and are
repeated in the bridge tool's description, so they hold even before the
overlay is applied. Each rule comes from a research finding:

| Rule | Finding |
| --- | --- |
| Open with "Why this matters" and "What you already have" | Advance organizers and activating prior knowledge (Ausubel; Mayer's pre-training principle) |
| Concrete case first, then the general statement | Concreteness fading |
| Fixed headings; bold a term only where it is defined | Signaling principle |
| One fully worked example, not the probe's, with step labels | Worked-example effect; subgoal labels (Catrambone) |
| No questions inside the notes | Prompts inside worked examples add load and hurt novices |
| "The common mistake" stated, refuted, then explained | Refutation texts are the most reliable format for correcting misconceptions |
| "You", plain active sentences | Personalization principle |
| No history, anecdotes or trivia | Coherence principle (seductive details hurt) |
| One name per idea | Terminology switches read as new concepts |
| End with "In three sentences" | Summaries support retention and give review an anchor |
| 400–900 words, about five minutes | Segmenting; keeps reading short of the walk itself |

## What the notes may never do

They never carry the node's `probe` or `transfer_probe`, never work the probe's
own instance, and never list the rubric. They teach the idea; the walk tests
it. Ratings are unchanged: the cold VERIFY is the evidence, and the notes buy
no discount and carry no penalty.

## Doctrine

`scripts/checkDoctrine.ts` pins the store as an app-userData writer (D2), the
new tool and the system-prompt sentence that discloses it (D3), and both
overlay files with the bargain's load-bearing sentences (D5). After a plugin
update, run `npm run apply:plugin-overlay` so the learn skill carries the
protocol.
