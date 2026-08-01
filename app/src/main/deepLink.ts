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

import { existsSync, statSync } from 'node:fs'
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

function deadlineNote(deadline: string): string {
  return `I need this understood by ${deadline} — pace the curriculum accordingly.`
}

/** Pure: decodes + shape-guards an `engram://new-topic?payload=<base64url>`
 * URL into a `NewTopicPrefill`, or an `{ error }` describing why it was
 * rejected. `contextFiles` here is only type/length-checked — filesystem
 * legitimacy is validateContextFiles' job, called separately by the caller. */
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

  if (typeof p.goal !== 'string' || p.goal.length === 0 || p.goal.length > MAX_GOAL_LEN) {
    return { error: `goal must be a non-empty string of at most ${MAX_GOAL_LEN} characters` }
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
    instructions = p.instructions
  }

  if (p.deadline !== undefined) {
    if (typeof p.deadline !== 'string' || !DEADLINE_RE.test(p.deadline)) {
      return { error: 'deadline must be a YYYY-MM-DD string' }
    }
    const note = deadlineNote(p.deadline)
    // Folded here (main process) so the renderer only ever sees
    // {goal, instructions, contextFiles} — it never learns there was a
    // separate `deadline` field at all.
    if (!instructions.includes(note)) {
      instructions = instructions.length > 0 ? `${instructions} ${note}` : note
    }
  }

  return { goal: p.goal, instructions, contextFiles }
}

/** Impure: keeps only contextFiles entries that are safe to hand to the
 * model as a Read target — absolute, no `..`/relative segments, actually on
 * disk, a regular file (not a directory/socket/symlink-to-nowhere), and one
 * of the allowed extensions. Anything else is silently dropped rather than
 * surfaced as an error: a stale or hostile path in the link must not block
 * the rest of a legitimate prefill from reaching the learner. */
export function validateContextFiles(paths: string[]): string[] {
  return paths.filter((p) => {
    if (!isAbsolute(p)) return false
    if (normalize(p) !== p) return false // catches `..`/`.`/redundant-separator segments
    if (!ALLOWED_CONTEXT_EXTENSIONS.has(extname(p).toLowerCase())) return false
    try {
      return existsSync(p) && statSync(p).isFile()
    } catch {
      return false
    }
  })
}
