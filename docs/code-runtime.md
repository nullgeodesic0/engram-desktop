# Code runtime and Labs

Engram Desktop can run Python. A learner working through a quantitative
subject needs to build things, simulate them and plot the results, and that
work belongs beside the tutor rather than in a separate notebook app. This
document covers the layer underneath: an app-managed Python environment, made
of runtime layers, and notebook-lite workbenches on the Labs screen. Graded
labs from content packs (smoke checks, hidden tests, an explain-back and a
signed report) build on it; see [content-packs.md](content-packs.md).

## What gets installed, and where

Nothing ships inside the app bundle except three small Python files and the
base layer's lockfile. The first time the learner presses **Install** in
Settings → Code runtime, the app builds everything under its own data folder:

```
<userData>/runtime/
  uv/0.11.32/uv              uv itself, downloaded from its GitHub release
  python/                    a uv-managed CPython 3.12
  cache/                     uv's wheel cache
  locks/<layer>-<hash>.lock  the lockfile each env was built from, copied in first
  envs/<layer>-<hash>/       one venv per layer and lockfile
  state.json                 what is installed, and the cell time limit
```

- **uv** is pinned to 0.11.32. The download is checked against the SHA-256
  that astral-sh publishes for each platform (the sums are in
  `main/runtime/runtimePaths.ts`); a mismatch discards the file.
- **Python** comes from uv's managed builds. uv is told to use only
  interpreters it manages under this root (`UV_PYTHON_PREFERENCE=only-managed`,
  its own `UV_PYTHON_INSTALL_DIR`), so a Python or conda the learner already
  has is never read or changed. `UV_*`, `PYTHONPATH`, `PYTHONHOME`,
  `VIRTUAL_ENV` and `CONDA_PREFIX` are removed from the build's environment.
- **Packages** come in layers, each its own venv from its own universal
  lockfile with hashes for every wheel on every platform, installed with
  `uv pip sync --require-hashes`. The **base** layer ships with the app
  (`app/resources/runtime/base.lock`: NumPy, SciPy, Matplotlib and pytest;
  regenerate it with the command at the top of `base.in`) and serves every
  free-standing workbench. A content pack can bring a layer of its own for its
  labs, with whatever libraries its subject needs; Settings lists it beside
  the base layer with its own **Install** button. One install runs at a time.
- The env directory is named by the layer and the first 12 hex of the
  lockfile's hash. When an app or pack update ships a new lock, the old env
  keeps serving cells and Settings offers **Update**, which builds the new env
  beside it. The old env of that layer is removed at its next install, never
  while a kernel may still be using it.
  An env is complete only once
  `verify_env.py` has imported the core packages and the `.engram-complete`
  marker is written, so an interrupted install is rebuilt rather than trusted.

Platforms: macOS (Apple silicon and Intel), Linux x64 and Windows x64, where
scientific packages publish wheels most reliably. On Windows ARM the app
installs the x64 uv and an x64 Python, which run under Windows' emulation and
use the win_amd64 wheels every pack can count on; this path is untested on
hardware. Linux ARM is refused up front with a plain message instead of
failing a source build. A pack whose libraries publish fewer wheels than that
says so in its own documentation.

An install can be cancelled from Settings; the download of uv times out after
five minutes.

On disk the runtime with the base layer is about 450 MB, most of it the wheel
cache (the venvs hard-link into it) and the Python build; a pack's layer adds
its own libraries. **Remove runtime** in Settings deletes the root, every
layer included, and stops every kernel; workbenches and labs are kept.

## The kernel

`app/resources/runtime/engram_kernel.py` is a deliberately small stand-in for
a Jupyter kernel: one process per open workbench, one shared namespace, JSON
lines on stdio. The docstring at its top lists the protocol. Three details
matter:

- Output from compiled extensions cannot corrupt the protocol. The protocol channel
  is a private duplicate of the original stdout; file descriptors 1 and 2 are
  re-pointed at pipes that are forwarded as `stream` messages. A sync mark
  written through each pipe guarantees every byte printed before a cell's
  value or error has been sent first, so output stays in order.
