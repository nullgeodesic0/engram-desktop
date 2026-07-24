import type { BeatSegment, ProseBeat } from './beatEvents'

const LABEL_RE = /\*\*(OPEN A GAP|PREDICT(?:\s*\/\s*ATTEMPT)?|STRUGGLE(?:\s*\([^)]{0,12}\))?|RESOLVE|SELF-EXPLAIN|CONNECT|VERIFY|CLOSE)\*\*:?/gi

function normalize(label: string): ProseBeat | 'verify' | 'close' | null {
  const upper = label.toUpperCase().replace(/\s*\([^)]*\)/, '').trim()
  if (upper === 'OPEN A GAP') return 'open_gap'
  if (upper.startsWith('PREDICT')) return 'predict'
  if (upper === 'STRUGGLE') return 'struggle'
  if (upper === 'RESOLVE') return 'resolve'
  if (upper === 'SELF-EXPLAIN') return 'self_explain'
  if (upper === 'CONNECT') return 'connect'
  if (upper === 'VERIFY') return 'verify' // recognized but not rendered as a prose card — Tier 1 owns VERIFY
  if (upper === 'CLOSE') return 'close' // folds visually into the next OPEN_GAP; kept as its own trailing segment
  return null
}

/**
 * Best-effort split of accumulated assistant prose into beat-labeled
 * segments, per the skill's own bolded-label convention. Never load-bearing:
 * text before the first recognized label (or all of it, if none match) comes
 * back as a single `{ beat: null }` segment, which the UI renders as a plain
 * dialogue block rather than a beat-specific card.
 */
export function parseBeatSegments(text: string): BeatSegment[] {
  const matches = [...text.matchAll(LABEL_RE)]
  if (matches.length === 0) {
    return text ? [{ beat: null, text }] : []
  }

  const segments: BeatSegment[] = []
  const first = matches[0]
  if (first.index! > 0) {
    const lead = text.slice(0, first.index).trim()
    if (lead) segments.push({ beat: null, text: lead })
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const normalized = normalize(m[1])
    const start = m.index! + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    const body = text.slice(start, end).trim()
    if (normalized === 'verify' || normalized === 'close' || normalized === null) {
      // VERIFY is Tier-1 owned; CLOSE and unrecognized labels render as plain text
      // rather than a dedicated beat card.
      if (body) segments.push({ beat: null, text: body })
    } else {
      segments.push({ beat: normalized, text: body })
    }
  }

  return segments
}

/**
 * The single most-recently-labeled beat in a chunk of assistant prose — used
 * to drive the live progress stepper (BeatStepper.tsx), separately from the
 * full segment split above. Same recognition rules, just returns the last
 * match instead of splitting the whole text.
 */
export function latestBeatLabel(text: string): ProseBeat | 'verify' | 'close' | null {
  const matches = [...text.matchAll(LABEL_RE)]
  if (matches.length === 0) return null
  return normalize(matches[matches.length - 1][1])
}
