import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveEngramPluginFromRoots } from './pluginResolver'

async function makePlugin(root: string, version: string): Promise<string> {
  const plugin = join(root, version)
  await mkdir(join(plugin, 'scripts'), { recursive: true })
  await writeFile(join(plugin, 'scripts', 'engram.py'), '# engine')
  return plugin
}

describe('resolveEngramPluginFromRoots', () => {
  it('selects the newest usable plugin across Claude and Codex caches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engram-plugin-roots-'))
    const claude = join(root, 'claude')
    const codex = join(root, 'codex')
    await makePlugin(claude, '1.10.1')
    await makePlugin(codex, '1.15.1')
    expect(resolveEngramPluginFromRoots([claude, codex])?.version).toBe('1.15.1')
  })

  it('accepts the app-bundled plugin as a direct root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engram-bundled-root-'))
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts', 'engram.py'), '# engine')
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.12.0' }))
    expect(resolveEngramPluginFromRoots([root]))?.toMatchObject({ version: '1.12.0', root })
  })
})
