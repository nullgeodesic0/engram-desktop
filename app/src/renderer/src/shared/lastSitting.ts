/** What the last sitting was predicted to cost, and what it actually cost.
 *
 * An estimate nobody checks is a guess with a confident font. Now that the
 * plate predicts a duration from measured pace, the honest next step is to
 * record how that prediction did and show it back — so the number carries its
 * own track record instead of asking to be believed.
 *
 * Renderer-local (localStorage), one entry, no history: this is a sanity
 * check on the estimator, not a dataset. The estimator itself learns from
 * transcripts, which are the real record. */

const KEY = 'engram:lastSitting'

export interface SittingOutcome {
  /** Epoch ms the sitting ended. */
  at: number
  estimatedSeconds: number
  actualSeconds: number
  items: number
}

export function recordSittingOutcome(o: SittingOutcome): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o))
  } catch {
    /* a nicety, never a precondition */
  }
}

export function loadSittingOutcome(): SittingOutcome | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<SittingOutcome>
    if (typeof o?.at !== 'number' || typeof o?.estimatedSeconds !== 'number') return null
    if (typeof o?.actualSeconds !== 'number' || typeof o?.items !== 'number') return null
    // A sitting left open overnight says nothing about pace.
    if (o.actualSeconds <= 0 || o.actualSeconds > 6 * 60 * 60) return null
    return o as SittingOutcome
  } catch {
    return null
  }
}

/** How the estimate did, in the plainest possible words. Null when the two
 * are close enough that saying anything would be noise. */
export function describeAccuracy(o: SittingOutcome): string | null {
  if (o.estimatedSeconds <= 0) return null
  const ratio = o.actualSeconds / o.estimatedSeconds
  if (ratio >= 0.75 && ratio <= 1.33) return null
  const est = Math.round(o.estimatedSeconds / 60)
  const act = Math.round(o.actualSeconds / 60)
  return ratio > 1 ? `last time: estimated ${est} min, took ${act}` : `last time: estimated ${est} min, took only ${act}`
}
