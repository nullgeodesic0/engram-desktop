/**
 * THE REGRESSION GUARD for Engram Desktop's two founding constraints.
 *
 * Constraint 1 — THE CORE DOCTRINE. The app is a window onto the engram
 * plugin, never a second author of its state:
 *   · every engram.py call goes through main/engramCli/readOnly.ts's
 *     READ_ONLY_COMMANDS / READ_ONLY_SUBCOMMANDS allowlists, with one narrow
 *     settings-shaped exception (DIRECT_MUTATION_COMMANDS);
 *   · learning state is mutated ONLY by a live driven session, so the app
 *     never becomes a second writer against engram.py's lockfile;
 *   · nothing the app writes to disk lands inside the learning home or the
 *     installed plugin — the sole, deliberately-gated exception being the
 *     backup/restore flow;
 *   · the engine is the oracle (that half is guarded separately, by
 *     `npm run check:topic-metrics`).
 *
 * Constraint 2 — THE LEARNING LOOP AND ITS COMPARTMENTALIZATION. The plugin's
 * pedagogy depends on who is allowed to know what, and when:
 *   · the tutor's instructions come from the installed skills, not from us —
 *     so every byte the app injects into a headless session (system prompt,
 *     kickoff message, tool surface, bridge tools) is PINNED here, and any
 *     change has to be made deliberately and re-pinned;
 *   · a probe's canonical answer (`claim`/`rubric`/`transfer_probe`) must not
 *     reach the learner before their production has been graded — so the set
 *     of files allowed to read those fields is pinned too;
 *   · the assessor is deliberately blind to the tutoring dialogue; the app
 *     must never gain a path that hands it anything.
 *
 * This check is STATIC ANALYSIS ONLY. It reads source text. It never launches
 * the app, never spawns `claude`, never runs engram.py, and never writes
 * anywhere. That is deliberate: a doctrine check that had to run the app to
 * prove the app is safe would be its own violation.
 *
 * Usage:
 *   npm run check:doctrine
 * (invoked as `tsx scripts/checkDoctrine.ts`.)
 *
 * WHEN THIS FAILS: the failure text says which rule broke and why the rule
 * exists. If the change is genuinely intended, update the pin in THIS file in
 * the same commit — that edit is the audit trail, and it is the point.
 *
 * What it provably cannot cover is listed at the bottom of
 * `.superpowers/sdd/doctrine-audit.md` — chiefly the SEMANTICS of prompt text
 * (a re-pinned prompt that softens the loop still passes) and anything that
 * happens inside the `claude` process at runtime.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

const failures: string[] = []
function fail(rule: string, detail: string, why: string): void {
  failures.push(`[${rule}] ${detail}\n      WHY THIS RULE EXISTS: ${why}`)
}

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf-8')
}

/** Every .ts/.tsx/.mjs file under src/, repo-relative to src/. */
function sourceFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx|mjs)$/.test(entry)) {
      out.push(relative(SRC, full))
    }
  }
  return out.sort()
}

const FILES = sourceFiles()
const TEXT = new Map(FILES.map((f) => [f, read(f)] as const))

function sha(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex').slice(0, 16)
}

