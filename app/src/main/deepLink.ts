// Parses and shape-guards the payload of an `engram://new-topic?payload=...`
// deep link — Observatory's paper→topic hand-off (see
// ObservatoryDesktop/app/src/shared/__fixtures__/engram-link-fixture.json,
// copied verbatim into ./__fixtures__ for the round-trip test below).
//
// This module is deliberately electron-free and side-effect-free: the URL
// itself is UNTRUSTED input (anything on this machine can register a click
// on an `engram://` link, or a second `open --args` on macOS), so every field
// is shape-guarded before it's trusted, and NOTHING here touches the
// filesystem or the engine. Filesystem checks on contextFiles are a
// SEPARATE, impure step (validateContextFiles below) — kept apart so the
// pure parse can be unit-tested without a real disk, and so main/index.ts's
// caller can decide when (and whether) to pay for stat() calls.
//
// This is a prefill source only. Nothing in this file, or in its caller,
// may start a session — the renderer's New Topic modal is what the learner
// reviews and submits (see LearnSessionView.tsx's startNewTopic, whose
// pinned kickoff-message construction this changeset does not touch).
//
// SECURITY NOTE (added after coordinator review): `goal`/`instructions` are
// UNTRUSTED text that ultimately rides a kickoff message into a headless
// `claude` session run with `--tools Bash,Write,Read,Task
// --permission-mode bypassPermissions` — see LearnSessionView.tsx's
// startNewTopic, which splices `goal` in quotes and `instructions` under an
// explicit "Standing instructions for this topic" framing. That splice
// itself is NOT modified by this changeset (it's the existing, pinned
// path every manually-typed New Topic already goes through). What IS new
// here is that this text can now originate from outside the app entirely,
// so normalizeHostileWhitespace below exists specifically to stop a payload
// from hiding an injected instruction below the fold of the New Topic
// modal's review textareas via long runs of blank lines — see
// NewTopicModal.tsx's own provenance-banner/review-area changes for the UI
// half of this mitigation. This is a defense-in-depth measure, not a
// replacement for the modal remaining a real human review gate.

import { existsSync, lstatSync } from 'node:fs'
import { extname, isAbsolute, normalize } from 'node:path'
import type { NewTopicPrefill } from '../shared/types'

const MAX_GOAL_LEN = 2000
const MAX_INSTRUCTIONS_LEN = 4000
const MAX_CONTEXT_FILES = 8
const DEADLINE_RE = /^\d{4}-\d{2}-\d{2}$/
// RFC 4648 §5 (base64url): only A-Z a-z 0-9 - _ , no padding. Checked
// explicitly (rather than letting a lenient Buffer.from silently drop bad
// characters and decode garbage) so a malformed payload fails with a clear
// reason instead of an unrelated JSON-parse error further down.
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/
const ALLOWED_CONTEXT_EXTENSIONS = new Set(['.pdf', '.md', '.txt'])

// C0 control characters and DEL, EXCLUDING tab (\x09) and newline (\x0A) —
// deliberately conservative: this must never mangle legitimate prose, only
// remove bytes that have no business in freeform text (raw \r included, so
// CRLF collapses to LF as a side effect of stripping it).
const HOSTILE_CONTROL_CHARS_RE = /[\x00-\x08\x0B-\x1F\x7F]/g

// Zero-width and bidi-override characters — a separate injection vector
// from visible whitespace: these can hide characters entirely (a zero-width
// space/joiner splices invisibly into a word) or scramble the VISUAL order
// of surrounding text (the bidi embedding/override controls) without
// changing what bytes are actually there. Written as explicit \u escapes
// (never literal invisible characters in source) so this is auditable by
// reading the code, not just by trusting what a diff viewer renders:
// U+200B–200F (zero-width space/joiners/direction marks), U+202A–202E
// (bidi embed/override/pop), U+2060 (word joiner), U+FEFF (zero-width
// no-break space / BOM).
const ZERO_WIDTH_AND_BIDI_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g