- `multiprocessing` works. Cells run in a fresh module installed as
  `__main__` with no `__file__`, so a library's spawn-based worker processes
  behave as they do under Jupyter.
- A trailing expression is echoed, Matplotlib figures are sent as SVG and PNG
  after each cell, and errors carry the line in the cell they point at.

`main/runtime/kernel.ts` owns the processes. It starts the interpreter of the
workbench's layer (a pack lab's pack layer, otherwise base) with
`-E -s -u -X utf8`, the workbench folder as the working directory, and a
scrubbed environment: no `ANTHROPIC_*`, `OPENAI_*`, `CLAUDE_*` or other AI
provider variables and no `*_API_KEY`, so a learner's cell cannot call a model
behind a mastery gate (see `scrubbedEnv` in `runtimePaths.ts`). Matplotlib's
cache goes to `runtime/mplconfig`, not the learner's home folder. At most
three kernels stay alive; the least recently used idle one is shut down, and
running a cell there starts it again. The kernel
serializes cells, and enforces the cell time limit from Settings (60 s, 2 min,
10 min or none; 2 min by default). Interrupt sends SIGINT on macOS and Linux,
which surfaces as `KeyboardInterrupt` in the cell and leaves variables intact;
if the cell does not stop within five seconds, the kernel is restarted. On
Windows a piped child cannot receive a console interrupt, so interrupt
restarts the kernel and says so in the cell's output.

## Workbenches

A workbench is a folder in `<userData>/labs/workbenches/<id>/`; a pack lab's
workbench is `labs/packs/<pack>/<lab>/`, with the id `<pack>/<lab>`, holding
the same files plus its submissions:

- `lab.py`, the cells in the percent format that Jupytext, VS Code and Spyder
  read (`# %%` markers, Markdown cells as `# `-prefixed comments). `python
  lab.py` runs the learner's work outside the app, and it diffs cleanly. The
  `id=` tag on each marker is Engram's own and keeps outputs attached to cells
  across saves. A body line that would read as a marker is escaped with one
  more `# ` in front (`# %%` is written `# # %%`), so every cell round-trips.
  See `shared/workbenchFile.ts`.
- `meta.json`, the title and last-saved time.
- `results.json`, each cell's last outputs, so a reopened workbench shows what
  it last showed. Past 8 MB, figures keep only their PNG.

Cells are `code` (the learner's), `note` (Markdown with math) or `given`
(read-only scaffolding a content pack supplies). Shift+Enter runs a cell
and moves on; Ctrl/Cmd+Enter runs it in place. Edits save themselves 0.7 s
after they stop. A scratch workbench always exists.

Kernel events are recorded by one app-wide listener in the renderer
(`renderer/src/shared/kernelSession.ts`), so a cell that finishes while its
workbench is off screen keeps its outputs, and **Run all** keeps going.

Not yet built: a `figures/` folder of saved SVG and PNG files, and Export as
`.ipynb`. Both arrive with the portfolio. A cell's `input()`
gets end-of-file at once, since the kernel's stdin is the protocol channel.
Output a background thread prints after its cell has finished is shown under
whichever cell runs next.

## Doctrine

None of this is learning state. No rating, receipt, schedule or stamp reads a
workbench or the runtime, and nothing here names the learning home.

- `main/runtime/envManager.ts`, `main/runtime/kernel.ts` and
  `main/labs/checkRunner.ts` are pinned subprocess doors (D1). The first runs
  only the pinned uv, `tar` to unpack it, and an env interpreter on
  `verify_env.py`; the second runs only an env interpreter on the kernel file;
  the third runs only an env interpreter on `engram_check.py`. None runs
  `engram.py`.
- `main/runtime/envManager.ts`, `main/runtime/workbenchStore.ts`,
  `main/labs/packStore.ts` and `main/labs/labStore.ts` are pinned writers
  (D2), all to app userData. A content pack's own folder is only ever read.

The learner's own code runs with the learner's permissions, as any script
they run in a terminal would. The app does not sandbox it; it only keeps it
in a process and a folder of its own.
