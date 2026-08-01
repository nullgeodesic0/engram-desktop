/* Optional licensed typefaces — loaded at runtime from whatever actually
 * exists in `assets/fonts/` at build time. The directory is git-ignored:
 * the commercial faces (Neue Haas Grotesk Display, Epoca Pro) cannot be
 * redistributed in a public repo, so a fresh clone builds with the glob
 * empty and every stack falls back to the bundled open faces the token
 * stacks already name (Space Grotesk, Fraunces, Inter — see index.css).
 * Drop the files in locally and they take over with no code change. */

const FACES: Record<string, { family: string; weight: string; style: string }> = {
  'epocapro-medium.otf': { family: 'EpocaPro', weight: '400 500', style: 'normal' },
  'epocapro-mediumitalic.otf': { family: 'EpocaPro', weight: '400 500', style: 'italic' },
  'NeueHaasDisplayRoman.ttf': { family: 'Neue Haas Grotesk Display Pro', weight: '400', style: 'normal' },
  'NeueHaasDisplayRomanItalic.ttf': { family: 'Neue Haas Grotesk Display Pro', weight: '400', style: 'italic' },
  'NeueHaasDisplayMediu.ttf': { family: 'Neue Haas Grotesk Display Pro', weight: '500', style: 'normal' },
  'NeueHaasDisplayMediumItalic.ttf': { family: 'Neue Haas Grotesk Display Pro', weight: '500', style: 'italic' },
  'NeueHaasDisplayBold.ttf': { family: 'Neue Haas Grotesk Display Pro', weight: '600 700', style: 'normal' },
  'NeueHaasDisplayBoldItalic.ttf': { family: 'Neue Haas Grotesk Display Pro', weight: '600 700', style: 'italic' },
}

const found = import.meta.glob('./assets/fonts/*.{ttf,otf}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

for (const [path, url] of Object.entries(found)) {
  const face = FACES[path.split('/').pop() ?? '']
  if (!face) continue
  const ff = new FontFace(face.family, `url(${url})`, {
    weight: face.weight,
    style: face.style,
  })
  document.fonts.add(ff)
  ff.load().catch(() => {
    /* a corrupt or unreadable file just means the open fallbacks render */
  })
}
