/** User-adjustable instrument panel for the topic map's live physics and
 * display scale — the Engram analogue of CairnDesktop's `physics.ts`
 * `AtlasGraphSettings`. Persisted across sessions (unlike Cairn, this map
 * has no per-artifact "filters" section — Engram's node kinds are already
 * separated by lens toggles in `TopicMapView`'s command bar, not by a
 * settings-panel checkbox list — so only Forces and Display are ported). */

export interface ForceSettings {
  enabled: boolean
  /** Pull toward the plate centre. Engram's own tuned live default is 0.5
   * (`PLATE_FORCE_PARAMS` in layout.ts) — kept as this slider's default so
   * leaving the panel untouched reproduces the map exactly as it already
   * shipped. */
  center: number
  /** Node–node repulsion. */
  repel: number
  /** Spring stiffness along `requires` edges. */
  link: number
  /** Rest-length multiplier for edges (Engram's `ForceParams.linkDistance`
   * is a multiplier of the tuned base distance, not raw pixels like
   * Cairn's). */
  linkDistance: number
}

export interface DisplaySettings {
  /** Multiplies every node's settled radius. */
  nodeScale: number
  /** Multiplies edge stroke width. */
  linkThickness: number
}

export interface AtlasGraphSettings {
  forces: ForceSettings
  display: DisplaySettings
}

/** Matches `PLATE_FORCE_PARAMS` in `layout.ts` exactly — the panel's
 * untouched state must reproduce the map this port already shipped. */
export const DEFAULT_GRAPH_SETTINGS: AtlasGraphSettings = {
  forces: { enabled: true, center: 0.5, repel: 3.2, link: 1, linkDistance: 1.9 },
  display: { nodeScale: 1, linkThickness: 1 },
}

const STORAGE_KEY = 'engram.atlas.graphSettings'

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** Tolerates garbage, missing fields, and out-of-range values — a settings
 * schema change or hand-edited localStorage must never crash the plate. */
export function loadGraphSettings(raw: string | null): AtlasGraphSettings {
  const d = DEFAULT_GRAPH_SETTINGS
  let p: { forces?: Record<string, unknown>; display?: Record<string, unknown> } = {}
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') p = parsed as typeof p
    } catch {
      // fall through to defaults
    }
  }
  const f = p.forces ?? {}
  const s = p.display ?? {}
  return {
    forces: {
      enabled: bool(f.enabled, d.forces.enabled),
      center: num(f.center, d.forces.center, 0, 2),
      repel: num(f.repel, d.forces.repel, 0, 8),
      link: num(f.link, d.forces.link, 0, 2),
      linkDistance: num(f.linkDistance, d.forces.linkDistance, 0.5, 4),
    },
    display: {
      nodeScale: num(s.nodeScale, d.display.nodeScale, 0.25, 4),
      linkThickness: num(s.linkThickness, d.display.linkThickness, 0.25, 6),
    },
  }
}

export function readGraphSettings(): AtlasGraphSettings {
  try {
    return loadGraphSettings(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_GRAPH_SETTINGS
  }
}

export function saveGraphSettings(settings: AtlasGraphSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private-browsing / quota-exceeded — the panel still works in-session.
  }
}
