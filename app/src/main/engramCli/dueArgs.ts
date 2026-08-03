/** Pure argv builders for the two shapes of `engram.py due` — extracted from
 * the IPC handler so the mapping is unit-testable without ipcMain.
 *
 * `--limit` is the original most-overdue-first bare list (what the mid-session
 * queue refresh wants). `--cap` is the v1.3 triage read: the engine returns
 * `{order, order_basis, cap, n, items}` ranked by expected retention saved
 * per expected minute — what the ready plate's time picker wants, because its
 * "covers about N of M" caption must reflect the order the sitting will
 * actually work. Both are actions of the `due` command, which is allowlisted
 * read-only in its entirety (readOnly.ts, pinned by D1) — no new command, no
 * re-pin. */
export function buildDueArgs(opts: { limit?: number; topic?: string }): string[] {
  const args: string[] = []
  if (opts.limit != null) args.push('--limit', String(opts.limit))
  if (opts.topic) args.push('--topic', opts.topic)
  return args
}

export function buildDueCappedArgs(cap: number, topic?: string): string[] {
  const args = ['--cap', String(cap)]
  if (topic) args.push('--topic', topic)
  return args
}
