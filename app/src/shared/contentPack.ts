import { isValidSlug } from './runtime'

/**
 * Content packs: folders of labs that the learner points the app at, in
 * Settings → Content packs. The app ships the machinery and no subject
 * matter; a pack brings the labs, their hidden tests and, if it needs more
 * than the base layer, its own pinned Python layer. See docs/content-packs.md.
 *
 * This file holds the manifest formats and their validators. It is pure (no
 * filesystem), so main's loader and the tests share it.
 */

export const PACK_FORMAT = 1
/** Explain-backs are capped so the report plus the text fit one engine production. */
export const EXPLAIN_BACK_MAX = 2000
export const DEFAULT_CHECK_LIMIT_S = 600
export const MAX_CHECK_LIMIT_S = 3600
/** "I'm stuck" steps a milestone may hold, and the length of each. */
export const MAX_STEPS = 12
export const MAX_STEP_CHARS = 4000

export interface PackRuntimeLayer {
  /** Names the env directory; unique across the loaded packs, never "base". */
  layer: string
  label: string
  description: string
  /** Path of a universal, hash-pinned lockfile inside the pack. */
  lock: string
  /** Modules imported to prove the env works after an install. */
  imports: string[]
  /** Distributions whose versions Settings and the kernel report. */
  packages: string[]
}

export interface PackManifest {
  format: number
  id: string
  title: string
  version: string
  description: string
  runtime: PackRuntimeLayer | null
  /** Folders inside the pack, each holding a lab.json. */
  labs: string[]
}

export interface MilestoneManifest {
  id: string
  title: string
  /** Markdown shown in the milestone's brief. */
  brief: string
  /** Visible checks, runnable any time. Path inside the lab folder. */
  smoke: string | null
  /** Hidden tests, run only at Submit. Path inside the lab folder. Null: brief only. */
  hidden: string | null
  /** The explain-back question asked at Submit. */
  explainBack: string
  /** Wall-clock limit for one check run, in seconds. */
  timeLimitS: number
  /**
   * The ladder, every rung optional and the learner's choice:
   * - worked: a fully worked example of a sibling problem, to study first
   * - completion: a percent-format file of cells with parts of this
   *   milestone filled in, which the learner can add and finish
   * - steps: worked steps of this milestone itself, shown one at a time on
   *   "I'm stuck"
   * Using completion or steps is recorded on the next Submit and in its report.
   */
  worked: string
  completion: string | null
  steps: string[]
}

export interface LabManifest {
  id: string
  title: string
  /** A short line above the title, e.g. "Lab 1 · Stage 1". */
  kicker: string
  summary: string
  /** A percent-format file of given and starter cells, inside the lab folder. */
  starter: string | null
  milestones: MilestoneManifest[]
}

