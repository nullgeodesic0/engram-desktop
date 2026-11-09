"""Engram Desktop's check runner: loads a frozen lab and runs a pack's pytest
file against it. Started by main/labs/checkRunner.ts, in a fresh process on
the lab's runtime layer, so a check always runs from a clean interpreter
rather than from whatever the learner's kernel holds.

    python -I -B engram_check.py          (the job arrives as one JSON line on stdin)

The job: {"mode": "smoke" | "hidden" | "collect", "cells": "<cells.json>",
"tests": "<tests.py>", "out": "<out.json>", "nonce": "<hex>"}

cells.json  the lab's runnable cells in order, [{"id": "c1", "source": "..."}]
tests.py    the pack's test file; each test takes the `lab` fixture
out.json    written at the end: {"nonce", "completed": bool, "error": str|null,
            "tests": [{"id", "name", "about", "tier", "outcome", "message"}],
            "seconds": float}

"collect" loads no learner code at all: it only lists the file's tests, so
main can check that a real run reported exactly those tests.

The cells run top to bottom in a fresh module installed as __main__ with no
__file__, exactly as the kernel runs them, so multiprocessing behaves the
same way in a check as in the workbench (spawn-based pools cannot pickle
functions defined in cells there either). A cell that raises ends the run:
nothing after it was defined, so no test could say anything useful.

Test tiers: in a smoke run every test is smoke. In a hidden run a test marked
@pytest.mark.slip is a slip test (an execution detail) and every other test
is core (the method is right). A test's docstring, first line, is the
description the learner sees while the milestone is still open.

What this does not do: make the result tamper-proof. The learner's code runs
in this process with the learner's permissions, so a determined learner can
interfere with pytest. The job's path and nonce come over stdin and the
writer is captured before any cell runs, which stops the casual forgeries
(writing out.json, patching json.dump); main also cross-checks the test list
against a run that loaded no learner code. The signed report attests that
the app ran the check, not that nobody tampered with it.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
import types

MAX_MESSAGE = 400


# Captured before any learner code runs, so a cell that rebinds them cannot
# change what the runner writes.
_dumps = json.dumps
_os_open, _os_write, _os_close = os.open, os.write, os.close
_O_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_BINARY", 0)


def _write(path: str, payload: dict) -> None:
    fd = _os_open(path, _O_FLAGS, 0o600)
    try:
        _os_write(fd, _dumps(payload).encode("utf-8"))
    finally:
        _os_close(fd)


def _load_cells(cells: list) -> tuple[types.ModuleType | None, str | None]:
    main = types.ModuleType("__main__")
    main.__dict__["__builtins__"] = __builtins__
    sys.modules["__main__"] = main
    for i, cell in enumerate(cells, start=1):
        source = cell.get("source", "")
        try:
            code = compile(source, f"<cell {i}>", "exec")
            exec(code, main.__dict__)
        except BaseException as e:  # noqa: BLE001 - the learner's code may raise anything
            line = None
            for frame in traceback.extract_tb(e.__traceback__):
                if frame.filename == f"<cell {i}>":
                    line = frame.lineno
            if isinstance(e, SyntaxError) and e.filename == f"<cell {i}>":
                line = e.lineno
            where = f"cell {i}" + (f", line {line}" if line else "")
            return None, f"Your {where} raised {type(e).__name__}: {str(e)[:200]}"
    return main, None


def _short(report) -> str:
    text = getattr(report, "longreprtext", "") or ""
    lines = [ln[1:].strip() for ln in text.splitlines() if ln.startswith("E ")]
    # pytest's "+  where ..." lines spell out the learner's objects; the first lines say enough.
    lines = [ln for ln in lines if ln and not ln.startswith("+")]
    if not lines:
        lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()][-3:]
    out = "\n".join(lines[:6])
    return out if len(out) <= MAX_MESSAGE else out[: MAX_MESSAGE - 1] + "…"


class _Collector:
    def __init__(self, lab: types.ModuleType, mode: str) -> None:
        self.lab = lab
        self.mode = mode
        self.tests: dict[str, dict] = {}
        self.collect_error: str | None = None

    def pytest_configure(self, config) -> None:
        config.addinivalue_line("markers", "slip: an execution detail rather than the method")
        config.addinivalue_line("markers", "core: the method is right (the default)")

    def _tier(self, item) -> str:
        if self.mode == "smoke":
            return "smoke"
        return "slip" if item.get_closest_marker("slip") else "core"

    def pytest_collection_modifyitems(self, items) -> None:
        for item in items:
            doc = (getattr(getattr(item, "function", None), "__doc__", None) or "").strip()
            self.tests[item.nodeid] = {
                "id": item.nodeid,
                "name": item.name,
                "about": doc.splitlines()[0][:200] if doc else "",
                "tier": self._tier(item),
                "outcome": "error",
                "message": "did not run",
            }

    def pytest_collectreport(self, report) -> None:
        if report.failed:
            self.collect_error = "The pack's test file could not be loaded: " + _short(report)

    def pytest_runtest_logreport(self, report) -> None:
        t = self.tests.get(report.nodeid)
        if t is None:
            return
        if report.when == "call" or (report.when == "setup" and not report.passed):
            if report.passed:
                t["outcome"], t["message"] = "passed", ""
            elif report.skipped:
                t["outcome"], t["message"] = "skipped", ""
            else:
                t["outcome"] = "failed" if report.when == "call" else "error"
                t["message"] = _short(report)
        elif report.when == "teardown" and report.failed and t["outcome"] == "passed":
            t["outcome"], t["message"] = "error", _short(report)


def main() -> int:
    job = json.loads(sys.stdin.readline())
    mode, out_path, nonce, tests_path = job["mode"], job["out"], job["nonce"], job["tests"]
    cells_path = job.get("cells")
    del job
    started = time.monotonic()

    def finish(completed: bool, error: str | None, tests: list) -> int:
        _write(
            out_path,
            {
                "nonce": nonce,
                "completed": completed,
                "error": error,
                "tests": tests,
                "seconds": round(time.monotonic() - started, 2),
            },
        )
        return 0

    # Like the kernel: files saved beside lab.py import by name.
    if os.getcwd() not in sys.path:
        sys.path.insert(0, os.getcwd())

    import pytest

    lab = None
    if mode != "collect":
        with open(cells_path, encoding="utf-8") as f:
            cells = json.load(f)
        lab, error = _load_cells(cells)
        if lab is None:
            return finish(False, error, [])

    collector = _Collector(lab, "hidden" if mode == "collect" else mode)
    # pytest reads fixtures from a plugin module's attributes.
    fixtures = types.ModuleType("engram_lab_fixture")
    fixtures.lab = pytest.fixture(scope="session", name="lab")(lambda: collector.lab)

    args = [
        tests_path,
        "-q",
        "-p",
        "no:cacheprovider",
        "--no-header",
        "-o",
        "addopts=",
        "-W",
        "ignore::pytest.PytestAssertRewriteWarning",
    ]
    if mode == "collect":
        args.append("--collect-only")
    try:
        pytest.main(args, plugins=[collector, fixtures])
    except BaseException as e:  # noqa: BLE001
        return finish(False, f"pytest could not run: {type(e).__name__}: {e}", list(collector.tests.values()))
    if collector.collect_error:
        return finish(False, collector.collect_error, [])
    if not collector.tests:
        return finish(False, "The pack's test file holds no tests.", [])
    return finish(True, None, list(collector.tests.values()))


if __name__ == "__main__":
    sys.exit(main())
