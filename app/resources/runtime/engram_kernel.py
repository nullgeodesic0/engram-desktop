"""Engram Desktop's notebook kernel.

A deliberately small stand-in for a Jupyter kernel: one process, one shared
namespace, JSON lines on stdio. The app (main/runtime/kernel.ts) writes one
request per line on stdin and reads one message per line on the protocol
channel. Nothing here talks to the network, the learning home or the engine.

Requests  {"id": 3, "op": "exec", "cell": "c2", "code": "..."}
          {"id": 4, "op": "vars"}
          {"id": 5, "op": "ping"}
Messages  {"type": "ready", "python": "3.12.13", "packages": {...}}
          {"id": 3, "type": "stream", "name": "stdout", "text": "..."}
          {"id": 3, "type": "value", "text": "repr of the last expression"}
          {"id": 3, "type": "figure", "svg": "<svg ...", "png": "<base64>"}
          {"id": 3, "type": "error", "ename": "...", "evalue": "...",
           "traceback": ["..."], "line": 7}
          {"id": 3, "type": "done", "ok": true, "ms": 41}

Interrupts arrive as SIGINT (POSIX) and surface as KeyboardInterrupt inside
the running cell, which is reported as an error and leaves the namespace
intact. Timeouts are the app's job: it sends SIGINT when a cell's limit runs
out.

Design notes that are easy to get wrong:

* The protocol channel is a private duplicate of the original stdout. File
  descriptors 1 and 2 are then pointed at pipes whose reader threads forward
  everything as "stream" messages, so output from C extensions (BLAS, a
  stray print in a compiled library) can never corrupt the protocol.
* Cells run in a fresh module installed as sys.modules['__main__'], with no
  __file__. multiprocessing's spawn start method (macOS and Windows default,
  and what most parallel samplers use) then treats the parent as interactive and does not
  re-run this file in each worker, exactly as it behaves under Jupyter. The
  `if __name__ == "__main__"` guard at the bottom still matters for any
  worker that does import this file.
"""

from __future__ import annotations

import ast
import base64
import codecs
import builtins
import io
import json
import os
import signal
import sys
import threading
import time
import traceback
import types

PROTOCOL_VERSION = 1
MAX_STREAM_CHUNK = 8192
MAX_REPR = 4000
FIGURE_DPI = 110
# The app names the packages worth reporting on the command line (a content
# pack's layer lists its own); these are the base layer's.
WATCHED_PACKAGES = tuple(a for a in sys.argv[1:] if a) or ("numpy", "scipy", "matplotlib")

_proto_lock = threading.Lock()
_proto = None  # the protocol channel, set up in main()
_current_id = None  # id of the request whose output is being produced


def send(msg: dict) -> None:
    line = json.dumps(msg, ensure_ascii=False)
    with _proto_lock:
        _proto.write(line + "\n")
        _proto.flush()


SYNC_MARK = b"\x1eENGRAM-SYNC\x1e"
_sync_events = {1: threading.Event(), 2: threading.Event()}


def _forward(fd: int, std_fd: int, name: str) -> None:
    """Forward everything written to `fd` as stream messages.

    A sync mark written by _sync() is stripped out and sets that stream's
    event, which is how the kernel knows every byte written before the mark
    has been sent. Bytes are buffered just enough to never split a mark.
    """
    pending = b""
    # Incremental, so a multi-byte character split across two reads survives.
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    with os.fdopen(fd, "rb", buffering=0) as src:
        while True:
            chunk = src.read(MAX_STREAM_CHUNK)
            if not chunk:
                text = decoder.decode(pending, final=True)
                if text:
                    send({"id": _current_id, "type": "stream", "name": name, "text": text})
                return
            pending += chunk
            while True:
                i = pending.find(SYNC_MARK)
                if i < 0:
                    break
                if i:
                    text = decoder.decode(pending[:i])
                    if text:
                        send({"id": _current_id, "type": "stream", "name": name, "text": text})
                pending = pending[i + len(SYNC_MARK):]
                _sync_events[std_fd].set()
            # Keep a tail that could be the start of a mark; send the rest.
            keep = 0
            for k in range(min(len(SYNC_MARK) - 1, len(pending)), 0, -1):
                if SYNC_MARK.startswith(pending[-k:]):
                    keep = k
                    break
            out, pending = (pending[:-keep], pending[-keep:]) if keep else (pending, b"")
            if out:
                text = decoder.decode(out)
                if text:
                    send({"id": _current_id, "type": "stream", "name": name, "text": text})


def _sync(timeout: float = 2.0) -> None:
    """Block until everything written to fds 1 and 2 so far has been forwarded."""
    _flush_std()
    for fd, ev in _sync_events.items():
        ev.clear()
        os.write(fd, SYNC_MARK)
    for ev in _sync_events.values():
        ev.wait(timeout)


def _redirect_std_fds() -> None:
    """Point fds 1 and 2 at pipes, keeping a private copy of the original stdout."""
    global _proto
    proto_fd = os.dup(1)
    _proto = io.TextIOWrapper(io.FileIO(proto_fd, "wb", closefd=True), encoding="utf-8", line_buffering=False)
    for fd, name in ((1, "stdout"), (2, "stderr")):
        r, w = os.pipe()
        os.dup2(w, fd)
        os.close(w)
        threading.Thread(target=_forward, args=(r, fd, name), daemon=True).start()
    # Python-level streams, unbuffered enough that print() order matches what the learner expects.
    sys.stdout = io.TextIOWrapper(io.FileIO(1, "wb", closefd=False), encoding="utf-8", line_buffering=True, write_through=True)
    sys.stderr = io.TextIOWrapper(io.FileIO(2, "wb", closefd=False), encoding="utf-8", line_buffering=True, write_through=True)


