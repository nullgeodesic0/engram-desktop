# Screenshot harness

Runs the real Electron app headless against seeded engram state, for design
reviews and before/after screenshots. Nothing here ships; it never touches your
real `~/.claude`.

```bash
cd app && npx electron-vite build
dev/screenshot-harness/setup.sh /tmp/engram-fakehome
S=/tmp/engram-fakehome/.. OUT=/tmp/shots xvfb-run -a -s "-screen 0 1600x1000x24" node dev/screenshot-harness/capture.cjs
```

- `seed.py` creates three topics through the vendored `engram.py` (`add-topic`,
  then back-dated `rate` calls via `ENGRAM_TODAY`) so every view has real,
  engine-produced data.
- `fake-claude.mjs` is installed as `~/.claude/local/claude` in the fake HOME.
  It answers `--version` and speaks Claude Code's stream-json protocol with a
  short canned tutor dialogue, so Learn sessions render a live transcript.
- `capture.cjs` screenshots Home, Learn, Topic Map, Coach and a session.
  Set `CSS=file.css` (and/or `JS=file.js`) to inject a prototype before each
  shot, which is how design mockups are made against the live app.
  It expects the fake HOME at `$S/fakehome`.
