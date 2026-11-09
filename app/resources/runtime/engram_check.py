"""Engram Desktop's check runner: loads a frozen lab and runs a pack's pytest
file against it. Started by main/labs/checkRunner.ts, once per check, in a
fresh process on the lab's runtime layer, so a check always runs from a clean
interpreter rather than from whatever the learner's kernel holds.

    python -I -B engram_check.py <cells.json> <tests.py> <smoke|hidden> <out.json>

cells.json  the lab's runnable cells in order, [{"id": "c1", "source": "..."}]
tests.py    the pack's test file; each test takes the `lab` fixture
out.json    written at the end: {"completed": bool, "error": str|null,
            "tests": [{"name", "tier", "outcome", "message"}], "seconds": float}

The cells run top to bottom in a fresh module installed as __main__ with no
__file__, exactly as the kernel runs them, so multiprocessing behaves the
same way in a check as in the workbench. A cell that raises ends the run:
nothing after it was defined, so no test could say anything useful.

Test tiers: in a smoke run every test is smoke. In a hidden run a test marked
@pytest.mark.slip is a slip test (an execution detail) and every other test
is core (the method is right).
"""

from __future__ import annotations

import json
import sys
import time
import traceback
import types

MAX_MESSAGE = 400


def _write(path: str, payload: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)


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
            self.tests[item.nodeid] = {
                "name": item.name,
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
    cells_path, tests_path, mode, out_path = sys.argv[1:5]
    started = time.monotonic()

    def finish(completed: bool, error: str | None, tests: list) -> int:
        _write(out_path, {"completed": completed, "error": error, "tests": tests, "seconds": round(time.monotonic() - started, 2)})
        return 0

    with open(cells_path, encoding="utf-8") as f:
        cells = json.load(f)
    lab, error = _load_cells(cells)
    if lab is None:
        return finish(False, error, [])

    import pytest

    collector = _Collector(lab, mode)

    @pytest.fixture(scope="session")
    def lab():
        return collector.lab

    # pytest reads fixtures from a plugin module's attributes.
    fixtures = types.ModuleType("engram_lab_fixture")
    fixtures.lab = lab

    args = [tests_path, "-q", "-p", "no:cacheprovider", "--no-header", "-o", "addopts=", "-W", "ignore::pytest.PytestAssertRewriteWarning"]
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
