/**
 * Collapses a burst of identical reads into one.
 *
 * ## Why
 *
 * Opening a review on the phone was slow enough to read as broken — "I press
 * on review topics and nothing opens" — and the cause was fan-out, not any one
 * slow call. Every engine read costs 100–155ms (a Python process), and the
 * phone's menu triggers a lot of them:
 *
 *   · the overview asks `walkableFor` for EVERY topic;
 *   · `walkableFor` asks whether each pack has been graded since it was
 *     written, and that question read the entire receipts history — once per
 *     pack, eleven times over;
 *   · opening a review then spawns `due` twice more, once to narrow the packs
 *     and once for the probe queue.
 *
 * None of those reads can see each other, so the same file was parsed a dozen
 * times inside one second to answer one question.
 *
 * ## Why a TTL and not the record stamp
 *
 * `recordStamp` exists and would be the exact invalidation key — but reading
 * it is itself a stat over the receipts directory, and the thing being fixed
 * is too many reads. A couple of seconds is far below the interval at which a
 * receipt can appear (a sitting takes minutes) and far above the burst this
 * exists to collapse, so it buys the whole win with no staleness a person
 * could observe.
 *
 * Deliberately NOT a long cache. Anything that outlives a single interaction
 * is a correctness problem wearing a performance costume: the desk writes
 * receipts continuously, and a phone told about them a minute late is the same
 * class of bug as the caches the record stamp was added to drop.
 */

const TTL_MS = 2_000

interface Entry {
  at: number
  value: Promise<unknown>
}

const entries = new Map<string, Entry>()

export function memoRead<T>(key: string, read: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = entries.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.value as Promise<T>
  const value = read()
  entries.set(key, { at: now, value })
  // A failed read must not be remembered: the next caller would get the same
  // rejection for two seconds without ever touching the thing that failed.
  void value.catch(() => entries.delete(key))
  return value
}

/** For tests, and for anything that knows the record just moved. */
export function clearReadMemo(): void {
  entries.clear()
}
