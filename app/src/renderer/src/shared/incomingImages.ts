/** Pulling images out of a paste or a drop.
 *
 * The handwriting flow runs on absolute paths — the tutor is handed paths and
 * reads them itself, with no binary transport through the bridge. A file
 * picker gives paths directly, which is why that path existed first. But the
 * way a learner ACTUALLY has a photo of their work is on the clipboard
 * (⌘⇧4, or AirDropped from a phone and copied) or under the cursor mid-drag,
 * and both of those hand the renderer bytes with no path at all.
 *
 * So these two functions answer one question — "are there images here, and
 * which?" — as pure data, and the caller does the byte-to-disk round trip.
 *
 * DELIBERATELY IMAGES-ONLY. Dropping a PDF of the answer key onto the
 * composer must not silently enter a flow whose whole premise is "this is
 * your own handwritten work". Non-images are ignored here and left to the
 * ordinary attachment path, which is what they are for. */

/** The types `dialog:saveIncomingImage` can actually write. Kept in step with
 * that handler's own extension table — a type accepted here but rejected
 * there would fail after the learner had already committed to the gesture. */
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/heic', 'image/heif', 'image/webp', 'image/gif', 'image/tiff'])

export interface IncomingImage {
  file: File
  mime: string
  /** Present for a dropped file; a pasted screenshot usually has none. */
  name: string | null
}

function collect(files: FileList | File[] | null | undefined): IncomingImage[] {
  if (!files) return []
  const out: IncomingImage[] = []
  for (const file of Array.from(files as ArrayLike<File>)) {
    if (!file || !ACCEPTED.has(file.type)) continue
    out.push({ file, mime: file.type, name: file.name || null })
  }
  return out
}

/** Images on a paste. Returns `[]` for an ordinary text paste, which the
 * caller must treat as "do nothing and let the paste proceed" rather than as
 * a failure — swallowing a text paste would break typing. */
export function imagesFromPaste(data: DataTransfer | null): IncomingImage[] {
  if (!data) return []
  // `files` is the reliable surface for a pasted image in Chromium; `items`
  // additionally carries the text/plain flavour that accompanies it, which
  // must not be mistaken for content.
  return collect(data.files)
}

/** Images on a drop, in the order the OS reported them — which for a
 * multi-select drag is the order the learner selected, and therefore the page
 * order the transcription should use. */
export function imagesFromDrop(data: DataTransfer | null): IncomingImage[] {
  if (!data) return []
  return collect(data.files)
}

/** Does this drag carry anything we would accept? Used to decide whether to
 * show the drop affordance at all, so dragging a text selection over the
 * composer doesn't light up a target that would reject it. */
export function dragCarriesImage(data: DataTransfer | null): boolean {
  if (!data) return false
  // During dragover, `files` is empty by design (the payload isn't exposed
  // until drop) — `items` is the only readable surface, and only its `type`.
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && ACCEPTED.has(item.type)) return true
  }
  return false
}
