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
  /** Local YYYY-MM-DD an optional per-topic deadline the learner set for
   * themselves — "exam mode" (see renderer/src/shared/pressure.ts). Never
   * read by, or written from, anything under `~/.claude/learning`: it drives
   * no scheduling and the engine never sees it. Optional so settings saved
   * before this field existed (and any settings literal that predates it,
   * e.g. LearnSessionView's pending-new-topic write) still satisfy this
   * type — same precedent as `contextFiles` above; `getTopicSettings`'s
   * defensive merge below fills it with `null` on read. */
  targetDate?: string | null
}

const EMPTY: TopicSettings = { systemPromptExtra: '', contextFiles: [], targetDate: null }

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
