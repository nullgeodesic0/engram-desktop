/** Local-model support — pointing the same `claude` binary at a runtime on
 * this machine instead of at Anthropic.
 *
 * NO PROXY, and that is worth stating because it is the surprising part.
 * Ollama 0.32+ serves the Anthropic Messages API directly at
 * `/v1/messages` (its binary carries a real Anthropic middleware —
 * ContentBlockStart/Delta/Stop events and all), which is exactly what
 * `ollama launch claude` wires up behind the scenes. So the whole feature
 * is two environment variables and a `--model` flag; there is no
 * translation layer in this app to maintain and no second wire format to
 * keep in sync. Anything else exposing an Anthropic-compatible endpoint
 * (LM Studio, llama.cpp behind a shim) works through the same setting.
 *
 * THE CAPABILITY PROBE IS THE POINT. A sitting is not prose — it is tool
 * calls. The tutor renders a ticket, asks a checkpoint, and runs
 * `engram rate` to write the receipt, all through tool_use blocks. A model
 * that answers beautifully in prose but cannot emit a tool_use block will
 * open a sitting, appear to work, and write nothing to the learner's
 * record. That failure is silent and it corrupts the one thing this app
 * promises to keep honest, so a model is probed before it is trusted
 * rather than after a lost sitting.
 *
 * Measured against Ollama 0.32.9 + `Randomblock1/nemotron-nano`: prose
 * fine, and for a tool it returns a ```json fence inside a TEXT block with
 * `stop_reason: end_turn`. That is the `toolUseImitation` case — the model
 * understood the request and cannot express it, which is a different
 * problem from a model that ignores tools entirely, so the two are
 * reported separately.
 */

import type { LocalModelProbe } from '../../shared/types'

export { describeProbe } from '../../shared/localModelVerdict'

export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434'

/** Deliberately shaped like a real bridge tool rather than a toy: an object
 * schema with a required string and a required integer, which is the shape
 * `render_ticket` actually uses. A model that can only manage zero-argument
 * tools would pass a simpler probe and still fail a sitting. */
const PROBE_TOOL = {
  name: 'render_ticket',
  description: 'Show the session ticket for the current node to the learner.',
  input_schema: {
    type: 'object',
    properties: {
      node: { type: 'string', description: 'The node id being reviewed.' },
      index: { type: 'integer', description: 'Position in the queue, 1-based.' },
    },
    required: ['node', 'index'],
  },
} as const

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/** Loopback only, and this is a product boundary rather than a nicety.
 *
 * PRODUCT.md's standing promise is that the app is 100% local — no server,
 * no sync, no telemetry. This one setting decides where a learner's
 * PRODUCTIONS go: their half-formed recall, their misconceptions, the
 * things they got wrong. A hostname typed into a box labelled "local
 * model" must not be able to quietly turn that promise off and stream all
 * of it to a third party. Anyone who genuinely wants a remote endpoint can
 * say so deliberately somewhere that reads like the choice it is.
 *
 * Parsed, never matched by prefix: `http://localhost.evil.com` and
 * `http://127.0.0.1.evil.com` both begin with a loopback-looking string and
 * resolve anywhere at all. */
export function isLoopbackUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/** Tags the runtime reports. Ollama's native route; absent elsewhere, which
 * is not an error — the model list is a convenience for the picker, never a
 * gate (an unlisted tag may still serve). */
export async function listLocalModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await fetch(`${normalizeBase(baseUrl)}/api/tags`, { signal })
    if (!res.ok) return []
    const body = (await res.json()) as { models?: Array<{ name?: unknown }> }
    return (body.models ?? [])
      .map((m) => (typeof m.name === 'string' ? m.name : null))
      .filter((n): n is string => n !== null)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/** One prose call and one tool call against the real endpoint.
 *
 * Never throws: every failure is a field on the result, because this runs
 * to ANSWER "will this work", and a probe that throws forces the caller to
 * turn an exception back into that answer. */
export async function probeLocalModel(
  baseUrl: string,
  model: string,
  timeoutMs = 90_000,
): Promise<LocalModelProbe> {
  const base = normalizeBase(baseUrl)
  const out: LocalModelProbe = {
    reachable: false,
    text: false,
    toolUse: false,
    toolUseImitation: false,
    models: [],
    error: null,
  }
  if (model.trim() === '') {
    out.error = 'No model selected.'
    return out
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    out.models = await listLocalModels(base, controller.signal)

    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 512,
        tools: [PROBE_TOOL],
        messages: [
          {
            role: 'user',
            content:
              'Call the render_ticket tool for node "kepler-orbits" at index 1. Use the tool rather than describing the call.',
          },
        ],
      }),
    })
    out.reachable = true
    if (!res.ok) {
      out.error = `${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`
      return out
    }

    const body = (await res.json()) as {
      content?: Array<{ type?: unknown; text?: unknown }>
    }
    for (const block of body.content ?? []) {
      if (block.type === 'tool_use') out.toolUse = true
      if (block.type === 'text' && typeof block.text === 'string') {
        out.text = true
        // A fenced or bare JSON object naming the tool — the model tried and
        // emitted the wrong shape. Matched on the tool NAME plus a brace so
        // ordinary prose mentioning the tool does not count.
        if (/[{[]/.test(block.text) && block.text.includes(PROBE_TOOL.name)) {
          out.toolUseImitation = true
        }
      }
    }
    return out
  } catch (err) {
    // An abort is a timeout, which for a local runtime usually means the
    // model is still loading into memory rather than that anything is
    // broken — say so, since the fix is "wait and retry", not "reconfigure".
    if (controller.signal.aborted) {
      out.error = `No response within ${Math.round(timeoutMs / 1000)}s. A large model can take a while to load on first use — try again once it is resident.`
    } else {
      out.error = err instanceof Error ? err.message : String(err)
    }
    return out
  } finally {
    clearTimeout(timer)
  }
}
