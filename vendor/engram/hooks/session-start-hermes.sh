#!/usr/bin/env bash
# Engram re-anchor hook for Hermes Agent.
# Two modes, auto-detected:
#   hook mode (stdin carries Hermes' pre_llm_call JSON payload): emit
#     {"context": "<nudge>"} once per session, {} on every other call.
#     Register in ~/.hermes/config.yaml:
#       hooks:
#         pre_llm_call:
#           - command: "/path/to/engram/hooks/session-start-hermes.sh"
#             timeout: 15
#   plain mode (stdin empty — e.g. `hermes cron create --no-agent --script …`):
#     print the nudge as plain text (nothing when nothing is due).
# On Hermes, /learn is the built-in skill-authoring command, so the nudge's
# "/learn" is rewritten to "/skill learn" in both modes.
# Contract (Constitution art. 8): ambient, never nagging — at most one nudge
# per session, and on ANY failure degrade to silence, never to repetition.
set -u
command -v python3 >/dev/null 2>&1 || { printf '{}\n'; exit 0; }

payload="$(cat - 2>/dev/null || true)"

emit_nudge() {  # prints the rewritten nudge (empty when nothing is due)
  python3 "$ROOT/scripts/engram.py" session-start 2>/dev/null | sed 's|/learn|/skill learn|g' || true
}

# Engine resolution: env override, else self-resolve from this script's location.
ROOT="${ENGRAM_ROOT:-}"
if [ -z "$ROOT" ] || [ ! -f "$ROOT/scripts/engram.py" ]; then
  ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd)"
fi
[ -f "$ROOT/scripts/engram.py" ] || { [ -n "$payload" ] && printf '{}\n'; exit 0; }

# Plain mode: no stdin payload (cron --no-agent, manual run). No JSON, no dedupe
# (each scheduled run SHOULD deliver); stdout goes to the delivery target verbatim.
if [ -z "$payload" ]; then
  emit_nudge
  exit 0
fi

# Hook mode. Dedupe key: the sanitized session id; if extraction fails, fall back
# to the parent (Hermes) PID so the guard fails CLOSED — at most one nudge per
# Hermes process — never open (one per LLM call).
session_id="$(printf '%s' "$payload" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("session_id") or "")
except Exception: print("")' 2>/dev/null | tr -c 'A-Za-z0-9_-' '_' | cut -c1-80)" || session_id=""
[ -n "$session_id" ] || session_id="pid-${PPID:-0}"

marker="${TMPDIR:-/tmp}/engram-nudge-${session_id}"
if [ -e "$marker" ]; then printf '{}\n'; exit 0; fi
# Unwritable marker dir → we could not remember having nudged, so stay silent:
# silence over repetition, per the contract.
if ! { : > "$marker"; } 2>/dev/null; then printf '{}\n'; exit 0; fi

out="$(emit_nudge)"
if [ -n "$out" ]; then
  printf '%s' "$out" | python3 -c 'import sys,json; print(json.dumps({"context": sys.stdin.read().strip()}))' 2>/dev/null || printf '{}\n'
else
  printf '{}\n'
fi
exit 0
