/** A one-off, isolated `claude -p` call that transcribes handwritten pages to
 * LaTeX — and NOTHING else. This is the fix for a real gap the previous
 * design had: the old flow asked the LIVE TUTOR SESSION to delegate
 * transcription to a Task subagent via a prompt instruction
 * ("using a subagent given only these paths and that instruction",
 * shared/handwritingRequest.ts's old wording) — but the tutor session is
 * itself granted `Read` (needed for its own skill files), so nothing in
 * CODE stopped it from reading the raw handwriting image directly and
 * commenting on it in its own dialogue before the learner ever saw the
 * confirmation card. A reader reported exactly that: the tutor "receiving
 * and using" their input before they pressed confirm.
 *
 * The fix is structural, not a stronger prompt: this function runs BEFORE
 * any turn reaches the actual tutor session at all. It spawns its own
 * throwaway `claude -p` process — no MCP bridge, no engram.py, no topic,
 * no node, no claim, no rubric, `--tools Read` and nothing else — reads
 * the given files, and returns plain transcribed text. Only once the
 * learner has confirmed that text (TranscriptionCard, rendered by the
 * caller BEFORE any session message is sent) does the CONFIRMED text ever
 * reach the tutor, as an ordinary user turn — never the raw image paths,
 * never a chance for the tutor to see the pages itself. The old in-dialogue
 * `propose_transcription` tool/TranscriptionCard `live` path stays wired
 * for REPLAY of sessions recorded before this fix; this is the only path a
 * fresh attachment takes now. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { resolveEngramPlugin } from './pluginResolver'
import { resolveClaudeBinary } from './claudeResolver'
import { buildSessionEnv } from './sessionEnv'
import { getAuthSettings } from './authSettings'
import { apiKeyStore } from './auth'

const execFileAsync = promisify(execFile)

/** Ten minutes — generous for a handful of photographed pages, short enough
 * that a genuinely wedged child (bad auth, a hung endpoint) fails loudly
 * rather than holding the confirm card in "transcribing…" forever. */
const TIMEOUT_MS = 10 * 60 * 1000

/** Exported for checkDoctrine's own pin on this exact text (the blindest
 * prompt in the app — literally zero context beyond file paths) and for
 * transcribeHandwriting.test.ts. */
export function buildPrompt(pages: readonly string[]): string {
  const list = pages.map((p, i) => `${i + 1}. ${p}`).join('\n')
  return `Read each of these image files, in order, then transcribe the handwritten mathematics/prose in them to LaTeX exactly as written — including any errors; do not correct, complete, or improve anything. Wrap each expression in $...$ inline or on its own line in $$...$$. Output ONLY the transcription, in reading order, with nothing else: no preamble, no summary, no commentary on whether anything is right or wrong, no closing remarks.

Files:
${list}`
}

/** Transcribes the given image paths and returns plain LaTeX text — never
 * touches any live tutoring session, never sees a node/claim/rubric, and is
 * given no instruction other than "transcribe exactly what is there." */
export async function transcribeHandwriting(pages: readonly string[]): Promise<string> {
  if (pages.length === 0) return ''
  const { root: engramRoot } = resolveEngramPlugin()
  const claudeBin = await resolveClaudeBinary()
  const { authMode, localBaseUrl, localModel } = await getAuthSettings()

  const args = [
    '-p', buildPrompt(pages),
    '--tools', 'Read',
    '--permission-mode', 'bypassPermissions',
    // Same reasoning as SessionManager's own spawn: 'local' only, so this
    // throwaway process can never pick up an unrelated project's global
    // Stop hook from settings.local.json.
    '--setting-sources', 'user,project',
  ]
  if (authMode === 'local') {
    if (localModel.trim() === '') {
      throw new Error('Local-model mode is selected but no model is chosen — pick one in Settings → Authentication, or switch back to subscription mode.')
    }
    args.push('--model', localModel.trim())
  }

  const env = buildSessionEnv(process.env, engramRoot, authMode, authMode === 'apiKey' ? apiKeyStore().get() : null, authMode === 'local' ? localBaseUrl : null)

  const { stdout } = await execFileAsync(claudeBin, args, {
    cwd: homedir(),
    env,
    timeout: TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout.trim()
}
