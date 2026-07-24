/** Incremental NDJSON line splitter — never assume a stdout chunk boundary aligns with a JSON boundary. */
export class NdjsonLineSplitter {
  private buffer = ''

  push(chunk: string): unknown[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    const parsed: unknown[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        parsed.push(JSON.parse(trimmed))
      } catch {
        // Non-JSON stray line (shouldn't happen with --output-format stream-json,
        // but never let a parse failure kill the stream).
      }
    }
    return parsed
  }
}
