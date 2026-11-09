import { app } from 'electron'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { LabManifest, PackManifest } from '../../shared/contentPack'
import { isSafeRelPath, parseLabManifest, parsePackManifest } from '../../shared/contentPack'
import { parseLabWorkbenchId } from '../../shared/runtime'
import type { LayerDef } from '../runtime/envManager'
import { BASE_LAYER } from '../runtime/runtimePaths'

/**
 * The content packs the learner has added, by folder. A pack is read where it
 * sits and never copied or changed; the only file written here is the list of
 * folders (labs/packs.json in app userData). See docs/content-packs.md.
 *
 * Every path a manifest names is resolved and checked to stay inside the
 * pack's folder, symlinks included, so a pack cannot point the runner or the
 * installer at a file elsewhere on the machine.
 *
 * Doctrine: a pinned writer (D2), to app userData only. Nothing here reads or
 * writes the learning home.
 */

export interface LoadedLab {
  manifest: LabManifest
  /** Absolute, resolved folder of the lab inside the pack. */
  dir: string
}

export interface LoadedPack {
  folder: string
  root: string | null
  manifest: PackManifest | null
  labs: LoadedLab[]
  error: string | null
}

interface Registry {
  folders: string[]
}

function registryPath(): string {
  return join(app.getPath('userData'), 'labs', 'packs.json')
}

async function readRegistry(): Promise<Registry> {
  try {
    const raw = JSON.parse(await readFile(registryPath(), 'utf-8')) as Partial<Registry>
    return {
      folders: Array.isArray(raw.folders) ? raw.folders.filter((f) => typeof f === 'string' && isAbsolute(f)) : [],
    }
  } catch {
    return { folders: [] }
  }
}

async function writeRegistry(r: Registry): Promise<void> {
  const p = registryPath()
  await mkdir(join(app.getPath('userData'), 'labs'), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(r, null, 2), 'utf-8')
  await rename(tmp, p)
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

/** Resolves a manifest path against a folder and proves it stays inside `root`, following symlinks. */
export async function resolveInside(root: string, base: string, rel: string): Promise<string> {
  if (!isSafeRelPath(rel)) throw new Error(`${rel} is not a relative path inside the pack`)
  const real = await realpath(resolve(base, ...rel.split('/'))).catch(() => {
    throw new Error(`${rel} is missing from the pack`)
  })
  if (!isInside(root, real)) throw new Error(`${rel} points outside the pack`)
  return real
}

async function loadLab(root: string, rel: string): Promise<LoadedLab> {
  const dir = await resolveInside(root, root, rel)
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(dir, 'lab.json'), 'utf-8'))
  } catch (e) {
    throw new Error(`${rel}/lab.json could not be read: ${e instanceof Error ? e.message : String(e)}`)
  }
  // Brief and worked-example files are small Markdown, read synchronously inside the validator.
  // Each is resolved and checked to stay inside the pack before it is read.
  const parsed = parseLabManifest(raw, (p) => {
    let real: string
    try {
      real = realpathSync(resolve(dir, ...p.split('/')))
    } catch {
      throw new Error(`${rel}: ${p} is missing`)
    }
    if (!isInside(root, real)) throw new Error(`${rel}: ${p} points outside the pack`)
    return readFileSync(real, 'utf-8').slice(0, 20_000)
  })
  if (!parsed.ok) throw new Error(parsed.error)
  const m = parsed.value
  if (m.starter) await resolveInside(root, dir, m.starter)
  for (const ms of m.milestones) {
    if (ms.smoke) await resolveInside(root, dir, ms.smoke)
    if (ms.hidden) await resolveInside(root, dir, ms.hidden)
    if (ms.completion) await resolveInside(root, dir, ms.completion)
  }
  return { manifest: m, dir }
}

