/** Whisper-quiet synthesized session sounds — Web Audio, no assets, master
 * gain low enough to sit under speech. DEFAULT OFF; the learner opts in via
 * Settings. Honest events only: recalls, ink drops, the ticket. Lapses and
 * partials are silent by design (absolve, never pity — and never sting). */

const KEY = 'engram-sound'

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Storage unavailable — sounds just stay at their default.
  }
}

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  if (!soundOn()) return null
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

const MASTER_GAIN = 0.06

function envelope(c: AudioContext, at: number, duration: number, peak: number): GainNode {
  const g = c.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(peak, at + duration * 0.15)
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  g.connect(c.destination)
  return g
}

/** An ink drop landing in the well. */
export function plink(): void {
  const c = audio()
  if (!c) return
  try {
    const t = c.currentTime
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(880, t)
    o.frequency.exponentialRampToValueAtTime(440, t + 0.09)
    o.connect(envelope(c, t, 0.12, MASTER_GAIN))
    o.start(t)
    o.stop(t + 0.12)
  } catch {
    // Sound is decoration — never let it throw into the loop.
  }
}

/** The session ticket sliding onto the table. */
export function paperSlide(): void {
  const c = audio()
  if (!c) return
  try {
    const t = c.currentTime
    const length = Math.floor(c.sampleRate * 0.16)
    const buffer = c.createBuffer(1, length, c.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length)
    const src = c.createBufferSource()
    src.buffer = buffer
    const filter = c.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(1200, t)
    filter.frequency.exponentialRampToValueAtTime(400, t + 0.16)
    filter.Q.value = 0.8
    src.connect(filter)
    filter.connect(envelope(c, t, 0.16, MASTER_GAIN * 0.8))
    src.start(t)
  } catch {
    // Decoration only.
  }
}

/** A recall confirmed — a soft warm dyad. */
export function warmTone(): void {
  const c = audio()
  if (!c) return
  try {
    const t = c.currentTime
    for (const freq of [220, 330]) {
      const o = c.createOscillator()
      o.type = 'triangle'
      o.frequency.value = freq
      o.connect(envelope(c, t, 0.28, MASTER_GAIN * 0.7))
      o.start(t)
      o.stop(t + 0.28)
    }
  } catch {
    // Decoration only.
  }
}