// 8+ consecutive ASCII spaces collapsed to one. A `<textarea>` renders with
// `white-space: pre-wrap` by default — unlike a run of newlines, a long run
// of plain spaces has no visible line break in it at all, but it still
// WRAPS onto many blank-looking lines at the textarea's width, achieving
// the identical "push the real content below the fold" effect the newline
// collapse below exists to stop. 8 is deliberately well above any
// legitimate use (a 4-space indent, a couple of spaces after a period) —
// see normalizeHostileWhitespace's own tests for the exact boundary.
const HOSTILE_HORIZONTAL_SPACE_RUN_RE = / {8,}/g

/** Strips control and zero-width/bidi-override characters, and collapses
 * both long horizontal space runs and runs of 2+ blank lines down to a
 * single one of each. Exists specifically to blunt the "push the real
 * payload below the visible fold" attack: `instructions` is reviewed by a
 * human in a small textarea before anything is sent to a session (see
 * NewTopicModal.tsx), and either dozens of blank lines OR thousands of
 * spaces (which wrap into the same visual effect — see
 * HOSTILE_HORIZONTAL_SPACE_RUN_RE above) followed by an injected "standing
 * instruction" would previously scroll the actual content out of the
 * initially-visible area. This is NOT a semantic rewrite — ordinary prose
 * with a single blank paragraph break, tabs, a 4-space indent, or unicode
 * content (including the em-dash this app uses throughout) is untouched. */
export function normalizeHostileWhitespace(s: string): string {
  return s
    .replace(ZERO_WIDTH_AND_BIDI_RE, '')
    .replace(HOSTILE_CONTROL_CHARS_RE, '')
    .replace(HOSTILE_HORIZONTAL_SPACE_RUN_RE, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function deadlineNote(deadline: string): string {
  return `I need this understood by ${deadline} — pace the curriculum accordingly.`
}

/** Pure: decodes + shape-guards an `engram://new-topic?payload=<base64url>`
 * URL into a `NewTopicPrefill`, or an `{ error }` describing why it was
 * rejected. `contextFiles` here is only type/length-checked — filesystem
 * legitimacy is validateContextFiles' job, called separately by the caller
 * (see buildNewTopicPrefill below, which composes both). `goal` and
 * `instructions` are whitespace/control-character normalized (see
 * normalizeHostileWhitespace) AFTER the length check, against the raw wire
 * value — normalization only ever shrinks text, so the ≤2000/≤4000 limits
 * still bound what's actually returned. */
export function parseEngramDeepLink(url: string): NewTopicPrefill | { error: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { error: `not a valid URL: ${url}` }
  }
  if (parsed.protocol !== 'engram:') {
    return { error: `wrong scheme: ${parsed.protocol}` }
  }
  // For a scheme with no special-cased parsing rules, WHATWG URL treats the
  // segment right after `//` as the host — so `engram://new-topic?...`
  // parses `new-topic` into `hostname`, not `pathname`. Unlike a special
  // scheme (http, https, ...), Node's URL parser does NOT lowercase this
  // host for an arbitrary scheme (verified: `new URL('engram://NEW-TOPIC')
  // .hostname === 'NEW-TOPIC'`), so the comparison is lowercased explicitly
  // — a host component is conventionally case-insensitive, and there is no
  // reason a byte-for-byte case match should be load-bearing here.
  if (parsed.hostname.toLowerCase() !== 'new-topic') {
    return { error: `wrong host: ${parsed.hostname}` }
  }

  const payload = parsed.searchParams.get('payload')
  if (!payload) {
    return { error: 'missing payload parameter' }
  }
  if (!BASE64URL_RE.test(payload)) {
    return { error: 'payload is not valid base64url' }
  }

  let decoded: unknown
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf-8')
    decoded = JSON.parse(json)
  } catch {
    return { error: 'payload does not decode to valid JSON' }
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    return { error: 'payload is not a JSON object' }
  }

  const p = decoded as Record<string, unknown>

  if (p.v !== 1) {
    return { error: `unsupported payload version: ${JSON.stringify(p.v)}` }
  }

  if (typeof p.goal !== 'string' || p.goal.length > MAX_GOAL_LEN) {
    return { error: `goal must be a string of at most ${MAX_GOAL_LEN} characters` }
  }
  const goal = normalizeHostileWhitespace(p.goal)
  if (goal.length === 0) {
    return { error: 'goal must not be empty (after removing control characters)' }
  }

  let contextFiles: string[] = []
  if (p.contextFiles !== undefined) {
    if (
      !Array.isArray(p.contextFiles) ||
      p.contextFiles.length > MAX_CONTEXT_FILES ||
      p.contextFiles.some((f) => typeof f !== 'string')
    ) {
      return { error: `contextFiles must be an array of at most ${MAX_CONTEXT_FILES} strings` }
    }
    contextFiles = p.contextFiles as string[]
  }

  let instructions = ''
  if (p.instructions !== undefined) {
    if (typeof p.instructions !== 'string' || p.instructions.length > MAX_INSTRUCTIONS_LEN) {
      return { error: `instructions must be a string of at most ${MAX_INSTRUCTIONS_LEN} characters` }
    }
    instructions = normalizeHostileWhitespace(p.instructions)
  }

  if (p.deadline !== undefined) {
    if (typeof p.deadline !== 'string' || !DEADLINE_RE.test(p.deadline)) {
      return { error: 'deadline must be a YYYY-MM-DD string' }
    }
    const note = deadlineNote(p.deadline)
    // Folded here (main process) so the renderer only ever sees
    // {goal, instructions, contextFiles} — it never learns there was a
    // separate `deadline` field at all. This exact sentence is pinned in
    // scripts/checkDoctrine.ts (D3.deepLinkText) — see that check's own
    // comment for why it needed its own pin rather than piggybacking on
    // D3.kickoff's existing collector.
    if (!instructions.includes(note)) {
      instructions = instructions.length > 0 ? `${instructions} ${note}` : note
    }
  }

  return { goal, instructions, contextFiles }
}

