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
      "timeLimitS": 600
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

### starter.py

The learner's copy of a lab is made from the starter the first time the lab
opens, in the percent format the workbench uses (`# %% [given] id=…`,
`# %% id=…`, `# %% [markdown] id=…`; see `shared/workbenchFile.ts`). Given
cells are the pack's: read-only in the workbench, and refreshed from the
starter by id each time the lab opens, so a fixed given cell reaches a lab
already under way. Give every cell a stable `id`.

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
    slope, _ = lab.fit_line([0.0, 1.0], [0.0, 2.0])
    assert type(slope) is float
```

Each run starts a fresh interpreter on the lab's layer
(`resources/runtime/engram_check.py`), runs the lab's code and given cells top
to bottom exactly as the kernel would, then runs the test file. A cell that
raises ends the run, reported as the cell and line it raised at. The run has
the kernel's scrubbed environment (no AI provider variables or API keys) and
Matplotlib's Agg backend.

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
2. The learner writes the explain-back with no result in view (up to 2,000
   characters).
3. The learner picks a confidence: Certain, Pretty sure, Half unsure or Just
   guessing.
4. Only then does main hand over the results and the signed report. Until
   the pick, a submission goes to the renderer with its results blanked,
   whatever main already knows.

The report is one line under 400 characters:

```
[engram-check v1 lab=my-pack/lab-one m=m1 sub=1 verdict=slip core=2/2 slip=0/1 env=base-4b09c790529a code=9c1e04aa31f2 t=4s at=2026-11-10T09:12:03Z sig=…]
```

`verdict` reads the grading table: `passed` (every core and slip test
passed), `slip` (core passed, a slip test failed), `core` (a core test
failed) or `broken` (the run did not complete). `sig` is an HMAC-SHA256 over
the rest of the line, keyed by a secret in `labs/.check-key` that never
leaves the install, so a report the app produced can be told from one typed
by hand. The report names the code only by its hash: the grader never sees
the code. **Copy for the tutor** puts the report and the explain-back on the
clipboard as one turn. Handing that turn to a tutor session, and the overlay
that teaches the tutor to grade it, come next.

A milestone passes once a submission's core tests all pass. That receipt is
app-side, like the workbench itself: no rating, schedule or stamp reads it.

## Where the learner's work goes

```
<userData>/labs/
  packs.json                                  the pack folders the learner added
  .check-key                                  the report-signing key
  packs/<pack>/<lab>/lab.py, meta.json, results.json
  packs/<pack>/<lab>/submissions.json         every Submit, sealed or not
  packs/<pack>/<lab>/submissions/<m>-<n>/     the frozen lab.py, the cells and the raw results
  packs/<pack>/<lab>/.checks/smoke/           the last smoke run
```

Removing a pack in Settings forgets its folder and stops its labs' kernels.
The learner's work and the pack's runtime layer stay on disk; **Remove
runtime** clears every layer.

## Not yet built

- Handing the production to a tutor session, the `read_workbench` bridge
  tool, and the checked-production grading overlay.
- Helper modules a pack's given cells can import.
- Long checks as background jobs. A check runs in main within its time limit
  and keeps going if the learner switches screens, but it stops when the app
  quits; a hidden run cut short that way unseals as broken, to be submitted
  again.
