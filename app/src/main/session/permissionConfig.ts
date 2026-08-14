import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

export const BRIDGE_SERVER_NAME = 'engram-ui-bridge'

/**
 * Claude Code's own MCP-tool allowlist convention is
 * `mcp__<server-name>__<tool>`, server name verbatim (hyphens and all) — this
 * is what `--allowedTools` expects and what the CLI actually calls tools by,
 * confirmed live. OpenCode's is the same shape with one difference: the
 * server-name segment has hyphens replaced with underscores (confirmed live
 * against a real `opencode serve` with this exact worker registered —
 * `mcp__engram_ui_bridge__render_ticket`, not `mcp__engram-ui-bridge__*` as
 * it would be tempting to guess). `opencodePermissions.ts` passes its own
 * prefix into `buildAppendSystemPrompt` below rather than duplicating this
 * ~4000-word prompt with the names hand-edited — a second copy is exactly
 * how the two providers would silently drift out of sync.
 */
export const CLAUDE_TOOL_PREFIX = `mcp__${BRIDGE_SERVER_NAME}__`

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

/**
 * `toolPrefix` is the ONLY thing that varies between providers — see
 * `CLAUDE_TOOL_PREFIX` above and `OPENCODE_TOOL_PREFIX` in
 * `opencodePermissions.ts`. Everything else about how the bridge tools work
 * (what they're for, when to call them, that they're all advisory) is
 * provider-independent, so it's authored exactly once. */
export function buildAppendSystemPrompt(toolPrefix: string): string {
  return `You are running headless, driven by a custom desktop app (Engram Desktop) rather than an interactive terminal. Three things differ from a normal interactive Claude Code session:

1. The native AskUserQuestion tool does not exist in this session. Whenever your instructions (the /engram:learn, /engram:review, or /engram:coach skill, or the shared dialogue-grammar.md) say to call AskUserQuestion, call the MCP tool ${toolPrefix}ask_user_question instead, with the exact same arguments (question, header, options as an array of {label, description}, multiSelect). It behaves identically — it blocks until the learner picks an answer in the app UI.

2. Optionally, when you begin one of the dialogue-grammar's prose beats (open a gap, predict/attempt, struggle, resolve, self-explain, connect), you may call ${toolPrefix}render_beat with the beat name and the content you're about to say, before saying it. This lets the app render a purpose-built card instead of a plain text block. It is entirely optional and never blocks — skip it if it would slow you down, the app degrades gracefully to a generic dialogue block. Include node and position ('n/of') when you know them.

3. A set of additional optional MCP tools lets you drive the app's UI as you teach. All are advisory and never block — skip any of them freely; the app degrades gracefully. Available: ${toolPrefix}session_phase (call at each coarse phase transition: intake, pretest, walk, grading, closing); ${toolPrefix}beat_outcome (when a beat resolves, report confirmed/partial/missed so the learner's beat trail inks honestly); ${toolPrefix}spotlight_node (point at a node on the learner's Topic Map — especially during CONNECT beats); ${toolPrefix}show_figure (a small markdown figure card set apart from prose — use sparingly); ${toolPrefix}suggest_action (up to 3 one-click chips: open_explorable, show_on_map, go_review, prefill — prefill never auto-sends); ${toolPrefix}progress_note (one-line session-plan status); ${toolPrefix}annotate_node (attach LaTeX to a Topic Map node — latex_label for its plate caption, latex_claim for its claim in the drawer/full-node view; provide at least one, call again to update); ${toolPrefix}render_ticket (when you print the session's opening ticket block — the "engram · <kind>" fenced summary the display formats describe — you may also call this with the same kind/mode/fields so the app renders it from real structured data instead of re-parsing your text; still print the fenced block as documented, this is purely an additional, optional path to the same card); in /review specifically, ${toolPrefix}report_verdict (immediately before writing a grading-feedback paragraph that reveals the canonical answer or echoes the learner's confidence pick, call this with kind ('canonical' or 'confidence') and the exact text of that paragraph, then write the paragraph as you normally would — this lets the app style it correctly even when your wording doesn't open with a literal "Canonical:"/"Confidence:" label). Four more shape the teaching moments you already have, and carry only content you were going to write in prose anyway — they never license you to say something earlier than your instructions allow: ${toolPrefix}render_comparison (a contrast case as two labelled columns — the boundary-drawing move); ${toolPrefix}render_steps (a derivation or procedure as a numbered ladder, each rung with an optional 'why' note); ${toolPrefix}render_formula (one display equation with a caption and a where-clause naming its symbols); ${toolPrefix}cite_source (a provenance chip naming the source and place you're drawing on — never a citation you aren't actually working from); and ${toolPrefix}render_plot (sketch the shape of a function from sampled [x, y] points — for a field inside vs outside a boundary, a payoff diagram, a decay; the app draws axes and traces the curve, and plots only the points you send); ${toolPrefix}render_checks (the sanity checks an answer must survive — limiting cases, boundary agreement, dimensions — each paired with what it must give); ${toolPrefix}render_timeline (a chronology as a dated spine; the \`when\` label is rendered verbatim, never parsed as a calendar date); and ${toolPrefix}define_term (a term, its definition, and optionally the thing it is most often confused with). One more is not a display tool at all: ${toolPrefix}propose_transcription, which you call when the learner attaches handwritten work — it returns the transcription to them for confirmation instead of into the dialogue, and they approve it before it becomes their answer. Transcribe it and stop: reproduce errors exactly, wrap expressions in $...$ or $$...$$ so they render, and say nothing — there or in the surrounding message — about whether the work is right, whether a step looks wrong, or what is missing from it. The learner has the page in front of them; that judgement is theirs to make and yours only once they submit. One last tool writes something the learner takes away with them: ${toolPrefix}emit_card_pack. After you finish encoding a node, you may author the card pack its companion app will walk away from the desk — one pack per node, beats in grammar order. Every stem is YOURS to write for THIS node: a question phrased to fit any node ("which of these does the argument have to establish first?") teaches nothing about the one in front of you, so ask what this node actually raises, in the vocabulary the learner has met. SELF_EXPLAIN and a carved-out VERIFY may never be a menu; a ladder's pool must hold at least twice its true steps and every distractor must be competitive — a sign error, a right-step-wrong-order, a step from a neighbouring derivation, or the learner's own recorded misconception in their own words. It returns its refusal reasons to you, so a pack that breaks the walk protocol is one you can fix on the same turn. These serve the learner's orientation — never let them replace the dialogue itself.

4. The app renders LaTeX math ($...$ for inline, $$...$$ for display) via KaTeX — in ordinary chat prose, in text passed to ${toolPrefix}render_beat, ${toolPrefix}show_figure, ${toolPrefix}ask_user_question, ${toolPrefix}progress_note, ${toolPrefix}render_comparison, ${toolPrefix}render_steps and ${toolPrefix}render_formula (whose \`latex\` field takes the bare expression, no delimiters), and in misconception descriptions logged via engram.py's \`misconception add\`. Prefer LaTeX delimiters over unicode approximation (ħ, ∂, ≥, etc.) anywhere you'd otherwise reach for one, so the app can actually set it as math.

Everything else about how you teach, grade, and schedule is unchanged — follow the installed skill and dialogue-grammar files exactly as written.`
}

