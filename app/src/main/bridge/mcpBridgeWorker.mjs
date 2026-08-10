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
import { request as httpRequest } from 'node:http'
import { z } from 'zod'

const PORT = process.env.ENGRAM_BRIDGE_PORT
const SESSION_ID = process.env.ENGRAM_BRIDGE_SESSION_ID

if (!PORT || !SESSION_ID) {
  process.stderr.write('[mcp-bridge] missing ENGRAM_BRIDGE_PORT / ENGRAM_BRIDGE_SESSION_ID\n')
  process.exit(1)
}

/**
 * node:http rather than fetch, and the reason is load-bearing: `/ask` holds
 * its HTTP response open until a HUMAN clicks, which can be minutes. Node's
 * fetch is undici, whose default `headersTimeout` is 300 s — so an ask left
 * open for five minutes died with a bare "fetch failed", the tutor saw a
 * tool error and re-posed the SAME question, and the learner got two cards
 * (observed live 2026-08-05: ask posed 19:54:12, failed 19:59:13 — 301.07 s
 * on the nose, then re-asked 5 s later). node:http applies no response
 * timeout of its own, so thinking time is unbounded, which is the only
 * honest setting for a question whose whole point is that a person answers
 * it. Socket timeouts are disabled explicitly too, in case an agent default
 * ever changes underneath this.
 */
function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`bridge relay ${path} returned ${res.statusCode}`))
            return
          }
          try {
            resolve(raw ? JSON.parse(raw) : {})
          } catch (err) {
            reject(err)
          }
        })
      },
    )
    req.setTimeout(0)
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
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