async function loadPack(folder: string): Promise<LoadedPack> {
  const out: LoadedPack = {
    folder,
    root: null,
    manifest: null,
    labs: [],
    error: null,
  }
  try {
    out.root = await realpath(folder)
  } catch {
    out.error = 'The folder is missing. Was it moved or renamed?'
    return out
  }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(out.root, 'pack.json'), 'utf-8'))
  } catch (e) {
    out.error = `pack.json could not be read: ${e instanceof Error ? e.message : String(e)}`
    return out
  }
  const parsed = parsePackManifest(raw)
  if (!parsed.ok) {
    out.error = parsed.error
    return out
  }
  out.manifest = parsed.value
  const errors: string[] = []
  if (parsed.value.runtime) {
    await resolveInside(out.root, out.root, parsed.value.runtime.lock).catch((e: Error) => errors.push(e.message))
  }
  const ids = new Set<string>()
  for (const rel of parsed.value.labs) {
    try {
      const lab = await loadLab(out.root, rel)
      if (ids.has(lab.manifest.id)) throw new Error(`Two labs use the id ${lab.manifest.id}`)
      ids.add(lab.manifest.id)
      out.labs.push(lab)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (errors.length) out.error = errors.join(' · ')
  return out
}

let cache: Promise<LoadedPack[]> | null = null

/** Every added pack, read fresh from disk. Packs whose id or layer an earlier
 * one already uses are kept in the list with an error, and offer no labs. */
export function reloadPacks(): Promise<LoadedPack[]> {
  cache = (async () => {
    const { folders } = await readRegistry()
    const packs: LoadedPack[] = []
    const ids = new Set<string>()
    const layers = new Set<string>()
    for (const folder of folders) {
      const p = await loadPack(folder)
      const m = p.manifest
      if (m && ids.has(m.id)) {
        p.error = `Another added pack already uses the id ${m.id}.`
        p.labs = []
      } else if (m?.runtime && layers.has(m.runtime.layer)) {
        p.error = `Another added pack already brings a runtime layer named ${m.runtime.layer}.`
        p.labs = []
      } else if (m) {
        ids.add(m.id)
        if (m.runtime) layers.add(m.runtime.layer)
      }
      packs.push(p)
    }
    return packs
  })()
  return cache
}

export function loadedPacks(): Promise<LoadedPack[]> {
  return cache ?? reloadPacks()
}

/** Only packs that loaded, with the labs that did. */
async function usablePacks(): Promise<LoadedPack[]> {
  return (await loadedPacks()).filter((p) => p.manifest && p.root && !(p.labs.length === 0 && p.error))
}

export async function findLab(packId: string, labId: string): Promise<{ pack: LoadedPack; lab: LoadedLab }> {
  const pack = (await usablePacks()).find((p) => p.manifest!.id === packId)
  if (!pack) throw new Error(`No added content pack has the id ${packId}.`)
  const lab = pack.labs.find((l) => l.manifest.id === labId)
  if (!lab) throw new Error(`The pack ${pack.manifest!.title} has no lab ${labId}.`)
  return { pack, lab }
}

export function packLayerId(pack: LoadedPack): string {
  return pack.manifest?.runtime?.layer ?? BASE_LAYER
}

/** The runtime layers the added packs bring, for envManager. */
export async function packLayerDefs(): Promise<LayerDef[]> {
  const out: LayerDef[] = []
  for (const p of await usablePacks()) {
    const r = p.manifest!.runtime
    if (!r) continue
    const lockPath = await resolveInside(p.root!, p.root!, r.lock).catch(() => null)
    if (!lockPath) continue
    out.push({
      id: r.layer,
      label: r.label,
      description: r.description,
      source: p.manifest!.id,
      sourceTitle: p.manifest!.title,
      lockPath,
      imports: r.imports,
      packages: r.packages,
    })
  }
  return out
}

/** The layer a workbench's kernel runs on: its pack's for a pack lab, else base. */
export async function layerForWorkbench(workbenchId: string): Promise<string> {
  const lab = parseLabWorkbenchId(workbenchId)
  if (!lab) return BASE_LAYER
  const pack = (await usablePacks()).find((p) => p.manifest!.id === lab.packId)
  return pack ? packLayerId(pack) : BASE_LAYER
}

export async function addPackFolder(folder: string): Promise<LoadedPack> {
  if (!isAbsolute(folder)) throw new Error('Choose a folder.')
  const probe = await loadPack(folder)
  if (!probe.manifest) throw new Error(probe.error ?? 'That folder holds no pack.json.')
  const reg = await readRegistry()
  const current = await loadedPacks()
  const same = current.find((p) => p.root && probe.root && p.root === probe.root)
  if (same) throw new Error('That pack is already added.')
  const clash = current.find((p) => p.manifest?.id === probe.manifest!.id)
  if (clash) throw new Error(`An added pack already uses the id ${probe.manifest.id} (${clash.folder}).`)
  reg.folders.push(folder)
  await writeRegistry(reg)
  const packs = await reloadPacks()
  return packs.find((p) => p.folder === folder) ?? probe
}

/** Forgets a pack folder. Nothing on disk changes: not the pack, not the
 * learner's work in it, not its runtime layer (Remove runtime clears those). */
export async function removePackFolder(folder: string): Promise<void> {
  const reg = await readRegistry()
  reg.folders = reg.folders.filter((f) => f !== folder)
  await writeRegistry(reg)
  await reloadPacks()
}
