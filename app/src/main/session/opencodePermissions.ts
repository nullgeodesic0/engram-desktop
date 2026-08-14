import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { BRIDGE_SERVER_NAME, BRIDGE_TOOL_NAMES, buildAppendSystemPrompt, resolveBridgeWorkerPath } from './permissionConfig'
import { resolveOpencodePluginPath } from './opencodeResolver'

/** OpenCode's own MCP-tool naming convention — see `CLAUDE_TOOL_PREFIX`'s
 * doctrine comment in permissionConfig.ts for how this was determined
 * (measured live against a real `opencode serve`, not guessed): the
 * server-name segment has its hyphens replaced with underscores. */
export const OPENCODE_TOOL_PREFIX = `mcp__${BRIDGE_SERVER_NAME.replace(/-/g, '_')}__`

export interface OpencodeSessionSetup {
  /** Passed as `OPENCODE_CONFIG` to the spawned `opencode serve`. Additive —
   * confirmed live that OpenCode merges this with the user's own
   * `~/.config/opencode/opencode.json` (which is where a `cursor-acp`
   * plugin install and its provider/model roster already live), so this
   * file only needs to add what THIS session needs: the bridge MCP server
   * and the engram-learning plugin. It must never declare a `provider`
   * block itself — that would be this app taking over configuration that
   * belongs to the user's own OpenCode setup. */
  opencodeConfigPath: string
  /** The directory the `opencode serve` child is spawned with as `cwd`, and
   * passed as `?directory=` on every HTTP call to it (confirmed live: the
   * SSE global event bus and several endpoints route differently without a
   * `directory` query param). STABLE across sittings — the
   * `opencode-engram-learning` plugin self-extracts its skills/agents into
   * `<directory>/.opencode/` on first use per that plugin's own README
   * ("Subsequent sessions use OpenCode's native disk discovery"), so
   * reusing the same directory means that extraction happens once per
   * install, not once per sitting. */
  workspaceDir: string
  /** `{providerID, modelID}` for the `POST /session/{id}/message` body. */
  model: { providerID: string; modelID: string }
  /** For the `system` field on that same request. */
  systemPrompt: string
  /** For the `tools` enable-map on that same request — `true` for every
   * bridge tool, `false` for nothing else (OpenCode's own built-ins stay at
   * their defaults; this map only ever grants, never revokes, matching the
   * bridge tools being purely additive/advisory). */
  tools: Record<string, boolean>
  cleanup: () => Promise<void>
}

function resolveWorkspaceDir(): string {
  return join(app.getPath('userData'), 'opencode-workspace')
}

/**
 * OpenCode analog of `prepareSessionPermissions` — same bridge worker, same
 * `bridgeServer` HTTP routes (both are provider-agnostic: the worker only
 * knows it talks MCP on one side and HTTP to `127.0.0.1:<bridgePort>` on the
 * other, never which CLI spawned it), different config file shape and a
 * different tool-name prefix. See that function's own doctrine comments for
 * what the bridge tools are for; not repeated here.
 */
export async function prepareOpencodeSession(
  bridgePort: number,
  sessionId: string,
  opencodeModel: string,
  extraInstructions?: string,
): Promise<OpencodeSessionSetup> {
  const dir = await mkdtemp(join(tmpdir(), 'engram-desktop-opencode-'))
  const opencodeConfigPath = join(dir, 'opencode.json')
  const workspaceDir = resolveWorkspaceDir()
  await mkdir(workspaceDir, { recursive: true })

  const workerPath = resolveBridgeWorkerPath()
  const pluginPath = resolveOpencodePluginPath() // throws with an actionable message if not vendored/installed

  const config = {
    $schema: 'https://opencode.ai/config.json',
    plugin: [pluginPath],
    mcp: {
      [BRIDGE_SERVER_NAME]: {
        type: 'local',
        command: [process.execPath, workerPath],
        environment: {
          ENGRAM_BRIDGE_PORT: String(bridgePort),
          ENGRAM_BRIDGE_SESSION_ID: sessionId,
          // Same requestSingleInstanceLock() hazard `permissionConfig.ts`
          // documents for the Claude path — process.execPath in a packaged
          // app is the Engram Desktop binary itself, not plain Node.
          ELECTRON_RUN_AS_NODE: '1',
        },
        enabled: true,
      },
    },
  }
  await writeFile(opencodeConfigPath, JSON.stringify(config, null, 2), 'utf-8')

  const basePrompt = buildAppendSystemPrompt(OPENCODE_TOOL_PREFIX)
  const systemPrompt = extraInstructions?.trim()
    ? `${basePrompt}\n\nAdditional instructions for this specific topic, set by the learner in the app's topic settings — follow these too:\n${extraInstructions.trim()}`
    : basePrompt

  const tools: Record<string, boolean> = {}
  for (const name of BRIDGE_TOOL_NAMES) tools[`${OPENCODE_TOOL_PREFIX}${name}`] = true

  return {
    opencodeConfigPath,
    workspaceDir,
    model: { providerID: 'cursor-acp', modelID: opencodeModel },
    systemPrompt,
    tools,
    cleanup: async () => {
      const { rm } = await import('node:fs/promises')
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}
