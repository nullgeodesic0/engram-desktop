export interface SessionUsage {
  usedTokens: number
  contextWindow: number
}

interface ResultLine {
  type?: string
  usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  modelUsage?: Record<string, { contextWindow?: number }>
}

/**
 * Same extraction SessionManager applies live to each `result` NDJSON line (see its
 * 'result' handler) — replayed here against a transcript's *last* result line, so a
 * resumed session's context gauge can initialize immediately from real history instead
 * of waiting for the next turn to complete. A brand-new session has no prior result
 * line and correctly gets `null` — there's nothing to report until its first turn ends.
 */
export function extractLastUsageFromTranscript(rawLines: unknown[]): SessionUsage | null {
  const lines = rawLines as ResultLine[]
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.type !== 'result' || !line.usage || !line.modelUsage) continue
    const contextWindow = Object.values(line.modelUsage)[0]?.contextWindow
    if (!contextWindow) continue
    const { input_tokens = 0, cache_creation_input_tokens = 0, cache_read_input_tokens = 0 } = line.usage
    return { usedTokens: input_tokens + cache_creation_input_tokens + cache_read_input_tokens, contextWindow }
  }
  return null
}
