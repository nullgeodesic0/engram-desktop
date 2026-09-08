import { join } from 'node:path'
import { BRIDGE_SERVER_NAME, BRIDGE_TOOL_NAMES, CLAUDE_TOOL_PREFIX, buildAppendSystemPrompt } from './permissionConfig'

export interface CodexThreadSetupOptions {
  bridgePort: number
  sessionId: string
  workerPath: string
  engramRoot: string
  electronPath: string
  extraInstructions?: string
}

/** In-memory Codex thread configuration. Unlike Claude's CLI adapter this
 * needs no temporary config file: app-server accepts the exact same MCP and
 * agent settings as per-thread config overrides. */
export function buildCodexThreadSetup(options: CodexThreadSetupOptions): {
  config: Record<string, unknown>
  developerInstructions: string
} {
  const baseInstructions = buildAppendSystemPrompt(CLAUDE_TOOL_PREFIX)
  const developerInstructions = options.extraInstructions?.trim()
    ? `${baseInstructions}\n\nAdditional instructions for this specific topic, set by the learner in the app's topic settings — follow these too:\n${options.extraInstructions.trim()}`
    : baseInstructions

  return {
    config: {
      forced_login_method: 'chatgpt',
      model_provider: 'openai',
      hide_agent_reasoning: true,
      features: { multi_agent: true },
      agents: {
        enabled: true,
        'engram-assessor': {
          description: 'Blindly assess learner responses using the Engram rubric.',
          config_file: join(options.engramRoot, 'codex', 'agents', 'engram-assessor.toml'),
        },
        'engram-curriculum-architect': {
          description: 'Design Engram curricula and topic graphs.',
          config_file: join(options.engramRoot, 'codex', 'agents', 'engram-curriculum-architect.toml'),
        },
        'engram-artifact-smith': {
          description: 'Create supporting Engram learning artifacts.',
          config_file: join(options.engramRoot, 'codex', 'agents', 'engram-artifact-smith.toml'),
        },
      },
      mcp_servers: {
        [BRIDGE_SERVER_NAME]: {
          command: options.electronPath,
          args: [options.workerPath],
          env: {
            ENGRAM_BRIDGE_PORT: String(options.bridgePort),
            ENGRAM_BRIDGE_SESSION_ID: options.sessionId,
            ELECTRON_RUN_AS_NODE: '1',
          },
          enabled: true,
          required: true,
          enabled_tools: [...BRIDGE_TOOL_NAMES],
          default_tools_approval_mode: 'auto',
          tool_timeout_sec: 600,
        },
      },
    },
    developerInstructions,
  }
}
