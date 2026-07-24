# Engram Desktop

A custom desktop app for the [Engram](https://github.com) Claude Code learning plugin. Scripts the `claude` CLI directly — every session rides your existing Claude subscription, never a billed API key.

## Development

```bash
npm install
npm run dev        # Electron + hot reload
npm run typecheck
npm run build       # production build to out/
```

## Packaging (macOS)

```bash
npm run icons        # regenerate build/icon.icns from build/icon.svg (macOS-only)
npm run dist:mac      # builds + packages a .dmg and .zip into dist/
```

This produces an **unsigned** build — there's no Apple Developer account behind it, so macOS Gatekeeper will refuse to open it with a normal double-click ("Engram Desktop is damaged and can't be opened" or "cannot be opened because the developer cannot be verified"). To run it anyway:

1. Open the `.dmg`, drag **Engram Desktop** into `/Applications`.
2. **Right-click** (or Control-click) the app in Finder → **Open** → confirm **Open** in the dialog. A plain double-click will not offer this option — it must be a right-click the first time.
3. After that first right-click-Open, it launches normally (double-click included) going forward.

If step 2 still refuses, macOS may have quarantined the download; clear it from a terminal:

```bash
xattr -cr "/Applications/Engram Desktop.app"
```

## Requirements

- The [Engram plugin](https://github.com) installed under `~/.claude/plugins/cache/engram`.
- The `claude` CLI installed and logged in (`claude.ai/code`).

The app checks both on launch and shows a setup screen with specifics if either is missing — see `src/main/session/claudeResolver.ts` for how it locates `claude` even when launched outside a terminal (Finder/Dock/Spotlight don't inherit a login shell's `PATH`, which is where `claude` is usually actually installed).