/** A relative path that stays inside its folder: no absolute paths, no "..", forward slashes. */
export function isSafeRelPath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 240) return false
  if (p.includes('\\') || p.includes('\0') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

class ManifestError extends Error {}

function str(
  o: Record<string, unknown>,
  key: string,
  where: string,
  opts: { optional?: boolean; max?: number } = {},
): string {
  const v = o[key]
  if (v === undefined || v === null) {
    if (opts.optional) return ''
    throw new ManifestError(`${where}: "${key}" is missing`)
  }
  if (typeof v !== 'string') throw new ManifestError(`${where}: "${key}" must be text`)
  const max = opts.max ?? 200
  if (v.length > max) throw new ManifestError(`${where}: "${key}" is longer than ${max} characters`)
  return v
}

function slug(o: Record<string, unknown>, key: string, where: string): string {
  const v = str(o, key, where)
  // 32 rather than the 64 a workbench id allows, so a signed report naming a
  // pack, a lab, a milestone and a layer stays inside its budget.
  if (!isValidSlug(v) || v.length > 32) {
    throw new ManifestError(`${where}: "${key}" must be up to 32 lowercase letters, digits and dashes`)
  }
  return v
}

function path(o: Record<string, unknown>, key: string, where: string, optional = false): string | null {
  const v = o[key]
  if (v === undefined || v === null) {
    if (optional) return null
    throw new ManifestError(`${where}: "${key}" is missing`)
  }
  if (!isSafeRelPath(v)) throw new ManifestError(`${where}: "${key}" must be a relative path inside the pack`)
  return v
}

function names(o: Record<string, unknown>, key: string, where: string): string[] {
  const v = o[key]
  if (v === undefined) return []
  if (!Array.isArray(v) || v.some((n) => typeof n !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(n))) {
    throw new ManifestError(`${where}: "${key}" must be a list of package or module names`)
  }
  return v as string[]
}

function obj(v: unknown, where: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ManifestError(`${where} must be a JSON object`)
  return v as Record<string, unknown>
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

function run<T>(fn: () => T): Parsed<T> {
  try {
    return { ok: true, value: fn() }
  } catch (e) {
    if (e instanceof ManifestError) return { ok: false, error: e.message }
    throw e
  }
}

export function parsePackManifest(raw: unknown): Parsed<PackManifest> {
  return run(() => {
    const o = obj(raw, 'pack.json')
    if (o.format !== PACK_FORMAT) throw new ManifestError(`pack.json: "format" must be ${PACK_FORMAT}`)
    let runtime: PackRuntimeLayer | null = null
    if (o.runtime !== undefined && o.runtime !== null) {
      const r = obj(o.runtime, 'pack.json runtime')
      const layer = slug(r, 'layer', 'pack.json runtime')
      if (layer === 'base')
        throw new ManifestError('pack.json runtime: "layer" cannot be "base", which is the app’s own')
      runtime = {
        layer,
        label: str(r, 'label', 'pack.json runtime', { max: 60 }),
        description: str(r, 'description', 'pack.json runtime', {
          optional: true,
          max: 300,
        }),
        lock: path(r, 'lock', 'pack.json runtime')!,
        imports: names(r, 'imports', 'pack.json runtime'),
        packages: names(r, 'packages', 'pack.json runtime'),
      }
    }
    if (!Array.isArray(o.labs)) throw new ManifestError('pack.json: "labs" must be a list of folders')
    const labs = o.labs.map((l, i) => {
      if (!isSafeRelPath(l)) throw new ManifestError(`pack.json: labs[${i}] must be a relative folder inside the pack`)
      return l
    })
    return {
      format: PACK_FORMAT,
      id: slug(o, 'id', 'pack.json'),
      title: str(o, 'title', 'pack.json', { max: 120 }),
      version: str(o, 'version', 'pack.json', { max: 40 }),
      description: str(o, 'description', 'pack.json', {
        optional: true,
        max: 600,
      }),
      runtime,
      labs,
    }
  })
}

export function parseLabManifest(raw: unknown, readBriefFile?: (p: string) => string): Parsed<LabManifest> {
  return run(() => {
    const o = obj(raw, 'lab.json')
    const id = slug(o, 'id', 'lab.json')
    if (!Array.isArray(o.milestones) || o.milestones.length === 0) {
      throw new ManifestError(`lab.json (${id}): "milestones" must be a non-empty list`)
    }
    const seen = new Set<string>()
    const milestones = o.milestones.map((m, i): MilestoneManifest => {
      const where = `lab.json (${id}) milestones[${i}]`
      const mo = obj(m, where)
      const mid = slug(mo, 'id', where)
      if (seen.has(mid)) throw new ManifestError(`${where}: id "${mid}" is used twice`)
      seen.add(mid)
      let brief = str(mo, 'brief', where, { optional: true, max: 20_000 })
      const briefFile = path(mo, 'briefFile', where, true)
      if (briefFile) {
        if (!readBriefFile) throw new ManifestError(`${where}: "briefFile" cannot be read here`)
        brief = readBriefFile(briefFile)
      }
      const limit = mo.timeLimitS === undefined ? DEFAULT_CHECK_LIMIT_S : mo.timeLimitS
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 5 || limit > MAX_CHECK_LIMIT_S) {
        throw new ManifestError(
          `${where}: "timeLimitS" must be a whole number of seconds from 5 to ${MAX_CHECK_LIMIT_S}`,
        )
      }
      let worked = str(mo, 'worked', where, { optional: true, max: 20_000 })
      const workedFile = path(mo, 'workedFile', where, true)
      if (workedFile) {
        if (!readBriefFile) throw new ManifestError(`${where}: "workedFile" cannot be read here`)
        worked = readBriefFile(workedFile)
      }
      const rawSteps = mo.steps === undefined ? [] : mo.steps
      if (
        !Array.isArray(rawSteps) ||
        rawSteps.length > MAX_STEPS ||
        rawSteps.some((x) => typeof x !== 'string' || !x.trim() || x.length > MAX_STEP_CHARS)
      ) {
        throw new ManifestError(
          `${where}: "steps" must be a list of up to ${MAX_STEPS} Markdown steps, each under ${MAX_STEP_CHARS} characters`,
        )
      }
      const hidden = path(mo, 'hidden', where, true)
      const explainBack = str(mo, 'explainBack', where, {
        optional: true,
        max: 400,
      })
      if (hidden && !explainBack.trim())
        throw new ManifestError(`${where}: a milestone with hidden tests needs an "explainBack" question`)
      return {
        id: mid,
        title: str(mo, 'title', where, { max: 120 }),
        brief,
        smoke: path(mo, 'smoke', where, true),
        hidden,
        explainBack,
        timeLimitS: limit,
        worked,
        completion: path(mo, 'completion', where, true),
        steps: rawSteps as string[],
      }
    })
    return {
      id,
      title: str(o, 'title', 'lab.json', { max: 120 }),
      kicker: str(o, 'kicker', 'lab.json', { optional: true, max: 120 }),
      summary: str(o, 'summary', 'lab.json', { optional: true, max: 600 }),
      starter: path(o, 'starter', 'lab.json', true),
      milestones,
    }
  })
}
