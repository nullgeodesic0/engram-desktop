import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

/**
 * Per-topic app-local customization — deliberately NOT part of engram.py's own
 * schema (never fork the plugin's data model; extend additively via
 * --append-system-prompt instead, same principle as the MCP bridge). Lives in
 * this app's own userData dir, keyed by topic id.
 */
export interface TopicSettings {
  /** Free-text appended to the session's system prompt whenever this topic is
   * being taught — e.g. "Use LaTeX ($...$/$$...$$) for all equations." */
  systemPromptExtra: string
  /** Absolute paths the model is told to Read at the start of every fresh session for
   * this topic (a syllabus, reference PDF, etc.) — see sessionHandlers.ts's spawn(). */
  contextFiles: string[]
}

const EMPTY: TopicSettings = { systemPromptExtra: '', contextFiles: [] }

function settingsPath(): string {
  return join(app.getPath('userData'), 'topic-settings.json')
}

async function readAll(): Promise<Record<string, TopicSettings>> {
  try {
    return JSON.parse(await readFile(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

async function writeAll(all: Record<string, TopicSettings>): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(all, null, 2), 'utf-8')
}

export async function getTopicSettings(topicId: string): Promise<TopicSettings> {
  const all = await readAll()
  // Defensive merge — settings saved before `contextFiles` existed lack the field.
  return { ...EMPTY, ...all[topicId] }
}

export async function setTopicSettings(topicId: string, settings: TopicSettings): Promise<void> {
  const all = await readAll()
  all[topicId] = settings
  await writeAll(all)
}
