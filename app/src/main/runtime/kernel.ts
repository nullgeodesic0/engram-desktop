import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { isWindows, spawnCli } from '../platform'
import type { CellOutput, KernelEvent, KernelState, KernelVar } from '../../shared/runtime'
import { getCellLimitS, kernelFilePath, mplConfigDir, readyInterpreter, watchedPackages } from './envManager'
import { BASE_LAYER } from './runtimePaths'
import { scrubbedEnv } from './runtimePaths'
import { LineSplitter, parseKernelLine } from './kernelProtocol'

/**
 * One notebook kernel per open workbench: the env's interpreter running
 * resources/runtime/engram_kernel.py, spoken to in JSON lines.
 *
 * Doctrine: a subprocess door (D1), pinned. The only program it launches is
 * the interpreter of an app-managed env (envManager.readyInterpreter), with
 * the kernel file that ships in the app's resources. The learner's code runs
 * inside that process with the workbench folder as its working directory; it
 * has no channel to the engine, the tutor or the learning home other than
 * what any program on the machine has. Nothing here writes a file.
 *
 * Interrupts: SIGINT on macOS and Linux, which the kernel turns into a
 * KeyboardInterrupt inside the cell and survives. Windows has no way to send
 * a console interrupt to a piped child, so there an interrupt restarts the
 * kernel, and says so in the cell's output.
 */

const READY_TIMEOUT_MS = 60_000
const INTERRUPT_GRACE_MS = 5_000
const MAX_LIVE_KERNELS = 3

interface Job {
  reqId: number
  cellId: string
  code: string
}

type Emit = (ev: KernelEvent) => void

class Kernel {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private nextReqId = 1
  private counter = 0
  private queue: Job[] = []
  private current: Job | null = null
  private limitTimer: ReturnType<typeof setTimeout> | null = null
  private graceTimer: ReturnType<typeof setTimeout> | null = null
  private stderrTail = ''
  private pendingVars = new Map<number, (v: KernelVar[]) => void>()
  state: KernelState = 'dead'
  private generation = 0
  private abortStart: (() => void) | null = null
  /** When this kernel last ran something; the manager stops the least recent. */
  lastUsed = Date.now()

  constructor(
    readonly workbenchId: string,
    private readonly cwd: string,
    private readonly layerFor: () => Promise<string>,
    private readonly emit: Emit,
  ) {}

  private setState(state: KernelState, detail?: string): void {
    this.state = state
    this.emit({ kind: 'state', workbenchId: this.workbenchId, state, detail })
  }

  private output(cellId: string, output: CellOutput): void {
    this.emit({
      kind: 'output',
      workbenchId: this.workbenchId,
      cellId,
      output,
    })
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    // Each start has a generation. kill() bumps it, so a start that was
    // superseded (a restart while starting up) can never touch the kernel
    // that replaced it, and its child is killed rather than orphaned.
    const gen = ++this.generation
    const stale = () => gen !== this.generation
    this.ready = (async () => {
      this.setState('starting')
      // A pack lab runs on its pack's layer; everything else on the base layer.
      const layer = await this.layerFor().catch(() => BASE_LAYER)
      const interpreter = await readyInterpreter(layer)
      const watch = await watchedPackages(layer)
      if (stale()) throw new Error('superseded')
      if (!interpreter) {
        this.setState(
          'dead',
          layer === BASE_LAYER
            ? 'The code runtime is not installed. Install it in Settings → Code runtime.'
            : `This lab needs the ${layer} layer. Install it in Settings → Code runtime.`,
        )
        throw new Error('runtime not installed')
      }
      const env: NodeJS.ProcessEnv = {
        ...scrubbedEnv(process.env),
        MPLBACKEND: 'Agg',
        MPLCONFIGDIR: mplConfigDir(),
        PYTHONIOENCODING: 'utf-8',
        PYTHONNOUSERSITE: '1',
      }
      // -E: ignore PYTHON* variables; -s: no user site-packages; -u: unbuffered.
      const child = spawnCli(interpreter, ['-E', '-s', '-u', '-X', 'utf8', kernelFilePath(), ...watch], {
        cwd: this.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      this.counter = 0
      this.stderrTail = ''
      const lines = new LineSplitter()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The kernel did not start within a minute.')), READY_TIMEOUT_MS)
        this.abortStart = () => {
          clearTimeout(timer)
          reject(new Error('superseded'))
        }
        child.stdout.setEncoding('utf-8')
        child.stdout.on('data', (chunk: string) => {
          for (const line of lines.push(chunk)) {
            const msg = parseKernelLine(line)
            if (!msg) continue
            if (msg.type === 'ready') {
              clearTimeout(timer)
              resolve()
            } else this.onMessage(msg)
          }
        })
        child.stderr.setEncoding('utf-8')
        child.stderr.on('data', (chunk: string) => {
          this.stderrTail = (this.stderrTail + chunk).slice(-4000)
        })
        child.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
        child.on('exit', (code, signal) => {
          clearTimeout(timer)
          if (this.child === child) this.onExit(code, signal)
          reject(
            new Error(`The kernel exited during startup. ${this.stderrTail.trim().split('\n').slice(-2).join(' ')}`),
          )
        })
      }).finally(() => {
        this.abortStart = null
      })
      if (stale()) throw new Error('superseded')
      this.setState('idle')
    })().catch((err) => {
      if (stale()) throw err
      this.ready = null
      // A start that fails after spawning must not leave its child behind.
      if (this.child) {
        const c = this.child
        this.child = null
        c.removeAllListeners('exit')
        c.kill('SIGKILL')
      }
      if (this.state !== 'dead') this.setState('dead', err instanceof Error ? err.message : String(err))
      throw err
    })
    return this.ready
  }

