import { buildMobileOverview, buildConstellationGraph } from './mobileOverview'
import { buildTopicReceipts, buildGradeRoster } from './mobileReceipts'
import { listArtifacts, readArtifact } from './mobileArtifacts'
import { buildCoach } from './mobileCoach'
import { buildReviewQueue } from './mobileReview'
import { arcPrefixesOf, humanizeWithArcs } from '../../shared/humanizeId'
import { readTopicGraph } from '../engramCli/readOnly'

/**
 * Every answer the phone-facing server is allowed to give, in one place.
 *
 * These used to be written out at the composition root and again in the dev
 * fixture, and they drifted three separate times: the fixture served a route
 * table older than the app's, and each time the symptom was a phone showing
 * "your Mac isn't answering" while the Mac was answering perfectly well —
 * about a route it had never heard of. A harness that quietly serves a
 * different contract than the thing it stands in for is worse than no harness.
 *
 * Living on the session side of the §D6 fence is deliberate: every function
 * here reads the engine, and the server receives them as plain values. It
 * gains ANSWERS and never a way to ask the engine anything of its own, which
 * is the distinction the inertness pin depends on.
 *
 * `packedFor` is injected because the pack store is owned by whoever is
 * composing — the app and the fixture point at the same directory but build
 * their own store instance.
 */
export function mobileProviders(packedFor: (topic: string) => Promise<string[]>) {
  return {
    overview: () => buildMobileOverview(packedFor),
    graph: (topic: string) => buildConstellationGraph(topic),
    receipts: (topic: string, mode?: string) =>
      buildTopicReceipts(topic, mode === 'total' ? 'total' : 'completed'),
    gradeRoster: (mode?: string) => buildGradeRoster(mode === 'total' ? 'total' : 'completed'),
    artifacts: () => listArtifacts(),
    artifact: (topic: string, node: string) => readArtifact(topic, node),
    coach: () => buildCoach(),
    // The floor under Review. Questions only — the claim and the rubric never
    // leave this machine, which main/session/mobileReview.ts is pinned on.
    reviewQueue: async (topic: string) => {
      // Narrow on purpose: ids are all the arc heuristic needs, and a wider
      // type here would put every node's claim in a local variable.
      // Narrow on purpose: ids are all the arc heuristic needs, and a wider
      // type here would put every node's claim in a local variable.
      const graph = (await readTopicGraph(topic).catch(() => null)) as
        | { nodes?: { id: string }[] }
        | null
      const arcs = arcPrefixesOf((graph?.nodes ?? []).map((n) => n.id))
      return buildReviewQueue(topic, (id) => humanizeWithArcs(id, arcs))
    },
  }
}
