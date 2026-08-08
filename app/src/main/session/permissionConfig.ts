import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

const BRIDGE_SERVER_NAME = 'engram-ui-bridge'

// Schema-level tool surface (see spike/FINDINGS.md Finding 1 — `--allowedTools`
// is inert in headless mode; `--tools` is what actually restricts what the
// model can even call). Kept to exactly what the /review, /learn, and /coach
// skills are documented to use: engram.py via Bash, tmpfiles via Write,
// subagent spawns via Task, and Read (both /learn and /review's SKILL.md
// open by instructing "Read dialogue-grammar.md now").
const MINIMAL_TOOLS = 'Bash,Write,Read,Task'

// Fine-grained denial within Bash — a light safety net on top of the --tools
// restriction, confirmed working in the spike (clean in-band denial, no hang).
const DISALLOWED_BASH_PATTERNS = [
  'Bash(rm -rf *)',
  'Bash(sudo *)',
  'Bash(curl *)',
  'Bash(wget *)',
  'Bash(> /dev/sd*)',
]

const APPEND_SYSTEM_PROMPT = `You are running headless, driven by a custom desktop app (Engram Desktop) rather than an interactive terminal. Three things differ from a normal interactive Claude Code session:

1. The native AskUserQuestion tool does not exist in this session. Whenever your instructions (the /engram:learn, /engram:review, or /engram:coach skill, or the shared dialogue-grammar.md) say to call AskUserQuestion, call the MCP tool mcp__${BRIDGE_SERVER_NAME}__ask_user_question instead, with the exact same arguments (question, header, options as an array of {label, description}, multiSelect). It behaves identically — it blocks until the learner picks an answer in the app UI.

2. Optionally, when you begin one of the dialogue-grammar's prose beats (open a gap, predict/attempt, struggle, resolve, self-explain, connect), you may call mcp__${BRIDGE_SERVER_NAME}__render_beat with the beat name and the content you're about to say, before saying it. This lets the app render a purpose-built card instead of a plain text block. It is entirely optional and never blocks — skip it if it would slow you down, the app degrades gracefully to a generic dialogue block. Include node and position ('n/of') when you know them.

3. A set of additional optional MCP tools lets you drive the app's UI as you teach. All are advisory and never block — skip any of them freely; the app degrades gracefully. Available: mcp__${BRIDGE_SERVER_NAME}__session_phase (call at each coarse phase transition: intake, pretest, walk, grading, closing); mcp__${BRIDGE_SERVER_NAME}__beat_outcome (when a beat resolves, report confirmed/partial/missed so the learner's beat trail inks honestly); mcp__${BRIDGE_SERVER_NAME}__spotlight_node (point at a node on the learner's Topic Map — especially during CONNECT beats); mcp__${BRIDGE_SERVER_NAME}__show_figure (a small markdown figure card set apart from prose — use sparingly); mcp__${BRIDGE_SERVER_NAME}__suggest_action (up to 3 one-click chips: open_explorable, show_on_map, go_review, prefill — prefill never auto-sends); mcp__${BRIDGE_SERVER_NAME}__progress_note (one-line session-plan status); mcp__${BRIDGE_SERVER_NAME}__annotate_node (attach LaTeX to a Topic Map node — latex_label for its plate caption, latex_claim for its claim in the drawer/full-node view; provide at least one, call again to update); mcp__${BRIDGE_SERVER_NAME}__render_ticket (when you print the session's opening ticket block — the "engram · <kind>" fenced summary the display formats describe — you may also call this with the same kind/mode/fields so the app renders it from real structured data instead of re-parsing your text; still print the fenced block as documented, this is purely an additional, optional path to the same card); in /review specifically, mcp__${BRIDGE_SERVER_NAME}__report_verdict (immediately before writing a grading-feedback paragraph that reveals the canonical answer or echoes the learner's confidence pick, call this with kind ('canonical' or 'confidence') and the exact text of that paragraph, then write the paragraph as you normally would — this lets the app style it correctly even when your wording doesn't open with a literal "Canonical:"/"Confidence:" label). Four more shape the teaching moments you already have, and carry only content you were going to write in prose anyway — they never license you to say something earlier than your instructions allow: mcp__${BRIDGE_SERVER_NAME}__render_comparison (a contrast case as two labelled columns — the boundary-drawing move); mcp__${BRIDGE_SERVER_NAME}__render_steps (a derivation or procedure as a numbered ladder, each rung with an optional 'why' note); mcp__${BRIDGE_SERVER_NAME}__render_formula (one display equation with a caption and a where-clause naming its symbols); mcp__${BRIDGE_SERVER_NAME}__cite_source (a provenance chip naming the source and place you're drawing on — never a citation you aren't actually working from); and mcp__${BRIDGE_SERVER_NAME}__render_plot (sketch the shape of a function from sampled [x, y] points — for a field inside vs outside a boundary, a payoff diagram, a decay; the app draws axes and traces the curve, and plots only the points you send); mcp__${BRIDGE_SERVER_NAME}__render_checks (the sanity checks an answer must survive — limiting cases, boundary agreement, dimensions — each paired with what it must give); mcp__${BRIDGE_SERVER_NAME}__render_timeline (a chronology as a dated spine; the \`when\` label is rendered verbatim, never parsed as a calendar date); and mcp__${BRIDGE_SERVER_NAME}__define_term (a term, its definition, and optionally the thing it is most often confused with). One more is not a display tool at all: mcp__${BRIDGE_SERVER_NAME}__propose_transcription, which you call when the learner attaches handwritten work — it returns the transcription to them for confirmation instead of into the dialogue, and they approve it before it becomes their answer. Transcribe it and stop: reproduce errors exactly, wrap expressions in $...$ or $$...$$ so they render, and say nothing — there or in the surrounding message — about whether the work is right, whether a step looks wrong, or what is missing from it. The learner has the page in front of them; that judgement is theirs to make and yours only once they submit. These serve the learner's orientation — never let them replace the dialogue itself.

4. The app renders LaTeX math ($...$ for inline, $$...$$ for display) via KaTeX — in ordinary chat prose, in text passed to mcp__${BRIDGE_SERVER_NAME}__render_beat, mcp__${BRIDGE_SERVER_NAME}__show_figure, mcp__${BRIDGE_SERVER_NAME}__ask_user_question, mcp__${BRIDGE_SERVER_NAME}__progress_note, mcp__${BRIDGE_SERVER_NAME}__render_comparison, mcp__${BRIDGE_SERVER_NAME}__render_steps and mcp__${BRIDGE_SERVER_NAME}__render_formula (whose \`latex\` field takes the bare expression, no delimiters), and in misconception descriptions logged via engram.py's \`misconception add\`. Prefer LaTeX delimiters over unicode approximation (ħ, ∂, ≥, etc.) anywhere you'd otherwise reach for one, so the app can actually set it as math.

Everything else about how you teach, grade, and schedule is unchanged — follow the installed skill and dialogue-grammar files exactly as written.`

