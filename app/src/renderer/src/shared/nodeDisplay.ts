/** Node state + date display shared between the Topic Map (node drawer, full-
 * node modal, GrowthScrubber readout) and the Node Table — extracted after
 * both grew byte-identical copies of `stateLabel`/date-formatting (the
 * circular-import reasoning for the original copy was sound — NodeTable is
 * imported BY TopicMapView, so importing back would cycle app/ and
 * components/ — but a shared leaf module both can import solves the same
 * problem without letting the two copies drift). */

/** FSRS node state → the house's own vocabulary for it — never the raw FSRS
 * term ('review' means nothing to a learner as a display word). */
export function stateLabel(state: string): string {
  if (state === 'new') return 'not started'
  if (state === 'learning') return 'encoding'
  return 'consolidated'
}

/** Local YYYY-MM-DD → "Mon d" — parsed without a `Z` suffix so it reads as
 * local midnight rather than shifting a day at UTC-negative offsets. Same
 * local-date discipline as every other due/date comparison in this app (see
 * GraphView's dueStatusFor). Deliberately year-less: every caller today scans
 * a single-topic-or-shorter timeline where the year would only be clutter. */
export function formatMonthDay(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
