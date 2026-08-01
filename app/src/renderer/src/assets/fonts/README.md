# Licensed typefaces (bring your own)

The app's first-choice faces are commercial and cannot be redistributed here:

- **Neue Haas Grotesk Display Pro** (display) — `NeueHaasDisplayRoman.ttf`, `NeueHaasDisplayRomanItalic.ttf`, `NeueHaasDisplayMediu.ttf`, `NeueHaasDisplayMediumItalic.ttf`, `NeueHaasDisplayBold.ttf`, `NeueHaasDisplayBoldItalic.ttf`
- **Epoca Pro** (serif) — `epocapro-medium.otf`, `epocapro-mediumitalic.otf`

If you own licenses, drop the files into this directory with those exact
names and rebuild — `../../fonts.ts` registers whatever it finds. Without
them the app renders on its bundled open fallbacks (Space Grotesk, Fraunces,
Inter) plus macOS system Futura, and everything still works.
