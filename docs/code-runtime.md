# Code runtime and Labs

Engram Desktop can run Python. A learner working through quantum error
correction needs to build circuits in Stim, decode them with PyMatching, and
plot threshold curves, and that work belongs beside the tutor rather than in a
separate notebook app. This document covers the first layer of that support:
an app-managed Python environment and notebook-lite workbenches on the Labs
screen. Graded labs (hidden tests and an explain-back) build on it next.

## What gets installed, and where

Nothing ships inside the app bundle except two small files and a lockfile.
The first time the learner presses **Install** in Settings → Code runtime, the
app builds everything under its own data folder:

```
<userData>/runtime/
  uv/0.11.32/uv              uv itself, downloaded from its GitHub release
  python/                    a uv-managed CPython 3.12
  cache/                     uv's wheel cache
  envs/qec-core-<hash>/      the venv, one per lockfile
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
- **Packages** come from `app/resources/runtime/qec-core.lock`, a universal
  lockfile with hashes for every wheel on every platform, installed with
  `uv pip sync --require-hashes`. The core layer is Stim, sinter, PyMatching,
  ldpc, NumPy, SciPy, Matplotlib, QuTiP and pytest. Regenerate the lock with
  the command at the top of `qec-core.in`.
- The env directory is named by the first 12 hex of the lockfile's hash. When
  an app update ships a new lock, the old env keeps serving cells and Settings
  offers **Update**, which builds the new env beside it. The old env is removed
  at the next install after that, never while a kernel may still be using it.
  An env is complete only once
  `verify_env.py` has imported the core packages and the `.engram-complete`
  marker is written, so an interrupted install is rebuilt rather than trusted.

Platforms: macOS (Apple silicon and Intel), Linux x64 and Windows x64. Stim
and PyMatching publish no Linux ARM or Windows ARM wheels. On Windows ARM the
app installs the x64 uv and an x64 Python, which run under Windows' emulation
and use the win_amd64 wheels; this path is untested on hardware. Linux ARM is
refused up front with a plain message instead of failing a C++ source build.

An install can be cancelled from Settings; the download of uv times out after
five minutes.

On disk the whole runtime is about 650 MB, most of it the wheel cache (the
venv hard-links into it). **Remove runtime** in Settings deletes the root and
stops every kernel; workbenches are kept.

## The kernel

`app/resources/runtime/engram_kernel.py` is a deliberately small stand-in for
a Jupyter kernel: one process per open workbench, one shared namespace, JSON
lines on stdio. The docstring at its top lists the protocol. Three details
matter:

- Output from C extensions cannot corrupt the protocol. The protocol channel
  is a private duplicate of the original stdout; file descriptors 1 and 2 are
  re-pointed at pipes that are forwarded as `stream` messages. A sync mark
  written through each pipe guarantees every byte printed before a cell's
  value or error has been sent first, so output stays in order.
- `multiprocessing` works. Cells run in a fresh module installed as
  `__main__` with no `__file__`, so sinter's worker processes behave as they
  do under Jupyter.
- A trailing expression is echoed, Matplotlib figures are sent as SVG and PNG
  after each cell, and errors carry the line in the cell they point at.

`main/runtime/kernel.ts` owns the processes. It starts the env's interpreter
with `-E -s -u -X utf8`, the workbench folder as the working directory, and a
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

A workbench is a folder in `<userData>/labs/workbenches/<id>/` (course labs
will sit beside them as `labs/<course>/<lab>/`):

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
(read-only scaffolding that lab packs will supply). Shift+Enter runs a cell
and moves on; Ctrl/Cmd+Enter runs it in place. Edits save themselves 0.7 s
after they stop. A scratch workbench always exists.

Kernel events are recorded by one app-wide listener in the renderer
(`renderer/src/shared/kernelSession.ts`), so a cell that finishes while its
workbench is off screen keeps its outputs, and **Run all** keeps going.

Not yet built: a `figures/` folder of saved SVG and PNG files, and Export as
`.ipynb`. Both arrive with lab packs and the portfolio. A cell's `input()`
gets end-of-file at once, since the kernel's stdin is the protocol channel.
Output a background thread prints after its cell has finished is shown under
whichever cell runs next.

## Doctrine

None of this is learning state. No rating, receipt, schedule or stamp reads a
workbench or the runtime, and nothing here names the learning home.

- `main/runtime/envManager.ts` and `main/runtime/kernel.ts` are pinned
  subprocess doors (D1). The first runs only the pinned uv, `tar` to unpack it,
  and the env interpreter on `verify_env.py`; the second runs only the env
  interpreter on the kernel file. Neither runs `engram.py`.
- `main/runtime/envManager.ts` and `main/runtime/workbenchStore.ts` are pinned
  writers (D2), both to app userData.

The learner's own code runs with the learner's permissions, as any script
they run in a terminal would. The app does not sandbox it; it only keeps it
in a process and a folder of its own.
