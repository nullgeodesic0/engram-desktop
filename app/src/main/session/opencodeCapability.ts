/** Setup checks and the capability probe for OpenCode + Cursor mode —
 * the same "verify a model can actually drive a sitting before trusting it"
 * discipline `localModel.ts` established for the local-model provider, with
 * one difference worth being explicit about: a probe run here spends real
 * money against the user's Cursor plan (confirmed live — a one-word "pong"
 * reply through `cursor-acp/auto` cost $0.036 real, reported back by the
 * server itself in the message response's `cost` field). Ollama's probe is
 * free; this one is not, so it is user-triggered ONLY (a Settings button),
 * never run automatically, and the real cost is surfaced rather than hidden.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as http from 'node:http'
import { resolveOpencodeBinary } from './opencodeResolver'
import { prepareOpencodeSession } from './opencodePermissions'
import { bridgeServer } from '../bridge/bridgeServer'
import { spawn } from 'node:child_process'
import type { OpencodeSetupStatus, OpencodeProbe } from '../../shared/types'

export { describeOpencodeProbe } from '../../shared/opencodeVerdict'

const execAsync = promisify(exec)

/** No live server, no cost — just "is this usable at all". Shells out to the
 * CLI's own `models` listing rather than standing up an `opencode serve`
 * just to enumerate models. */
export async function checkOpencodeSetup(): Promise<OpencodeSetupStatus> {
  const binaryPath = await resolveOpencodeBinary().catch(() => null)
  if (!binaryPath) {
    return { binaryFound: false, binaryPath: null, models: [], error: 'opencode CLI not found.' }
  }
  try {
    const { stdout } = await execAsync(`${JSON.stringify(binaryPath)} models cursor-acp`, { timeout: 15_000 })
    const models = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('cursor-acp/'))
      .map((l) => l.slice('cursor-acp/'.length))
    if (models.length === 0) {
      return {
        binaryFound: true,
        binaryPath,
        models: [],
        error:
          'No cursor-acp models found. Install the plugin once from a terminal: `opencode plugin cursor-acp`, then make sure Cursor is open and signed in.',
      }
    }
    return { binaryFound: true, binaryPath, models, error: null }
  } catch (err) {
    return {
      binaryFound: true,
      binaryPath,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** A REAL turn through a REAL `opencode serve`, using the exact same session
 * setup (bridge MCP, tool allow-map, system prompt) a live sitting would use
 * — the only difference from a real sitting is the prompt and that it always
 * runs to exactly one turn. Costs real money; see this file's header. */
export async function probeOpencodeModel(model: string, timeoutMs = 60_000): Promise<OpencodeProbe> {
  if (model.trim() === '') return { ok: false, toolUse: false, costUsd: null, error: 'No model selected.' }

  let child: ReturnType<typeof spawn> | null = null
  let cleanup: (() => Promise<void>) | null = null
  try {
    const port = await bridgeServer.start()
    const setup = await prepareOpencodeSession(port, `probe-${Date.now()}`, model)
    cleanup = setup.cleanup
    const bin = await resolveOpencodeBinary()
    child = spawn(bin, ['serve', '--port', '0'], {
      cwd: setup.workspaceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENCODE_CONFIG: setup.opencodeConfigPath },
    })

    const port2 = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('opencode serve did not start within 30s')), 30_000)
      child!.stdout!.on('data', (chunk: Buffer) => {
        const m = chunk.toString('utf-8').match(/listening on http:\/\/[^:]+:(\d+)/)
        if (m) {
          clearTimeout(timer)
          resolve(Number(m[1]))
        }
      })
      child!.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child!.once('close', (code) => {
        clearTimeout(timer)
        reject(new Error(`opencode serve exited before starting (code ${code})`))
      })
    })

    const baseUrl = `http://127.0.0.1:${port2}`
    const created = await httpJson<{ id: string }>(baseUrl, setup.workspaceDir, 'POST', '/session', { title: 'Engram probe' })

    const toolProbe = Object.keys(setup.tools).find((n) => n.endsWith('render_ticket')) ?? Object.keys(setup.tools)[0]
    const response = await httpJson<{
      info?: { cost?: number }
      parts?: Array<{ type?: string; tool?: string }>
    }>(baseUrl, setup.workspaceDir, 'POST', `/session/${created.id}/message`, {
      parts: [
        {
          type: 'text',
          text: `Call the ${toolProbe} tool for node "kepler-orbits" at index 1. Use the tool rather than describing the call.`,
        },
      ],
      model: setup.model,
      system: setup.systemPrompt,
      tools: setup.tools,
    }, timeoutMs)

    const toolUse = (response.parts ?? []).some((p) => p.type === 'tool')
    return { ok: toolUse, toolUse, costUsd: response.info?.cost ?? null, error: null }
  } catch (err) {
    return { ok: false, toolUse: false, costUsd: null, error: err instanceof Error ? err.message : String(err) }
  } finally {
    child?.kill()
    if (cleanup) void cleanup()
  }
}

function httpJson<T>(baseUrl: string, directory: string, method: string, path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const url = new URL(`${baseUrl}${path}`)
  url.searchParams.set('directory', directory)
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`opencode ${method} ${path} -> ${res.statusCode}: ${text.slice(0, 300)}`))
            return
          }
          try {
            resolve(text ? JSON.parse(text) : ({} as T))
          } catch (err) {
            reject(err)
          }
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)))
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

