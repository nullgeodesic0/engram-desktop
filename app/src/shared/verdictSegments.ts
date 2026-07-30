/** Verdict Anatomy — functional segmentation of a tutor's post-grade reply
 * into presentation-only parts: the canonical answer reveal, the tutor's own
 * `Rating **x**`/`Confidence:` declarations, and the schedule/growth line the
 * GradeResultCard already states as structured data. Nothing here touches
 * grading, rubrics, or the learning loop itself — this module only decides
 * how already-graded prose gets diced into pieces for presentation, never
 * what those pieces MEAN.
 *
 * DOCTRINE NOTE (checkDoctrine's D4 answer-leak scan): that scan greps
 * source text for a dot or destructured/shorthand access on three lowercase
 * field names — the expected-answer fields a probe's node carries (the
 * word "claim", the word "rubric", and "transfer underscore probe"), which
 * must never reach the learner before their production is graded. This
 * module never reads a node at all (it only parses the TUTOR'S OWN already-
 * graded reply text), and its own field for the canonical-answer reveal
 * segment is deliberately named `canonical`, never that first forbidden
 * word — so it can never accidentally satisfy that grep. The regex family
 * below matches the literal CAPITALIZED word "Claim" as one of the marker
 * synonyms a tutor might write ("Claim:", the same word the skill's own
 * rubric vocabulary uses when narrating a reveal) — that is prose the
 * TUTOR generated after grading, not a field read off a node, and the
 * capitalized spelling never forms the dotted/braced lowercase substrings
 * the scan looks for. Zero re-pins expected from this file.
 *
 * Architecture: intra-message text structure, following the
 * `parseBeatSegments -> segment render` pattern in beatLabelParser.ts /
 * ChatMessageView.tsx (NOT the marks/atIndex system) — a pure function of a
 * message's own text, called identically by the live view and by transcript
 * replay, so parity holds by construction rather than by two independently
 * maintained code paths agreeing to agree.
 *
 * A 50-verdict survey of every real /review transcript on this machine
 * established the ground truth this module is built against (see
 * `.superpowers/sdd/verdict-wave-1-report.md` for the corpus scan that
 * verified it): verdict body sits BEFORE the `rate` tool call in 21/50
 * sittings and AFTER in 29/50; verdicts span >=2 messages in 41/50; the
 * only high-precision anchors are the schedule-line family, the
 * `Canonical:`/`Reveal:`/`Claim:` marker, and `Rating **x**` declarations.
 * Gap-analysis interiors, rubric-item phrasing, meta-observations, and
 * praise codas are corpus-certified hopeless — they stay prose forever, by
 * design, not by omission.
 */

import type { ChatMessage } from './chatMessages'
import type { GradeResult } from './gradeResult'
import { lapseReturnDate } from './gradeResult'
import { nextProbeHeaderAt } from './reviewCrossing'
import { splitAroundProbeHeader } from './probeHeader'

// ===========================================================================
// Segment types
// ===========================================================================

/** Plain, unstructured text — the default for anything the corpus survey
 * declared hopeless (gap-analysis interiors, rubric phrasing, meta-
 * observations, praise codas, blockquoted probe text) and for anything a
 * fenced code block ever contains, verdict-adjacent or not. */
export interface ProseSegment {
  kind: 'prose'
  raw: string
}

/** A block-initial canonical-answer reveal — `Canonical:`, `Reveal:`, or
 * `Claim:` (the tutor's own word choice; skills vary), 100%-precision,
 * 34%-recall per the corpus survey (most sessions never use one of these
 * three literal openers even when they do reveal the answer in prose). */
export interface CanonicalSegment {
  kind: 'canonical'
  /** The tutor's own marker word, verbatim — 'Canonical' | 'Reveal' | 'Claim'
   * — carried through so rendering can show the tutor's actual language
   * rather than a paraphrase (see CanonicalPlate, a later wave). */
  marker: string
  /** Everything after the marker and its colon, trimmed. */
  body: string
  raw: string
}

/** The tutor's own `Rating **good**` — the loop's own grade language,
 * verbatim, never recomputed. */
export interface RatingSegment {
  kind: 'rating'
  rating: GradeResult['rating']
  raw: string
}

/** `Confidence: certain (90).` — the tutor's own echo of the confidence pick
 * collected earlier in the exchange (never the pick's original collection,
 * which happens before feedback and is out of scope here). */
export interface ConfidenceSegment {
  kind: 'confidence'
  /** Everything between "Confidence:" and the end of that first clause,
   * verbatim — e.g. "certain (90)", "pretty sure (70)". */
  band: string
  raw: string
}

/** Every fact a schedule-family paragraph can state, independently —
 * a paragraph can carry more than one (e.g. a growth pair AND a return
 * date in the same sentence). Every field is `null`/`false` when this
 * paragraph's clauses never stated it — never guessed, never defaulted. */
