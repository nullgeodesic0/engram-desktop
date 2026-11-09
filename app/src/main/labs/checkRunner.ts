import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CheckOutcome, CheckRun } from '../../shared/labs'
import { execCli, isWindows, spawnCli } from '../platform'
import { checkRunnerPath, mplConfigDir, readyInterpreter } from '../runtime/envManager'
import { scrubbedEnv } from '../runtime/runtimePaths'

/**
 * Runs one check: a fresh interpreter on the lab's runtime layer, running
 * resources/runtime/engram_check.py, which loads the frozen cells and runs a
 * pack's pytest file against them. The files it reads (cells.json) and the
 * report it writes (out-*.json) sit in a work folder labStore prepares
 * outside the learner's lab folder; this file writes nothing itself.
 *
 * A check is two runs. The first loads no learner code and only lists the
 * pack's tests and their tiers; the second runs them against the cells. The
 * second must report exactly the tests the first listed, with the same
 * tiers, and echo the nonce it was handed on stdin, or it counts as broken.
 * That stops the casual ways a learner's cell could fake a result (writing
 * the out file, dropping a failing test). It does not make the result
 * tamper-proof: see the runner's own docstring and docs/content-packs.md.
 *
 * Doctrine: a pinned subprocess door (D1). The only program it launches is
 * the managed env's interpreter on the check runner shipped in the app's
 * resources, with the same scrubbed environment a kernel gets, so a check
 * cannot reach a model any more than a cell can; and, on Windows, taskkill
 * to stop that interpreter's process tree. Never engram.py.
 */

export interface CheckJob {
  layer: string
  /** Folder holding cells.json, where the runner's out files land. Not the learner's lab folder. */
  workDir: string
  /** The run's working directory: the learner's lab folder, as for the kernel. */
  cwd: string
  testsPath: string
  mode: 'smoke' | 'hidden'
  timeLimitS: number
}

export interface RunningCheck {
  done: Promise<CheckRun>
  cancel: () => void
}

function broken(error: string, seconds = 0, tests: CheckOutcome[] = []): CheckRun {
  return { completed: false, error, tests, seconds }
}

/** Reads the runner's out file. Null when it is missing, malformed or carries the wrong nonce. */
export function parseOut(raw: unknown, mode: CheckJob['mode'] | 'collect', nonce: string): CheckRun | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.nonce !== nonce) return null
  const tests: CheckOutcome[] = []
  for (const t of Array.isArray(o.tests) ? o.tests : []) {
    const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
    const tier = mode === 'smoke' ? 'smoke' : r.tier === 'slip' ? 'slip' : 'core'
    const outcome = r.outcome === 'passed' || r.outcome === 'failed' || r.outcome === 'skipped' ? r.outcome : 'error'
    tests.push({
      id: String(r.id ?? r.name ?? '').slice(0, 300),
      name: String(r.name ?? '').slice(0, 120),
      about: String(r.about ?? '').slice(0, 200),
      tier,
      outcome,
      message: String(r.message ?? '').slice(0, 400),
    })
  }
  return {
    completed: o.completed === true,
    error: typeof o.error === 'string' ? o.error.slice(0, 400) : null,
    tests,
    seconds: typeof o.seconds === 'number' ? o.seconds : 0,
  }
}

/** Does a real run report exactly the tests, and tiers, that the collect-only run listed? */
export function sameTests(listed: CheckOutcome[], ran: CheckOutcome[]): boolean {
  if (listed.length !== ran.length) return false
  const want = new Map(listed.map((t) => [t.id, t.tier]))
  if (want.size !== listed.length) return false
  const seen = new Set<string>()
  for (const t of ran) {
    if (seen.has(t.id) || want.get(t.id) !== t.tier) return false
    seen.add(t.id)
  }
  return true
}

/** The scrubbed kernel environment, minus anything that steers pytest from outside. */
function checkEnv(): NodeJS.ProcessEnv {
  const env = scrubbedEnv(process.env)
  for (const k of Object.keys(env)) if (k.toUpperCase().startsWith('PYTEST_')) delete env[k]
  return {
    ...env,
    MPLBACKEND: 'Agg',
    MPLCONFIGDIR: mplConfigDir(),
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
  }
}

interface Phase {
  /** The run's out file, parsed and nonce-checked; null if it never came. */
  run: CheckRun | null
  stopped: 'timeout' | 'cancel' | null
  code: number | null
  tail: string
}

