# Content packs

Engram Desktop ships the machinery for graded programming labs and no subject
matter. A content pack brings the subject: a folder of labs, each a sequence
of milestones with visible smoke checks, hidden tests and an explain-back
question, and, when the labs need more than NumPy and SciPy, a pinned Python
layer of its own. The learner adds the folder in **Settings → Content packs**,
and its labs appear in **Labs**. A pack can live anywhere: a private git
checkout, a synced folder, a download. The app reads it where it sits and
never changes it.

[`examples/example-pack/`](../examples/example-pack/) is a complete pack in
the format below, small enough to read in a few minutes.

## Layout

```
my-pack/
  pack.json
  runtime/my-layer.lock          optional: a pinned layer for this pack's labs
  labs/
    lab-one/
      lab.json
      starter.py                 given and starter cells, percent format
      m1.md                      a milestone brief, if it is long
      checks/
        smoke_m1.py              visible checks
        hidden_m1.py             hidden tests
```

Every path a manifest names is relative to the file that names it, uses
forward slashes, and must stay inside the pack. The loader resolves each one,
symlinks included, and refuses a pack whose files point anywhere else.

**A pack is trusted code.** Its tests and given cells run as Python with the
learner's permissions, like anything else they install. Add packs you would
run from a terminal. Its briefs are treated as text: raw HTML in them is shown
as written, links go only to the web or mail, and images are not loaded.

### pack.json

```json
{
  "format": 1,
  "id": "my-pack",
  "title": "My pack",
  "version": "1.0.0",
  "description": "One or two sentences for Settings.",
  "runtime": {
    "layer": "my-layer",
    "label": "My layer",
    "description": "What it adds.",
    "lock": "runtime/my-layer.lock",
    "imports": ["numpy", "mylib"],
    "packages": ["mylib", "numpy"]
  },
  "labs": ["labs/lab-one"]
}
```

- `id`, `runtime.layer`, and every lab and milestone id are up to 32
  lowercase letters, digits and dashes. Two added packs cannot share an id or
  a layer name, and no pack can name its layer `base`.
- `runtime` is optional. Without it the pack's labs run on the base layer
  (NumPy, SciPy, Matplotlib, pytest).

### The runtime layer

A layer is one more venv beside the base one, built by the same pinned uv and
the same uv-managed Python 3.12 (see [code-runtime.md](code-runtime.md)). Its
lockfile must be universal and carry hashes for every wheel, because it is
installed with `uv pip sync --require-hashes`:

```
uv pip compile my-layer.in --universal --python-version 3.12 --generate-hashes -o runtime/my-layer.lock
```

Include `pytest` in the lock: the hidden tests run on the layer. `imports` are
imported once after the install to prove the env works; `packages` are the
distributions whose versions Settings and the workbench badge show. The lock
is copied into the runtime folder before uv reads it, so the env is built from
exactly the bytes that were hashed. When a pack update changes the lock,
Settings offers **Update** and the new env builds beside the old one, which
keeps serving cells until then.

### lab.json

```json
{
  "id": "lab-one",
  "title": "Fitting a line by least squares",
  "kicker": "Lab 1 · Stage 1",
  "summary": "One line for the Labs list.",
  "starter": "starter.py",
  "milestones": [
    {
      "id": "m1",
      "title": "The fit",
      "briefFile": "m1.md",
      "smoke": "checks/smoke_m1.py",
      "hidden": "checks/hidden_m1.py",
      "explainBack": "Explain why the normal equations give the best line.",
      "timeLimitS": 600,
      "workedFile": "worked_m1.md",
      "completion": "completion_m1.py",
      "steps": ["Build the design matrix…", "Set the gradient to zero…"]
    },
    { "id": "m2", "title": "Further reading", "brief": "Brief only, no tests." }
  ]
}
```

- `brief` is inline Markdown with `$math$`; `briefFile` reads it from a file
  instead.
- A milestone with `hidden` tests needs an `explainBack` question. One without
  is brief only: it can be read but not submitted, and it never locks the
  milestones after it.
- Milestones open in order: one with hidden tests is locked until every
  earlier milestone with hidden tests has passed its core tests.