export interface SessionPermissionSetup {
  mcpConfigPath: string
  tools: string
  disallowedTools: string
  allowedTools: string
  appendSystemPrompt: string
  cleanup: () => Promise<void>
}

/**
 * Absolute path to mcpBridgeWorker.mjs — a plain, unbundled Node ESM script
 * (see that file's header comment) that ships in the source tree rather than
 * going through electron-vite's bundler. In dev/`build`+`start`, `app.getAppPath()`
 * is the project root, so the source-tree path resolves directly. In a packaged
 * app, `app.getAppPath()` is the app.asar root — the raw `src/` tree isn't part
 * of that bundle — so it's shipped instead via electron-builder's `extraResources`
 * (see package.json) and read from `process.resourcesPath`.
 */
function resolveBridgeWorkerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'mcpBridgeWorker.mjs')
    : join(app.getAppPath(), 'src', 'main', 'bridge', 'mcpBridgeWorker.mjs')
}

/**
 * `extraInstructions`, when given, is a per-topic customization (see
 * topicSettings.ts — e.g. "use LaTeX for all equations") appended after the
 * base bridge instructions. Same additive-only principle as the bridge setup
 * itself: never fork the installed skill files, only ever add to the system
 * prompt layered on top of them.
 */
export async function prepareSessionPermissions(
  bridgePort: number,
  sessionId: string,
  extraInstructions?: string,
): Promise<SessionPermissionSetup> {
  const dir = await mkdtemp(join(tmpdir(), 'engram-desktop-mcp-'))
  const mcpConfigPath = join(dir, 'mcp-config.json')
  const workerPath = resolveBridgeWorkerPath()

  const config = {
    mcpServers: {
      [BRIDGE_SERVER_NAME]: {
        command: process.execPath,
        args: [workerPath],
        env: {
          ENGRAM_BRIDGE_PORT: String(bridgePort),
          ENGRAM_BRIDGE_SESSION_ID: sessionId,
          // Without this, process.execPath in a PACKAGED app is the branded "Engram
          // Desktop" binary itself, not a plain Node runtime — spawning it with a
          // script path as argv doesn't run that script, it boots a second full app
          // instance, which immediately hits our own requestSingleInstanceLock() and
          // quits (root-caused live: system/init showed mcp_servers status "failed",
          // and the model's tool_use for ask_user_question got "No such tool available"
          // back instantly). This forces Electron's binary to act as plain Node against
          // the given script instead, in both dev and packaged builds.
          ELECTRON_RUN_AS_NODE: '1',
        },
      },
    },
  }
  await writeFile(mcpConfigPath, JSON.stringify(config, null, 2), 'utf-8')

  const appendSystemPrompt = extraInstructions?.trim()
    ? `${APPEND_SYSTEM_PROMPT}\n\nAdditional instructions for this specific topic, set by the learner in the app's topic settings — follow these too:\n${extraInstructions.trim()}`
    : APPEND_SYSTEM_PROMPT

  return {
    mcpConfigPath,
    tools: MINIMAL_TOOLS,
    disallowedTools: DISALLOWED_BASH_PATTERNS.join(' '),
    allowedTools: `mcp__${BRIDGE_SERVER_NAME}__ask_user_question mcp__${BRIDGE_SERVER_NAME}__render_beat mcp__${BRIDGE_SERVER_NAME}__session_phase mcp__${BRIDGE_SERVER_NAME}__beat_outcome mcp__${BRIDGE_SERVER_NAME}__spotlight_node mcp__${BRIDGE_SERVER_NAME}__show_figure mcp__${BRIDGE_SERVER_NAME}__suggest_action mcp__${BRIDGE_SERVER_NAME}__progress_note mcp__${BRIDGE_SERVER_NAME}__annotate_node mcp__${BRIDGE_SERVER_NAME}__render_ticket mcp__${BRIDGE_SERVER_NAME}__report_verdict mcp__${BRIDGE_SERVER_NAME}__render_comparison mcp__${BRIDGE_SERVER_NAME}__render_steps mcp__${BRIDGE_SERVER_NAME}__render_formula mcp__${BRIDGE_SERVER_NAME}__cite_source mcp__${BRIDGE_SERVER_NAME}__render_plot mcp__${BRIDGE_SERVER_NAME}__render_checks mcp__${BRIDGE_SERVER_NAME}__render_timeline mcp__${BRIDGE_SERVER_NAME}__define_term mcp__${BRIDGE_SERVER_NAME}__propose_transcription`,
    appendSystemPrompt,
    cleanup: async () => {
      const { rm } = await import('node:fs/promises')
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}
