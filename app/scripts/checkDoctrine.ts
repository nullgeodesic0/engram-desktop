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
// 2026-08-08 re-pin: + `stash count`. Verified in engram.py 1.10.1 — the
// count branch reads the stash file and emits its length, nothing else, while
// add and clear in the same command do write. That is why this is gated per
// ACTION rather than by allowlisting the command. It reads no claim or rubric
// (the stash holds the learner's own productions) and mutates nothing, so the
// app stays a reader. It exists so pending-but-ungraded work is visible in
// the app instead of sitting in limbo until a later session happens to run.
const PINNED_READ_ONLY_SUBCOMMANDS = ['misconception', 'list', 'experiment', 'status', 'list', 'stash', 'count']
// 2026-07-30 re-pin (3 → 4): `misconception` joins the mutation door,
// action-gated to `resolve` only (see D1.mutationGate below). Rationale:
// `misconception resolve` is engine-proven pure ledger — FSRS, scheduling,
// and verdicts never read misconceptions.json, so no graph, receipt, stash,
// or schedule is touched and no memory record the engine didn't mint is
// fabricated; the flip completes a loop the plugin's own docs already
// assume (03-architecture.md's "schedule early re-test", artifact-smith's
// "misconception resolved") but that no skill ever instructs. `add` stays
// session-only — a fabricated observation.
// 2026-08-03 re-pin: + 'retire' — the engine's own autonomy verb, whose
// docstring states retirement advances no mastery claim and that THE
// LEARNER names what to retire. Topic Settings' "Archive topic" button is
// that voice; the in-function shape gate (see D1.mutationGate below)
// restricts this door to `--topic <slug> [--restore]` — whole topic or
// nothing, never per-node, so the app can never shade into auto-retiring
// the nodes a learner keeps failing.
const PINNED_DIRECT_MUTATION = ['visuals', 'focus', 'commit', 'misconception', 'retire']
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

