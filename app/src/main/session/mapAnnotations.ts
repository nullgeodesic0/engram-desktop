import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { MapAnnotation, MapAnnotations } from '../../shared/types'

/**
 * Learner/tutor-authored LaTeX overrides for Topic Map nodes, set by the
 * advisory `annotate_node` bridge tool (see bridge/mcpBridgeWorker.mjs) so
 * the map can render real math instead of plain claim/label text.
 * Deliberately NOT part of engram's own schema — never written into
 * ~/.claude/learning/**, including graphs/*.json (SACRED: engram's files are
 * never written by this app). Lives in this app's own userData dir, keyed by
 * topic then node id — same read/write-on-demand pattern as topicSettings.ts.
 */

const TOPIC_ID_RE = /^[a-z0-9-]+$/
const MAX_ID_LEN = 128
const MAX_LATEX_LEN = 2000

function annotationsPath(): string {
  return join(app.getPath('userData'), 'map-annotations.json')
}

async function readAll(): Promise<Record<string, MapAnnotations>> {
  try {
    return JSON.parse(await readFile(annotationsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

async function writeAll(all: Record<string, MapAnnotations>): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(annotationsPath(), JSON.stringify(all, null, 2), 'utf-8')
}

export async function getMapAnnotations(topicId: string): Promise<MapAnnotations> {
  const all = await readAll()
  return all[topicId] ?? {}
}

/** Merges `patch` into the existing annotation for one node — a field absent
 * from `patch` (e.g. a later `annotate_node` call that only sends latex_label)
 * leaves the other field untouched rather than clobbering it. */
export async function setNodeAnnotation(topicId: string, nodeId: string, patch: MapAnnotation): Promise<void> {
  const all = await readAll()
  const forTopic = { ...(all[topicId] ?? {}) }
  forTopic[nodeId] = { ...forTopic[nodeId], ...patch }
  all[topicId] = forTopic
  await writeAll(all)
}

/**
 * Shape-guards an `annotate_node` bridge payload before it ever touches disk.
 * Bridge payloads are untrusted model output — zod-validated at the MCP
 * worker, but that boundary is a separate process and not trusted here.
 * Rejects (returns null, never throws — advisory contract) anything with the
 * wrong field types, an oversized LaTeX body, or a topic/node id outside
 * engram's own kebab-case charset.
 */
export function sanitizeAnnotatePayload(
  payload: Record<string, unknown>,
): { topic: string; node: string; patch: MapAnnotation } | null {
  const topic = payload.topic
  const node = payload.node
  const latexLabel = payload.latex_label
  const latexClaim = payload.latex_claim

  if (typeof topic !== 'string' || topic.length > MAX_ID_LEN || !TOPIC_ID_RE.test(topic)) return null
  if (typeof node !== 'string' || node.length > MAX_ID_LEN || !TOPIC_ID_RE.test(node)) return null

  const patch: MapAnnotation = {}
  if (latexLabel !== undefined) {
    if (typeof latexLabel !== 'string' || latexLabel.length > MAX_LATEX_LEN) return null
    patch.latexLabel = latexLabel
  }
  if (latexClaim !== undefined) {
    if (typeof latexClaim !== 'string' || latexClaim.length > MAX_LATEX_LEN) return null
    patch.latexClaim = latexClaim
  }
  // Mirrors the bridge tool's own "at least one of the two" contract — a
  // payload with neither (or both stripped by the checks above) is not
  // actionable, so it's rejected rather than persisted as a no-op entry.
  if (patch.latexLabel === undefined && patch.latexClaim === undefined) return null

  return { topic, node, patch }
}