def _new_main_module() -> types.ModuleType:
    mod = types.ModuleType("__main__", "Engram notebook namespace")
    mod.__dict__["__builtins__"] = builtins
    sys.modules["__main__"] = mod
    return mod


def _package_versions() -> dict:
    out = {}
    try:
        from importlib import metadata
    except ImportError:  # pragma: no cover - 3.8+ always has it
        return out
    for name in WATCHED_PACKAGES:
        try:
            out[name] = metadata.version(name)
        except Exception:
            pass
    return out


def _split_last_expression(code: str, filename: str):
    """Compile a cell so that a trailing expression is evaluated and echoed, notebook style."""
    tree = ast.parse(code, filename=filename, mode="exec")
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = tree.body.pop()
        body = compile(tree, filename, "exec") if tree.body else None
        expr = compile(ast.Expression(last.value), filename, "eval")
        return body, expr
    return compile(tree, filename, "exec"), None


def _emit_figures() -> None:
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    try:
        nums = list(plt.get_fignums())
    except Exception:
        return
    for num in nums:
        fig = plt.figure(num)
        svg_buf, png_buf = io.StringIO(), io.BytesIO()
        try:
            fig.savefig(svg_buf, format="svg", bbox_inches="tight")
            fig.savefig(png_buf, format="png", dpi=FIGURE_DPI, bbox_inches="tight")
        except Exception as exc:  # a broken figure is the cell's problem, reported, never fatal
            send({"id": _current_id, "type": "stream", "name": "stderr", "text": f"[figure {num} could not be saved: {exc}]\n"})
            continue
        send({
            "id": _current_id,
            "type": "figure",
            "svg": svg_buf.getvalue(),
            "png": base64.b64encode(png_buf.getvalue()).decode("ascii"),
        })
    plt.close("all")


def _error_message(exc: BaseException, filename: str) -> dict:
    tb = traceback.extract_tb(exc.__traceback__)
    # Drop this file's own frames; keep the cell and anything it called.
    frames = [f for f in tb if f.filename != __file__]
    cell_lines = [f.lineno for f in frames if f.filename == filename]
    lines = traceback.format_list(frames) + traceback.format_exception_only(type(exc), exc)
    return {
        "type": "error",
        "ename": type(exc).__name__,
        "evalue": str(exc)[:MAX_REPR],
        "traceback": lines,
        "line": cell_lines[-1] if cell_lines else getattr(exc, "lineno", None) if isinstance(exc, SyntaxError) else None,
    }


def _flush_std() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:
            pass


def run_cell(ns: dict, req: dict) -> None:
    filename = f"<cell {req.get('cell', '?')}>"
    started = time.monotonic()
    ok = True
    try:
        body, expr = _split_last_expression(req.get("code", ""), filename)
        if body is not None:
            exec(body, ns)
        if expr is not None:
            value = eval(expr, ns)
            if value is not None:
                text = repr(value)
                if len(text) > MAX_REPR:
                    text = text[:MAX_REPR] + " …"
                _sync()
                send({"id": _current_id, "type": "value", "text": text})
    except BaseException as exc:  # KeyboardInterrupt and SystemExit included: they end the cell, not the kernel
        ok = False
        _sync()
        send({"id": _current_id, **_error_message(exc, filename)})
    _sync()
    _emit_figures()
    send({"id": _current_id, "type": "done", "ok": ok, "ms": int((time.monotonic() - started) * 1000)})


def list_vars(ns: dict) -> list:
    out = []
    for name, value in ns.items():
        if name.startswith("_") or isinstance(value, types.ModuleType) or name == "__builtins__":
            continue
        try:
            text = repr(value)
        except Exception:
            text = "<unrepresentable>"
        out.append({"name": name, "type": type(value).__name__, "repr": text[:200]})
    return out


def main() -> None:
    global _current_id
    os.environ.setdefault("MPLBACKEND", "Agg")
    _redirect_std_fds()
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, signal.default_int_handler)
    # Like Jupyter: modules saved in the working directory (the workbench folder) import by name.
    if os.getcwd() not in sys.path:
        sys.path.insert(0, os.getcwd())
    ns = _new_main_module().__dict__
    stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
    # The protocol owns the real stdin. A cell that calls input() gets EOF at
    # once instead of hanging on a channel nothing will ever write to.
    sys.stdin = io.StringIO("")
    send({
        "type": "ready",
        "protocol": PROTOCOL_VERSION,
        "python": ".".join(str(p) for p in sys.version_info[:3]),
        "executable": sys.executable,
        "packages": _package_versions(),
    })
    while True:
        try:
            line = stdin.readline()
        except KeyboardInterrupt:  # an interrupt that lands between cells is a no-op
            continue
        if not line:
            return
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            send({"type": "protocol_error", "text": "request is not JSON"})
            continue
        _current_id = req.get("id")
        op = req.get("op")
        try:
            if op == "exec":
                run_cell(ns, req)
            elif op == "vars":
                send({"id": _current_id, "type": "vars", "vars": list_vars(ns)})
            elif op == "ping":
                send({"id": _current_id, "type": "pong"})
            else:
                send({"id": _current_id, "type": "protocol_error", "text": f"unknown op {op!r}"})
        except KeyboardInterrupt:
            send({"id": _current_id, "type": "done", "ok": False, "ms": 0})
        finally:
            _current_id = None


if __name__ == "__main__":
    main()
