import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CheckOutcome, CheckRun } from '../../shared/labs'
import { isWindows, spawnCli } from '../platform'
import { checkRunnerPath, mplConfigDir, readyInterpreter } from '../runtime/envManager'
import { scrubbedEnv } from '../runtime/runtimePaths'

/**
 * Runs one check: a fresh interpreter on the lab's runtime layer, running
 * resources/runtime/engram_check.py, which loads the frozen cells and runs a
 * pack's pytest file against them. The files it reads (cells.json) and the
 * report it writes (out.json) sit in a work folder labStore prepares; this
 * file writes nothing itself.
 *
 * Doctrine: a pinned subprocess door (D1). The only program it launches is
 * the managed env's interpreter on the check runner shipped in the app's
 * resources, with the same scrubbed environment a kernel gets, so a check
 * cannot reach a model any more than a cell can. Never engram.py.
 */

export interface CheckJob {
  layer: string
  /** Folder holding cells.json; the run's working directory, and where out.json lands. */
  workDir: string
  testsPath: string
  mode: 'smoke' | 'hidden'
  timeLimitS: number
}

export interface RunningCheck {
  done: Promise<CheckRun>
  cancel: () => void
}

function broken(error: string, seconds = 0): CheckRun {
  return { completed: false, error, tests: [], seconds }
}

function parseOut(raw: unknown, mode: CheckJob['mode']): CheckRun | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const tests: CheckOutcome[] = []
  for (const t of Array.isArray(o.tests) ? o.tests : []) {
    const r = t as Record<string, unknown>
    const tier = mode === 'smoke' ? 'smoke' : r.tier === 'slip' ? 'slip' : 'core'
    const outcome = r.outcome === 'passed' || r.outcome === 'failed' || r.outcome === 'skipped' ? r.outcome : 'error'
    tests.push({
      name: String(r.name ?? '').slice(0, 120),
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

export function startCheck(job: CheckJob): RunningCheck {
  let cancel: () => void = () => {}
  const done = (async (): Promise<CheckRun> => {
    const interpreter = await readyInterpreter(job.layer)
    if (!interpreter)
      return broken(`The ${job.layer} runtime layer is not installed. Install it in Settings → Code runtime.`)
    const outPath = join(job.workDir, 'out.json')
    const started = Date.now()
    const env: NodeJS.ProcessEnv = {
      ...scrubbedEnv(process.env),
      MPLBACKEND: 'Agg',
      MPLCONFIGDIR: mplConfigDir(),
      PYTHONIOENCODING: 'utf-8',
      PYTHONNOUSERSITE: '1',
    }
    // -I: isolated (no PYTHON* variables, no user site, no script dir on the
    // path); -B: write no bytecode beside the pack's test files.
    const child = spawnCli(
      interpreter,
      ['-I', '-B', '-X', 'utf8', checkRunnerPath(), join(job.workDir, 'cells.json'), job.testsPath, job.mode, outPath],
      // Its own process group on POSIX, so a timeout also stops any worker
      // processes the learner's code started.
      {
        cwd: job.workDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !isWindows,
      },
    )
    let tail = ''
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString('utf-8')).slice(-2000)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    let stopped: 'timeout' | 'cancel' | null = null
    const kill = () => {
      try {
        if (!isWindows && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
    cancel = () => {
      stopped = 'cancel'
      kill()
    }
    const timer = setTimeout(() => {
      stopped = 'timeout'
      kill()
    }, job.timeLimitS * 1000)
    const code = await new Promise<number | null>((res) => {
      child.on('error', () => res(-1))
      child.on('close', (c) => res(c))
    })
    clearTimeout(timer)
    const seconds = Math.round((Date.now() - started) / 100) / 10
    if (stopped === 'timeout')
      return broken(`The check ran past its ${job.timeLimitS} s limit and was stopped.`, seconds)
    if (stopped === 'cancel') return broken('The check was stopped.', seconds)
    try {
      const run = parseOut(JSON.parse(await readFile(outPath, 'utf-8')), job.mode)
      if (run) return run
    } catch {
      // Falls through to the runner's own last words.
    }
    const last = tail.trim().split('\n').slice(-2).join(' ').slice(0, 300)
    return broken(`The check runner stopped (exit ${code}) before reporting. ${last}`.trim(), seconds)
  })()
  return { done, cancel: () => cancel() }
}
