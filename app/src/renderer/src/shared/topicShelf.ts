import type { TopicListEntry } from '../../../shared/types'

/**
 * A topic's node counts sort it into exactly one of three states — never
 * zero, never two. `notStarted` and `consolidated` are the two extremes
 * (all-new, all-review); `active` is everything between, which includes a
 * topic that is only mid-encoding with no review nodes yet. Written as an
 * if/else-if/else specifically so the three predicates can never overlap
 * or leave a topic uncategorized, which is what let the old single
 * `states.new > 0 || states.learning > 0` filter silently drop an
 * all-review topic in the first place.
 *
 * Moved verbatim out of HomeView.tsx (was HomeView.tsx:107-113) so Learn's
 * atlas shelf can group the same way Home does — one grouping rule, not two
 * that could quietly drift apart.
 */
export type TopicBucket = 'notStarted' | 'consolidated' | 'active'

export function topicBucket(t: TopicListEntry): TopicBucket {
  if (t.states.review === 0 && t.states.learning === 0) return 'notStarted'
  if (t.states.new === 0 && t.states.learning === 0) return 'consolidated'
  return 'active'
}

/** Only the node states actually present, review-first — so a fully-encoded
 * topic reads as "16 review" instead of a padded "16 review · 0 new", and an
 * actively-encoding one shows its mid-flight `learning` count instead of
 * hiding it (the original card never rendered `states.learning` at all).
 * Unified across Home's tiles and Learn's shelf rows: review-warm,
 * encoding-cool, new-cool-dim, and — only when the topic actually has
 * something due — due-danger, matching Learn's local TopicCard's own
 * hand-rolled due chip (it never went through this function before; Home's
 * `TopicTile` never showed a due chip at all, relying on HealthRing's danger
 * notch alone — this brings both callers onto one chip vocabulary without
 * changing what either currently renders, since Home's forecast/health ring
 * already carries the due signal and its call sites don't ask for the due
 * chip — see TopicCard's `variant` prop). */
export function topicChips(
  t: TopicListEntry,
  opts: { includeFolder?: boolean } = {},
): { label: string; className: string }[] {
  // A fully archived topic (Topic Settings' close-out; every node retired)
  // says so and nothing else — its state counts still exist but reviews
  // never come due, and a row of live-looking chips would misread as an
  // active topic.
  if (t.retired != null && t.nodes > 0 && t.retired >= t.nodes) {
    return [{ label: 'archived', className: 'text-[var(--color-text-faint)]' }]
  }
  const chips: { label: string; className: string }[] = []
  // Filing leads, in the faintest ink — it is context ("where this lives"),
  // read before the state counts rather than competing with them, and it is
  // what makes a topic's folder visible on EVERY surface that draws a topic
  // card, not just the two that group by it. Suppressed by the caller when
  // the surrounding heading already names the folder (see TopicCard's
  // `hideFolderChip`), so a folder group doesn't repeat itself on every row.
  const folder = t.folder?.trim()
  if (folder && opts.includeFolder !== false) {
    chips.push({ label: folder, className: 'text-[var(--color-text-faint)]' })
  }
  if (t.states.review > 0) chips.push({ label: `${t.states.review} review`, className: 'text-[var(--color-ink-warm)]' })
  if (t.states.learning > 0) chips.push({ label: `${t.states.learning} encoding`, className: 'text-[var(--color-ink-cool)]' })
  if (t.states.new > 0) chips.push({ label: `${t.states.new} new`, className: 'text-[var(--color-ink-cool-dim)]' })
  if (t.due > 0) chips.push({ label: `${t.due} due`, className: 'text-[var(--color-ink-danger)]' })
  return chips
}
