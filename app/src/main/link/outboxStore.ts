import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseOutboxItem, type OutboxItem } from '../../shared/linkProtocol'

/**
 * Durable landing zone for whatever the phone has queued.
 *
 * An **append-only JSONL log**, not a rewritten JSON document, and the shape
 * is load-bearing rather than stylistic. The phone retries a batch whenever
 * the link flaps, so the same item arrives more than once as a matter of
 * routine; and this file is written at exactly the moments a laptop lid is
 * likely to close. Append-only gives both properties cheaply: a torn trailing
 * line costs the one record being written instead of the whole queue, and a
 * crash between "received" and "drained" replays as a duplicate rather than
 * as a loss.
 *
 * Two record kinds share the log: `item` (evidence arrived) and `drained`
 * (evidence handed to a session). Draining appends a tombstone rather than
 * removing the item, so a replay after a drain is still recognised as a
 * duplicate — otherwise a phone that never got its acknowledgement would
 * re-queue evidence the learner already paid for, and the schedule would
 * count it twice.
 *
 * Nothing here rates, stamps, or touches `~/.claude/learning/`. This is a
 * queue; the Mac's live session is what turns its contents into a receipt.
 */

export interface OutboxStoreDeps {
  /** Injected so the grace window is testable without waiting half an hour. */
  now?: () => number
  /** Absolute path to the log. Parent directories are created on demand. */
  filePath: string
}

export interface AppendResult {
  accepted: number
  duplicates: number
}

export interface InFlightItem {
  item: OutboxItem
  /** When the sitting that took it started, ISO. */
  startedAt: string
}

export interface OutboxStore {
  /** Appends every previously-unseen item. Returns how many were new. */
  append(items: OutboxItem[]): Promise<AppendResult>
  /** Items waiting for a session: never handed off, or handed to a sitting
   * that has since had long enough to produce a receipt and did not. */
  pending(): Promise<OutboxItem[]>
  /** Handed to a sitting that is still plausibly working on it. */
  inFlight(): Promise<InFlightItem[]>
  /** Handed to a sitting that has since had long enough and written nothing.
   * These are already back in `pending`; this exists so the drain can REPORT
   * that they are retries rather than quietly re-sending them. */
  staleInFlight(): Promise<OutboxItem[]>
  /** Records that a sitting has taken these items. NOT the same as done —
   * see the state note below. */
  markInFlight(ids: string[], startedAt: string): Promise<void>
  /** Marks items settled. Permanent: only a receipt earns this. */
  markDrained(ids: string[]): Promise<void>
}

/**
 * ## Three states, because two lost work
 *
 * An item used to go straight from pending to drained the moment a sitting
 * STARTED. That reads as careful — it is strictly later than marking on
 * enqueue — and it is still wrong: starting a session is not the same as it
 * producing a receipt. A sitting that crashed, was closed, or simply never
 * rated left the learner's evidence marked handled with nothing in the record
 * to show for it, and no way to notice.
 *
 * So: `pending` → `inflight` → `drained`, and only a receipt earns the last
 * step. An in-flight item is invisible to `pending` while its sitting could
 * still be working, and reappears if the grace passes with nothing written.
 * The failure mode is now a repeat, which the append path already dedupes,
 * instead of a silent loss.
 */
const IN_FLIGHT_GRACE_MS = 30 * 60_000

type LogRecord =
  | { kind: 'item'; item: unknown }
  | { kind: 'inflight'; id: string; at: string }
  | { kind: 'drained'; id: string }

interface LogState {
  order: string[]
  items: Map<string, OutboxItem>
  drained: Set<string>
  /** Latest handoff time per id. A retry overwrites the earlier one, so a
   * second attempt gets its own grace rather than inheriting a spent one. */
  inflight: Map<string, string>
}

/** Reads the log, skipping any record that does not parse.
 *
 * A skipped record is nearly always the torn tail of an interrupted append,
 * which is exactly the case this format exists to survive. It is deliberately
 * silent rather than throwing: refusing to open a queue because its last line
 * is half-written would turn a one-record loss into a total one. */
async function readLog(filePath: string): Promise<LogState> {
  const state: LogState = {
    order: [],
    items: new Map(),
    drained: new Set(),
    inflight: new Map(),
  }
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch {
    return state
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: LogRecord
    try {
      record = JSON.parse(line) as LogRecord
    } catch {
      continue
    }
    if (record.kind === 'drained' && typeof record.id === 'string') {
      state.drained.add(record.id)
      continue
    }
    if (record.kind === 'inflight' && typeof record.id === 'string' && typeof record.at === 'string') {
      state.inflight.set(record.id, record.at)
      continue
    }
    if (record.kind !== 'item') continue
    const item = parseOutboxItem(record.item)
    if (!item || state.items.has(item.id)) continue
    state.items.set(item.id, item)
    state.order.push(item.id)
  }
  return state
}

/** True when the log's last write was interrupted before its newline landed.
 *
 * Appending straight onto a torn tail would fuse the new record to the
 * fragment and lose BOTH — turning a one-record crash into an ongoing one,
 * since every later append inherits the damage. Healing the tail first costs
 * one byte and confines the loss to the record that was actually interrupted. */
async function endsMidLine(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return raw.length > 0 && !raw.endsWith('\n')
  } catch {
    return false
  }
}

async function appendRecords(filePath: string, records: LogRecord[]): Promise<void> {
  if (records.length === 0) return
  await mkdir(dirname(filePath), { recursive: true })
  const heal = (await endsMidLine(filePath)) ? '\n' : ''
  await appendFile(filePath, heal + records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8')
}

export function createOutboxStore(deps: OutboxStoreDeps): OutboxStore {
  const { filePath } = deps
  const now = deps.now ?? (() => Date.now())

  /** Latest handoff per id, and whether it is still within its grace. */
  function stillWorking(startedAt: string | undefined): boolean {
    if (startedAt === undefined) return false
    const began = Date.parse(startedAt)
    if (Number.isNaN(began)) return false
    return now() - began < IN_FLIGHT_GRACE_MS
  }

  return {
    async append(items) {
      const state = await readLog(filePath)
      const fresh: OutboxItem[] = []
      const seen = new Set<string>()
      let duplicates = 0
      for (const item of items) {
        if (state.items.has(item.id) || seen.has(item.id)) {
          duplicates += 1
          continue
        }
        seen.add(item.id)
        fresh.push(item)
      }
      await appendRecords(
        filePath,
        fresh.map((item) => ({ kind: 'item', item })),
      )
      return { accepted: fresh.length, duplicates }
    },

    async pending() {
      const state = await readLog(filePath)
      return state.order
        .filter((id) => !state.drained.has(id) && !stillWorking(state.inflight.get(id)))
        .map((id) => state.items.get(id)!)
    },

    async inFlight() {
      const state = await readLog(filePath)
      return state.order
        .filter((id) => !state.drained.has(id) && stillWorking(state.inflight.get(id)))
        .map((id) => ({ item: state.items.get(id)!, startedAt: state.inflight.get(id)! }))
    },

    async staleInFlight() {
      const state = await readLog(filePath)
      return state.order
        .filter(
          (id) =>
            !state.drained.has(id) &&
            state.inflight.has(id) &&
            !stillWorking(state.inflight.get(id)),
        )
        .map((id) => state.items.get(id)!)
    },

    async markInFlight(ids, startedAt) {
      await appendRecords(
        filePath,
        ids.map((id) => ({ kind: 'inflight', id, at: startedAt })),
      )
    },

    async markDrained(ids) {
      await appendRecords(
        filePath,
        ids.map((id) => ({ kind: 'drained', id })),
      )
    },
  }
}
