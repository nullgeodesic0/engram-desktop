/** Local-only record of the last few nodes and sittings the user opened, for
 * the command palette's empty-query state and Home's quiet "Recently viewed"
 * row. Ring buffer in localStorage — the engine knows nothing about this,
 * nothing here ever affects grades or scheduling. Same "renderer-local,
 * decorative, not app state" framing as calibrationStore.ts: losing it costs
 * nothing. */

export interface RecentNodeView {
  kind: 'node'
  topic: string
  node: string
  /** Humanized node name — what the row/command actually shows as its label. */
  label: string
  /** The topic's display title, shown as the row's subtitle/hint. */
  topicTitle: string
  ts: number
}

export interface RecentSittingView {
  kind: 'sitting'
  sessionId: string
  /** Pre-formatted "Learn · <topic title>" / "Review" tag — same shape as
   * SessionHistoryDrawer's own historyRowTag, computed at record time since
   * this list outlives any single drawer instance. */
  label: string
  ts: number
}

export type RecentView = RecentNodeView | RecentSittingView

const KEY = 'engram-recently-viewed'
const MAX = 8

function load(): RecentView[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as RecentView[]) : []
  } catch {
    return []
  }
}

/** Identity for dedup: topic+node for a node view, sessionId for a sitting —
 * the two kinds never collide even if a raw id string happened to match,
 * since the kind tag is part of the key. Structural type (not RecentView
 * itself) so this also accepts a fresh entry that hasn't been stamped with
 * `ts` yet. */
function identity(v: Pick<RecentNodeView, 'kind' | 'topic' | 'node'> | Pick<RecentSittingView, 'kind' | 'sessionId'>): string {
  return v.kind === 'node' ? `node:${v.topic}:${v.node}` : `sitting:${v.sessionId}`
}

/** Records a view, moving an existing entry with the same identity to the
 * front instead of duplicating it — most-recent-wins on re-view. Ring-buffered
 * at 8, newest first. */
export function recordView(entry: Omit<RecentNodeView, 'ts'> | Omit<RecentSittingView, 'ts'>): void {
  const views = load()
  const id = identity(entry)
  const next = [{ ...entry, ts: Date.now() } as RecentView, ...views.filter((v) => identity(v) !== id)].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Full/blocked storage just means no recency list — never let it break navigation.
  }
}

export function recentViews(): RecentView[] {
  return load()
}
