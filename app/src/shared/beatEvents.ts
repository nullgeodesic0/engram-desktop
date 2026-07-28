// The 8-beat dialogue grammar (skills/_shared/dialogue-grammar.md). CLOSE
// isn't parsed from prose — it folds into the next node's OPEN_GAP. The other
// seven, including VERIFY, are pure prose today, recognized client-side from
// the skill's own bolded-label convention (observed in real transcripts:
// "**RESOLVE:**", "**SELF-EXPLAIN:**", "**VERIFY — cold, no notes.**", etc.)
// — best-effort, never load-bearing; an unrecognized chunk just renders as a
// generic block. VERIFY's OUTCOME (confirmed/partial/missed — what inks the
// BeatStepper trail after grading) still comes only from the `beat_outcome`
// bridge call, and the tutor never calls `render_beat` for verify itself
// (its reveal is gated behind the AskUserQuestion confidence pick, not a
// beat announcement — see mcpBridgeWorker.mjs's BEATS list, deliberately
// narrower than this type). But the prose ANNOUNCEMENT of verify — the
// tutor writing out the probe, cold — is exactly as real a beat as the other
// six when the tutor writes it that way, and gets the same card.
export type ProseBeat = 'open_gap' | 'predict' | 'struggle' | 'resolve' | 'self_explain' | 'connect' | 'verify'

export interface BeatSegment {
  beat: ProseBeat | null // null = unlabeled / doesn't match a known beat
  text: string
}
