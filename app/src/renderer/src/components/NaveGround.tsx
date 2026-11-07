/** The Nave ground: the app's still backdrop, after RaftHad's Nave Folio look
 * (packages/web/src/theme/naveFolio there). It replaces the old NeuralField,
 * a full-window WebGL particle scene that redrew every frame and made every
 * glass panel above it re-blur on each of those frames — the app's idle heat.
 *
 * Everything here is painted once. The only motion is the light shafts'
 * slow sway, a compositor-only CSS animation paused while the window is
 * unfocused (index.css, nf-sway):
 *   - a rough paper ground: one seeded noise tile (assets/grain.png, made by
 *     scripts/make-grain.py), laid twice at two scales;
 *   - three soft diagonal light shafts, the first warm and the third violet
 *     (overview pages only — `[data-shafts="off"]` on <html> hides them while
 *     a transcript is open, so long reading sits on plain paper);
 *   - a faint outline arch in the right-hand gutter, only where the window
 *     is wide enough.
 *
 * No canvas per frame, no filter, no backdrop-filter. Purely
 * decorative: fixed, behind everything, aria-hidden, pointer-events none. */

export function NaveGround() {
  return (
    <div className="nf-ground" aria-hidden="true">
      <b className="nf-bigarch" />
      <i className="nf-shaft s1" />
      <i className="nf-shaft s2" />
      <i className="nf-shaft s3" />
    </div>
  )
}