export interface ScheduleFacts {
  /** "Back in N days" / "Next in N days" -> N. */
  intervalDays: number | null
  /** "Back tomorrow" — tracked separately from `intervalDays` since the
   * tutor's own phrasing said "tomorrow", not "in 1 days"; still checked
   * against a receipt's interval rounding to 1 (see `scheduleMatchesReceipt`). */
  tomorrow: boolean
  /** The tutor's own literal date/weekday phrase — "Jul 24", "Tuesday",
   * "late September" — never resolved to a real calendar date here (this
   * module has no wall-clock); `scheduleMatchesReceipt` resolves it against
   * an explicit anchor. */
  dateText: string | null
  /** First number of a growth pair ("~N -> ~M" or "from ~N days to ~M"). */
  sBefore: number | null
  /** Second number of a growth pair. */
  sAfter: number | null
  /** "Next due" / "due back" / "parked until" appeared, independent of
   * whatever numeric/date facts (if any) were also captured above. */
  dueMarker: boolean
}

/** A schedule/growth paragraph — the one segment kind that can be
 * (conditionally) suppressed on screen, since the GradeResultCard already
 * states the same fact structurally (see `shouldSuppressSchedule`). Never
 * suppressed in exports (`sittingToMarkdown`/`sittingToPrintHtml` keep
 * every byte) — only the screen dedupes, deliberately. */
export interface ScheduleSegment {
  kind: 'schedule'
  facts: ScheduleFacts
  /** True iff the ENTIRE paragraph is schedule-family clauses plus
   * connective filler and nothing else — the only shape eligible for
   * suppression. False means the paragraph OPENS with a schedule clause but
   * continues into real, non-connective prose (a "growth-line-as-opener" —
   * the plan's original 50-verdict survey found 6/50; a fuller re-scan of
   * this machine's whole corpus at implementation time found 9/36 schedule
   * paragraphs in this shape, see `.superpowers/sdd/verdict-wave-1-report.md`
   * — fused judgment + numbers, e.g. "Back in 2 days. Two left — both from
   * the Lenin topic.") — always kept visible in full. */
  bare: boolean
  raw: string
}

export type VerdictSegment = ProseSegment | CanonicalSegment | RatingSegment | ConfidenceSegment | ScheduleSegment

/** A `report_verdict` bridge-tool call's payload — the tutor's OWN advance
 * declaration of an upcoming paragraph's role, carrying its exact text
 * verbatim. Exists to raise this module's corpus-measured 34% recall on
 * canonical/confidence paragraphs: the marker-word regexes above are
 * 100%-precision but miss the other 66% of real verdicts, where the tutor
 * reveals the answer or echoes confidence without ever writing the literal
 * word "Canonical:"/"Confidence:". A hint reclassifies a paragraph the
 * regex would otherwise leave as plain prose — it never overrides a
 * paragraph the regex already classified (they'd agree in that case
 * anyway), and a message with no hints classifies exactly as before this
 * type existed. Read verbatim off the tool call, never off a node — same
 * D4 non-concern as the rest of this file (see the doctrine note above). */
export interface VerdictHint {
  kind: 'canonical' | 'confidence'
  text: string
}

/** The report_verdict bridge tool's full MCP name, as it appears in a raw
 * transcript's `tool_use` blocks — same naming convention as
 * ritualFromTranscript.ts's `RENDER_BEAT`/`SESSION_PHASE`/etc constants. */
export const REPORT_VERDICT_TOOL = 'mcp__engram-ui-bridge__report_verdict'

/** Validates and extracts a VerdictHint from a report_verdict tool_use
 * call's raw `input` — the ONE place both the live bridge:ui handler
 * (ReviewSessionView.tsx) and replay's transcript walker
 * (SessionHistoryDrawer.tsx's `buildHistoryTimeline`) parse this payload,
 * so they can never disagree about what counts as a well-formed hint. */
export function parseVerdictHint(input: unknown): VerdictHint | null {
  if (typeof input !== 'object' || input === null) return null
  const rec = input as Record<string, unknown>
  if (rec.kind !== 'canonical' && rec.kind !== 'confidence') return null
  if (typeof rec.text !== 'string' || rec.text.trim().length === 0) return null
  return { kind: rec.kind, text: rec.text }
}

/** Loose-equality match between a hint's declared text and a paragraph's
 * actual text — whitespace-normalized containment either direction, so
 * minor formatting drift between what the tutor DECLARED via the tool call
 * and what it actually WROTE (a trailing period, a collapsed newline)
 * doesn't silently miss the match. */
function hintMatches(hint: VerdictHint, trimmed: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const a = norm(hint.text)
  const b = norm(trimmed)
  if (a.length === 0 || b.length === 0) return false
  return b.includes(a) || a.includes(b)
}

// ===========================================================================
// The schedule regex family
// ===========================================================================

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
const WEEKDAY = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)'
const MONTH_DAY = `${MONTH}\\.?\\s+\\d{1,2}`

/** A short, named lead-in a real verdict sometimes fuses onto the FRONT of a
 * growth clause — "That jumped from ~4 days to ~29", "This one's now holding
 * ~69 days" — corpus-real (see `.superpowers/sdd/verdict-wave-1-report.md`'s
 * acceptance scan), never itself a fact, so it's folded into the clause
 * pattern rather than extracted. Deliberately a closed enumeration of
 * subject + verb, not free text — that's what keeps a meta-document merely
 * DESCRIBING this regex family (e.g. a spec paragraph containing the phrase
 * "jumped from holding ~4 days to ~29" as a quoted example) from being
 * mistaken for a real growth-line-as-opener: the subject/verb combination
 * here is narrow enough that ordinary prose essentially never opens on it by
 * accident. */
