#!/usr/bin/env bash
# Builds a throwaway HOME with seeded engram state, a stub `claude`, and a
# Futura stand-in font, so the real Electron app can be screenshotted headless.
# Usage: dev/screenshot-harness/setup.sh /path/to/fakehome
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; H="${1:?fake HOME dir}"
rm -rf "$H"; mkdir -p "$H/.claude/local" "$H/.fonts"
python3 -I "$HERE/seed.py" "$H"
cp "$HERE/fake-claude.mjs" "$H/.claude/local/claude"; chmod +x "$H/.claude/local/claude"
# Optional: Jost renamed "Futura" so label type renders like macOS (needs fonttools+brotli).
if python3 -c 'import fontTools, brotli' 2>/dev/null; then
  T="$(mktemp -d)"; (cd "$T" && npm pack @fontsource/jost@5 >/dev/null 2>&1 && tar xzf fontsource-jost-*.tgz)
  for w in 400 500 600; do python3 - "$T/package/files/jost-latin-$w-normal.woff2" "$H/.fonts/futura-$w.ttf" <<'PY'
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1]); f.flavor = None
for r in f['name'].names:
    if r.nameID in (1, 16): r.string = "Futura"
f.save(sys.argv[2])
PY
  done; HOME="$H" fc-cache -f >/dev/null || true
fi
echo "ready: $H"
