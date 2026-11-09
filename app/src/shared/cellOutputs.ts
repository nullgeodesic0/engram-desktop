import type { CellOutput } from './runtime'

/** Largest single stream chunk kept in a cell's outputs; the rest is elided. */
export const MAX_OUTPUT_CHARS = 200_000

/**
 * Appends an output to a cell's list, merging consecutive chunks of the same
 * stream so a loop that prints a thousand lines stays one block, and capping
 * the merged text so a runaway print cannot exhaust the renderer.
 */
export function appendOutput(outputs: CellOutput[], next: CellOutput): CellOutput[] {
  const last = outputs[outputs.length - 1]
  if (next.type === 'stream' && last?.type === 'stream' && last.name === next.name) {
    if (last.text.length >= MAX_OUTPUT_CHARS) return outputs
    let text = last.text + next.text
    if (text.length > MAX_OUTPUT_CHARS) text = text.slice(0, MAX_OUTPUT_CHARS) + '\n… output truncated\n'
    return [...outputs.slice(0, -1), { ...last, text }]
  }
  return [...outputs, next]
}
