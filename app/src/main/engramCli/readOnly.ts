import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, join } from 'node:path'
import { resolveEngramPlugin } from '../session/pluginResolver'

const execFileAsync = promisify(execFile)

// Exact allowlist of engram.py subcommands this module will ever invoke.
//
// The guarantee here is "no WRITE action is reachable" — NOT "no lock is
// taken". engram.py's `main()` keeps a local `mutating` set that decides
// lock acquisition per COMMAND, not per action, and it includes
// `misconception`, `experiment`, and `model` — so those three acquire the
// advisory lock even for their read actions (`LOCK_TIMEOUT_S = 10`, so a
// read can block briefly, or throw, while a live session is mid-write).
// That's pre-existing and accepted: `artifact list` has always done it.
// What must stay true is that every entry below either has no write action
// at all, or is gated by READ_ONLY_SUBCOMMANDS to its read actions only.
const READ_ONLY_COMMANDS = new Set([
  'topics',
  'stats',
  'due',
  'decay',
  'next',
  'adherence',
  'retention',
  'transfer',
  'grader-health',
  'topic-status',
  'doctor',
  'path',
  'model',
])

// Some engram.py subcommands are read-only for SOME of their actions but not
// others — `misconception add`/`resolve` write misconceptions.json while
// `misconception list` only reads it; `experiment start`/`assign`/`settle`
// write experiments.json while `status`/`list` only read it. Putting either
// command name in READ_ONLY_COMMANDS would therefore permit its write actions
// too, so these are gated on args[0] instead, consulted only when the flat
// set above misses.
const READ_ONLY_SUBCOMMANDS: Map<string, Set<string>> = new Map([
  ['misconception', new Set(['list'])],
  ['experiment', new Set(['status', 'list'])],
])

export class EngramCliError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message)
    this.name = 'EngramCliError'
  }
}

/**
 * Run a read-only engram.py subcommand and parse its JSON stdout.
 * Refuses anything not in READ_ONLY_COMMANDS — mutating state must go
 * through a live driven session (see main/session/SessionManager), never
 * this module, to avoid a second writer against engram.py's lockfile.
 */
export async function engramRead<T = unknown>(command: string, args: string[] = []): Promise<T> {
  if (!READ_ONLY_COMMANDS.has(command)) {
    // Missing action, unknown action, or a command not in either allowlist
    // all refuse identically — the caller learns nothing about which case it
    // hit, same as a flat-set miss did before this map existed.
    const allowedActions = READ_ONLY_SUBCOMMANDS.get(command)
    const action = args[0]
    if (!allowedActions || action === undefined || !allowedActions.has(action)) {
      throw new Error(`engramRead: "${command}" is not on the read-only allowlist`)
    }
  }
  const { scriptPath } = resolveEngramPlugin()
  try {
    const { stdout } = await execFileAsync('python3', [scriptPath, command, ...args], {
      maxBuffer: 32 * 1024 * 1024,
    })
    return JSON.parse(stdout) as T
  } catch (err: unknown) {
    const e = err as { stderr?: string; code?: number; message: string }
    throw new EngramCliError(
      `engram.py ${command} failed: ${e.message}`,
      e.stderr ?? '',
      e.code ?? null,
    )
  }
}

// `topic-status` is human-readable text, not JSON — keep it separate.
export async function engramTopicStatusText(topic: string): Promise<string> {
  const { scriptPath } = resolveEngramPlugin()
  try {
    const { stdout } = await execFileAsync('python3', [scriptPath, 'topic-status', '--topic', topic])
    return stdout
  } catch (err: unknown) {
    const e = err as { stderr?: string; code?: number; message: string }
    throw new EngramCliError(`engram.py topic-status failed: ${e.message}`, e.stderr ?? '', e.code ?? null)
  }
}

// `path` prints a bare filesystem path, not JSON — keep it separate from engramRead
// (which JSON.parses stdout), same reasoning as engramTopicStatusText above.
export async function engramLearningHome(): Promise<string> {
  const { scriptPath } = resolveEngramPlugin()
  const { stdout } = await execFileAsync('python3', [scriptPath, 'path'])
  return stdout.trim()
}

/**
 * engram.py's own `artifact list` mixes absolute paths (artifacts saved outside
 * the learning home, e.g. via a custom topic settings path) with paths relative
 * to the learning home (the normal case) — confirmed live: `artifact list`'s
 * real output had one of each. `win.loadFile()` resolves a relative path against
 * the app's own root, not the learning home, so those entries silently failed
 * to load (a blank explorable window, no visible error) until resolved here.
 */
export async function engramArtifactList(): Promise<unknown[]> {
  const { scriptPath } = resolveEngramPlugin()
  const { stdout } = await execFileAsync('python3', [scriptPath, 'artifact', 'list'])
  const entries = JSON.parse(stdout) as { artifact: string; [k: string]: unknown }[]
  if (entries.length === 0) return entries
  const home = await engramLearningHome()
  return entries.map((e) => ({ ...e, artifact: isAbsolute(e.artifact) ? e.artifact : join(home, e.artifact) }))
}

// The narrow direct-mutation exception (settings only — see plan §5):
// visuals/focus/model --set/commit, pure key-value writes engram.py's own
// skills already treat as user-invocable outside a session.
const DIRECT_MUTATION_COMMANDS = new Set(['visuals', 'focus', 'commit'])

export async function engramDirectMutate(command: string, args: string[]): Promise<unknown> {
  if (!DIRECT_MUTATION_COMMANDS.has(command) && command !== 'model') {
    throw new Error(`engramDirectMutate: "${command}" is not on the direct-mutation allowlist`)
  }
  const { scriptPath } = resolveEngramPlugin()
  const { stdout } = await execFileAsync('python3', [scriptPath, command, ...args])
  try {
    return JSON.parse(stdout)
  } catch {
    return { raw: stdout }
  }
}

/**
 * Read a specific topic's full graph JSON directly from disk — there's no
 * engram.py subcommand that dumps the whole node graph (topic-status only
 * renders a text progress bar), and graphs/<topic>.json is a documented,
 * stable, engine-owned schema safe to read (never write) directly.
 */
export async function readTopicGraph(topic: string): Promise<unknown> {
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  const { readFile } = await import('node:fs/promises')
  const path = join(homedir(), '.claude', 'learning', 'graphs', `${topic}.json`)
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw)
}