const GROWTH_LEAD_IN = `(?:(?:That|This|It)(?:'s|\\s+one|\\s+one's|\\s+memory)?\\s+(?:is\\s+|just\\s+|also\\s+|now\\s+)?(?:jumped|went|climbed)\\s+)?`

/** One recognizable schedule clause. `source` is deliberately NOT global and
 * NOT anchored — `exec`'d once per paragraph for fact extraction, and used
 * (with a fresh 'g' flag) to strip every occurrence for the bare-paragraph
 * check. Applied in this fixed order so `backInDays`/`backTomorrow` consume
 * their own optional "(Month Day)" parenthetical BEFORE `backDate` ever gets
 * a chance to see it as a separate, un-stripped clause, and so the two
 * growth shapes are tried before their reversed `growthUpFrom` sibling. */
const CLAUSE = {
  backInDays: `Back in (\\d+) days?(?:\\s*\\(\\s*(${MONTH_DAY})\\s*\\))?`,
  backTomorrow: `Back tomorrow(?:\\s*\\(\\s*(${MONTH_DAY})\\s*\\))?`,
  backDate: `Back (?:on )?(${MONTH_DAY})\\b`,
  backWeekday: `Back (?:on )?(${WEEKDAY})\\b`,
  growthArrow: `~(\\d+(?:\\.\\d+)?)\\s*(?:days?)?\\s*(?:→|->)\\s*~(\\d+(?:\\.\\d+)?)`,
  // Covers both "from ~N days to ~M" and the corpus-real "That jumped from
  // holding ~N days to ~M" / "This one went from ~N to ~M" family.
  growthFromTo: `${GROWTH_LEAD_IN}from\\s+(?:holding\\s+)?~(\\d+(?:\\.\\d+)?)\\s*days?\\s*(?:of holding(?:\\s+power)?\\s*)?to\\s*~(\\d+(?:\\.\\d+)?)`,
  // The reversed shape — "now holding ~69 days, up from ~9" — states the
  // CURRENT value first, so its capture order is swapped at extraction time.
  growthUpFrom: `${GROWTH_LEAD_IN}holding\\s+~(\\d+(?:\\.\\d+)?)\\s*days?,?\\s*up from\\s*~(\\d+(?:\\.\\d+)?)`,
  nextInDays: `Next in (\\d+) days?\\b`,
  nextDue: `Next due\\b`,
  dueBack: `due back\\b`,
  parkedUntil: `parked until ([A-Za-z]+(?:\\s+\\w+)?)`,
} as const

const CLAUSE_LIST = Object.values(CLAUSE)

/** Short referential fillers a corpus-real bare schedule paragraph can carry
 * around its clause(s) without becoming substantive prose — "Back in 3 days
 * for that one.", "Back in 6 days on that one.". Deliberately narrow: a
 * genuine explanatory clause ("...to catch it again.", "...given the short
 * interval on a `hard` rating.") is NOT in this list and correctly keeps the
 * paragraph out of `bare:true`. */
const CONNECTIVE_PHRASES = /\b(?:on|for) (?:that|this) one\b|\b(?:that|this) one'?s\b|\bit'?s\b|\bnow\b|\btoo\b|\bas well\b|\bfor now\b/gi

/** Corpus-real qualitative restatements of a growth pair or return date this
 * SAME paragraph already stated numerically — "That jumped from ~4 days to
 * ~29 — it'll survive a month now." states nothing beyond what "~4 -> ~29"
 * already says; "back in late August" restates a date already given as
 * "~36 days" elsewhere in the same sentence. Stripped as connective filler
 * ONLY for the bare check, on the same "dedupe only where the same fact is
 * already presented" ground the schedule-suppression rule itself rests on —
 * never a reason to reclassify the paragraph as prose (it's still `schedule`
 * either way), only a reason to allow `bare:true`. Deliberately a CLOSED,
 * corpus-grounded list, not a generalized "sounds redundant" pattern: a
 * genuinely new judgment ("worth another pass soon", "given the short
 * interval on a `hard` rating") is never in it, so it never over-suppresses. */
const GROWTH_RESTATEMENT_PHRASES = new RegExp(
  [
    `it'?ll hold now`,
    `it'?ll clear the week now`,
    `it'?ll survive (?:the |a )?(?:week|month|fortnight|full cycle) now`,
    `it'?s crossed into (?:the )?month-plus territory now`,
    `it'?s crossed into (?:the )?month-plus range`,
    `it'?s in long-term storage now`,
    `solidly into the month-plus range now`,
    `into a week-plus`,
    `holding for a month now`,
    `back in late [A-Za-z]+`,
  ].join('|'),
  'gi',
)

/** Pure punctuation/whitespace/markdown-emphasis — what a bare schedule
 * paragraph's clauses (and connective fillers) must fully reduce to once
 * stripped. `*` is included so a bold-wrapped marker ("**Next due**") can
 * still reduce to bare once the literal words are stripped out from inside
 * the asterisks. */