/** Impure: keeps only contextFiles entries that are safe to hand to the
 * model as a Read target — absolute, no `..`/relative segments, actually on
 * disk, a genuine regular file, and one of the allowed extensions. Uses
 * `lstatSync` (not `statSync`) deliberately: `lstatSync` reports the type of
 * the path itself rather than following a symlink to its target, so ANY
 * symlink is rejected outright — whether it's broken or points at a
 * perfectly legitimate file elsewhere. A deep link's contextFiles entries
 * are untrusted paths with no reason to ever be links; only a plain regular
 * file counts. Anything else is silently dropped rather than surfaced as an
 * error: a stale or hostile path in the link must not block the rest of a
 * legitimate prefill from reaching the learner. */
export function validateContextFiles(paths: string[]): string[] {
  return paths.filter((p) => {
    if (!isAbsolute(p)) return false
    if (normalize(p) !== p) return false // catches `..`/`.`/redundant-separator segments
    if (!ALLOWED_CONTEXT_EXTENSIONS.has(extname(p).toLowerCase())) return false
    try {
      return existsSync(p) && lstatSync(p).isFile()
    } catch {
      return false
    }
  })
}

/** Composes the pure parse with the impure filesystem check into the exact
 * shape main/index.ts's handleDeepLink delivers to the renderer — factored
 * out so both the real delivery path and this file's own tests exercise the
 * identical composition (previously duplicated inline in index.ts, which
 * has no test coverage since it imports `electron` at module scope).
 * `droppedContextFileCount` lets the modal tell the learner "N attached
 * files from the link couldn't be included" instead of silently showing
 * fewer files than the link actually carried. */
export function buildNewTopicPrefill(url: string): NewTopicPrefill | { error: string } {
  const parsed = parseEngramDeepLink(url)
  if ('error' in parsed) return parsed
  const validated = validateContextFiles(parsed.contextFiles)
  return {
    goal: parsed.goal,
    instructions: parsed.instructions,
    contextFiles: validated,
    droppedContextFileCount: parsed.contextFiles.length - validated.length,
  }
}
