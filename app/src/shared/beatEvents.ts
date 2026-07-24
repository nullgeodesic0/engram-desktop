// The 8-beat dialogue grammar (skills/_shared/dialogue-grammar.md). VERIFY and
// CLOSE aren't parsed from prose — VERIFY is driven by the confidence bridge
// call + stash/rate tool calls (Tier 1), and CLOSE folds into the next node's
// OPEN_GAP. The other six are pure prose today, recognized client-side from
// the skill's own bolded-label convention (observed consistently in real
// transcripts: "**RESOLVE:**", "**SELF-EXPLAIN:**", etc.) — best-effort,
// never load-bearing; an unrecognized chunk just renders as a generic block.
export type ProseBeat = 'open_gap' | 'predict' | 'struggle' | 'resolve' | 'self_explain' | 'connect'

export interface BeatSegment {
  beat: ProseBeat | null // null = unlabeled / doesn't match a known beat
  text: string
}
