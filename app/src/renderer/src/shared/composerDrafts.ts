/** Per-node drafts of a production in progress.
 *
 * Losing a half-written recall answer is the most expensive failure this app
 * can have. The learner has already done the retrieval — the hard part, the
 * part the whole system exists to cause — and re-typing it does not re-earn
 * that, it only costs them the sitting's momentum. Nothing persisted the
 * composer before this, so navigating away mid-answer discarded it silently.
 *
 * Keyed by NODE, not by session: the same node probed again should offer back
 * what you were writing, and two topics in one sitting must never share a
 * draft. Stored in localStorage, which is renderer-local and touches neither
 * the learning home nor any engine state — a draft is not a production until
 * it is sent, and the app must never be the thing that files one.
 *
 * Cleared on submit, never on mount: a restored draft that vanished because a
 * view re-rendered would be the same bug wearing a different hat. */

const PREFIX = 'engram:draft:'
/** Older than this is almost certainly abandoned, and restoring it into a
 * fresh sitting would confuse rather than help. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface DraftKey {
  /** 'learn' | 'review' — the same node in the two loops is two contexts. */
  surface: string
  topic: string | null
  node: string | null
}

interface StoredDraft {
  text: string
  at: number
}

/** Null when the key isn't specific enough to be safe. A draft saved under a
 * null node would be restored into whatever came next, which is worse than
 * not saving at all. */
export function draftKey(key: DraftKey): string | null {
  if (!key.topic || !key.node) return null
  return `${PREFIX}${key.surface}:${key.topic}:${key.node}`
}

export function saveDraft(key: DraftKey, text: string): void {
  const k = draftKey(key)
  if (!k) return
  try {
    // An emptied box is a deletion, not an entry — otherwise clearing it
    // would leave a tombstone that restores as empty forever.
    if (text.trim().length === 0) {
      localStorage.removeItem(k)
      return
    }
    localStorage.setItem(k, JSON.stringify({ text, at: Date.now() } satisfies StoredDraft))
  } catch {
    // Storage full or unavailable: a draft is a convenience, never a
    // precondition for answering.
  }
}

export function loadDraft(key: DraftKey, now: number = Date.now()): string | null {
  const k = draftKey(key)
  if (!k) return null
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    if (typeof parsed?.text !== 'string' || typeof parsed?.at !== 'number') return null
    if (now - parsed.at > MAX_AGE_MS) {
      localStorage.removeItem(k)
      return null
    }
    return parsed.text.length > 0 ? parsed.text : null
  } catch {
    return null
  }
}

export function clearDraft(key: DraftKey): void {
  const k = draftKey(key)
  if (!k) return
  try {
    localStorage.removeItem(k)
  } catch {
    /* see saveDraft */
  }
}