export function startCheck(job: CheckJob): RunningCheck {
  let cancelled = false
  let killCurrent: () => void = () => {}
  const cancel = () => {
    cancelled = true
    killCurrent()
  }

  const done = (async (): Promise<CheckRun> => {
    const interpreter = await readyInterpreter(job.layer)
    if (!interpreter)
      return broken(`The ${job.layer} runtime layer is not installed. Install it in Settings → Code runtime.`)
    const started = Date.now()
    const deadline = started + job.timeLimitS * 1000
    const elapsed = () => Math.round((Date.now() - started) / 100) / 10

    const phase = async (mode: 'collect' | CheckJob['mode']): Promise<Phase> => {
      if (cancelled) return { run: null, stopped: 'cancel', code: null, tail: '' }
      const nonce = randomBytes(16).toString('hex')
      // labStore hands over a fresh work folder; a stale out file would carry the wrong nonce anyway.
      const outPath = join(job.workDir, `out-${mode}.json`)
      // -I: isolated (no PYTHON* variables, no user site, no script dir on the
      // path); -B: write no bytecode beside the pack's test files.
      const child = spawnCli(interpreter, ['-I', '-B', '-X', 'utf8', checkRunnerPath()], {
        cwd: job.cwd,
        env: checkEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        // Its own process group on POSIX, so stopping it also stops any
        // worker processes the learner's code started.
        detached: !isWindows,
      })
      let tail = ''
      const keep = (chunk: Buffer) => {
        tail = (tail + chunk.toString('utf-8')).slice(-2000)
      }
      child.stdout?.on('data', keep)
      child.stderr?.on('data', keep)
      child.stdin?.on('error', () => {})
      // The job, nonce included, goes over stdin rather than argv, where the
      // learner's code could read it back from sys.argv.
      child.stdin?.end(
        JSON.stringify({
          mode,
          cells: join(job.workDir, 'cells.json'),
          tests: job.testsPath,
          out: outPath,
          nonce,
        }) + '\n',
      )
      let stopped: Phase['stopped'] = null
      let exited = false
      const killTree = () => {
        if (!child.pid) return
        if (isWindows) {
          if (!exited)
            void execCli('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10_000 }).catch(() => {})
          return
        }
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // The group is already gone.
        }
      }
      killCurrent = () => {
        stopped ??= 'cancel'
        killTree()
      }
      const timer = setTimeout(
        () => {
          stopped ??= 'timeout'
          killTree()
        },
        Math.max(0, deadline - Date.now()),
      )
      // 'exit', not 'close': a worker the learner's code left running holds
      // the pipes open, and the runner has written its report by now.
      const code = await new Promise<number | null>((res) => {
        child.on('error', () => res(-1))
        child.on('exit', (c) => res(c))
      })
      exited = true
      clearTimeout(timer)
      killCurrent = () => {}
      // Anything the cells left running goes with the runner.
      killTree()
      let run: CheckRun | null = null
      try {
        run = parseOut(JSON.parse(await readFile(outPath, 'utf-8')), mode, nonce)
      } catch {
        run = null
      }
      if (cancelled) stopped = 'cancel'
      return { run, stopped, code, tail }
    }

    const fail = (p: Phase): CheckRun => {
      const seconds = elapsed()
      if (p.stopped === 'timeout')
        return broken(`The check ran past its ${job.timeLimitS} s limit and was stopped.`, seconds)
      if (p.stopped === 'cancel') return broken('The check was stopped.', seconds)
      const last = p.tail.trim().split('\n').slice(-2).join(' ').slice(0, 300)
      return broken(`The check runner stopped (exit ${p.code}) before reporting. ${last}`.trim(), seconds)
    }

    const listing = await phase('collect')
    if (!listing.run || listing.stopped) return fail(listing)
    if (!listing.run.completed) return broken(listing.run.error ?? 'The pack’s tests could not be listed.', elapsed())
    const listed = listing.run.tests.map((t) => ({
      ...t,
      tier: job.mode === 'smoke' ? ('smoke' as const) : t.tier,
      outcome: 'error' as const,
      message: 'did not run',
    }))

    const real = await phase(job.mode)
    if (!real.run || real.stopped) return { ...fail(real), tests: listed }
    const run = { ...real.run, seconds: elapsed() }
    if (!run.completed) return { ...run, tests: listed }
    if (!sameTests(listed, run.tests))
      return broken(
        'The run did not report the pack’s tests as listed, so its result cannot be trusted. Does a cell change pytest or the test file?',
        run.seconds,
        listed,
      )
    return run
  })()
  return { done, cancel }
}
