import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { NotifierSettings } from '../../shared/types'

interface NotifierState extends NotifierSettings {
  // Dedup bookkeeping for the periodic auto-check — see reviewNotifier.ts.
  lastNotifiedAt: string | null
  lastSignature: string | null
}

const DEFAULTS: NotifierState = {
  remindersEnabled: true,
  cadenceMinutes: 30,
  lastNotifiedAt: null,
  lastSignature: null,
}

function statePath(): string {
  return join(app.getPath('userData'), 'notifier-state.json')
}

async function read(): Promise<NotifierState> {
  try {
    return { ...DEFAULTS, ...JSON.parse(await readFile(statePath(), 'utf-8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

async function write(state: NotifierState): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(statePath(), JSON.stringify(state, null, 2), 'utf-8')
}

export async function getNotifierSettings(): Promise<NotifierSettings> {
  const { remindersEnabled, cadenceMinutes } = await read()
  return { remindersEnabled, cadenceMinutes }
}

export async function setNotifierSettings(patch: Partial<NotifierSettings>): Promise<NotifierSettings> {
  const state = await read()
  const next = { ...state, ...patch }
  await write(next)
  return { remindersEnabled: next.remindersEnabled, cadenceMinutes: next.cadenceMinutes }
}

export async function getNotifiedSignature(): Promise<{ lastNotifiedAt: string | null; lastSignature: string | null }> {
  const { lastNotifiedAt, lastSignature } = await read()
  return { lastNotifiedAt, lastSignature }
}

export async function recordNotified(signature: string): Promise<void> {
  const state = await read()
  await write({ ...state, lastNotifiedAt: new Date().toISOString(), lastSignature: signature })
}