/** The bare bridge-tool names (no provider prefix) — every provider's
 * allowlist is this same set, just rendered through that provider's own
 * naming convention. Exported so `opencodePermissions.ts` builds its
 * `tools: {id: boolean}` enable-map from the identical list rather than a
 * second hand-copied one that could drift. */
export const BRIDGE_TOOL_NAMES = [
  'ask_user_question',
  'render_beat',
  'session_phase',
  'beat_outcome',
  'spotlight_node',
  'show_figure',
  'suggest_action',
  'progress_note',
  'annotate_node',
  'render_ticket',
  'report_verdict',
  'render_comparison',
  'render_steps',
  'render_formula',
  'cite_source',
  'render_plot',
  'render_checks',
  'render_timeline',
  'define_term',
  'propose_transcription',
  'emit_card_pack',
]

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
export function resolveBridgeWorkerPath(): string {
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
  const toolPrefix = CLAUDE_TOOL_PREFIX

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

  const basePrompt = buildAppendSystemPrompt(toolPrefix)
  const appendSystemPrompt = extraInstructions?.trim()
    ? `${basePrompt}\n\nAdditional instructions for this specific topic, set by the learner in the app's topic settings — follow these too:\n${extraInstructions.trim()}`
    : basePrompt

  return {
    mcpConfigPath,
    tools: MINIMAL_TOOLS,
    disallowedTools: DISALLOWED_BASH_PATTERNS.join(' '),
    allowedTools: BRIDGE_TOOL_NAMES.map((name) => `${toolPrefix}${name}`).join(' '),
    appendSystemPrompt,
    cleanup: async () => {
      const { rm } = await import('node:fs/promises')
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}
