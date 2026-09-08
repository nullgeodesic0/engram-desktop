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

import { homedir } from 'node:os'
import { resolveEngramPlugin } from './pluginResolver'
import { resolveClaudeBinary } from './claudeResolver'
import { buildSessionEnv } from './sessionEnv'
import { ensurePython3Shim } from '../engramCli/pythonShim'
import { getAuthSettings } from './authSettings'
import { apiKeyStore } from './auth'
import { execCli } from '../platform'
import { resolveCodexBinary } from './codexResolver'
import { assertCodexSubscriptionAccount, launchCodexAppServer, type CodexAccountResponse, type CodexWireMessage } from './codexAppServerClient'
import { buildCodexSessionEnv } from './codexEnv'
import { listCodexModels } from './codexModels'
import type { CodexModelOption } from '../../shared/types'

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

export function buildCodexTranscriptionInput(pages: readonly string[]): Array<Record<string, unknown>> {
  return [
    { type: 'text', text: buildPrompt(pages), text_elements: [] },
    ...pages.map((path) => ({ type: 'localImage', path })),
  ]
}

export function assertCodexImageModel(models: readonly CodexModelOption[], selectedModel: string): void {
  const option = models.find((candidate) => candidate.value === selectedModel)
  if (!option) throw new Error('The selected Codex model is no longer available. Choose another model in Settings.')
  if (option.inputModalities.length > 0 && !option.inputModalities.includes('image')) {
    throw new Error(`${option.label} does not accept images. Choose an image-capable Codex model in Settings before transcribing handwriting.`)
  }
}

export function codexTranscriptionTurnError(turn: Record<string, unknown>): Error | null {
  if (turn.status === 'completed') return null
  const detail = turn.error && typeof turn.error === 'object' ? turn.error as Record<string, unknown> : {}
  const message = typeof detail.message === 'string'
    ? detail.message
    : `Codex handwriting transcription ${typeof turn.status === 'string' ? turn.status : 'did not complete'}`
  return new Error(message)
}

async function transcribeWithCodex(pages: readonly string[], engramRoot: string, model: string): Promise<string> {
  const binary = await resolveCodexBinary()
  const client = launchCodexAppServer(binary, {
    cwd: homedir(),
    env: buildCodexSessionEnv(process.env, engramRoot, await ensurePython3Shim()),
  })
  try {
    await client.initialize()
    assertCodexSubscriptionAccount(
      await client.request<CodexAccountResponse>('account/read', { refreshToken: false }),
    )
    const thread = await client.request<{ thread: { id: string } }>('thread/start', {
      ...(model ? { model } : {}),
      modelProvider: 'openai',
      cwd: homedir(),
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      config: {
        forced_login_method: 'chatgpt',
        model_provider: 'openai',
        hide_agent_reasoning: true,
      },
      serviceName: 'engram_desktop_handwriting',
      developerInstructions: 'Transcribe only. Do not infer, grade, teach, correct, or use any context outside the attached pages.',
    })

    let output = ''
    let expectedTurnId = ''
    let detachCompletionListeners = () => {}
    const completed = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        client.off('notification', onNotification)
        client.off('closed', onClosed)
      }
      const onNotification = (message: CodexWireMessage) => {
        const params = message.params && typeof message.params === 'object' ? message.params as Record<string, unknown> : {}
        if (params.threadId !== thread.thread.id) return
        if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') output += params.delta
        if (message.method !== 'turn/completed') return
        const turn = params.turn && typeof params.turn === 'object' ? params.turn as Record<string, unknown> : {}
        if (expectedTurnId && turn.id !== expectedTurnId) return
        cleanup()
        const error = codexTranscriptionTurnError(turn)
        if (error) reject(error)
        else resolve()
      }
      const onClosed = (details: { code?: number | null; error?: Error }) => {
        cleanup()
        reject(details.error ?? new Error(`Codex app-server exited before handwriting transcription completed (code ${details.code ?? 'unknown'})`))
      }
      detachCompletionListeners = cleanup
      client.on('notification', onNotification)
      client.on('closed', onClosed)
    })
    // The listener is installed before turn/start so a very fast completion
    // cannot be missed. Mark it handled in case turn/start itself rejects.
    void completed.catch(() => {})
    const started = await client.request<{ turn: { id: string } }>('turn/start', {
      threadId: thread.thread.id,
      input: buildCodexTranscriptionInput(pages),
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      ...(model ? { model } : {}),
    })
    expectedTurnId = started.turn.id
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        completed,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Codex handwriting transcription timed out')), TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
      detachCompletionListeners()
    }
    return output.trim()
  } finally {
    client.close()
  }
}

/** Transcribes the given image paths and returns plain LaTeX text — never
 * touches any live tutoring session, never sees a node/claim/rubric, and is
 * given no instruction other than "transcribe exactly what is there." */
export async function transcribeHandwriting(pages: readonly string[]): Promise<string> {
  if (pages.length === 0) return ''
  const { root: engramRoot } = resolveEngramPlugin()
  const { authMode, localBaseUrl, localModel, subscriptionModel, codexModel } = await getAuthSettings()

  if (authMode === 'codexSubscription') {
    const selectedModel = codexModel.trim()
    assertCodexImageModel(await listCodexModels(), selectedModel)
    return transcribeWithCodex(pages, engramRoot, selectedModel)
  }

  const claudeBin = await resolveClaudeBinary()

  const args = [
    '-p', buildPrompt(pages),
    '--tools', 'Read',
    '--permission-mode', 'bypassPermissions',
    // Same reasoning as SessionManager's own spawn: 'local' only, so this
    // throwaway process can never pick up an unrelated project's global
    // Stop hook from settings.local.json.
    '--setting-sources', 'user,project',
  ]
  // Same gating as SessionManager's own spawn — see its comment for why
  // subscription mode is optional here and local mode is not. A photographed
  // page runs through this exact same path once per attachment, so the
  // learner's model pick applies here too rather than only to live sittings.
  if (authMode === 'local') {
    if (localModel.trim() === '') {
      throw new Error('Local-model mode is selected but no model is chosen — pick one in Settings → Authentication, or switch back to subscription mode.')
    }
    args.push('--model', localModel.trim())
  } else if (authMode === 'subscription' && subscriptionModel.trim() !== '') {
    args.push('--model', subscriptionModel.trim())
  }

  const env = buildSessionEnv(
    process.env,
    engramRoot,
    authMode,
    authMode === 'apiKey' ? apiKeyStore().get() : null,
    authMode === 'local' ? localBaseUrl : null,
    await ensurePython3Shim(),
  )

  // `execCli`, not `execFile` — `claudeBin` may be a Windows `.cmd` shim, and
  // the prompt argument here is a paragraph of prose with spaces in it. See
  // platform.ts.
  const { stdout } = await execCli(claudeBin, args, {
    cwd: homedir(),
    env,
    timeout: TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout.trim()
}