/** Contents of `new Set([...])` / `[...]` initializers, as string literals. */
function literalsIn(block: string): string[] {
  return [...block.matchAll(/['"`]([^'"`]*)['"`]/g)].map((m) => m[1])
}

function blockAfter(text: string, marker: string, open = '[', close = ']'): string | null {
  const at = text.indexOf(marker)
  if (at < 0) return null
  const start = text.indexOf(open, at)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function eq(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\x00') === [...b].sort().join('\x00')
}

// ===========================================================================
// SECTION 1 — the engram.py surface: read-only by construction
// ===========================================================================

// Pinned from main/engramCli/readOnly.ts. Adding a subcommand here is a real
// decision: `engram.py main()` gates its advisory lock per COMMAND, and a
// command with ANY write action (or an unlisted action of a partly-writing
// command) makes this app a second writer against a live session's lockfile.
const PINNED_READ_ONLY_COMMANDS = [
  'topics', 'stats', 'due', 'decay', 'next', 'adherence', 'retention', 'transfer',
  'grader-health', 'topic-status', 'doctor', 'path', 'model',
]
const PINNED_READ_ONLY_SUBCOMMANDS = ['misconception', 'list', 'experiment', 'status', 'list']
const PINNED_DIRECT_MUTATION = ['visuals', 'focus', 'commit']
// Subcommands invoked by readOnly.ts's own bespoke helpers, which bypass
// engramRead's allowlist because their output isn't JSON (or needs post-
// processing). All read-only; every one of them is named here on purpose.
const PINNED_BESPOKE_READ_HELPERS = ['topic-status', 'path', 'artifact', 'list']

const readOnlyTs = read('main/engramCli/readOnly.ts')

const roCommands = literalsIn(blockAfter(readOnlyTs, 'READ_ONLY_COMMANDS') ?? '')
if (!eq(roCommands, PINNED_READ_ONLY_COMMANDS)) {
  fail(
    'D1.allowlist',
    `READ_ONLY_COMMANDS changed.\n      pinned: ${PINNED_READ_ONLY_COMMANDS.join(', ')}\n      found:  ${roCommands.join(', ')}`,
    'The app never writes engram state. Every subcommand on this list must be read-only for ALL of its actions; anything else turns the app into a second writer racing engram.py’s lockfile against a live session. If the new command is genuinely read-only, re-pin it here in the same commit.',
  )
}

const roSubBlock = blockAfter(readOnlyTs, 'READ_ONLY_SUBCOMMANDS: Map') ?? ''
const roSub = literalsIn(roSubBlock)
if (!eq(roSub, PINNED_READ_ONLY_SUBCOMMANDS)) {
  fail(
    'D1.allowlist',
    `READ_ONLY_SUBCOMMANDS changed.\n      pinned: ${PINNED_READ_ONLY_SUBCOMMANDS.join(', ')}\n      found:  ${roSub.join(', ')}`,
    'These commands write for SOME actions (misconception add, experiment start/settle) and are gated to their read actions only. A widened gate here silently grants the app a write path into learning state.',
  )
}

const dmBlock = blockAfter(readOnlyTs, 'DIRECT_MUTATION_COMMANDS') ?? ''
const dm = literalsIn(dmBlock)
if (!eq(dm, PINNED_DIRECT_MUTATION)) {
  fail(
    'D1.mutation',
    `DIRECT_MUTATION_COMMANDS changed.\n      pinned: ${PINNED_DIRECT_MUTATION.join(', ')} (+ the 'model' special case)\n      found:  ${dm.join(', ')}`,
    'The one sanctioned exception to “no direct writes” is settings-shaped key/value writes the plugin’s own skills already treat as user-invocable outside a session. Anything that touches a graph, a receipt, the stash, or a schedule must go through a live driven session instead — a receipt the engine did not mint is a fabricated memory record.',
  )
}

// The bespoke helpers must still only ever invoke read-only subcommands.
const bespoke = [...readOnlyTs.matchAll(/execFileAsync\('python3',\s*\[scriptPath,\s*([^\]]*)\]/g)]
  .flatMap((m) => literalsIn(m[1]))
  .filter((s) => !s.startsWith('--'))
if (!eq(bespoke, PINNED_BESPOKE_READ_HELPERS)) {
  fail(
    'D1.bespoke',
    `readOnly.ts’s literal (non-allowlisted) engram.py invocations changed.\n      pinned: ${PINNED_BESPOKE_READ_HELPERS.join(', ')}\n      found:  ${bespoke.join(', ')}`,
    'engramRead()’s allowlist only guards calls that go THROUGH it. The handful of helpers that hardcode a subcommand (topic-status, path, artifact list) bypass that check by construction, so the set of subcommands they name is pinned separately.',
  )
}

// Only these files may run a child process at all, and only readOnly.ts may
// run engram.py. Comments mentioning engram.py are fine — an INVOCATION is not.
const PINNED_SUBPROCESS_FILES: Record<string, string> = {
  'main/engramCli/readOnly.ts': 'THE door to the engine: python3 engram.py, allowlisted',
  'main/session/SessionManager.ts': 'spawns the `claude` CLI — the driven session itself',
  'main/session/claudeResolver.ts': 'locates the claude binary',
  'main/session/backup.ts': 'tar, for backup archives',
  'main/session/updateCheck.ts': 'gh api, for the update banner',
  'main/index.ts': 'claude --version, for the environment check',
}
const SPAWN_CALL = /\b(execFile|execFileSync|execSync|exec|spawn|spawnSync|fork)\s*(?:Async)?\s*\(/g
for (const f of FILES) {
  const t = TEXT.get(f)!
  // Strip the `spawn(` helper name sessionHandlers.ts defines for itself —
  // a local function, not node:child_process.
  const importsChildProcess = /from 'node:child_process'/.test(t)
  if (importsChildProcess && !(f in PINNED_SUBPROCESS_FILES)) {
    fail(
      'D1.subprocess',
      `${f} imports node:child_process and is not a pinned subprocess caller.`,
      'The app reaches the outside world through a very small number of doors. A new one is how an engram.py call gets made without passing readOnly.ts’s allowlist — which is the only thing that makes “the app never writes engram state” mechanically true rather than merely intended.',
    )
  }
  if (!importsChildProcess || f === 'main/engramCli/readOnly.ts') continue
  for (const m of t.matchAll(SPAWN_CALL)) {
    const window = t.slice(m.index!, m.index! + 200)
    if (/python3|engram\.py|scriptPath/.test(window)) {
      fail(
        'D1.subprocess',
        `${f}:${t.slice(0, m.index!).split('\n').length} — invokes engram.py outside readOnly.ts.`,
        'Every engram.py call must pass READ_ONLY_COMMANDS / READ_ONLY_SUBCOMMANDS (or the narrow settings-mutation allowlist). A call made anywhere else is an unlocked door into learning state, racing engram.py’s advisory lockfile against whatever live session is running.',
      )
    }
  }
}

// ===========================================================================
// SECTION 2 — filesystem writes: never inside the learning home or the plugin
// ===========================================================================

const WRITE_CALLEES =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rmdir|rm|rmSync|rename|renameSync|copyFile|copyFileSync|unlink|unlinkSync|createWriteStream|cp|cpSync)\s*\(/g

/** Files permitted to write to disk at all, each with the destination that
 * makes it legitimate. A NEW file appearing here is the single most likely
 * way this doctrine regresses, which is why the list is exhaustive. */
const PINNED_WRITERS: Record<string, string> = {
  'main/windowState.ts': 'app userData — window bounds',
  'main/index.ts': 'user-chosen export folder (dialog), never a destination derived from the learning home',
  'main/session/notifierState.ts': 'app userData',
  'main/session/topicSettings.ts': 'app userData',
  'main/session/mapAnnotations.ts': 'app userData',
  'main/session/sessionScan.ts': 'app userData — transcript scan cache',
  'main/session/achievementsStore.ts': 'app userData',
  'main/session/sessionIndex.ts': 'app userData',
  'main/session/updateCheck.ts': 'app userData — update-check cache',
  'main/session/permissionConfig.ts': 'os tmpdir — per-session MCP config',
  'main/session/exportSitting.ts': 'user-chosen export path (dialog) + os tmpdir',
  'main/session/exportMap.ts': 'user-chosen export path (dialog) + os tmpdir — the map-as-PDF sibling of exportSitting.ts, reusing its renderPrintHtmlToPdf pipeline',
  'main/session/backup.ts': 'THE blessed exception: backup archives, and restore into the learning home (see D2.backupGate)',
}

/** The only module allowed to name the learning home on a write. */
const BLESSED_LEARNING_HOME_WRITER = 'main/session/backup.ts'

for (const f of FILES) {
  const t = TEXT.get(f)!
  const matches = [...t.matchAll(WRITE_CALLEES)]
  if (matches.length === 0) continue
  if (!(f in PINNED_WRITERS)) {
    fail(
      'D2.newWriter',
      `${f} performs filesystem writes but is not a pinned writer.`,
      'Every write in this app must have a destination provably outside ~/.claude/learning and outside the installed plugin. A new writer is how “the app never writes engram state” quietly stops being true — pin it here with its destination, and prove that destination first.',
    )
  }
  if (f === BLESSED_LEARNING_HOME_WRITER) continue
  for (const m of matches) {
    // The call's argument text — enough to catch a destination named after the
    // learning home or the plugin cache.
    const argText = t.slice(m.index!, m.index! + 240)
    const line = t.slice(0, m.index!).split('\n').length
    if (/learningHome|engramLearningHome\s*\(|\.claude\b|['"`][^'"`]*\/learning\//.test(argText.split('\n')[0])) {
      fail(
        'D2.learningHomeWrite',
        `${f}:${line} — a write whose arguments name the learning home.`,
        'engram.py owns everything under the learning home and coordinates writers with an advisory lockfile. A write from here can corrupt a live session mid-settle, and — worse — can fabricate learning state that no receipt backs. Mutating learning state goes through a driven session; the ONLY exception is backup.ts’s gated restore.',
      )
    }
    if (/PLUGIN_CACHE_ROOT|plugins\/cache|resolveEngramPlugin|pluginRoot|scriptPath/.test(argText.split('\n')[0])) {
      fail(
        'D2.pluginWrite',
        `${f}:${line} — a write whose arguments name the installed plugin.`,
        'The plugin — not the app — owns the pedagogy. Editing a skill, an agent definition, engram.py or a gold set from here would mean the app is teaching itself and grading its own homework; the whole separation of powers rests on those files being upstream’s, untouched.',
      )
    }
  }
}

// pluginResolver may only ever locate the plugin, never modify it.
if (WRITE_CALLEES.test(TEXT.get('main/session/pluginResolver.ts') ?? '')) {
  fail(
    'D2.pluginWrite',
    'main/session/pluginResolver.ts contains a filesystem write.',
    'This module resolves the installed plugin’s path. A write here is a write into the plugin the app exists to obey.',
  )
}
WRITE_CALLEES.lastIndex = 0

// The blessed exception keeps its three gates.
const backupTs = TEXT.get(BLESSED_LEARNING_HOME_WRITER)!
for (const [needle, what] of [
  ["confirmation !== 'restore'", 'the typed-confirmation gate'],
  ['isSessionActive()', 'the no-live-session gate'],
  ['createSafetySnapshotArchive', 'the mandatory pre-restore safety snapshot'],
] as const) {
  if (!backupTs.includes(needle)) {
    fail(
      'D2.backupGate',
      `${BLESSED_LEARNING_HOME_WRITER} lost ${what} (${needle}).`,
      'Restore is the one flow allowed to overwrite the learning home, and it is allowed only because it is impossible to trigger accidentally, impossible to run while a session is live, and impossible to run without first snapshotting what it replaces. Remove a gate and it stops being an exception and becomes exactly the second writer the doctrine forbids.',
    )
  }
}

// ===========================================================================
// SECTION 3 — what the app injects into a driven session
// ===========================================================================

const permissionTs = read('main/session/permissionConfig.ts')

// (a) Every long string literal in permissionConfig.ts — the appended system
// prompt plus the per-topic-instructions wrapper. Hashed, not compared, so
// the pin stays readable; the failure prints the new hash to paste back.
const injectedStrings = [...permissionTs.matchAll(/`([^`]{40,})`|'([^']{40,})'/g)]
  .map((m) => m[1] ?? m[2])
  .join('\n---\n')
const PINNED_PROMPT_HASH = '88e9274bd205166e'
if (sha(injectedStrings) !== PINNED_PROMPT_HASH) {
  fail(
    'D3.systemPrompt',
    `the text appended to every session’s system prompt changed.\n      pinned: ${PINNED_PROMPT_HASH}\n      found:  ${sha(injectedStrings)}`,
    'The plugin owns the pedagogy; the app owns the window. Text the app appends to the system prompt sits ABOVE the skill files in authority, so a sentence added here can add to, override, or soften the loop’s own instructions — the confidence pick before any correctness signal, the blind assessor, the stash-before-grade order — and nothing downstream would ever notice. Additive UI affordances are legitimate; pedagogy is not. Re-read the whole prompt, confirm it still only describes UI plumbing and still ends by deferring to the installed skills, then re-pin this hash in the same commit.',
  )
}

// (b) The tool surface handed to the model.
const minimalTools = permissionTs.match(/MINIMAL_TOOLS = '([^']*)'/)?.[1] ?? ''
if (minimalTools !== 'Bash,Write,Read,Task') {
  fail(
    'D3.tools',
    `--tools changed: "${minimalTools}" (pinned "Bash,Write,Read,Task").`,
    'This is exactly what /learn, /review and /coach are documented to use: engram.py via Bash, tmpfiles via Write, subagent spawns via Task, Read for the dialogue grammar. A wider surface lets a session act outside the loop; a narrower one silently breaks a beat (e.g. no Write means the learner’s production reaches the engine on a shell command line, which is the injection hole the grammar forbids).',
  )
}

const disallowed = literalsIn(blockAfter(permissionTs, 'DISALLOWED_BASH_PATTERNS') ?? '')
const PINNED_DISALLOWED = ['Bash(rm -rf *)', 'Bash(sudo *)', 'Bash(curl *)', 'Bash(wget *)', 'Bash(> /dev/sd*)']
if (!eq(disallowed, PINNED_DISALLOWED)) {
  fail(
    'D3.tools',
    `DISALLOWED_BASH_PATTERNS changed.\n      pinned: ${PINNED_DISALLOWED.join(' ')}\n      found:  ${disallowed.join(' ')}`,
    'These patterns stay enforced even under --permission-mode bypassPermissions; they are the last thing standing between a driven session and the learner’s disk.',
  )
}

// (c) The bridge: registered tools, allowlisted tools, and disclosed tools
// must be the same nine. Adding a tool is how the app would grow a channel
// the loop never sanctioned.
const PINNED_BRIDGE_TOOLS = [
  'ask_user_question', 'render_beat', 'session_phase', 'beat_outcome',
  'spotlight_node', 'show_figure', 'suggest_action', 'annotate_node', 'progress_note',
  'render_ticket',
]
const workerMjs = read('main/bridge/mcpBridgeWorker.mjs')
const registered = [...workerMjs.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1])
const allowedLine = permissionTs.match(/allowedTools: `([^`]*)`/)?.[1] ?? ''
const allowlisted = [...allowedLine.matchAll(/__\$\{BRIDGE_SERVER_NAME\}__([a-z_]+)/g)].map((m) => m[1])

if (!eq(registered, PINNED_BRIDGE_TOOLS)) {
  fail(
    'D3.bridgeTools',
    `the MCP bridge registers a different tool set.\n      pinned: ${PINNED_BRIDGE_TOOLS.join(', ')}\n      found:  ${registered.join(', ')}`,
    'Each bridge tool is a channel between the driven session and the learner’s screen. ask_user_question is the only one that carries information BACK from the learner, and it exists solely because headless mode has no AskUserQuestion. A new tool must be proved not to expose anything the loop withholds until after grading (a claim, a rubric, an expected answer) and not to hand any subagent — least of all the deliberately blind assessor — a path to the learner. Pin it here once you have.',
  )
}
if (!eq(allowlisted, PINNED_BRIDGE_TOOLS)) {
  fail(
    'D3.bridgeTools',
    `--allowedTools names a different bridge tool set than the pinned nine.\n      found: ${allowlisted.join(', ')}`,
    'The allowlist and the registered set must match exactly: a registered-but-unallowed tool fails mid-session, and an allowed-but-unregistered one is a promise the app cannot keep.',
  )
}
for (const tool of registered) {
  if (!permissionTs.includes(`__${tool}`)) {
    fail(
      'D3.bridgeTools',
      `bridge tool "${tool}" is registered but never disclosed in the appended system prompt.`,
      'A tool the model is not told about is dead weight; a tool the model discovers without the prompt’s framing (“advisory, never blocks, never replaces the dialogue”) is a UI affordance quietly competing with the loop’s own instructions.',
    )
  }
}

// (d) The CLI invocation itself.
const sessionManagerTs = read('main/session/SessionManager.ts')
const argsBlock = blockAfter(sessionManagerTs, 'const args = ') ?? ''
const flags = [...argsBlock.matchAll(/'(--[a-zA-Z-]+)'/g)].map((m) => m[1])
const PINNED_FLAGS = [
  '--input-format', '--output-format', '--include-partial-messages', '--verbose',
  '--tools', '--disallowedTools', '--allowedTools', '--permission-mode',
  '--mcp-config', '--strict-mcp-config', '--append-system-prompt', '--resume', '--session-id',
]
if (!eq(flags, PINNED_FLAGS)) {
  fail(
    'D3.cliFlags',
    `the claude CLI invocation changed.\n      pinned: ${PINNED_FLAGS.join(' ')}\n      found:  ${flags.join(' ')}`,
    '--strict-mcp-config keeps the session from inheriting the user’s other MCP servers; --append-system-prompt (never --system-prompt) is what keeps the installed skills in charge rather than replaced; --tools/--allowedTools/--disallowedTools are the whole permission story. Any flag added or dropped here changes what the loop runs under.',
  )
}

// (e) Everything the app types INTO the session: kickoff messages and any
// text it splices into a learner's turn.
const injectedMessages: string[] = []
for (const f of FILES) {
  // permissionConfig.ts's own text is covered by D3.systemPrompt above.
  if (f === 'main/session/permissionConfig.ts') continue
  const literals = [
    ...TEXT.get(f)!.matchAll(/`([^`]{0,400})`/g),
    ...TEXT.get(f)!.matchAll(/'([^'\n]{0,400})'/g),
  ]
  for (const m of literals) {
    if (!/\/engram:|\[Attached files/.test(m[1])) continue
    injectedMessages.push(`${f}: ${m[1].replace(/\$\{[^}]*\}/g, '${}').replace(/\s+/g, ' ').trim()}`)
  }
}
const PINNED_MESSAGE_HASH = '914f29fd061a363d'
if (sha(injectedMessages.sort().join('\n')) !== PINNED_MESSAGE_HASH) {
  fail(
    'D3.kickoff',
    `the messages the app sends into a session changed.\n      pinned: ${PINNED_MESSAGE_HASH}\n      found:  ${sha(injectedMessages.sort().join('\n'))}\n      current set:\n${injectedMessages.map((s) => `        ${s}`).join('\n')}`,
    'A kickoff message is a user turn with the app’s words in the learner’s mouth. It may say WHICH topic and WHICH skill (navigation the learner already performed by clicking); it may not say how to teach, what to skip, or how to grade — that is the skill file’s job, and a sentence here would override it invisibly. Same for text spliced into a learner’s own message: it reaches the assessor as if the learner wrote it.',
  )
}

// ===========================================================================
// SECTION 4 — compartmentalization: canonical answers stay out of the app's
// unsolicited surfaces
// ===========================================================================

/** `claim`, `rubric` and `transfer_probe` are the expected answers. /review
 * reveals `claim` only AFTER the production is in and the confidence pick is
 * made. Files allowed to read them, and why each is not a leak. */
const PINNED_ANSWER_READERS: Record<string, string> = {
  'renderer/src/app/TopicMapView.tsx': 'learner-initiated: opening one’s own node in the map drawer/full view',
  'renderer/src/app/HomeView.tsx': 'the “on this day” flashback — GATED by safeToReveal(): never a node with a retrieval due inside the safe window',
  'renderer/src/shared/searchIndex.ts': 'learner-initiated: command-palette search over one’s own graph',
  'renderer/src/components/GraphView.tsx': 'learner-initiated: in-map text filter',
  'shared/types.ts': 'type declarations only',
  'shared/ritualFromTranscript.ts': 'a comment quoting the plugin’s own stash shape — no field is read',
}
// Property access AND destructuring/shorthand, so `const { claim } = node`
// can't slip past a check that only looked for `node.claim`.
const ANSWER_FIELDS = /\.(claim|rubric|transfer_probe)\b|[{,]\s*(claim|rubric|transfer_probe)\s*[,}:]/
for (const f of FILES) {
  if (!ANSWER_FIELDS.test(TEXT.get(f)!)) continue
  if (!(f in PINNED_ANSWER_READERS)) {
    fail(
      'D4.answerLeak',
      `${f} reads a node’s claim/rubric/transfer_probe and is not a pinned answer reader.`,
      'These fields ARE the expected answer. /review’s order of operations is sacred: probe → production → confidence pick → reveal. Any app surface that shows a claim before the learner has produced turns the next retrieval into recognition — and the receipt then records reading as memory, inflating a schedule the learner is trusting with their recall. The blind assessor cannot detect this: it only ever sees the production. If the new surface is learner-initiated (they went looking) or gated on the node not being due, pin it here with that justification.',
    )
  }
}

// The Home flashback's specific gate — the one place the app volunteers a
// claim without being asked.
const homeView = TEXT.get('renderer/src/app/HomeView.tsx')!
if (!/function safeToReveal\(/.test(homeView) || !/safeToReveal\(node/.test(homeView)) {
  fail(
    'D4.flashbackGate',
    'HomeView’s flashback no longer gates on safeToReveal().',
    'The flashback is the only place the app prints a canonical answer unprompted, on the same screen as the “Clear today’s reviews” button. Without the due-date gate it will, on real data, routinely print the answer to a node the learner is about to be probed on (measured: 45 of 76 eligible candidates on the author’s own machine were due within a week).',
  )
}

// The app must never gain a path that feeds the blind assessor. It has no
// Task tool and no way to spawn a subagent, so the only conceivable channel
// is text it types into a session — which is exactly the set collected above.
for (const msg of injectedMessages) {
  if (/assessor|rubric|when grading|grade (it|this|the)/i.test(msg)) {
    fail(
      'D4.assessorBlindness',
      `an app-injected session message addresses grading: ${msg}`,
      'The assessor is deliberately blind to the tutoring dialogue: it receives only items, rubrics and productions, and returns receipt JSON. That blindness is what makes the grade independent evidence rather than the tutor’s opinion with extra steps. The app has no legitimate reason to address it — the tutor spawns it from the stash. Naming it while also writing into a session is how that boundary would erode.',
    )
  }
}

// ===========================================================================

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} doctrine violation(s):\n`)
  for (const f of failures) console.error(`  - ${f}\n`)
  console.error(
    'These two constraints are the product: the app is a window onto the engram plugin,\n' +
      'and the loop’s information compartmentalization is what makes its grades mean anything.\n' +
      'If a change above is genuinely intended, update its pin in scripts/checkDoctrine.ts in\n' +
      'the SAME commit — that edit is the audit trail.',
  )
  process.exitCode = 1
} else {
  console.log('OK — core doctrine and loop compartmentalization intact.')
  console.log(
    `  engram allowlist=${roCommands.length} cmds (+${PINNED_DIRECT_MUTATION.length} settings mutators) · ` +
      `writers=${Object.keys(PINNED_WRITERS).length} pinned · bridge tools=${registered.length} · ` +
      `answer readers=${Object.keys(PINNED_ANSWER_READERS).length} pinned · files scanned=${FILES.length}`,
  )
}