// The misconception mutation door must stay action-gated to resolve —
// the command-level allowlist alone would let `misconception add` (a
// fabricated observation no sitting produced) through the same door.
if (!readOnlyTs.includes("args[0] !== 'resolve'")) {
  fail(
    'D1.mutationGate',
    `readOnly.ts lost the misconception action gate (args[0] !== 'resolve').`,
    'The direct-mutation allowlist admits the misconception COMMAND for the sake of its resolve action alone: resolve is a pure status flip on a row the engine itself minted, while add would fabricate a ledger entry no sitting observed. The in-function gate is what narrows the command to the action.',
  )
}
// The retire mutation door must stay shape-gated to the whole topic — the
// command-level allowlist alone would let per-node retire args through,
// and the engine's own docstring names exactly why that door stays shut
// ("a flattering denominator dressed as help").
if (!readOnlyTs.includes("args[2] === '--restore'")) {
  fail(
    'D1.mutationGate',
    `readOnly.ts lost the retire shape gate (--topic <slug> [--restore] only).`,
    'The retire door exists for the whole-topic Archive action the learner clicks in Topic Settings. Without the shape gate this door would also accept per-node retire args, and a surface that can quietly retire individual nodes is one refactor away from suggesting which — the auto-retirement the engine explicitly forbids.',
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
  'main/session/topicTrash.ts':
    'the second gated learning-home writer: topic deletion as a custody transfer — rename() out of the learning home into app userData topic-trash, never an erase (see D2.trashGate)',
  'main/session/crashLog.ts': 'app userData — local crash-log.jsonl, capped at 200 entries',
  'main/session/misconceptionResolves.ts':
    'app userData — manual misconception-resolve provenance (display-only; the engine status is the grade)',
  // Dual-mode auth (suite doctrine, mirrored from Observatory Desktop).
  // Both destinations are fixed app-userData filenames — never derived from
  // the learning home, never inside the installed plugin.
  'main/session/authSettings.ts': 'app userData — auth-settings.json (auth mode only; the key is never in this file)',
  'main/session/apiKeyStore.ts': 'app userData — auth-api-key.enc, safeStorage-encrypted API key (path injected by main/session/auth.ts)',
  'main/session/apiKeyStore.test.ts': 'os tmpdir — ephemeral mkdtemp fixtures for the key store round-trip tests, removed in afterEach',
  // Task 12 (engram:// deep link) coordinator review, additive pin — NOT a
  // re-pin of any injected/kickoff string. This is a *test* file's own
  // fixtures: writeFileSync/mkdtempSync/symlinkSync creating throwaway
  // paper.pdf/notes.md/archive.zip/a symlink under os.tmpdir() so
  // validateContextFiles and buildNewTopicPrefill (main/deepLink.ts) have
  // real files/a real symlink to check against, cleaned up in the same
  // file's afterAll. Never runs outside `npm run test`; never touches
  // anything but its own tmpdir directory.
  'main/deepLink.test.ts': 'os tmpdir — ephemeral test fixtures (paper/notes/archive files + a symlink)',
  // Engram Mobile link layer (2026-08-09). Both stores take their path by
  // INJECTION rather than deriving one, and both are wired in main to fixed
  // app-userData filenames — see main/link/README-less note in LinkServer.ts.
  // Neither module imports the learning home, spawns anything, or knows what
  // a receipt is: the queue is inert until a live session drains it, which is
  // what keeps the phone from becoming a second author of engine state.
  'main/link/outboxStore.ts': 'app userData — outbox.jsonl, the append-only queue of evidence received from the phone (path injected)',
  'main/link/pairing.ts': 'app userData — paired-devices.json, SHA-256 token digests only, never a usable credential (path injected)',
  'main/link/cardPackStore.ts':
    'app userData — card-packs/<topic>/<node>.json (root injected). Deliberately NOT the learning home: explorables live there because a live tutor writes them with its own Write tool inside a session; a card pack is written by the APP, and the app authors nothing under ~/.claude/learning',
  'main/link/cardPackStore.test.ts': 'os tmpdir — ephemeral mkdtemp fixtures for the pack store tests, removed in afterEach',
  'main/link/mobileDrain.ts':
    'os tmpdir — the per-drain evidence batch a session reads (dir injected). Never a rating and never a stamp: the batch is exactly what the phone sent, and the session decides what it was worth',
  'main/link/mobileDrain.test.ts': 'os tmpdir — ephemeral mkdtemp fixtures for the drain tests, removed in afterEach',
  'main/link/outboxStore.test.ts': 'os tmpdir — ephemeral mkdtemp fixtures for the queue durability tests, removed in afterEach',
  'main/link/pairing.test.ts': 'os tmpdir — ephemeral mkdtemp fixtures for the pairing tests, removed in afterEach',
  'main/link/LinkServer.test.ts': 'os tmpdir — ephemeral mkdtemp fixtures backing the injected stores, removed in afterEach',
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

// The second (and last) gated learning-home writer: topic deletion is a
// custody TRANSFER into app userData, never an erase, and keeps its gates.
const trashTs = TEXT.get('main/session/topicTrash.ts')!
for (const [needle, what] of [
  ['hasLiveSessions()', 'the no-live-session gate'],
  ["/^[a-z0-9-]+$/.test(topic)", 'the slug-shape gate'],
  ["app.getPath('userData')", 'the userData-only destination'],
  ['rename(', 'the move-not-delete mechanism'],
] as const) {
  if (!trashTs.includes(needle)) {
    fail(
      'D2.trashGate',
      `main/session/topicTrash.ts lost ${what} (${needle}).`,
      'Topic deletion is licensed as a MOVE into app storage with a live-session refusal and a validated slug — the learner ends custody, nothing is destroyed, and the engine can never race it. Swap the rename for an rm, drop the liveness gate, or derive the destination from anything but userData, and this stops being a custody transfer and becomes the destructive second writer the doctrine forbids.',
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
// 2026-08-07 — re-pinned for the four structured-teaching bridge tools
// (render_comparison / render_steps / render_formula / cite_source). Whole
// prompt re-read before re-pinning: the added sentences describe UI plumbing
// only, each defers explicitly to the skill's own timing rules rather than
// relaxing them ("never license you to say something earlier than your
// instructions allow"), and the prompt still closes by deferring wholesale to
// the installed skill and dialogue-grammar files.
// 2026-08-07 (2) — re-pinned for render_plot. Whole prompt re-read again:
// the added clause is one parenthetical describing what the card draws and
// stating that it plots only the points sent. It sits inside the same
// sentence whose opening already says these tools "never license you to say
// something earlier than your instructions allow", and the prompt still
// closes by deferring wholesale to the installed skill and dialogue-grammar
// files. No pedagogy added, softened, or overridden.
// 2026-08-08 — re-pinned for render_checks / render_timeline / define_term.
// Whole prompt re-read: the addition extends the same §3 sentence whose
// opening already states these tools "never license you to say something
// earlier than your instructions allow", describes only what each card draws,
// and the prompt still closes by deferring wholesale to the installed skill
// and dialogue-grammar files.
// 2026-08-08 (3) — re-pinned for propose_transcription. Prompt re-read in
// full: the added sentence describes a return channel and states the gate
// ("they approve it before it becomes their answer"). It grants no new
// latitude about what may be said or when, and the prompt still closes by
// deferring wholesale to the installed skills.
// 2026-08-08 (4) — re-pinned after a live transcription came back with a
// paragraph of commentary attached, including which parts of the learner's
// answer were missing. The added clauses REMOVE latitude rather than granting
// it: transcribe and stop, wrap expressions so they render, and say nothing
// about whether the work is right, whether a step looks wrong, or what is
// absent. That is a correctness signal ahead of grading, which is precisely
// what the loop withholds.
const PINNED_PROMPT_HASH = '0ae178b0a5381e36'
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
// must be the same set. Adding a tool is how the app would grow a channel
// the loop never sanctioned.
//
// 2026-08-07 — four added: render_comparison, render_steps, render_formula,
// cite_source. Each was checked against this rule's own test ("does it expose
// anything the loop withholds until after grading — a claim, a rubric, an
// expected answer; does it hand any subagent a path to the learner") before
// being pinned:
//   · All four are FORMATTING channels for prose the tutor was going to write
//     anyway. None reads engine state, none accepts a rubric or a claim from
//     the engine, none returns anything to the model but 'ok'. A tutor that
//     would leak a canonical answer through render_steps would leak the same
//     answer through the paragraph it writes either way — the withholding
//     rule constrains the words, and the words are unchanged.
//   · Each tool's own description states that timing rule explicitly, so the
//     constraint travels with the tool rather than living only here.
//   · None is reachable by a subagent: the bridge MCP config is attached to
//     the driven session, and the assessor is spawned blind exactly as before.
// The one genuinely new capability is cite_source, which prints a source name
// the tutor supplies. That is learner-visible provenance, not engine state.
const PINNED_BRIDGE_TOOLS = [
  'ask_user_question', 'render_beat', 'session_phase', 'beat_outcome',
  'spotlight_node', 'show_figure', 'suggest_action', 'annotate_node', 'progress_note',
  'render_ticket', 'report_verdict',
  'render_comparison', 'render_steps', 'render_formula', 'cite_source',
  // 2026-08-07 — render_plot added, same test applied: it takes points the
  // tutor supplies and draws them. It reads no engine state, evaluates no
  // function, and can assert nothing the tutor's own prose could not; its
  // description carries the same timing rule as the other four. A sketch of
  // the answer is a reveal exactly to the degree a sentence describing that
  // answer is, and no more — the rule governs the moment, not the medium.
  'render_plot',
  // 2026-08-08 — three more, same test, same answer. render_checks and
  // define_term format prose the tutor writes anyway; render_timeline is the
  // first card in this family aimed at the non-STEM curricula (history,
  // political theory) the app also teaches. None reads engine state, none
  // accepts a rubric or claim, none is reachable by the blind assessor.
  // define_term deserved the closest look, since a definition can be a
  // reveal — but so can a sentence defining the same term, and the timing
  // rule its description carries is the same one governing that sentence.
  'render_checks', 'render_timeline', 'define_term',
  // 2026-08-08 — propose_transcription, the only bridge tool that is not a
  // display channel: it carries a transcription of the learner's OWN
  // handwriting back for them to confirm. Same test as the others:
  //   · it reads no engine state — its whole input is text the model produced
  //     from an image the learner chose, at a path the learner picked;
  //   · it cannot reveal a claim or rubric, because it carries the learner's
  //     work rather than the answer;
  //   · nothing it returns becomes a production until the LEARNER confirms it
  //     in the app. That gate is why this is a tool at all, rather than the
  //     tutor stashing a transcription directly.
  // Its description carries the verbatim rule, which is what stops a tutor
  // that already knows the answer from repairing a sign on the way past and
  // having the assessor certify a grade the learner did not earn.
  'propose_transcription',
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
    `--allowedTools names a different bridge tool set than the pinned set.\n      found: ${allowlisted.join(', ')}`,
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
// 2026-07-30 re-pin: Review's fresh-sitting kickoff may now carry the
// open-misconception digest for this queue's topics — engine-state
// disclosure naming the engine's own resolve verb (loop-completion the
// plugin's docs assume: 03-architecture.md's "schedule early re-test",
// artifact-smith's "misconception resolved"), phrased in the learner's
// navigational voice. It says nothing about how to teach, what to skip, or
// how to assess; verified captured un-truncated by this check's printed
// current-set (the 400-char/no-backtick collector net).
// Second same-day re-pin: the ledger's "Re-test" launcher adds a targeted
// kickoff naming one open row and the same resolve verb — the learner's own
// navigational voice ("I picked one open misconception from my ledger"),
// deferring to the skill for the rest of the sitting. Verified captured
// un-truncated by the printed current-set.
// 2026-08-03 re-pin: Review's kickoffs consolidate into
// shared/reviewKickoff.ts (retest + digest text byte-identical, only the
// collector's file prefix moved) and gain two sitting-shape variants — a
// time-sized standard sitting naming the skill's own --cap vocabulary, and
// the checkpoint opt-in naming the protocol the review skill itself defines
// (the D5-pinned overlay), plus the app-computed recall-floor node list.
// Both are navigational learner voice — what I want covered and in which
// style the skill offers — saying nothing about how to teach or judge.
// Verified captured un-truncated by the printed current-set.
// Same-day re-pin: two resume re-pose nudges (composeResumeNudge) — sent
// only when a resumed transcript's tail is an unanswered ask, whose bridge
// request died with the old child process (both sides otherwise deadlock).
// They name the skill marker in PROSE, deliberately not as a command line
// (re-invoking the skill would restart the queue load mid-sitting), and
// the checkpoint variant restates the sitting's own election, which the
// resume path never re-sends. Navigational voice throughout.
// 2026-08-08 re-pin: the handwriting request joins the collected set
// (renderer/src/shared/handwritingRequest.ts). It is a user turn with the
// app's words in the learner's mouth, so it says only three things, all
// plumbing: which files in which order (navigation the learner performed by
// picking them), transcribe verbatim INCLUDING ERRORS via a subagent given
// nothing but the paths, and that the learner will check it before it counts.
// It names no node, claim or rubric and says nothing about how to teach or
// grade. "including any errors" is the load-bearing clause — without it a
// tutor that knows the answer could quietly repair a sign on the way past and
// the assessor would certify a grade the learner did not earn.
// 2026-08-08 (2) — the handwriting request gains two clauses, both
// restrictive: wrap expressions in $...$/$$...$$ so the result renders as
// maths rather than prose, and "Say nothing about whether any of it is right
// — that is mine to judge." Still 362 source chars, inside the 400-char cap
// this collector's own regex imposes; a longer literal would not match at all
// and would drop out of the pinned set silently.
// 2026-08-08 (3) — one-topic sittings. A mixed queue is engine-ordered by
// savings, which is right for retention and punishing for a person: an
// observed sitting stepped from stat-mech into quantum mechanics between two
// items. The new clause is a FILTER the learner selected in the app, phrased
// in their own navigational voice, and it reorders nothing — the engine still
// sequences within the topic (due --topic), and everything outside it simply
// stays due. It says nothing about how to teach, what to skip, or how to
// grade.
// 2026-08-08 (4) — reviewKickoff.test.ts now asserts on the focus branch, and
// the collector scans test files too, so its expected strings join the set.
// Nothing the app SENDS changed between (3) and (4); these are assertions
// about the message, not new message text.
// 2026-08-09 re-pin: the mobile drain kickoff joins the set
// (shared/mobileKickoff.ts), plus its test file's expected substring. It is
// the message that carries a phone sitting's evidence into a real session,
// and it says exactly three things, all navigational: which skill and topic,
// that the sitting happened on the companion surface, and where the batch is.
// Declaring the surface is load-bearing rather than descriptive — the
// D5-pinned mobile-walk overlay activates ONLY on that declaration, so
// without it the tutor silently walks the ordinary desk beats over phone
// evidence. Naming the protocol is licensed exactly as the checkpoint
// kickoff's naming is: the LEARN skill itself defines it via the overlay, and
// owns everything pedagogical about it. The evidence is a FILE, not inline
// text: a sitting's picks and productions do not fit the collector's 400-char
// net, and inlining a learner's production into a command line is what the
// plugin's own shell-safety rule forbids. Says nothing about how to teach or
// judge. Verified captured un-truncated by this check's printed current-set.
// 2026-08-09 (2) — mobileDrain.test.ts asserts the kickoff reaches the
// session, and the collector scans test files too, so its expected substring
// joins the set. Nothing the app SENDS changed between (1) and (2); this is an
// assertion about the message, not new message text.
const PINNED_MESSAGE_HASH = 'd0f3c30ed83e38f9'
if (sha(injectedMessages.sort().join('\n')) !== PINNED_MESSAGE_HASH) {
  fail(
    'D3.kickoff',
    `the messages the app sends into a session changed.\n      pinned: ${PINNED_MESSAGE_HASH}\n      found:  ${sha(injectedMessages.sort().join('\n'))}\n      current set:\n${injectedMessages.map((s) => `        ${s}`).join('\n')}`,
    'A kickoff message is a user turn with the app’s words in the learner’s mouth. It may say WHICH topic and WHICH skill (navigation the learner already performed by clicking); it may not say how to teach, what to skip, or how to grade — that is the skill file’s job, and a sentence here would override it invisibly. Same for text spliced into a learner’s own message: it reaches the assessor as if the learner wrote it.',
  )
}

// ===========================================================================
// SECTION 3b — deep-link app-authored text (Task 12): the ONE sentence
// deepLink.ts folds into a deep-linked topic's `instructions` before it ever
// reaches a session, once main/index.ts delivers the resulting prefill and
// the learner clicks Start on the (unmodified, still-pinned) kickoff in
// LearnSessionView.tsx's startNewTopic. D3.kickoff's own collector above
// only keeps literals containing '/engram:' or '[Attached files' — this
// sentence matches neither, so without a pin of its own it would be
// invisible to any doctrine audit despite eventually reaching a session
// exactly like a kickoff message does. Pinned here separately and
// additively, rather than by widening D3.kickoff's collector to catch it:
// that regex also governs LearnSessionView.tsx's "Standing instructions for
// this topic" / "Context files to Read" appendices, two lines below the
// kickoff message this sentence (and any deep-linked goal/instructions)
// actually rides into — a real pre-existing blind spot, and now the actual
// landing zone for a hostile deep-link payload's `instructions` text, but
// widening that collector is a decision for the repo owner to make
// deliberately, not something to fold quietly into this task's diff.
// ===========================================================================

const deepLinkTs = read('main/deepLink.ts')
const deadlineNoteMatch = deepLinkTs.match(/function deadlineNote[\s\S]*?return `([^`]*)`/)
const deadlineNoteNormalized = deadlineNoteMatch ? deadlineNoteMatch[1].replace(/\$\{[^}]*\}/g, '${}') : null
const PINNED_DEEPLINK_DEADLINE_NOTE_HASH = '476ce8053b998a40'
if (deadlineNoteNormalized === null || sha(deadlineNoteNormalized) !== PINNED_DEEPLINK_DEADLINE_NOTE_HASH) {
  fail(
    'D3.deepLinkText',
    `deepLink.ts's app-authored deadline sentence changed or is missing.\n      pinned: ${PINNED_DEEPLINK_DEADLINE_NOTE_HASH}\n      found:  ${deadlineNoteNormalized === null ? '(deadlineNote() not found)' : sha(deadlineNoteNormalized)}\n      current text: ${deadlineNoteNormalized ?? '(none)'}`,
    "This sentence is folded into a deep-linked topic's instructions in main/deepLink.ts before it ever reaches a session — the same authority-bearing position as a kickoff message, just delivered through a different file than permissionConfig.ts/D3.kickoff's collector, and outside both (it matches neither /engram: nor [Attached files). Pinning it here separately is what keeps a change to its wording an explicit, audited decision instead of a silent drift with no pin to update. See this check's own file-level comment for the pre-existing appendix blind spot this does NOT cover.",
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
// SECTION 5 — plugin overlays: the one door into the plugin's own files
// ===========================================================================
// applyPluginOverlays.ts writes into the INSTALLED plugin's skill files —
// a file set this script otherwise never reads, which made overlays the
// least-audited path in the repo exactly when the charter widened to admit
// one pedagogy overlay (the learner-elected checkpoint protocol). This
// section closes that gap three ways: every overlay content file is pinned
// by hash; the pedagogy overlay's load-bearing sentences are asserted
// verbatim (so a rewording that softens the bargain can't ride an
// innocent-looking re-pin); and the INSTALLED plugin is checked for the
// applied markers, so a `claude plugin update` silently reverting pedagogy
// is a gate failure on this machine, not a shrug. (The installed check
// SKIPS — with a console note — when no plugin install is present, so CI
// and fresh clones still gate cleanly.)

const OVERLAY_DIR = join(ROOT, '..', 'plugin-overlays', 'engram')
// 2026-08-03 pin: the two explorable-contract presentation overlays
// (unchanged), plus the checkpoint-protocol pedagogy overlay and its
// dialogue-grammar companion — the first admissions under the widened
// charter (see plugin-overlays/README.md).
const PINNED_OVERLAY_HASHES: Record<string, string> = {
  'explorable-contract.qa-checklist-item.md': '3038484342c5c9fe',
  'explorable-contract.visual-design-section.md': '8ed0ac6a70ce56b7',
  // 2026-08-03 second pin (first live sitting's lessons): step 2 gains the
  // ask-fields-are-not-markdown LaTeX rule and the never-reference-options-
  // by-position rule (the app shuffles checkpoint option display order).
  'review-skill.quick-checkpoint-protocol.md': 'dd49fcd70b6ee8c8',
  'dialogue-grammar.checkpoint-exception.md': '9c4b24e6b10a16d4',
  // 2026-08-09 pin: the mobile-walk pedagogy overlay and its own
  // dialogue-grammar companion — the second admission under the widened
  // charter, and the first that touches ENCODING rather than review. Priced
  // higher for exactly that reason: provisional status until a desk sitting
  // solidifies the node, `mobile-*` stamps on every receipt, and the beats
  // recognition damages most barred from menus outright. Drafted here and
  // pinned before being wired into applyPluginOverlays' OVERLAYS array —
  // a pin is cheap, and an unpinned overlay sitting in this directory is
  // exactly the unaudited voice this section exists to prevent.
  'learn-skill.mobile-walk-protocol.md': '5f808bedbd581255',
  'dialogue-grammar.mobile-walk-exception.md': '9cbbd325856c2c76',
}
const overlayFiles = readdirSync(OVERLAY_DIR).filter((f) => f.endsWith('.md'))
for (const f of overlayFiles) {
  const found = sha(readFileSync(join(OVERLAY_DIR, f), 'utf-8'))
  if (!(f in PINNED_OVERLAY_HASHES)) {
    fail(
      'D5.overlayHash',
      `plugin-overlays/engram/${f} is not pinned.\n      found: ${found}`,
      'Overlays write into the plugin’s own skill files — text with HIGHER authority than any kickoff the app types. An unpinned overlay is an unaudited voice in the loop’s own instructions. Pin it here, in the same commit, with a rationale.',
    )
  } else if (found !== PINNED_OVERLAY_HASHES[f]) {
    fail(
      'D5.overlayHash',
      `plugin-overlays/engram/${f} changed.\n      pinned: ${PINNED_OVERLAY_HASHES[f]}\n      found:  ${found}`,
      'An overlay edit changes what the plugin’s own skills say. Re-read the whole content file, confirm the charter terms still hold (opt-in per sitting; source stamp; constitutional-exception header for pedagogy overlays), then re-pin in the same commit — that edit is the audit trail.',
    )
  }
}
for (const f of Object.keys(PINNED_OVERLAY_HASHES)) {
  if (!overlayFiles.includes(f)) {
    fail(
      'D5.overlayHash',
      `pinned overlay plugin-overlays/engram/${f} is missing from the repo.`,
      'A pinned overlay that vanishes without unpinning means the installed plugin may still carry its content with no source of truth left in the repo. Remove the pin in the same commit that removes the file — never let them drift apart.',
    )
  }
}

// (b) Each pedagogy overlay's load-bearing sentences, asserted verbatim.
// One entry per pedagogy overlay. A presentation overlay needs no entry —
// only the ones that buy an exception have a bargain to keep.
const LOAD_BEARING: Record<string, string[]> = {
  'review-skill.quick-checkpoint-protocol.md': [
    'Run this protocol ONLY when the learner\'s opening message for this sitting explicitly asks for the checkpoint style',
    'NEVER `easy`',
    '`effectively_relearn: true`',
    '--source quick-mc',
    'EXCLUDED from the §3 assessor-audit stash',
    'omit `--confidence` from the rate call',
  ],
  // The mobile-walk bargain, clause by clause: the per-sitting election; the
  // two beats menus may never reach; the four rules that stop an assembly
  // degenerating into a guessable chain; the refusal to serve an instance
  // whose key was never executed; the rating cap; the permanent stamp; the
  // audit exclusion; the calibration quarantine; and provisional status,
  // which is the clause that licenses touching encoding at all.
  'learn-skill.mobile-walk-protocol.md': [
    'Run this protocol ONLY when this sitting\'s opening message declares the mobile surface',
    'step assembly or a real production only, never a chain of picks',
    'Pool ≥ 2N',
    'No backtracking.',
    'L4 cold solve is never an assembly',
    'not served here at all',
    'Tap-derived items are rated at `good` at best.',
    '`--source mobile-walk` on the node',
    'EXCLUDED from the §4 assessor stash',
    'omit `--confidence` from the rate call',
    'is **provisional**',
  ],
  'dialogue-grammar.mobile-walk-exception.md': [
    'A second learner-elected exception to the menus rule',
  ],
}
for (const [file, needles] of Object.entries(LOAD_BEARING)) {
  if (!overlayFiles.includes(file)) continue
  const body = readFileSync(join(OVERLAY_DIR, file), 'utf-8')
  for (const needle of needles) {
    if (!body.includes(needle)) {
      fail(
        'D5.overlayContent',
        `${file} lost a load-bearing sentence: ${needle}`,
        'These sentences ARE the bargain that licenses a pedagogy overlay: per-sitting opt-in, the rating cap, the recall carve-outs, the permanent source stamp, the audit exclusion, and the calibration quarantine. Any one of them missing turns a priced exception into silent doctrine erosion. If the wording must change, change the assert in the same commit and say why.',
      )
    }
  }
}

// (c) The widened charter is stated where overlay authors will read it.
const overlayReadme = readFileSync(join(ROOT, '..', 'plugin-overlays', 'README.md'), 'utf-8')
if (!overlayReadme.includes('A pedagogy overlay is')) {
  fail(
    'D5.overlayCharter',
    'plugin-overlays/README.md no longer states the widened-charter terms for pedagogy overlays.',
    'The charter paragraph is what separates “a deliberate, documented exception” from “overlays quietly became a pedagogy editing surface.” If the charter is being re-narrowed, remove the pedagogy overlays and their pins in the same commit.',
  )
}

// (d) The INSTALLED plugin still carries the applied markers.
try {
  // Same manifest shape applyPluginOverlays.ts's readInstalledPluginPath
  // resolves: { plugins: { 'engram@engram': [{ installPath }] } }.
  const manifest = JSON.parse(
    readFileSync(join(process.env.HOME ?? '', '.claude', 'plugins', 'installed_plugins.json'), 'utf-8'),
  ) as { plugins?: Record<string, { installPath?: string }[]> }
  const installPath = manifest.plugins?.['engram@engram']?.[0]?.installPath
  if (installPath) {
    // Pedagogy overlays only — a presentation overlay that goes missing is a
    // cosmetic regression, but a missing pedagogy overlay means the tutor is
    // running a protocol the app believes it has. One row per applied block;
    // add a row in the same commit that adds a pedagogy insertion.
    const EXPECTED_MARKERS: Array<[string, string]> = [
      ['skills/review/SKILL.md', 'engram-desktop-overlay:quick-checkpoint-protocol:start'],
      ['skills/_shared/dialogue-grammar.md', 'engram-desktop-overlay:checkpoint-exception:start'],
      ['skills/learn/SKILL.md', 'engram-desktop-overlay:mobile-walk-protocol:start'],
      ['skills/_shared/dialogue-grammar.md', 'engram-desktop-overlay:mobile-walk-exception:start'],
    ]
    for (const [rel, mark] of EXPECTED_MARKERS) {
      const installed = readFileSync(join(installPath, rel), 'utf-8')
      if (!installed.includes(mark)) {
        fail(
          'D5.overlayApplied',
          `installed plugin file ${rel} is missing overlay marker ${mark} — run \`npm run apply:plugin-overlay\`.`,
          'The checkpoint feature’s app side (picker, kickoff, receipts substrate) assumes the protocol exists in the installed skill. A plugin update installs a fresh version directory with no overlays; if the app then elects checkpoints, the tutor has a request it has never heard of. Reapply before shipping — a pedagogy feature that exists only when someone remembers a script is worse than none.',
        )
      }
    }
  } else {
    console.log('  (D5.overlayApplied skipped — engram plugin not found in installed_plugins.json)')
  }
} catch {
  console.log('  (D5.overlayApplied skipped — no plugin install manifest on this machine)')
}

// ===========================================================================
// SECTION 6 — the mobile boundary: the phone is a client, never an author
// ===========================================================================
// The iOS companion reaches this app over the network, and what it sends
// becomes learner evidence. Sections 1–2 already prove the DESKTOP never
// authors engine state; this section proves the link layer did not quietly
// open a second door. Three properties, each cheap to check and expensive to
// lose:
//
//   (a) the source-stamp table is pinned, because it IS the honesty
//       mechanism — a stamp added or repointed silently is how recognition
//       evidence gets laundered into the free-recall pool;
//   (b) no module under main/link/ names engram.py, spawns a process, or
//       names the learning home — the queue is inert until a live session
//       drains it;
//   (c) the wire schema keeps refusing a client-supplied rating or stamp.

const LINK_DIR_PREFIX = 'main/link/'
const linkFiles = FILES.filter((f) => f.startsWith(LINK_DIR_PREFIX) && !f.endsWith('.test.ts'))

// (a) The stamp table, pinned value by value.
const PINNED_SOURCE_STAMPS: Record<string, string> = {
  checkpoint: 'quick-mc',
  connect: 'mobile-mc',
  cloze: 'mobile-cloze',
  ladder: 'mobile-ladder',
  // `self` is the load-bearing one: a spoken or typed production on the phone
  // is ordinary free recall, assessor-graded and uncapped. Repointing this to
  // a mobile-* value would silently demote every honest production the
  // companion ever collected.
  recall: 'self',
}
const protocolText = TEXT.get('shared/linkProtocol.ts') ?? ''
if (protocolText) {
  for (const [kind, stamp] of Object.entries(PINNED_SOURCE_STAMPS)) {
    if (!new RegExp(`${kind}:\\s*'${stamp}'`).test(protocolText)) {
      fail(
        'D6.sourceStamps',
        `shared/linkProtocol.ts no longer maps ${kind} → '${stamp}'.`,
        'The stamp table is the mobile bargain’s enforcement point: it is what keeps recognition-grade evidence distinguishable from free recall in every stat, audit, and export that ever reads a receipt. Changing a mapping — especially repointing `recall` away from `self` — is a doctrine change, not a refactor. Re-pin here in the same commit and say why.',
      )
    }
  }
} else {
  fail(
    'D6.sourceStamps',
    'shared/linkProtocol.ts is missing — the mobile source-stamp table has no source of truth.',
    'The link layer’s stamps are pinned here against that file. If the protocol moved, move the pin in the same commit; if the mobile surface was removed, remove this section and its pins together.',
  )
}

// (b) The link layer stays inert.
//
// Matched against CODE, not prose. These modules are expected to describe the
// boundary they keep — "never runs engram.py", "never touches
// ~/.claude/learning/" — and a check that made documenting the rule into a
// violation would train authors to delete the explanation, which is the
// opposite of what this file is for.
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const LINK_FORBIDDEN: Array<[RegExp, string]> = [
  [/engram\.py/, 'names engram.py'],
  [/\bspawn\b|\bexecFile\b|\bexecSync\b|child_process/, 'spawns a process'],
  [/\.claude[/'"`]|learning[/'"`]home|getLearningHome/, 'names the learning home'],
]
for (const f of linkFiles) {
  const t = codeOnly(TEXT.get(f)!)
  for (const [pattern, what] of LINK_FORBIDDEN) {
    if (pattern.test(t)) {
      fail(
        'D6.linkInert',
        `${f} ${what}.`,
        'main/link/ receives evidence from an untrusted client over the network. It must stay a queue: authenticate, validate, append. The moment it can run the engine or reach the learning home, a network peer is one bug away from authoring the learner’s record — which is exactly the boundary “a window, never a second author” draws. Drain the queue from a live session instead.',
      )
    }
  }
}

// (b2) The NETWORK module specifically stays sealed off from the engine.
//
// The directory rule above is necessarily coarse: linkService.ts is the
// composition root and legitimately reaches for a session (the learner-
// initiated drain) and for the overview counts. LinkServer.ts is the module a
// network peer actually talks to, and it must not be able to reach either —
// everything it needs arrives as an injected value. Without this, "the link
// layer is inert" would quietly become "the link directory contains one file
// that isn't".
const linkServerText = TEXT.get('main/link/LinkServer.ts') ?? ''
for (const forbidden of ["from '../session", "from '../ipc", "from '../engramCli"]) {
  if (linkServerText.includes(forbidden)) {
    fail(
      'D6.serverSealed',
      `main/link/LinkServer.ts imports ${forbidden}… — the network-facing module must not reach the engine or the session layer.`,
      'This is the module an untrusted peer sends bytes to. Everything it needs must arrive as an injected value, so it holds ANSWERS and never a way to ask the engine or start a session. A direct import puts a network request one bug away from the learner’s record — exactly the boundary the rest of this section exists to keep.',
    )
  }
}

// (b3) The phone menu ships counts, never answers.
//
// A due item carries probe/claim/rubric. A menu that shipped due ITEMS so it
// could say "6 due" would put the expected answers on the device, and the next
// retrieval would be recognition with a receipt recording it as memory. D4
// catches a field read app-wide; this says the narrower thing at the one place
// whose whole job is summarising due work for an off-machine surface.
const overviewText = TEXT.get('main/session/mobileOverview.ts') ?? ''
if (overviewText && /\.(probe|claim|rubric|transfer_probe)\b/.test(overviewText)) {
  fail(
    'D6.overviewCounts',
    'main/session/mobileOverview.ts reads a probe/claim/rubric field — the phone overview must be counts only.',
    'The overview crosses to a device the learner carries around. Counts cannot leak an answer; items can. If the menu genuinely needs more than numbers, that is a design decision about the order of operations (probe → production → confidence → reveal), not a data-plumbing convenience.',
  )
}

// (b4) The graph projection stays a projection.
//
// buildConstellationGraph narrows the graph read to exactly the fields a
// figure needs — id, state, threshold, requires — so an edit wanting `claim`
// has to widen a type declaration, which is a visible act. This asserts the
// narrowing is still there. Without it, the easiest "fix" for a missing field
// is to cast the read to the full node type, and every answer in the topic
// ships to a device the learner carries around.
if (overviewText && !overviewText.includes('type DrawableNode')) {
  fail(
    'D6.graphProjection',
    'main/session/mobileOverview.ts no longer narrows its graph read to a drawable projection.',
    'The graph crosses to the phone so a topic can be DRAWN. An EngramNode carries claim, rubric, probe and transfer_probe; a projection typed to id/state/threshold/requires cannot leak one, and a widened read can leak all of them at once. If a figure genuinely needs another field, add that field to the narrow type — do not reach for the full node.',
  )
}

// (b5) The one network write outside the outbox stays app-local.
//
// /link/topic-folder lets a paired phone file a topic. That is safe only
// because a folder is presentational grouping in the app's own settings store
// — nothing moves on disk, no graph is touched, no schedule changes. The
// composition root must reach it through topicSettings and nothing else; a
// write that went anywhere near the learning home would make a network peer an
// author of the record, which is the whole thing §D6 exists to prevent.
const linkServiceText = TEXT.get('main/link/linkService.ts') ?? ''
if (codeOnly(linkServiceText).includes('setFolder')) {
  if (!linkServiceText.includes("from '../session/topicSettings'")) {
    fail(
      'D6.filingScope',
      'main/link/linkService.ts exposes setFolder without going through topicSettings.',
      'Filing from the phone is licensed because it writes an app-local label in the app’s own settings store. Routing it anywhere else — a graph, the learning home, a second store — turns a presentational convenience into a network peer writing the learner’s record.',
    )
  }
}
// No second forbidden-substring list here: (b) above already forbids naming
// the engine, spawning, or reaching the learning home anywhere under
// main/link/, and it matches CODE rather than prose. A duplicate check that
// scanned comments too immediately fired on the word "rate" inside a sentence
// explaining that this module does not rate — a rule that cries wolf teaches
// people to silence it.

// (b6) The grades that come BACK carry no content.
//
// /link/receipts is the only route that answers with the engine's own verdicts
// rather than counts. That is licensed because a receipt is written AFTER the
// production is graded and records none of it — the learner's words stay in
// the transcript on the Mac. But "a receipt records no content" is a property
// of today's receipt schema, not a promise the engine made, so the projection
// is a whitelist and this pins it as one. A widened read has to name the field
// it wants, which is a visible act in a diff.
const receiptsText = codeOnly(TEXT.get('main/session/mobileReceipts.ts') ?? '')
if (receiptsText) {
  if (/\b(probe|claim|rubric|transfer_probe|production|stash)\b/.test(receiptsText)) {
    fail(
      'D6.receiptsGradesOnly',
      'main/session/mobileReceipts.ts names an answer field — the return leg ships grades, never content.',
      'A receipt may cross to the phone precisely because it is a verdict with no production attached. The moment this projection reaches for the text that was graded, the phone is holding the answer to a node it has not yet been re-asked — which is the same leak D4 prevents at the desk, arriving by a different road.',
    )
  }
  if (!receiptsText.includes('PHONE_SOURCE_STAMPS')) {
    fail(
      'D6.receiptsGradesOnly',
      'main/session/mobileReceipts.ts no longer derives its phone-stamp set from shared/linkProtocol.ts.',
      'Which stamps mean "recognition-grade" decides which nodes read as provisional. Copying that list into a second file means a new mobile card kind can ship a stamp that one file knows about and the other silently treats as desk-grade work — the node would look solidified without anyone having solidified it.',
    )
  }
}

// (c) The wire schema still refuses a client-supplied rating or stamp.
for (const needle of ['.strict()', 'sourceStampFor', 'PHONE_SOURCE_STAMPS']) {
  if (protocolText && !protocolText.includes(needle)) {
    fail(
      'D6.wireSchema',
      `shared/linkProtocol.ts lost ${needle}.`,
      '`.strict()` is what turns a client-supplied `rating` or `source` into a rejection instead of a silently-ignored field, and sourceStampFor is the single place a stamp is derived. Losing either means a payload can assert its own grade and have the app shrug.',
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
