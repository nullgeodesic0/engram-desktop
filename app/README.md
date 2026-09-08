# Engram Desktop

A custom desktop app for the Engram learning loop. Sessions can use an existing Claude Code or OpenAI Codex/ChatGPT subscription; switching providers preserves the same local learning data, UI bridge, and history.

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

- Claude Code or OpenAI Codex installed and signed in to the subscription selected in Settings.
- The Engram engine, bundled in packaged builds and also discovered from Claude/Codex plugin caches.

The app checks the selected provider on launch and shows provider-specific setup instructions when needed. Codex subscription mode accepts only a ChatGPT login and strips ambient API credentials.