  private onMessage(msg: NonNullable<ReturnType<typeof parseKernelLine>>): void {
    const cur = this.current
    if (msg.type === 'output') {
      if (cur && msg.id === cur.reqId) this.output(cur.cellId, msg.output)
    } else if (msg.type === 'done') {
      if (!cur || msg.id !== cur.reqId) return
      this.clearTimers()
      this.counter += 1
      this.current = null
      this.emit({
        kind: 'done',
        workbenchId: this.workbenchId,
        cellId: cur.cellId,
        ok: msg.ok,
        ms: msg.ms,
        count: this.counter,
      })
      this.setState('idle')
      this.pump()
    } else if (msg.type === 'vars') {
      this.pendingVars.get(msg.id)?.(msg.vars)
      this.pendingVars.delete(msg.id)
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null
    this.ready = null
    this.clearTimers()
    for (const resolve of this.pendingVars.values()) resolve([])
    this.pendingVars.clear()
    const why = signal ? `signal ${signal}` : `exit code ${code}`
    const tail = this.stderrTail.trim().split('\n').slice(-3).join('\n')
    this.failCurrentAndQueue(`The kernel stopped unexpectedly (${why}).${tail ? `\n${tail}` : ''}`)
    this.setState('dead', `The kernel stopped (${why}).`)
  }

  private failCurrentAndQueue(message: string): void {
    const jobs = [...(this.current ? [this.current] : []), ...this.queue]
    this.current = null
    this.queue = []
    jobs.forEach((job, i) => {
      if (i === 0)
        this.output(job.cellId, {
          type: 'error',
          ename: 'KernelDied',
          evalue: message,
          traceback: [],
          line: null,
        })
      else
        this.output(job.cellId, {
          type: 'stream',
          name: 'stderr',
          text: 'Not run: the kernel stopped before this cell started.\n',
        })
      this.emit({
        kind: 'done',
        workbenchId: this.workbenchId,
        cellId: job.cellId,
        ok: false,
        ms: 0,
        count: 0,
      })
    })
  }

  private clearTimers(): void {
    if (this.limitTimer) clearTimeout(this.limitTimer)
    if (this.graceTimer) clearTimeout(this.graceTimer)
    this.limitTimer = this.graceTimer = null
  }

  run(cellId: string, code: string): void {
    this.lastUsed = Date.now()
    this.queue.push({ reqId: this.nextReqId++, cellId, code })
    this.start()
      .then(() => this.pump())
      .catch((err: Error) => {
        if (err.message !== 'superseded') this.failCurrentAndQueue(`The kernel could not start. ${err.message}`)
      })
  }

  private pump(): void {
    if (this.current || !this.child || this.state === 'starting') return
    const job = this.queue.shift()
    if (!job) return
    this.current = job
    this.setState('busy')
    this.child.stdin.write(
      JSON.stringify({
        id: job.reqId,
        op: 'exec',
        cell: job.cellId,
        code: job.code,
      }) + '\n',
    )
    void getCellLimitS().then((limit) => {
      if (limit > 0 && this.current === job) {
        this.limitTimer = setTimeout(() => {
          if (this.current !== job) return
          this.output(job.cellId, {
            type: 'stream',
            name: 'stderr',
            text: `\n[Stopped: the cell ran past its ${limit} s limit. Change the limit in Settings → Code runtime.]\n`,
          })
          this.interrupt()
        }, limit * 1000)
      }
    })
  }

  /** Stops the running cell and drops the queued ones. */
  interrupt(): void {
    const job = this.current
    for (const queued of this.queue) {
      this.output(queued.cellId, {
        type: 'stream',
        name: 'stderr',
        text: 'Not run: an earlier cell was interrupted.\n',
      })
      this.emit({
        kind: 'done',
        workbenchId: this.workbenchId,
        cellId: queued.cellId,
        ok: false,
        ms: 0,
        count: 0,
      })
    }
    this.queue = []
    if (!job || !this.child) return
    if (isWindows) {
      this.output(job.cellId, {
        type: 'stream',
        name: 'stderr',
        text: '\n[On Windows a running cell can only be stopped by restarting the kernel. Variables were cleared.]\n',
      })
      this.restart()
      return
    }
    this.child.kill('SIGINT')
    if (this.graceTimer) clearTimeout(this.graceTimer)
    this.graceTimer = setTimeout(() => {
      if (this.current !== job) return
      this.output(job.cellId, {
        type: 'stream',
        name: 'stderr',
        text: '\n[The cell did not stop after an interrupt, so the kernel was restarted. Variables were cleared.]\n',
      })
      this.restart()
    }, INTERRUPT_GRACE_MS)
  }

  /** Kills the process, fails anything in flight, and starts a fresh one. */
  restart(): void {
    this.kill('Restarted.')
    void this.start()
      .then(() => this.pump())
      .catch(() => {})
  }

  kill(reason: string): void {
    const child = this.child
    this.child = null
    this.ready = null
    this.generation++
    this.abortStart?.()
    this.abortStart = null
    this.clearTimers()
    const jobs = [...(this.current ? [this.current] : []), ...this.queue]
    this.current = null
    this.queue = []
    for (const job of jobs)
      this.emit({
        kind: 'done',
        workbenchId: this.workbenchId,
        cellId: job.cellId,
        ok: false,
        ms: 0,
        count: 0,
      })
    for (const resolve of this.pendingVars.values()) resolve([])
    this.pendingVars.clear()
    if (child) {
      child.removeAllListeners('exit')
      child.kill('SIGKILL')
    }
    this.setState('dead', reason)
  }

  vars(): Promise<KernelVar[]> {
    if (!this.child || this.state !== 'idle') return Promise.resolve([])
    const id = this.nextReqId++
    return new Promise((resolve) => {
      this.pendingVars.set(id, resolve)
      this.child!.stdin.write(JSON.stringify({ id, op: 'vars' }) + '\n')
      setTimeout(() => {
        if (this.pendingVars.delete(id)) resolve([])
      }, 5000)
    })
  }
}

export class KernelManager {
  private kernels = new Map<string, Kernel>()

