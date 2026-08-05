import type { TopicListEntry } from '../../../shared/types'
import { normalizeFolderName } from './topicFolders'

/**
 * The named-but-possibly-empty folders.
 *
 * Filing itself still lives per-topic (TopicSettings.folder), and the folders
 * that MATTER are still the ones in use — this registry exists for exactly
 * one reason: a folder you just created, or just emptied, has to stay on
 * screen so you can drop something into it. Without it, "New folder" would
 * create something invisible and dragging the last topic out of a folder
 * would make the drop target vanish mid-gesture.
 *
 * So the registry is additive, never authoritative: the effective folder
 * list is `union(names in use, registry)`. That ordering of concerns is what
 * keeps the two stores from being able to disagree in a way the learner
 * would notice — a topic filed into a folder the registry has never heard of
 * still shows its folder (it's in use), and a registry entry whose topics
 * all left still shows (it's registered). Neither can hide the other.
 *
 * localStorage, like the sort/group picks: this is view state about how a
 * list is drawn, it needs no IPC, and losing it costs nothing beyond
 * re-creating an empty folder (every folder with a topic in it survives
 * regardless, because it survives in the topics themselves).
 */

const KEY = 'engram-folder-registry'

export function loadFolderRegistry(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter((n): n is string => typeof n === 'string')
  } catch {
    return []
  }
}

export function saveFolderRegistry(names: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(names))
  } catch {
    // best-effort — an unsaved registry costs an empty folder, never a topic
  }
}

/** Adds a folder name, normalized, refusing duplicates case-insensitively so
 * "Physics" and "physics" can't become two shelves. Returns the new registry
 * (unchanged when the name was empty or already known). */
export function addFolderToRegistry(registry: string[], raw: string): string[] {
  const name = normalizeFolderName(raw)
  if (!name) return registry
  if (registry.some((n) => n.toLowerCase() === name.toLowerCase())) return registry
  return [...registry, name]
}

export function removeFolderFromRegistry(registry: string[], name: string): string[] {
  return registry.filter((n) => n.toLowerCase() !== name.toLowerCase())
}

/** Every folder that should be drawn: in use ∪ registered, alphabetical,
 * de-duplicated case-insensitively (the in-use spelling wins, since that's
 * the one already attached to real topics). */
export function allFolderNames(topics: TopicListEntry[], registry: string[]): string[] {
  const seen = new Map<string, string>()
  for (const t of topics) {
    const name = t.folder?.trim()
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  for (const name of registry) {
    const trimmed = name.trim()
    if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
