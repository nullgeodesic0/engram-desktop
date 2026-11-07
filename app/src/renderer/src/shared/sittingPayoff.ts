import type { GradeResult } from '../../../shared/gradeResult'

/** What this sitting changed, said first. Delayed rewards are discounted
 * steeply in ADHD (a benefit due in nine days is close to invisible), so the
 * ceremony opens on the payoff that exists TODAY — memories that now hold
 * longer — before tallies and dates. Pure over the receipts; never estimated. */
export function sittingPayoff(results: GradeResult[]): { strengthened: number; holdWeek: number } {
  let strengthened = 0
  let holdWeek = 0
  for (const r of results) {
    if (r.sBefore !== null && r.sAfter !== null && r.sAfter > r.sBefore) strengthened++
    if (r.sAfter !== null && r.sAfter >= 7 && (r.sBefore === null || r.sBefore < 7)) holdWeek++
  }
  return { strengthened, holdWeek }
}

/** Items missed despite a "Certain" or "Pretty sure" pick. High-confidence
 * errors are the MOST correctable kind (the hypercorrection effect), so they
 * are named at the close as the best use of a near-term re-look. */
export function confidentMisses(results: GradeResult[], pickFor: (node: string) => string | null): string[] {
  return results
    .filter((r) => r.grade !== 'recalled')
    .filter((r) => {
      const label = pickFor(r.node)
      return label === 'Certain' || label === 'Pretty sure'
    })
    .map((r) => r.node)
}
