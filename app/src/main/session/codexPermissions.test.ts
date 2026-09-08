import { describe, expect, it } from 'vitest'
import { buildCodexThreadSetup } from './codexPermissions'

describe('buildCodexThreadSetup', () => {
  it('requires the Engram bridge and registers the three isolated agents', () => {
    const setup = buildCodexThreadSetup({
      bridgePort: 4312,
      sessionId: 'desktop-session',
      workerPath: '/app/mcpBridgeWorker.mjs',
      engramRoot: '/plugins/engram/1.2.3',
      electronPath: '/app/Engram Desktop',
      extraInstructions: 'Use the learner’s notation.',
    })

    expect(setup.config.forced_login_method).toBe('chatgpt')
    expect(setup.config.model_provider).toBe('openai')
    expect(setup.config.mcp_servers).toMatchObject({
      'engram-ui-bridge': {
        command: '/app/Engram Desktop',
        args: ['/app/mcpBridgeWorker.mjs'],
        required: true,
        // Engram's private loopback bridge must run without a second Codex
        // approval prompt; ask_user_question is itself the app's modal.
        default_tools_approval_mode: 'approve',
        env: {
          ENGRAM_BRIDGE_PORT: '4312',
          ENGRAM_BRIDGE_SESSION_ID: 'desktop-session',
          ELECTRON_RUN_AS_NODE: '1',
        },
      },
    })
    expect(setup.config.agents).toMatchObject({
      enabled: true,
      'engram-assessor': { config_file: '/plugins/engram/1.2.3/codex/agents/engram-assessor.toml' },
      'engram-curriculum-architect': { config_file: '/plugins/engram/1.2.3/codex/agents/engram-curriculum-architect.toml' },
      'engram-artifact-smith': { config_file: '/plugins/engram/1.2.3/codex/agents/engram-artifact-smith.toml' },
    })
    expect(setup.developerInstructions).toContain('Use the learner’s notation.')
    expect(setup.developerInstructions).toContain('mcp__engram-ui-bridge__ask_user_question')
  })
})