- `timeLimitS` (5 to 3600, default 600) bounds one check run.
- The ladder, every rung optional and every rung the learner's choice:
  - `worked` (or `workedFile`): a fully worked example of a sibling problem,
    in Markdown, to study before or while attempting the milestone.
  - `completion`: a percent-format file of cells with parts of the milestone
    done, which **Start from a partial solution** appends to the learner's
    lab for them to finish. Give its cells ids of their own.
  - `steps`: up to 12 worked steps of the milestone itself, opened one at a
    time with **I'm stuck**. Opening is for good.

  Every Submit records the help it had: `rung=completion` once the partial
  solution was added, and `help=N` for the steps open. The milestone rail says
  "passed first try" only for a first, unaided pass.

## Learning design

The flow follows what the research on learning to program, and on worked
problems generally, finds works:

- **Worked examples, then completion problems, then problems from scratch.**
  Novices learn more from studying a worked solution than from solving the
  same problem cold, and that advantage reverses as they gain expertise. So
  the worked example and the partial solution are offered, never forced, and
  their use is recorded so the tutor can see where on the ladder the learner
  is and push them up it.
- **Productive struggle before help.** Steps open one at a time, with a nudge
  to try first, and the first attempt is the one that counts: `sub=1` with
  `rung=full help=0` is the cleanest evidence of mastery the report can give.
- **Feedback that points rather than tells.** A failed core test names the
  behaviour that broke (its docstring) and holds back the assertion text until
  the milestone passes, so the next try comes from working out why rather than
  copying an expected value. Smoke and slip feedback are immediate and
  specific, because they are about form, not method.
- **Self-explanation and prediction.** The explain-back comes before any
  result, and the confidence is a prediction about the core tests. A
  resubmission asks what changed and why, rather than the same question again.
- **Hypercorrection.** When a confident prediction meets a failure, the
  receipt asks which assumption broke. Errors held with high confidence are
  corrected best when confronted at once.

Still to come with the tutor handoff: predict-the-output items, variants of a
milestone for retrieval practice, and interleaving across labs.

### starter.py

The learner's copy of a lab is made from the starter the first time the lab
opens, in the percent format the workbench uses (`# %% [given] id=…`,
`# %% id=…`, `# %% [markdown] id=…`; see `shared/workbenchFile.ts`). Given
cells are the pack's: read-only in the workbench, and refreshed from the
starter by id each time the lab opens, so a fixed given cell reaches a lab
already under way, and a given cell the starter has gained since is inserted
in place. Every cell needs a stable `id`; a starter cell without one is an
error.

## Checks

A check is a pytest file. Every test takes the `lab` fixture, which is the
learner's namespace after their cells have run:

```python
import numpy as np
import pytest

def test_matches_least_squares(lab):
    x = np.linspace(0, 1, 50)
    assert np.allclose(lab.fit_line(x, 2 * x + 1), (2, 1))

@pytest.mark.slip
def test_returns_plain_floats(lab):
    """The slope comes back as a Python float."""
    slope, _ = lab.fit_line([0.0, 1.0], [0.0, 2.0])
    assert type(slope) is float
```

Name each test for the behaviour it checks and give it a one-line docstring.
That line is what the learner sees when a core test fails while the milestone
is still open; the assertion message appears only once the milestone has
passed. So a core message may name the expected value, and the docstring
should not: the learner should learn which behaviour broke and work out why,
rather than read off the answer and copy it into the next try. Smoke and slip
messages are always shown, so make them say what to fix.

Each check is two runs of a fresh interpreter on the lab's layer
(`resources/runtime/engram_check.py`), in the learner's lab folder like the
kernel. The first loads no learner code and only lists the test file's tests
and tiers. The second runs the lab's code and given cells top to bottom
exactly as the kernel would, then runs the tests. A cell that raises ends the
run, reported as the cell and line it raised at. The second run must report
exactly the tests the first listed, with the same tiers, and echo a nonce it
was handed on stdin, or the check counts as broken. Both runs have the
kernel's scrubbed environment (no AI provider variables, API keys or
`PYTEST_*` settings) and Matplotlib's Agg backend.

That stops the casual ways a cell could fake a result. It is not a sandbox:
the learner's cells and the tests share one process, so a determined learner
can still interfere with pytest. The signed report attests that the app ran
the pack's tests on code with that hash, not that the code left them alone.

