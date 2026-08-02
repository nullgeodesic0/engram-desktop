# Contributing your learning data

**This is an informed-consent document, not a privacy policy.** A privacy policy tells you what a
company is allowed to do to you. This tells you exactly what leaves your machine, exactly what
never does, and exactly how to change your mind — so that saying *yes* is a decision and saying
*no* costs you nothing.

**Nothing here is automatic. Nothing is on by default. Engram has never sent anything anywhere,
and the engine cannot: `scripts/engram.py` contains no network code, and a selftest proves that on
every single run.**

---

## Why you would

The evidence base of learning science is built on **undergraduates, word pairs, and 20-minute
retention intervals.** Almost nothing in the literature tests *self-directed adults*, on *hard
conceptual material*, at *30–90 day horizons*, with *blind-graded free recall*.

That is not a gap anyone chose. It is a gap because, until about 2026, **grading free recall at
scale was impossible.** You needed a human to read every answer.

Engram produces exactly that data as a byproduct of being useful — on hundreds of machines, with a
**measured** grader behind every verdict (v0.7). Nobody else has this corpus, because nobody could
build it.

**The open question it can answer:** [Kestin et al. (Harvard, *Scientific Reports*, 2025, n=194)](https://www.nature.com/articles/s41598-025-97652-6)
found an AI tutor built on exactly Engram's dialogue grammar produced **~2× the learning gains of
an active-learning classroom, in less time.** Its outcome was an **immediate post-test.** *Nobody
has ever measured whether AI-tutoring gains survive to thirty days.*

You have that data sitting on your disk right now.

---

## Exactly what leaves

Run this first. It writes a file; it sends nothing.

```bash
python3 scripts/engram.py export --contributor "@your-handle"
```

Then **open the file and read it.** It is JSON, it is yours, and it is short.

| leaves | never leaves |
|---|---|
| `grade`, `rating`, `confidence` | **your productions** — every word you wrote |
| `days_since_encode`, `s_before`, `s_after`, `interval_days` | **probes, claims, rubrics** |
| `kind` (encode / review / transfer) | **your goals and interests** |
| `artifact` (was an explorable used: true/false) | **misconception text** |
| `arm`, `stratum` (the experimental condition) | **topic names and node ids** — hashed, not carried |
| `grader`, **`grader_qwk`** (its measured validity) | **your commitment**, your session notes |

The full `stripped` list ships **inside the file**, so the promise is verifiable rather than
trusted. And the receipt payload is a **whitelist**: every field is constructed by name. There is
no code path by which a production could arrive — not "we remembered to delete it."

### The hash caveat, stated plainly

Topic and node names are **hashed**, not carried. But a hash of a *common* topic name
(`transformers`, `bayes`) is recoverable by dictionary attack in seconds. **This hides your topic
from a casual reader. It does not hide it from someone who wants it.**

**If a topic's NAME is sensitive to you, do not contribute that topic.** `export --topic T` exports
one topic at a time, precisely so you can choose.

---

## It is ATTRIBUTED. It posts publicly, as you.

We considered anonymising this. **We are not going to lie to you about it.**

The transport is `gh` — already installed and authenticated on most Claude Code machines — and **a
GitHub post carries your identity.** A "salted anonymous hash" riding inside a signed envelope
would be theatre the moment the envelope is signed. You cannot have one-keystroke `gh` upload
*and* anonymity. Pick one, and say which out loud.

**Engram picks attribution — and it is the stronger design, for the science rather than despite
it.** A retention study lives on **longitudinal linkage**: following *the same learner across
months* is the entire question. Attributed, linkable series at n=100 are scientifically worth more
than anonymous one-shot dumps at n=500. Attribution also buys deduplication, fabrication
detection, the ability to ask a contributor a follow-up — and the ability to **credit you**, which
is the only honest incentive on offer.

This is not anonymous telemetry. **It is a consenting, named, informed participant in an open
study** — which is what every good study has always had.

---

## The gate: an unaudited grader cannot contribute

`export` **refuses** if your assessor has not passed its audit. Not a warning — a refusal.

```
REFUSING TO EXPORT: the grader behind every one of these grades is unaudited.
A finding aggregated from unaudited oracles is not a finding — it is noise with a schema.
Run `/coach audit` (about four minutes), then export.
```

Every shared receipt carries its grader's **measured QWK**, and the bundle carries the gold set's
own **circularity limit** (`gold_adjudication: "authored"` — see the README). A number you cannot
stand behind should not enter the world with your name on it.

---

## How to actually do it

```
/coach contribute
```

It will:

1. Run `export` and **show you the file**.
2. Check for `gh`. **If `gh` is missing, unauthenticated, or you are offline: it prints the path
   and stops.** No error. No retry. No nag. The file is still yours.
3. If `gh` is present, ask you — **naming the exact handle it will post under** — and post a
   Discussion to `nagisanzenin/engram-data` only on an explicit yes.

**`gh` is a convenience, never a dependency. Declining must cost you nothing, or the consent is not
real.**

---

## Changing your mind

**It is a GitHub post. Delete it.**

That is the whole withdrawal mechanism, and it is deliberately that simple. There is no account to
close, no support ticket, no dark pattern. Open the Discussion, delete it, and it is gone. Ask us
to purge it from any aggregate and we will.

We would rather you contribute once, honestly, and be able to walk away — than be locked into
something you agreed to before you understood it.

---

## What you get back

- **Cohort comparison on your own dashboard** — with confounds stated *always*, in the same voice
  as `modality.caveat`. If the comparison is soft, you will be told it is soft.
- **Credit.** Contributors are named in any finding their data supports.
- **The findings themselves, in public**, including the ones that make Engram look bad. A project
  whose entire thesis is honest measurement does not get to hide its own worst measurement.

---

## The engine has no network code, and that is structural

Not "no network by default." **None.**

```bash
python3 scripts/engram.py selftest | grep "NO NETWORK"
# ⚠ THE ENGINE HAS NO NETWORK CODE — structural, permanent, and never to be deleted
```

That check parses the engine's own **abstract syntax tree** — not a grep over the text, which
would find the words in its own comments. It looks at what the interpreter will actually execute.
It fails the build if anyone ever adds `import requests` to make one thing convenient.

`export` writes a file and stops. The **agent** posts — it already has Bash, it already reaches the
network for WebSearch, and you already trust it with your machine. That is not a loophole. It is
the correct place to put the boundary, because the thing the *100% local* badge is about is the
engine, and the engine will never grow a socket.