const CONNECTIVE_ONLY_RE = /^[\s.,;:()*–—\-!?'"]*$/

/** A short, closed set of leading verdict-correctness sentences a real
 * paragraph sometimes prepends before its own schedule opener — "Correct —
 * Paris. That jumped from holding ~1.4 days to ~8.9; ..." — stripped only
 * for the OPENER test (never for fact extraction or the bare check, since
 * these paragraphs always carry substantive trailing prose too and are
 * never eligible for `bare:true` regardless). Narrow on purpose: it must
 * never make an unrelated paragraph that merely starts with "Correct" look
 * like a schedule opener when nothing schedule-shaped follows. */
const LEADING_VERDICT_RE = /^(?:Correct|Right|Wrong|Incorrect|Yes|No)\b[^.!?\n]*[.!?]\s*/

const SCHEDULE_OPENER_RE = new RegExp(`^\\*{0,2}(?:${CLAUSE_LIST.join('|')})`)

function scheduleFactsPresent(facts: ScheduleFacts): boolean {
  return (
    facts.intervalDays != null ||
    facts.tomorrow ||
    facts.dateText != null ||
    facts.sBefore != null ||
    facts.sAfter != null ||
    facts.dueMarker
  )
}

function extractScheduleFacts(text: string): ScheduleFacts {
  const facts: ScheduleFacts = {
    intervalDays: null,
    tomorrow: false,
    dateText: null,
    sBefore: null,
    sAfter: null,
    dueMarker: false,
  }
  const backInDays = new RegExp(CLAUSE.backInDays).exec(text)
  if (backInDays) {
    facts.intervalDays = Number(backInDays[1])
    if (backInDays[2]) facts.dateText = backInDays[2]
  }
  const backTomorrow = new RegExp(CLAUSE.backTomorrow).exec(text)
  if (backTomorrow) {
    facts.tomorrow = true
    if (backTomorrow[1]) facts.dateText = backTomorrow[1]
  }
  if (!facts.dateText) {
    const backDate = new RegExp(CLAUSE.backDate).exec(text)
    if (backDate) facts.dateText = backDate[1]
  }
  if (!facts.dateText) {
    const backWeekday = new RegExp(CLAUSE.backWeekday).exec(text)
    if (backWeekday) facts.dateText = backWeekday[1]
  }
  const growthArrow = new RegExp(CLAUSE.growthArrow).exec(text)
  if (growthArrow) {
    facts.sBefore = Number(growthArrow[1])
    facts.sAfter = Number(growthArrow[2])
  } else {
    const growthFromTo = new RegExp(CLAUSE.growthFromTo, 'i').exec(text)
    if (growthFromTo) {
      facts.sBefore = Number(growthFromTo[1])
      facts.sAfter = Number(growthFromTo[2])
    } else {
      const growthUpFrom = new RegExp(CLAUSE.growthUpFrom, 'i').exec(text)
      if (growthUpFrom) {
        // Reversed: the FIRST number is the current/after value, the SECOND
        // ("up from ~M") is the prior/before value.
        facts.sAfter = Number(growthUpFrom[1])
        facts.sBefore = Number(growthUpFrom[2])
      }
    }
  }
  if (facts.intervalDays == null) {
    const nextInDays = new RegExp(CLAUSE.nextInDays).exec(text)
    if (nextInDays) facts.intervalDays = Number(nextInDays[1])
  }
  if (new RegExp(CLAUSE.nextDue).test(text) || new RegExp(CLAUSE.dueBack, 'i').test(text)) {
    facts.dueMarker = true
  }
  if (!facts.dateText) {
    const parkedUntil = new RegExp(CLAUSE.parkedUntil, 'i').exec(text)
    if (parkedUntil) facts.dateText = parkedUntil[1]
  }
  return facts
}

/** Classifies one already-trimmed, non-fenced, non-blockquote paragraph as a
 * schedule segment, or returns null (not schedule at all — ordinary prose).
 * `bare:true` when the WHOLE paragraph reduces to schedule clauses plus
 * connective filler; `bare:false` when it OPENS with a schedule clause (or a
 * short leading verdict-correctness sentence, then a schedule clause) but
 * continues into real prose (never null in that case — see ScheduleSegment's
 * doctrine comment on growth-line-as-openers). A paragraph that merely
 * MENTIONS a schedule phrase mid-sentence without opening on one (corpus-
 * certified "interval editorial prose", e.g. "Clean — no mismatch, back in 4
 * days.") is deliberately left as ordinary prose forever — returns null. */
function classifySchedule(trimmed: string): { facts: ScheduleFacts; bare: boolean } | null {
  const isOpener = SCHEDULE_OPENER_RE.test(trimmed) || SCHEDULE_OPENER_RE.test(trimmed.replace(LEADING_VERDICT_RE, ''))
  let remainder = trimmed
  for (const clause of CLAUSE_LIST) {
    remainder = remainder.replace(new RegExp(clause, 'gi'), '')
  }
  // Longer, more specific restatement phrases FIRST — `CONNECTIVE_PHRASES`
  // includes bare short words like "now"/"it's" that would otherwise
  // cannibalize a piece of a longer GROWTH_RESTATEMENT_PHRASES match (e.g.
  // stripping "it's" and "now" out of "it's crossed into month-plus
  // territory now" before that whole-phrase pattern ever gets to match it).
  remainder = remainder.replace(GROWTH_RESTATEMENT_PHRASES, '').replace(CONNECTIVE_PHRASES, '')
  const bare = CONNECTIVE_ONLY_RE.test(remainder)
  if (!bare && !isOpener) return null
  const facts = extractScheduleFacts(trimmed)
  if (!scheduleFactsPresent(facts)) return null
  return { facts, bare }
}

// ===========================================================================
// Canonical / rating / confidence markers
// ===========================================================================

const CANONICAL_RE = /^(?:\*\*)?(Canonical|Reveal|Claim)\*{0,2}\s*:\s*/
const RATING_RE = /^Rating \*\*(again|hard|good|easy)\*\*/
const CONFIDENCE_RE = /^Confidence:\s*/

function extractConfidenceBand(afterColon: string): string {
  const m = afterColon.match(/^[^.\n]*\.?/)
  const raw = m ? m[0] : afterColon
  return raw.replace(/\.$/, '').trim()
}

// ===========================================================================
// Paragraph walker
// ===========================================================================

interface RawParagraph {
  raw: string
  fenced: boolean
}

/** Splits `text` into paragraphs whose `raw` slices, concatenated in order,
 * are byte-identical to `text` — the invariant every consumer of
 * `segmentVerdictText` depends on (see Task 3's snapshot-harness assertion).
 * Fence-aware: a ``` … ``` block is always exactly one paragraph, however
 * many blank lines it contains, and is tagged `fenced` so classification
 * never looks inside it (a /learn receipts fence's "next due"/"tomorrow"-
 * shaped lines must never be claimed by the schedule family). */
function splitIntoParagraphs(text: string): RawParagraph[] {
  if (text.length === 0) return []
  const lines: { content: string; start: number; end: number }[] = []
  {
    let i = 0
    while (i < text.length) {
      const nl = text.indexOf('\n', i)
      if (nl === -1) {
        lines.push({ content: text.slice(i), start: i, end: text.length })
        break
      }
      lines.push({ content: text.slice(i, nl), start: i, end: nl + 1 })
      i = nl + 1
    }
  }

  const breaks: { start: number; fenced: boolean }[] = [{ start: 0, fenced: false }]
  let inFence = false
  let blankRun = false
  for (const line of lines) {
    const isFenceMarker = /^\s{0,3}```/.test(line.content)
    if (isFenceMarker) {
      if (!inFence) {
        if (breaks[breaks.length - 1].start !== line.start) breaks.push({ start: line.start, fenced: true })
        else breaks[breaks.length - 1].fenced = true
        inFence = true
      } else {
        inFence = false
        if (line.end < text.length) breaks.push({ start: line.end, fenced: false })
      }
      blankRun = false
      continue
    }
    if (inFence) {
      blankRun = false
      continue
    }
    const isBlank = line.content.trim().length === 0
    if (isBlank) {
      blankRun = true
      continue
    }
    if (blankRun) {
      if (breaks[breaks.length - 1].start !== line.start) breaks.push({ start: line.start, fenced: false })
      blankRun = false
    }
  }

  const paragraphs: RawParagraph[] = []
  for (let i = 0; i < breaks.length; i++) {
    const start = breaks[i].start
    const end = i + 1 < breaks.length ? breaks[i + 1].start : text.length
    if (end <= start) continue
    paragraphs.push({ raw: text.slice(start, end), fenced: breaks[i].fenced })
  }
  return paragraphs
}

function classifyParagraph(raw: string, fenced: boolean, hints: VerdictHint[]): VerdictSegment {
  const trimmed = raw.trim()
  if (fenced || trimmed.length === 0 || trimmed.startsWith('>')) {
    return { kind: 'prose', raw }
  }
  const canonical = CANONICAL_RE.exec(trimmed)
  if (canonical) {
    return { kind: 'canonical', marker: canonical[1], body: trimmed.slice(canonical[0].length).trim(), raw }
  }
  const rating = RATING_RE.exec(trimmed)
  if (rating) {
    return { kind: 'rating', rating: rating[1] as GradeResult['rating'], raw }
  }
  const confidence = CONFIDENCE_RE.exec(trimmed)
  if (confidence) {
    return { kind: 'confidence', band: extractConfidenceBand(trimmed.slice(confidence[0].length)), raw }
  }
  const schedule = classifySchedule(trimmed)
  if (schedule) {
    return { kind: 'schedule', facts: schedule.facts, bare: schedule.bare, raw }
  }
  // Marker-less recall recovery — only reached when none of the regexes
  // above already classified this paragraph, so a hint can never disagree
  // with an explicit marker the tutor actually wrote.
  for (const hint of hints) {
    if (!hintMatches(hint, trimmed)) continue
    if (hint.kind === 'canonical') return { kind: 'canonical', marker: 'Canonical', body: trimmed, raw }
    return { kind: 'confidence', band: extractConfidenceBand(trimmed), raw }
  }
  return { kind: 'prose', raw }
}

/** The paragraph walker: splits `text` (one chat message's worth of assistant
 * prose, or a message's `splitAroundProbeHeader(...).before` prefix) into
 * `VerdictSegment`s. Fence-aware (a fenced block is always one `prose`
 * segment, whatever it contains); `>` blockquote lines are always `prose`
 * (the tutor quoting the probe text back — never restructured). Degrades to
 * a single `prose` segment for text with no recognizable markers at all,
 * which is the common case — this is corpus-measured LOW recall by design,
 * not a bug: gap-analysis interiors, rubric phrasing, meta-observations, and
 * praise codas are declared hopeless and stay prose forever.
 *
 * Invariant every caller may rely on: `segmentVerdictText(text).map(s =>
 * s.raw).join('')` is byte-identical to `text`.
 *
 * `hints` (optional, defaults to none — every existing call site and every
 * historical transcript classifies byte-identically without them) are this
 * message's own `report_verdict` bridge-tool calls, if any; see VerdictHint's
 * doctrine comment. */
export function segmentVerdictText(text: string, hints: VerdictHint[] = []): VerdictSegment[] {
  return splitIntoParagraphs(text).map((p) => classifyParagraph(p.raw, p.fenced, hints))
}

// ===========================================================================
// Dedupe rule
// ===========================================================================

/** `~`-rounded numbers (stability days) match within a tolerance rather than
 * exactly — the tutor's own prose always rounds ("~4 days", never the raw
 * "4.2137"). Tolerance scales with magnitude (the same rounding that reads
 * as "~4" for 4.2 would read as "~17" for 17.4, not "~17.0"). */
function roughlyMatches(actual: number | null, approx: number | null): boolean {
  if (actual == null || approx == null) return false
  const tolerance = Math.max(1, Math.abs(actual) * 0.15)
  return Math.abs(actual - approx) <= tolerance
}

const MONTH_ABBREVS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Resolves `dateText` (the tutor's own literal phrase — "Jul 24",
 * "Tuesday", "late September") against `isoDate` ('YYYY-MM-DD', already
 * computed from a real anchor via `lapseReturnDate`). Month/day form
 * compares month + day, ignoring year (the tutor's prose never states one).
 * Weekday form resolves the weekday `isoDate` itself falls on and compares
 * names. Anything else (e.g. "late September", too vague to pin to a single
 * day) can't be verified and returns false — never guessed true. */
function dateTextMatchesIsoDate(dateText: string, isoDate: string): boolean {
  const parts = isoDate.split('-').map(Number)
  const year = parts[0]
  const month = parts[1]
  const day = parts[2]
  const trimmed = dateText.trim()

  const monthDay = trimmed.match(/^([A-Za-z]+)\.?\s+(\d{1,2})$/)
  if (monthDay) {
    const monthWord = monthDay[1].slice(0, 3).toLowerCase()
    const wantDay = Number(monthDay[2])
    return monthWord === MONTH_ABBREVS[month - 1] && wantDay === day
  }
  const weekdayWord = WEEKDAY_NAMES.find((w) => w === trimmed.toLowerCase())
  if (weekdayWord) {
    const resolved = new Date(year, month - 1, day)
    return WEEKDAY_NAMES[resolved.getDay()] === weekdayWord
  }
  return false
}

/** Whether every fact `facts` actually states matches `result`'s own receipt
 * — the single source of truth `shouldSuppressSchedule` defers to. A fact
 * the paragraph never mentioned is vacuously fine (nothing to contradict);
 * ANY fact that IS present and doesn't match fails the whole check. A date
 * claim with no `anchorDate` to resolve it against always fails (never
 * assumed true) — this is the one case where "can't verify" behaves like
 * "doesn't match", by design, so an unresolvable date claim never gets
 * silently suppressed. */
export function scheduleMatchesReceipt(facts: ScheduleFacts, result: GradeResult, anchorDate: Date | null): boolean {
  if (facts.intervalDays != null) {
    if (result.intervalDays == null) return false
    if (Math.round(result.intervalDays) !== facts.intervalDays) return false
  }
  if (facts.tomorrow) {
    if (result.intervalDays == null) return false
    if (Math.round(result.intervalDays) !== 1) return false
  }
  if (facts.sBefore != null && !roughlyMatches(result.sBefore, facts.sBefore)) return false
  if (facts.sAfter != null && !roughlyMatches(result.sAfter, facts.sAfter)) return false
  if (facts.dateText != null) {
    if (anchorDate == null) return false
    if (result.intervalDays == null) return false
    const expected = lapseReturnDate(result.intervalDays, anchorDate)
    if (expected == null) return false
    if (!dateTextMatchesIsoDate(facts.dateText, expected)) return false
  }
  return true
}

/** THE single shared suppression predicate — both the live view and replay
 * call this verbatim, so a resumed sitting can never disagree with the live
 * one about which schedule paragraphs are redundant with their own
 * GradeResultCard. Suppress iff ALL of:
 *   - the paragraph is `bare:true` (pure fact, no editorial clause — see
 *     ScheduleSegment's doctrine comment; an editorial clause keeps the
 *     paragraph on screen in full, unconditionally);
 *   - the region's own batch graded exactly ONE node (a multi-result batch's
 *     schedule paragraph can't be safely attributed to a single card);
 *   - at least one fact is actually present (an empty `facts` — content the
 *     opener/bare check somehow let through with nothing extracted — never
 *     suppresses, since there is nothing to have matched);
 *   - the GradeResultCard's own return chip would actually render
 *     (`intervalDays !== null` — suppressing a paragraph that names the ONLY
 *     place the fact appears on screen would be a real information loss);
 *   - every fact the paragraph states matches the receipt exactly (or within
 *     the tutor's own `~`-rounding — see `scheduleMatchesReceipt`);
 *   - this is not the live streaming tail (a still-growing message's last
 *     paragraph hasn't finished — suppressing it would flicker the schedule
 *     line in and out as more text streams in).
 * Exports never call this at all — `sittingToMarkdown`/`sittingToPrintHtml`
 * keep every byte; only the interactive screen dedupes, deliberately. */
export function shouldSuppressSchedule(
  segment: ScheduleSegment,
  batchResults: GradeResult[],
  anchorDate: Date | null,
  isLiveStreamingTail: boolean,
): boolean {
  if (!segment.bare) return false
  if (isLiveStreamingTail) return false
  if (batchResults.length !== 1) return false
  const result = batchResults[0]
  if (result.intervalDays === null) return false
  if (!scheduleFactsPresent(segment.facts)) return false
  return scheduleMatchesReceipt(segment.facts, result, anchorDate)
}

// ===========================================================================
// deriveVerdictRegions
// ===========================================================================

/** Structurally a subset of `SessionHistoryDrawer.tsx`'s `GradeBatch` — only
 * the one field region derivation actually needs. Kept local (rather than
 * importing GradeBatch) so this shared/ module never reaches into a
 * renderer/ component file; a real `GradeBatch[]` is assignable here as-is
 * (TS matches structurally), same convention as
 * `ritualFromTranscript.ts`'s `DerivedRitualMark`. */
export interface VerdictRegionBatch {
  id: string
  /** Same convention as GradeBatch.atIndex — the message-array length at the
   * moment this batch's `rate`/`receipt` tool_result landed. */
  atIndex: number
}

/** One GradeBatch's own verdict text, located within `messages` — a message
 * INDEX RANGE, not pre-extracted text (segmentation stays per-message; see
 * `verdictRegionMessageTexts` for the one place that turns a region back
 * into the literal strings to feed `segmentVerdictText`, honoring the
 * boundary message's prefix-only clip). */
export interface VerdictRegion {
  batchId: string
  /** First message this region draws text from. */
  startIndex: number
  /** Last message this region draws text from (inclusive). May equal
   * `startIndex - 1` for a genuinely empty region (an interjection landed
   * immediately after the boundary with nothing in between) — callers must
   * check `endIndex >= startIndex` before rendering. */
  endIndex: number
  /** True iff `endIndex`'s message carries a probe header and only the text
   * BEFORE that header (`splitAroundProbeHeader(...).before`) belongs to
   * this region — the header itself and everything after stay owned by the
   * existing ProbeCard/`beforeProbeHeader` flow, completely untouched. False
   * means the entire `endIndex` message's text belongs here (the tail case,
   * or a region truncated by a learner interjection). */
  boundaryPrefixOnly: boolean
}

/** Per GradeBatch, the message range its own verdict commentary occupies.
 *
 * LEFT boundary: the message immediately after the learner's last
 * production (a `user`-role message) at or before `batch.atIndex` — this is
 * what makes both corpus-measured layouts fall out of ONE rule. In the
 * "verdict AFTER the rate call" layout (29/50), that production is
 * immediately followed by the tool call, so the left boundary lands right at
 * `atIndex` itself, where the tutor's next turn narrates the verdict. In the
 * "verdict BEFORE the rate call" layout (21/50), the tutor's full commentary
 * — up to and including the `rate` tool_use — merges into ONE ChatMessage
 * with whatever text follows it too (Bash isn't a mark-boundary tool use, so
 * `parseTranscriptToMessages`/`buildHistoryTimeline` never split there); that
 * merged message was already pushed before `atIndex` was captured, so it
 * sits at index `atIndex - 1` — still exactly "the message after the
 * learner's last production," just below the anchor instead of at it.
 *
 * RIGHT boundary: `nextProbeHeaderAt(messages, leftIndex)` — starting the
 * search at the LEFT boundary (not `atIndex`) is what correctly finds a
 * probe header even when it's fused into that same BEFORE-layout merged
 * message (a real shape: full verdict, then the `rate` call, then the next
 * probe, all still one bubble) — `nextProbeHeaderAt` searching from `atIndex`
 * alone would skip straight past it. Falls back to the last message when no
 * later header exists yet (the sitting's final graded item, or a session
 * that closed before its next probe).
 *
 * TRUNCATION: if the learner sends a real message (an interjection — a
 * follow-up question mid-verdict) before the resolved probe header is
 * reached, the region stops at the message just before that interjection
 * instead: the tutor's continued reply past that point is answering the
 * learner's follow-up, not finishing the original verdict.
 *
 * CLAMPING: each region's `startIndex` is floored at the previous region's
 * own claimed range, so two grade batches whose boundaries would otherwise
 * overlap (e.g. two items rated in rapid succession with no learner message
 * between them) never claim the same message text twice. */
export function deriveVerdictRegions(messages: ChatMessage[], gradeBatches: VerdictRegionBatch[]): VerdictRegion[] {
  const regions: VerdictRegion[] = []
  const sorted = [...gradeBatches].sort((a, b) => a.atIndex - b.atIndex)
  let floor = 0

  for (const batch of sorted) {
    const anchor = Math.min(Math.max(batch.atIndex, 0), messages.length)

    let leftIndex = floor
    for (let i = anchor - 1; i >= floor; i--) {
      if (messages[i].role === 'user') {
        leftIndex = i + 1
        break
      }
    }
    if (leftIndex > anchor) leftIndex = anchor

    let interjectionIndex: number | null = null
    for (let i = leftIndex; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        interjectionIndex = i
        break
      }
    }

    const headerIndex = nextProbeHeaderAt(messages, leftIndex)

    let endIndex: number
    let boundaryPrefixOnly: boolean
    if (headerIndex !== null && (interjectionIndex === null || headerIndex <= interjectionIndex)) {
      endIndex = headerIndex
      boundaryPrefixOnly = true
    } else if (interjectionIndex !== null) {
      endIndex = interjectionIndex - 1
      boundaryPrefixOnly = false
    } else {
      endIndex = messages.length - 1
      boundaryPrefixOnly = false
    }

    regions.push({ batchId: batch.id, startIndex: leftIndex, endIndex, boundaryPrefixOnly })
    floor = endIndex >= leftIndex ? (boundaryPrefixOnly ? endIndex : endIndex + 1) : floor
  }

  return regions
}

/** The exact text each message in `region` contributes to verdict
 * segmentation: the boundary message's own probe-header prefix only when
 * `boundaryPrefixOnly` is set, the full text of every other participating
 * message otherwise. Empty regions (`endIndex < startIndex`) yield `[]`.
 * The one place this prefix-clip logic lives, so a later renderer
 * (ChatMessageView) and the snapshot harness's `verdictFingerprint` can
 * never disagree about which bytes belong to a region. */
export function verdictRegionMessageTexts(messages: ChatMessage[], region: VerdictRegion): string[] {
  if (region.endIndex < region.startIndex) return []
  const out: string[] = []
  for (let i = region.startIndex; i <= region.endIndex; i++) {
    const message = messages[i]
    if (!message) continue
    if (i === region.endIndex && region.boundaryPrefixOnly) {
      const split = splitAroundProbeHeader(message.text)
      out.push(split ? split.before : message.text)
    } else {
      out.push(message.text)
    }
  }
  return out
}

// ===========================================================================
// Rendering (Wave 2) — per-message segment lists, and the region-wide
// "which message holds the eyebrow" decision
// ===========================================================================

/** One region-participating message's own render input: its segmented text,
 * plus (at most once per region — see `verdictRegionMessageRenders`) which
 * segment index is the VERDICT eyebrow anchor. */
export interface VerdictMessageRender {
  /** Index into the `messages` array this render was derived from — NOT an
   * offset into this region's own message list. */
  messageIndex: number
  segments: VerdictSegment[]
  /** Index into `segments` of the region's own FIRST `prose` segment, iff it
   * lands in THIS message; `null` on every other message in the region (and
   * on this one too, if this region carries no prose at all). */
  eyebrowSegmentIndex: number | null
}

/** Per-message segments for one region, plus the region-WIDE (never
 * per-message) decision of which single segment — in which single message —
 * is "the first prose of the region" and therefore gets the quiet VERDICT
 * eyebrow rail (`components/ritual/VerdictRows.tsx`'s `VerdictEyebrowRail`).
 * A verdict commentary regularly spans several messages (this module's own
 * doctrine comment: >=2 messages in 41/50 sittings), so "first prose" can
 * land on any one of them — resolving it here, ONCE, off the exact same
 * per-message segment lists both the live view and transcript replay already
 * need to render is what keeps two messages from ever both claiming the
 * eyebrow, or the eyebrow landing in different places live vs. replayed.
 * `ReviewSessionView.tsx` and `SessionHistoryDrawer.tsx` both call this
 * verbatim rather than re-deriving the per-message split themselves.
 *
 * Mirrors `verdictRegionMessageTexts`'s own loop (rather than calling it and
 * assuming the returned array's index lines up with `messages`) so a message
 * this region's range technically spans but that doesn't exist in `messages`
 * — defensively guarded there, never actually reachable for a `region` this
 * module itself derived from the same `messages` array — can never desync
 * `messageIndex` from the text it segments. */
export function verdictRegionMessageRenders(
  messages: ChatMessage[],
  region: VerdictRegion,
  hintsByMessageIndex?: Map<number, VerdictHint[]>,
): VerdictMessageRender[] {
  if (region.endIndex < region.startIndex) return []
  const out: VerdictMessageRender[] = []
  for (let i = region.startIndex; i <= region.endIndex; i++) {
    const message = messages[i]
    if (!message) continue
    let text: string
    if (i === region.endIndex && region.boundaryPrefixOnly) {
      const split = splitAroundProbeHeader(message.text)
      text = split ? split.before : message.text
    } else {
      text = message.text
    }
    out.push({ messageIndex: i, segments: segmentVerdictText(text, hintsByMessageIndex?.get(i) ?? []), eyebrowSegmentIndex: null })
  }
  outer: for (const entry of out) {
    for (let si = 0; si < entry.segments.length; si++) {
      if (entry.segments[si].kind === 'prose') {
        entry.eyebrowSegmentIndex = si
        break outer
      }
    }
  }
  return out
}