- **Smoke** checks are visible and run whenever the learner asks. They should
  catch shape and type mistakes ("your circuit has 0 detectors") and never
  say whether the method is right.
- **Hidden** tests run only at Submit. A test marked `@pytest.mark.slip`
  checks an execution detail; every other test is **core**, checking that the
  method is right. Test behaviour and results within honest tolerances rather
  than the shape of the code.

Hidden tests are hidden in the app, not secret: they are files in a folder
the learner can open. That is fine for tests of behaviour, and it is why a
pack's tests belong wherever the pack lives rather than in this repository.

## Submit

Submit runs in the engine's order, and main enforces it:

1. The cells freeze. The saved `lab.py` is copied to
   `submissions/<milestone>-<n>/` and its hash taken, and the hidden tests
   start on that copy in the background.
   The lab's kernel and smoke checks are refused until the seal breaks.
2. The learner writes the explain-back with no result in view (up to 2,000
   characters). The first Submit of a milestone asks the pack's question;
   a later one asks "What failed last time, what did you change, and why
   should that fix it?"
3. The learner answers "How sure are you that the core tests pass?":
   Certain, Pretty sure, Half unsure or Just guessing (keys 1 to 4).
4. Only then does main sign the report and hand over the results. Until the
   pick, a submission goes to the renderer with its results blanked and not
   even marked finished, whatever main already knows. If the app quits
   between the pick and the results, the submission unseals the next time
   the lab opens (as broken, if its run was lost too).
5. When a Certain or Pretty sure pick meets a core failure, the receipt asks
   one more question, "Which assumption do you think broke?", and the answer
   goes to the tutor with the rest. Confident errors are the ones most worth
   correcting at once.

The report is one line under 400 characters:

```
[engram-check v1 lab=my-pack/lab-one m=m1 sub=1 verdict=slip core=2/2 slip=0/1 env=base-4b09c790529a code=9c1e04aa31f2 t=4s at=2026-11-10T09:12:03Z conf=pretty-sure eb=5d1c0e9a77b2 sig=…]
```

`verdict` reads the grading table: `passed` (every core and slip test
passed), `slip` (core passed, a slip test failed), `core` (a core test
failed) or `broken` (the run did not complete). `conf` is the confidence
picked before the results were shown and `eb` the hash of the explain-back,
so neither can be swapped once the learner has seen the results. `sig` is an
HMAC-SHA256 over
the rest of the line, keyed by a secret in `labs/.check-key` that never
leaves the install, so a report the app produced can be told from one typed
by hand. The report names the code only by its hash: the grader never sees
the code. **Copy for the tutor** puts the report, the explain-back and any
reflection on the clipboard as one turn. The receipt reads "tests only ·
explain-back not yet graded": the tests grade the code, and the explanation
is the tutor's to grade. Handing that turn to a tutor session, and the overlay
that teaches the tutor to grade it, come next.

A milestone passes once a submission's core tests all pass. That receipt is
app-side, like the workbench itself: no rating, schedule or stamp reads it.

## Where the learner's work goes

```
<userData>/labs/
  packs.json                                  the pack folders the learner added
  .check-key                                  the report-signing key
  packs/<pack>/<lab>/lab.py, meta.json, results.json   the workbench; the kernel's and the checks' folder
  records/<pack>/<lab>/submissions.json       every Submit, sealed or not
  records/<pack>/<lab>/submissions/<m>-<n>/   the frozen lab.py, the cells and the raw results
  records/<pack>/<lab>/smoke/                 the last smoke run
```

Removing a pack in Settings forgets its folder and stops its labs' kernels.
The learner's work and the pack's runtime layer stay on disk; **Remove
runtime** clears every layer.

## Not yet built

- Predict-the-output items, milestone variants and interleaved review.

- Handing the production to a tutor session, the `read_workbench` bridge
  tool, and the checked-production grading overlay.
- Helper modules a pack's given cells can import.
- Long checks as background jobs. A check runs in main within its time limit
  and keeps going if the learner switches screens, but it stops when the app
  quits; a hidden run cut short that way unseals as broken, to be submitted
  again.
