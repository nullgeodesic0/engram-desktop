/** The ask-header contract between the checkpoint overlay and the app.
 *
 * The overlay (plugin-overlays/engram/review-skill.quick-checkpoint-protocol.md,
 * pinned by doctrine D5) mandates the exact header `Checkpoint k/n` on every
 * chain step — headers are the ONLY metadata channel an ask carries (the
 * same idiom as the confidence picker's exact-match 'Confidence' sniff in
 * AskCard). `Confidence` can never collide: AskCard checks it first with an
 * exact match, and 'Checkpoint…' is a disjoint startsWith. */

export interface CheckpointHeader {
  step: number
  total: number
}

const HEADER_RE = /^Checkpoint\s+(\d+)\s*\/\s*(\d+)/

export function isCheckpointHeader(header: string): boolean {
  return header.startsWith('Checkpoint')
}

export function parseCheckpointHeader(header: string): CheckpointHeader | null {
  const m = header.match(HEADER_RE)
  if (!m) return null
  const step = Number(m[1])
  const total = Number(m[2])
  if (!Number.isFinite(step) || !Number.isFinite(total) || step < 1 || total < 1) return null
  return { step, total }
}
