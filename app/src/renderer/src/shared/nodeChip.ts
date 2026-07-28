import { humanizeNodeId } from '../../../shared/humanizeId'
import { nodeGlyphBlobPath } from './inkNodeGlyph'

/** Marks every element this hook's delegated click listener should treat as
 * "navigate to this node" — read by `useNodeChipClick.ts`. Exported so the
 * hook and the HTML builder can never disagree about the attribute name. */
export const NODE_CHIP_ATTR = 'data-node-chip'
export const NODE_CHIP_TOPIC_ATTR = 'data-topic-id'
export const NODE_CHIP_NODE_ATTR = 'data-node-id'

const CHIP_GLYPH_SIZE = 14

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Tailwind utility classes, not a bespoke `.node-chip` CSS rule — reusing
// ActionChips' own exact "quiet chip" language (rounded-full, hairline
// border, faint text warming to ink-warm on hover, `--dur-fast`) rather than
// inventing a second chip visual style. `inline-flex` (not `flex`) so it
// sits correctly mid-paragraph; `align-middle` keeps its baseline from
// dropping the surrounding text line.
const CHIP_CLASS =
  'node-chip focus-ring inline-flex items-center gap-1 align-middle rounded-full border border-[var(--color-hairline)] px-2 py-0.5 mx-0.5 text-[0.85em] leading-none text-[var(--color-text-faint)] hover:text-[var(--color-ink-warm)] hover:border-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-fast)] cursor-pointer'

/** The chip's own static HTML — a real `<button>` (not a `<span
 * role="button">`) specifically so Enter/Space activation dispatches a real
 * `click` event with zero extra keyboard-handling code; `useNodeChipClick.ts`
 * only ever needs to listen for `click`. The glyph is the exact same
 * deterministic-per-id blob `<InkNode variant="outlined">` draws elsewhere in
 * this app (shared/inkNodeGlyph.ts) — "faint node glyph" per the spec is
 * this app's OWN node glyph, not a new symbol. `type="button"` defensively,
 * even though chat prose is never inside a `<form>` today. */
export function nodeChipHtml(topicId: string, nodeId: string): string {
  const r = CHIP_GLYPH_SIZE / 2 - 2
  const d = nodeGlyphBlobPath(nodeId, r)
  const label = humanizeNodeId(nodeId)
  return (
    `<button type="button" class="${CHIP_CLASS}" ${NODE_CHIP_ATTR}="1" ` +
    `${NODE_CHIP_TOPIC_ATTR}="${escapeAttr(topicId)}" ${NODE_CHIP_NODE_ATTR}="${escapeAttr(nodeId)}" ` +
    `title="Open on the Topic Map">` +
    `<svg width="${CHIP_GLYPH_SIZE}" height="${CHIP_GLYPH_SIZE}" viewBox="0 0 ${CHIP_GLYPH_SIZE} ${CHIP_GLYPH_SIZE}" aria-hidden="true" class="shrink-0 opacity-70">` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.2"/>` +
    `</svg>` +
    `<span>${escapeText(label)}</span>` +
    `</button>`
  )
}
