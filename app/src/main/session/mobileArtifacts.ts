import { readFile, stat } from 'node:fs/promises'
import { engramArtifactList } from '../engramCli/readOnly'
import { humanizeNodeId } from '../../shared/humanizeId'

/**
 * The explorable gallery, for a device that is very good at reading one page.
 *
 * Artifacts are self-contained HTML explorables the artifact-smith builds for
 * threshold concepts. They are the one part of the corpus that is BETTER on a
 * phone than at the desk — a single interactive page, read on a couch, is
 * exactly the shape of thing the small screen wins at.
 *
 * ## Why this may cross when a due item may not
 *
 * An explorable is RESOLVE-grade material: it explains a concept the learner
 * has already met, and it is the same artifact the desktop gallery opens
 * freely. It is not a sealed reveal attached to a pending probe, so serving it
 * does not break the order of operations the card packs protect.
 *
 * What it DOES share with the desktop is the browsable hole: a learner who
 * goes looking can read the explorable for a node they are about to be probed
 * on. That is true at the desk today and this changes nothing about it. It is
 * recorded here rather than fixed here, because closing it on one surface
 * only would give the phone a rule the desk does not have while leaving the
 * behaviour reachable — which is the appearance of a guarantee, not one.
 *
 * ## Addressing
 *
 * The phone asks by topic and node; paths never cross the wire. A path would
 * be a host detail on a device the learner carries around, and one a client
 * could try to vary — the resolution stays here, against the engine's own
 * ledger, so an artifact the ledger does not list cannot be fetched at all.
 */

export interface MobileArtifact {
  topic: string
  node: string
  title: string
}

interface LedgerRow {
  topic: unknown
  node: unknown
  artifact: unknown
  exists: unknown
}

/** An explorable is a self-contained page, not a download channel. */
export const MAX_ARTIFACT_BYTES = 1_500_000

export function projectArtifacts(entries: unknown[]): MobileArtifact[] {
  const out: MobileArtifact[] = []
  for (const raw of entries) {
    const row = raw as LedgerRow
    if (typeof row?.topic !== 'string' || typeof row?.node !== 'string') continue
    // `exists: false` means the file moved or was deleted out from under the
    // ledger. Listing it would offer a tap that can only fail.
    if (row.exists === false) continue
    out.push({ topic: row.topic, node: row.node, title: humanizeNodeId(row.node) })
  }
  return out
}

export async function listArtifacts(): Promise<{ artifacts: MobileArtifact[] }> {
  const entries = await engramArtifactList().catch(() => [] as unknown[])
  return { artifacts: projectArtifacts(entries) }
}

/**
 * One artifact's HTML, resolved through the ledger.
 *
 * Returns null for anything the ledger does not list, which is also what makes
 * the topic/node pair safe to take from a network peer: there is no path to
 * traverse, only a lookup that either matches a row the engine wrote or does
 * not.
 */
export async function readArtifact(topic: string, node: string): Promise<string | null> {
  const entries = await engramArtifactList().catch(() => [] as unknown[])
  const match = (entries as LedgerRow[]).find(
    (row) => row?.topic === topic && row?.node === node && row?.exists !== false,
  )
  if (!match || typeof match.artifact !== 'string') return null

  try {
    const info = await stat(match.artifact)
    if (info.size > MAX_ARTIFACT_BYTES) return null
    return await readFile(match.artifact, 'utf-8')
  } catch {
    return null
  }
}
