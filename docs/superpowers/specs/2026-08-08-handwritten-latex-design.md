# Handwritten LaTeX, and a composer that can hold it

Two sub-projects. **B** ships first and is independently useful; **A** lands in it.

## Why the split

The original ask was A — photograph handwritten work, get LaTeX the grader can
use. Editing that LaTeX afterwards is where A's payoff is won or lost: attesting
to a transcription and then editing raw TeX in a plain textarea is barely better
than typing it. B also pays off every sitting, not just the ones with a photo.

---

# B · A LaTeX-fluent composer  *(built)*

## The problem

Editing LaTeX is not editing text. Prose is linear and its mistakes are visible;
an expression is a tree, and its most common mistakes — an unclosed brace, a
stray `$`, `\left(` with no `\right)` — are invisible until the render fails, at
a reported position usually nowhere near the actual error. Worse, `x^10` is not
an error at all: it renders as x¹0, silently, and survives into a graded
production.

## Architecture

Three units, two of them pure.

| unit | job | depends on |
|---|---|---|
| `shared/latexSyntax.ts` | scan text → delimiter tokens with depth, partner, family; problems; caret pair | nothing |
| `shared/latexEditing.ts` | (text, selection, key) → new text + selection, or null | nothing |
| `components/LatexHighlightOverlay.tsx` | paint tokens behind the textarea | latexSyntax |

Both pure modules are tested as data (25 + 17 cases), which matters because
these rules are fiddly and their failures are subtle.

### Scanning

Delimiters are **math-scoped by design**: `(`, `[`, `{` are tokenised only
inside a math span. Prose is full of ordinary parentheses, and colouring them
would be confetti — the value of the colour is that it means *"you are inside
an expression, this deep."* `$`/`$$` are always tokenised.

`\left`/`\right` pair as sized delimiters, with the word included in the token
so a mismatch is findable at a glance. The guard that matters: `\leftarrow`
must not read as `\left` + `arrow`, so the word only counts when the letter run
ends there.

### Editing aids

Each fixes a specific silent failure:

- **`^` and `_` always take a group** — kills `x^10` structurally
- **wrap a selection** in `(`, `[`, `{`, `$` — how math actually gets written
- **auto-close**, only at a boundary, with **type-over** and **smart backspace**
  so every auto-insert is one keystroke from undone
- **`\left(` → `\right)`**, **`\begin{env}` → `\end{env}`**
- **unicode → LaTeX** on demand (never silently) — the system prompt already
  asks the *tutor* to prefer LaTeX over `ħ ∂ ≥`; the learner pasting from a qual
  paper had no equivalent help

### Rendering

Standard mirror technique: a `<pre>` under a textarea whose glyphs are
transparent. Caret, selection, IME, spellcheck stay native — we only paint. The
contract is identical metrics on both elements, restated explicitly rather than
inherited, since a form element falling back to a UA font puts every glyph
fractionally off its own highlight.

Colours cycle warm → cool → violet → lavender by depth, unmatched in danger —
the same four inks `MarkFrame` uses, so the composer speaks the transcript's
colour language instead of inventing an editor palette.

### Transparency

One status line: *"3 math spans · balanced"* or *"`{` never closed · 2 more"*.
It names the **first** problem, not a count — the first unbalanced delimiter is
usually the cause of every later one.

---

# A · Handwriting → attested LaTeX  *(designed, not built)*

## Decisions

| question | decision |
|---|---|
| what makes it *your* production | **you attest to every transcription** — nothing is stashed until you confirm |
| who reads the image | **a blind subagent** spawned by the tutor, given only the image path and a transcribe-verbatim instruction |
| the original photo | **ephemeral** — read, transcribed, attested, forgotten |
| where the LaTeX lands | **the composer**, as ordinary editable text; you still press send |
| multi-page | **yes**, ordered pages of one derivation |

## Flow

```
[Attach handwritten work] → pick pages (ordered)
   ↓  app sends a transcription request naming the image paths
tutor spawns a blind subagent
   ↓  returns LaTeX
tutor calls propose_transcription({ pages, latex })
   ↓
ATTESTATION CARD — pages beside rendered LaTeX, editable
   ↓  confirm
composer → send → engine, by today's path exactly
```

## Why this shape

- **The app never transcribes.** Its only privileged role is the gate, so it
  can't be blamed for what the transcription says.
- **Nothing downstream of the composer changes.** The production reaches the
  engine by the existing route (`Write` → `stash add --file`), so dialogue-
  grammar §80 — *learner text never touches a shell command line* — needs no
  re-audit.
- **Blindness mirrors the assessor.** A transcriber that knows the rubric reads
  what it expects to see on a smudged exponent.

## Known weaknesses

1. **Blind by instruction, not construction.** The tutor could ignore the
   system-prompt instruction and read the image itself. Mitigation: detect the
   spawn in the transcript the way the assessor spawn already is, and show
   provenance on the card — *"transcribed blind"* vs *"transcribed by the
   tutor"* — so the difference is visible rather than assumed.
2. **Unverified:** that a `Task` subagent can `Read` an image under the
   session's `--tools Bash,Write,Read,Task`. Must be checked before building.
3. `propose_transcription` is a new bridge tool and needs a D3 re-pin. It
   carries text from the model to the learner and reads no engine state, so it
   passes the same test the other structured tools did.

## Out of scope

Source-material attachment (a qual paper for context) keeps using the existing
paperclip. This flow is for your own work.
