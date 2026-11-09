import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { KernelEvent } from '../../shared/runtime'

// A stand-in kernel in Node: waits FAKE_DELAY ms, says ready, answers each exec after 50 ms.
const dir = mkdtempSync(join(tmpdir(), 'engram-kernel-test-'))
const fake = join(dir, 'fake-kernel.cjs')
const spawned: ChildProcess[] = []

vi.mock('./envManager', () => ({
  readyInterpreter: async () => process.execPath,
  watchedPackages: async () => [],
  getCellLimitS: async () => 0,
  kernelFilePath: () => fake,
  mplConfigDir: () => dir,
}))
vi.mock('../platform', async () => {
  const cp = await import('node:child_process')
  return {
    isWindows: false,
    // The real launcher passes interpreter flags; the stand-in only needs the file.
    spawnCli: (cmd: string, args: string[], opts: object) => {
      const child = cp.spawn(cmd, [args[args.length - 1]], {
        ...opts,
        env: { ...process.env, ...(opts as { env?: object }).env },
      })
      spawned.push(child)
      return child
    },
  }
})

const alive = () => spawned.filter((c) => c.exitCode === null && c.signalCode === null).length
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(() => {
  writeFileSync(
    fake,
    `const delay = Number(process.env.FAKE_DELAY || 0)
setTimeout(() => {
  process.stdout.write(JSON.stringify({ type: 'ready', python: 'x', packages: {} }) + '\\n')
  let buf = ''
  process.stdin.on('data', (d) => {
    buf += d
    const lines = buf.split('\\n'); buf = lines.pop()
    for (const line of lines) {
      const r = JSON.parse(line)
      if (r.op === 'exec') setTimeout(() => process.stdout.write(JSON.stringify({ id: r.id, type: 'done', ok: true, ms: 1 }) + '\\n'), 50)
    }
  })
}, delay)
`,
  )
})
afterAll(() => {
  for (const c of spawned) c.kill('SIGKILL')
  rmSync(dir, { recursive: true, force: true })
})

describe('KernelManager', () => {
  it('a restart during startup leaves one healthy kernel and no orphan', async () => {
    const { KernelManager } = await import('./kernel')
    const events: KernelEvent[] = []
    const km = new KernelManager(
      () => dir,
      (e) => events.push(e),
    )
    process.env.FAKE_DELAY = '400'
    km.run('w', 'c1', 'x')
    await sleep(100)
    process.env.FAKE_DELAY = '0'
    km.restart('w')
    await sleep(600)
    expect(km.state('w')).toBe('idle')
    expect(alive()).toBe(1)
    // The first run was failed by the restart, once.
    expect(events.filter((e) => e.kind === 'done' && e.cellId === 'c1')).toHaveLength(1)
    km.run('w', 'c2', 'y')
    await sleep(300)
    expect(events.filter((e) => e.kind === 'done' && e.cellId === 'c2')).toMatchObject([{ ok: true }])
    km.shutdownAll()
    await sleep(100)
    expect(alive()).toBe(0)
  })

  it('keeps at most three kernels alive, stopping the least recently used idle one', async () => {
    const { KernelManager } = await import('./kernel')
    const km = new KernelManager(
      () => dir,
      () => {},
    )
    process.env.FAKE_DELAY = '0'
    for (const id of ['a', 'b', 'c', 'd']) {
      km.run(id, 'c', 'x')
      await sleep(250)
    }
    expect(['a', 'b', 'c', 'd'].map((id) => km.state(id))).toEqual(['dead', 'idle', 'idle', 'idle'])
    km.shutdownAll()
  })
})
