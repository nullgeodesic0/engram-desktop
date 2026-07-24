#!/usr/bin/env node
// Spawned by `claude` (via --mcp-config) as a stdio MCP server, one per live
// session. Stands in for the native AskUserQuestion tool, which does not
// exist in headless `-p` mode (spike/FINDINGS.md, Finding 3). Talks MCP to
// Claude on stdio; talks plain HTTP to the Electron main process's
// bridgeServer on the other side, which is what actually blocks on a real
// human click in the renderer.
//
// Deliberately plain Node ESM (not bundled/compiled) so `claude` can spawn
// it directly with `node <this file>` — no build step, no path-resolution
// surprises for an out-of-band child process.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const PORT = process.env.ENGRAM_BRIDGE_PORT
const SESSION_ID = process.env.ENGRAM_BRIDGE_SESSION_ID

if (!PORT || !SESSION_ID) {
  process.stderr.write('[mcp-bridge] missing ENGRAM_BRIDGE_PORT / ENGRAM_BRIDGE_SESSION_ID\n')
  process.exit(1)
}

async function postJson(path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`bridge relay ${path} returned ${res.status}`)
  return res.json()
}

function fireUi(tool, payload) {
  postJson(`/bridge/${encodeURIComponent(SESSION_ID)}/ui`, { tool, payload }).catch(() => {})
  return { content: [{ type: 'text', text: 'ok' }] }
}

const server = new McpServer({ name: 'engram-ui-bridge', version: '0.1.0' })

const BEATS = ['open_gap', 'predict', 'struggle', 'resolve', 'self_explain', 'connect']

server.registerTool(
  'ask_user_question',
  {
    title: 'Ask User Question',
    description:
      'Ask the learner a single-pick question via the app UI, in place of the native AskUserQuestion tool (unavailable in this headless session). Use this for confidence picks and any other menu-style choice the current instructions call for.',
    inputSchema: {
      question: z.string(),
      header: z.string(),
      options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
      multiSelect: z.boolean().optional().default(false),
    },
  },
  async ({ question, header, options, multiSelect }) => {
    const answer = await postJson(`/bridge/${encodeURIComponent(SESSION_ID)}/ask`, {
      question,
      header,
      options,
      multiSelect: multiSelect ?? false,
    })
    return { content: [{ type: 'text', text: JSON.stringify(answer) }] }
  },
)

server.registerTool(
  'render_beat',
  {
    title: 'Render Beat',
    description:
      "Advisory, best-effort: signal which dialogue-grammar beat you're on right now (open_gap, predict, struggle, resolve, self_explain, connect) so the app can render a purpose-built card instead of a plain text block. Skipping this call is fine — the app falls back to a generic dialogue block. Include node (the node id you're teaching) and position (like '2/3' — node n of the session's planned m) whenever you know them.",
    inputSchema: {
      beat: z.enum(BEATS),
      content: z.string(),
      node: z.string().optional(),
      position: z.string().optional(),
    },
  },
  async ({ beat, content, node, position }) => {
    // Fire-and-forget from Claude's perspective — never block the dialogue on UI paint.
    postJson(`/bridge/${encodeURIComponent(SESSION_ID)}/beat`, { beat, content, node, position }).catch(() => {})
    return { content: [{ type: 'text', text: 'ok' }] }
  },
)

server.registerTool('session_phase', {
  title: 'Session Phase',
  description: 'Advisory, best-effort: signal the coarse session phase so the app can stage its chrome (opening plate, grading shimmer, closing ceremony). Call at each transition: intake (new-topic interview), pretest, walk (teaching nodes), grading (assessor running), closing (wrap-up).',
  inputSchema: { phase: z.enum(['intake', 'pretest', 'walk', 'grading', 'closing']), note: z.string().optional() },
}, async (args) => fireUi('session_phase', args))

server.registerTool('beat_outcome', {
  title: 'Beat Outcome',
  description: "Advisory, best-effort: when a beat you announced via render_beat resolves, report how it went — confirmed (the learner's prediction/production held), partial, or missed. The app inks the beat trail accordingly.",
  inputSchema: { beat: z.enum([...BEATS, 'verify']), outcome: z.enum(['confirmed', 'partial', 'missed']), note: z.string().optional() },
}, async (args) => fireUi('beat_outcome', args))

server.registerTool('spotlight_node', {
  title: 'Spotlight Node',
  description: "Advisory, best-effort: point the learner at a node on their Topic Map — e.g. during CONNECT, spotlight the related node you're linking to. Pans/highlights the map (or badges the map tab if they're elsewhere). Never blocks.",
  inputSchema: { topic: z.string(), node: z.string(), reason: z.string().optional() },
}, async (args) => fireUi('spotlight_node', args))

server.registerTool('show_figure', {
  title: 'Show Figure',
  description: 'Advisory, best-effort: push a small figure card into the transcript — a markdown table, list, or callout that deserves framing beyond plain prose. Markdown only. Use sparingly, for content that genuinely benefits from being set apart.',
  inputSchema: { title: z.string().optional(), body: z.string() },
}, async (args) => fireUi('show_figure', args))

server.registerTool('suggest_action', {
  title: 'Suggest Action',
  description: "Advisory, best-effort: offer the learner up to 3 one-click action chips instead of describing what they could do. Kinds: open_explorable (arg = artifact path you were given), show_on_map (spotlight the current node), go_review (jump to the review queue), prefill (arg = text placed in their composer — never auto-sent). Chips are replaced by your next call and cleared when the learner sends a message.",
  inputSchema: {
    actions: z.array(z.object({
      label: z.string(),
      kind: z.enum(['open_explorable', 'show_on_map', 'go_review', 'prefill']),
      arg: z.string().optional(),
    })).max(3),
  },
}, async (args) => fireUi('suggest_action', args))

server.registerTool('annotate_node', {
  title: 'Annotate Node',
  description: "Advisory, best-effort: attach LaTeX to a Topic Map node so the map renders real math instead of plain text — latex_label is a short caption for the plate's node label, latex_claim replaces the node's claim in the drawer/full-node view. Provide at least one; call again to update either later. Persists across sessions. Never blocks.",
  inputSchema: {
    topic: z.string(),
    node: z.string(),
    latex_label: z.string().optional(),
    latex_claim: z.string().optional(),
  },
}, async (args) => {
  if (args.latex_label === undefined && args.latex_claim === undefined) {
    return { content: [{ type: 'text', text: 'error: provide latex_label and/or latex_claim' }] }
  }
  return fireUi('annotate_node', args)
})

server.registerTool('progress_note', {
  title: 'Progress Note',
  description: "Advisory, best-effort: a one-line session-plan status the app shows under the header (e.g. 'node 2 of 3 — one struggle beat to go'). Replaces the previous note.",
  inputSchema: { text: z.string() },
}, async (args) => fireUi('progress_note', args))

const transport = new StdioServerTransport()
await server.connect(transport)
