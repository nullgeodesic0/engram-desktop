import type { TopicListEntry } from '../../../shared/types'

/**
 * The library's topic writes, shared by Learn's library and the Topic Map's
 * rail so both file, rename and restore a topic the same way. Each one
 * read-modify-writes the settings record rather than rebuilding it, so
 * filing or renaming can never clobber a topic's instructions or context
 * files. Callers refresh their own topic list afterwards.
 */

export async function fileTopics(topicIds: string[], folder: string | null): Promise<void> {
  for (const id of topicIds) {
    const current = await window.engram.getTopicSettings(id)
    await window.engram.setTopicSettings(id, { ...current, folder })
  }
}

/** The display-name override (TopicSettings.displayTitle): presentational
 * only, the engine's title and the topic id never change. An empty or
 * engine-identical name clears the override. */
export async function renameTopicDisplay(t: TopicListEntry, raw: string): Promise<void> {
  const name = raw.trim()
  const engineTitle = t.engineTitle ?? t.title
  const current = await window.engram.getTopicSettings(t.topic)
  await window.engram.setTopicSettings(t.topic, { ...current, displayTitle: name && name !== engineTitle ? name : null })
}

/** Puts every node of an archived topic back on its schedule (the engine's
 * own `retire --topic --restore`). */
export async function restoreTopic(t: TopicListEntry): Promise<void> {
  await window.engram.retireTopic(t.topic, true)
}