server.registerTool(
  'emit_card_pack',
  {
    title: 'Emit Card Pack',
    description:
      "Author the card pack the phone will walk for ONE node, and hand it to the app. Advisory and non-blocking like the rest: skipping it simply means this node cannot be walked away from the desk.\n\n" +
      "Every stem is YOURS to write, for THIS node. Do not reach for a house style — a pack whose PREDICT card asks 'which of these does the argument have to establish first?' would ask the same thing of Noether's theorem and of Lenin on Economism, and a question that fits every node teaches nothing about any of them. Write the question this node actually raises, in the vocabulary the learner has met.\n\n" +
      "Beats run in grammar order and each appears at most once. SELF_EXPLAIN and a carved-out VERIFY may never be a menu — use ladder, cloze or recall there. A ladder's pool must hold at least twice its true steps, and every distractor must be competitive: a sign error, a right-step-wrong-order, a step from a neighbouring derivation, or the learner's own recorded misconception in their own words. Filler options make the card a coin flip and the receipt a lie.\n\n" +
      "Sealed fields (`sealed.*`) hold the answer and are never shown before the learner commits.\n\n" +
      "A prose beat may carry a FIGURE, so the phone can show what you would show at the desk: formula (with a where-clause glossing its symbols), steps, comparison, checks, timeline, definition, citation, plot. Reach for one wherever you would have reached for the matching render_* card here — a learner who met a concept as a set equation at the desk should not meet a paragraph about it on the train.\n\n" +
      "Identity is not yours to set: the app assigns the pack id and the timestamp.",
    inputSchema: {
      topic: z.string(),
      node: z.string(),
      nodeTitle: z.string(),
      // Exactly the pack schema's own shape, and all of it required. An
      // earlier draft made these optional and omitted packId/generatedAt
      // entirely, which meant every pack this tool emitted would have been
      // refused by the validator on arrival — a tool that cannot succeed.
      // Read node_kind from the CLI, never the graph's raw kind.
      eligibility: z.object({
        nodeKind: z.enum(['concept', 'fact', 'procedure']),
        threshold: z.boolean(),
        transferReady: z.boolean(),
        lapsed: z.boolean(),
        experimentArm: z.string().nullable(),
      }),
      beats: z.array(z.record(z.any())),
    },
  },
  async ({ topic, node, nodeTitle, eligibility, beats }) => {
    const result = await postJson(`/bridge/${encodeURIComponent(SESSION_ID)}/card-pack`, {
      topic,
      node,
      nodeTitle,
      eligibility,
      beats,
    })
    // The refusal reasons come back to YOU, not to a log nobody reads: a pack
    // that breaks the walk protocol is a pack you can fix on this turn.
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
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

server.registerTool('render_ticket', {
  title: 'Render Ticket',
  description:
    "Advisory, best-effort: when you print the session's opening ticket block (the fenced \"engram · <kind>\" summary the display formats describe), you may also call this with the same data so the app renders it from structured fields instead of re-parsing your printed text. Still print the fenced block as documented — this is an additional path to the same card, never a replacement for it.",
  inputSchema: {
    kind: z.string(),
    mode: z.string().optional(),
    fields: z.array(z.object({ key: z.string(), value: z.string() })),
  },
}, async (args) => fireUi('render_ticket', args))

server.registerTool('report_verdict', {
  title: 'Report Verdict',
  description:
    "Advisory, best-effort, /review only: call this immediately before writing a paragraph that reveals the canonical answer (kind 'canonical') or echoes the learner's confidence pick (kind 'confidence') in your grading feedback. Pass the exact text of that paragraph verbatim in `text` — the app matches it against what you actually write next so it can style that paragraph correctly even when your wording doesn't start with a literal 'Canonical:'/'Confidence:' label. Still write the paragraph as you normally would — this never changes what you say, only how the app displays it.",
  inputSchema: {
    kind: z.enum(['canonical', 'confidence']),
    text: z.string(),
  },
}, async (args) => fireUi('report_verdict', args))

// ── Structured teaching moments ────────────────────────────────────────────
// Four tools for the shapes the dialogue already produces constantly and the
// transcript could only render as undifferentiated prose: the contrast case,
// the step ladder, the set formula, and the source citation.
//
// None of them changes WHAT the tutor may say. Each carries content the model
// was about to write in prose anyway — the same licence show_figure has always
// run on — so the loop's withholding discipline (no canonical answer before
// the confidence pick, no rubric before the production) is untouched: it
// constrains the tutor's words, not the element that sets them. Each
// description says so explicitly, because a tool that LOOKS like a reveal
// channel will eventually be used as one.

server.registerTool('render_comparison', {
  title: 'Render Comparison',
  description:
    "Advisory, best-effort: draw a contrast case as two labelled columns instead of two paragraphs — the move you already make when a misconception needs a boundary drawn (canonical vs grand canonical, the learner's approach vs the correct one, before vs after). `left`/`right` each take a short `label` and a `body`; LaTeX is rendered. Say the same thing in your prose as you normally would; this only sets it side by side. Subject to the same timing rules as anything else you say — never use it to show a canonical answer earlier than your instructions allow.",
  inputSchema: {
    title: z.string().optional(),
    left: z.object({ label: z.string(), body: z.string() }),
    right: z.object({ label: z.string(), body: z.string() }),
  },
}, async (args) => fireUi('render_comparison', args))

server.registerTool('render_steps', {
  title: 'Render Steps',
  description:
    "Advisory, best-effort: lay a derivation or procedure out as a numbered ladder (up to 12 rungs) rather than a run-on paragraph. Each step takes `text` and an optional `note` — the 'why this step' aside you'd otherwise put in parentheses. LaTeX is rendered in both. Especially for procedure nodes, where the probe is 'walk me through it'. Subject to the same timing rules as anything else you say — this is for a method being taught or reviewed, never a worked answer shown before the learner has produced one.",
  inputSchema: {
    title: z.string().optional(),
    steps: z.array(z.object({ text: z.string(), note: z.string().optional() })).min(1).max(12),
  },
}, async (args) => fireUi('render_steps', args))

server.registerTool('render_formula', {
  title: 'Render Formula',
  description:
    "Advisory, best-effort: set one display equation with a caption and a where-clause. `latex` is the bare expression (no $$ needed), `caption` names what it is, and `where` is up to 8 {symbol, meaning} pairs — the glossary that actually unblocks a learner mid-derivation. Use it for the equation a node turns on, not for every inline expression (ordinary math in your prose already renders).",
  inputSchema: {
    latex: z.string(),
    caption: z.string().optional(),
    where: z.array(z.object({ symbol: z.string(), meaning: z.string() })).max(8).optional(),
  },
}, async (args) => fireUi('render_formula', args))

server.registerTool('cite_source', {
  title: 'Cite Source',
  description:
    "Advisory, best-effort: name where the material you're teaching came from — `label` is the source (a textbook, a paper, an exam), `locator` the place in it ('ch. 13', 'problem 4b', 'p. 220'), `note` an optional one-line gloss. Pins a small provenance chip into the transcript. Use it when you're drawing on a specific source the learner gave you or the topic was built from; never invent a citation you aren't actually working from.",
  inputSchema: {
    label: z.string(),
    locator: z.string().optional(),
    note: z.string().optional(),
  },
}, async (args) => fireUi('cite_source', args))

server.registerTool('render_plot', {
  title: 'Render Plot',
  description:
    "Advisory, best-effort: sketch the SHAPE of a function inline. Supply sampled points and the app draws the axes, fits the range, and traces the curve — it never evaluates or extrapolates, so what appears is exactly what you sent. Each series takes a `label` (LaTeX rendered) and `points` as [x, y] pairs (2–96 of them; sample densely enough that the shape is honest, and put a point exactly at each boundary so a piecewise curve meets itself). Up to 3 series, `dashed` for a comparison or a wrong-shape contrast. `markers` place labelled vertical guides at boundaries like r = a or T = T_c. Use it when the shape is the thing being taught or tested — a field inside vs outside a sphere, a payoff diagram, a decay. Subject to the same timing rules as anything else you say: never sketch the answer before the learner has produced one.",
  inputSchema: {
    title: z.string().optional(),
    x_label: z.string().optional(),
    y_label: z.string().optional(),
    series: z.array(z.object({
      label: z.string(),
      points: z.array(z.tuple([z.number(), z.number()])).min(2).max(96),
      dashed: z.boolean().optional(),
    })).min(1).max(3),
    markers: z.array(z.object({ x: z.number(), label: z.string().optional() })).max(4).optional(),
  },
}, async (args) => fireUi('render_plot', args))

server.registerTool('render_checks', {
  title: 'Render Checks',
  description:
    "Advisory, best-effort: lay out the sanity checks an answer must survive — limiting cases, boundary agreement, dimensions, symmetry. Each row is a `check` (what to try: 'let $r\\to\\infty$', 'set $T=0$', 'compare dimensions') and an `expect` (what it must give), plus an optional `note` saying what a failure would mean. Up to 8. This is the verification habit a struggling learner never builds on their own — they solve, then stop. Same timing rules as anything else you say: after their attempt, not instead of it.",
  inputSchema: {
    title: z.string().optional(),
    checks: z.array(z.object({
      check: z.string(),
      expect: z.string(),
      note: z.string().optional(),
    })).min(1).max(8),
  },
}, async (args) => fireUi('render_checks', args))

server.registerTool('render_timeline', {
  title: 'Render Timeline',
  description:
    "Advisory, best-effort: lay a chronology out as a dated spine instead of a paragraph — the order of events a historical, political, or process-based topic turns on, or the stages of a lifecycle. Each event takes `when` (rendered exactly as you write it: a year, a congress, 'at expiry', 'T+30d' — never parsed as a calendar date), `what`, and an optional `note`. Up to 10, in the order you want them read.",
  inputSchema: {
    title: z.string().optional(),
    events: z.array(z.object({
      when: z.string(),
      what: z.string(),
      note: z.string().optional(),
    })).min(1).max(10),
  },
}, async (args) => fireUi('render_timeline', args))

server.registerTool('define_term', {
  title: 'Define Term',
  description:
    "Advisory, best-effort: pin a term with its definition, and — when it earns one — the thing it is most often confused with (`not_to_be_confused_with`). That last field is the point: naming the boundary BEFORE the learner crosses it is worth more than correcting them after. `aka` carries an alternative name the literature uses. Use it for a term the learner will meet again, not for every noun.",
  inputSchema: {
    term: z.string(),
    definition: z.string(),
    aka: z.string().optional(),
    not_to_be_confused_with: z.string().optional(),
  },
}, async (args) => fireUi('define_term', args))

server.registerTool('propose_transcription', {
  title: 'Propose Transcription',
  description:
    "When the learner attaches handwritten work, return the transcription HERE rather than in prose. `latex` is what is on the page, exactly as written — wrap each expression in $...$, or $$...$$ on its own line, so it renders as maths. `pages` echoes the image paths in order. TRANSCRIBE AND STOP. Reproduce errors exactly as they appear. Do not say — here, or in the message around this call, or anywhere before they submit — whether the work is right, whether a step looks wrong, what is missing or incomplete, which characters you found hard to read, or how confident you are. There is nowhere in this call to put such a remark, and that is deliberate: the learner has the page in front of them and it is their judgement to make, not yours until they hand it in. Produce the transcription with a subagent given only the image paths and the verbatim instruction, so what you already expect the answer to be cannot colour what you read.",
  inputSchema: {
    latex: z.string(),
    pages: z.array(z.string()).min(1).max(12),
  },
}, async (args) => fireUi('propose_transcription', args))

const transport = new StdioServerTransport()
await server.connect(transport)
