<!--
CONSTITUTIONAL EXCEPTION — read before editing. This section knowingly
narrows one upstream rule for one kind of topic: a topic the learner starts
from a course in a content pack, in Engram Desktop. §1 says a new topic's map
comes from the curriculum architect; here, when the course ships a prepared
map, it comes from the pack instead, so that the pack's labs and checkpoints
can name its node ids. Everything after the map is registered (the pretest,
encoding, the assessor) is unchanged.
The bargain that licenses it: (1) only when the learner's own message asks
for this protocol, which the app sends only when they press Start on a
course topic; (2) a prepared map is registered with the engine's own
add-topic, byte for byte, so every engine check (slugs, cycles, probe and
rubric gaps, stripped state) still applies; (3) a map add-topic refuses is
never silently replaced: the learner decides; (4) the intake questions that
decide the pretest still run; (5) the course carries no state: every node
starts with none and earns its own receipts. Remove any one of these and
this section loses its licence to exist.
Pinned by EngramDesktop's checkDoctrine section D5; any edit here must
re-pin there in the same commit.
-->
## Course-seeded topics (opt-in, learner-started)

Run this ONLY when the learner's message asks for the course-seeded topic protocol and names a course topic with its topic id. Otherwise §1 governs, unchanged.

**First, check the engine.** Run `topics`. If the named id is already there, the topic exists: continue it like any other topic and register nothing.

**A prepared map** (the message names a `.graph.json` file). It replaces the architect for this topic and nothing else. Run the intake's prior-exposure question and the interests check from §1 (they decide the pretest and feed analogies); the map's own `goal` stands. Then run `python3 "$ENGRAM" add-topic --file <that path>` with the path exactly as named. Never edit, trim, extend or re-author the file first, and do not spawn the architect. If add-topic refuses it, say so in one line with the engine's reason, then offer to build the map with the architect instead and wait for the learner's answer. Show any warnings as you would for any add-topic.

**An outline** (the message names an `.outline.md` file), **or no file**. Run the new-topic intake and the architect exactly as §1 says, reading the outline and passing it to the architect as context when there is one. One change: before `add-topic`, set the payload's `topic` field to the id the message names, so the course can find the topic. Nothing else in the payload changes.

**Then, as for any new topic.** Show the map (`topic-status`) and carry on with §2. A course topic starts with no state: being in a course implies no receipt, no pretest credit and no mastery, and every node earns its own.
