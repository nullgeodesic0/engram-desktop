/**
 * The model picker for Claude Code SUBSCRIPTION auth mode.
 *
 * Every sitting drives the `claude` binary the learner already installed and
 * pays for. Left unset, the CLI's own default wins — and as of this file's
 * writing that default is Opus, which is the right choice for open-ended
 * coding work and the wrong one for a fixed-length tutoring turn on a small
 * plan: a `/learn` or `/review` sitting runs for many turns, and Opus burns
 * through a weekly/5-hour usage allotment far faster than Sonnet or Haiku do
 * for what is, turn to turn, a much shorter and more structured exchange
 * (render a ticket, ask a checkpoint, call `engram rate`).
 *
 * `''` is the sentinel for "don't pass --model at all" — SessionManager.ts
 * and transcribeHandwriting.ts both treat it as "trust whatever Claude
 * Code's own default is," which is deliberately NOT hardcoded here: this app
 * has no way to know when Anthropic changes that default, and pinning a
 * value for "default" would silently stop being the default the moment it
 * does. An explicit pick, by contrast, is exactly this model, forever, until
 * the learner changes it again.
 */

export interface SubscriptionModelOption {
  /** Passed verbatim to `claude --model`. Empty string = omit the flag. */
  value: string
  label: string
  description: string
}

export const SUBSCRIPTION_MODEL_OPTIONS: SubscriptionModelOption[] = [
  {
    value: '',
    label: 'Claude Code default',
    description: 'Whatever the CLI itself defaults to — currently Opus.',
  },
  {
    value: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    description: 'Fastest, and the lightest on a usage allotment — the right pick for most sittings on a small plan.',
  },
  {
    value: 'claude-sonnet-5',
    label: 'Sonnet 5',
    description: 'A middle ground: noticeably more capable than Haiku, still far lighter than Opus.',
  },
  {
    value: 'claude-opus-5',
    label: 'Opus 5',
    description: 'The most capable tier, and the one that empties a small plan’s usage allotment fastest.',
  },
]
