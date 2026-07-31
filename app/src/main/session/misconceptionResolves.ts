import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

/** App-local provenance for MANUALLY-resolved misconceptions (the ledger's
 * quiet "Mark resolved" path) — deliberately NOT part of engram.py's own
 * schema (never fork the plugin's data model; same principle as
 * topicSettings.ts). The engine's `status`/`resolved_ts` remain the single
 * source of truth for grading — this file is display-only, letting the
 * ledger label which resolves were clicked in the app rather than
 * demonstrated in a sitting. Losing this file loses labels, never state. */

interface ResolveRecord {
  id: string
  resolvedVia: 'manual'
  date: string // local YYYY-MM-DD
}

interface Store {
  version: 1
  resolves: ResolveRecord[]
}

function empty(): Store {
  return { version: 1, resolves: [] }
}

function storePath(): string {
  return join(app.getPath('userData'), 'misconception-resolves.json')
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), 'utf-8'))
    if (parsed && parsed.version === 1 && Array.isArray(parsed.resolves)) return parsed as Store
    return empty()
  } catch {
    return empty()
  }
}

async function write(store: Store): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(storePath(), JSON.stringify(store, null, 2), 'utf-8')
}

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function recordManualResolve(id: string): Promise<void> {
  const store = await read()
  if (store.resolves.some((r) => r.id === id)) return
  store.resolves.push({ id, resolvedVia: 'manual', date: localToday() })
  await write(store)
}

/** id → provenance, for the ledger's "manual" chips. */
export async function getManualResolves(): Promise<Record<string, { date: string }>> {
  const store = await read()
  const out: Record<string, { date: string }> = {}
  for (const r of store.resolves) out[r.id] = { date: r.date }
  return out
}