  constructor(
    private readonly cwdFor: (workbenchId: string) => string,
    private readonly emit: Emit,
    /** The runtime layer a workbench's kernel runs on. */
    private readonly layerFor: (workbenchId: string) => Promise<string> = async () => BASE_LAYER,
  ) {}

  private get(workbenchId: string): Kernel {
    let k = this.kernels.get(workbenchId)
    if (!k) {
      k = new Kernel(workbenchId, this.cwdFor(workbenchId), () => this.layerFor(workbenchId), this.emit)
      this.kernels.set(workbenchId, k)
    }
    return k
  }

  run(workbenchId: string, cellId: string, code: string): void {
    this.get(workbenchId).run(cellId, code)
    this.evictIdle(workbenchId)
  }

  /** Keeps at most MAX_LIVE_KERNELS processes: the least recently used idle
   * ones are shut down. Each holds NumPy, Matplotlib and a pack's libraries in memory. */
  private evictIdle(keep: string): void {
    const live = [...this.kernels.values()].filter((k) => k.state !== 'dead')
    if (live.length <= MAX_LIVE_KERNELS) return
    const idle = live
      .filter((k) => k.workbenchId !== keep && k.state === 'idle')
      .sort((a, b) => a.lastUsed - b.lastUsed)
    for (const k of idle.slice(0, live.length - MAX_LIVE_KERNELS))
      k.kill('Shut down to save memory. Running a cell starts it again.')
  }

  interrupt(workbenchId: string): void {
    this.kernels.get(workbenchId)?.interrupt()
  }

  restart(workbenchId: string): void {
    this.get(workbenchId).restart()
  }

  state(workbenchId: string): KernelState {
    return this.kernels.get(workbenchId)?.state ?? 'dead'
  }

  vars(workbenchId: string): Promise<KernelVar[]> {
    return this.kernels.get(workbenchId)?.vars() ?? Promise.resolve([])
  }

  shutdown(workbenchId: string): void {
    this.kernels.get(workbenchId)?.kill('Shut down.')
    this.kernels.delete(workbenchId)
  }

  shutdownAll(): void {
    for (const id of [...this.kernels.keys()]) this.shutdown(id)
  }
}
