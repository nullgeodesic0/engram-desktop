/** The "checkpoints on every node" Settings toggle — persisted the way
 * sittingPrefs.ts persists sitting length: renderer localStorage, try/catch
 * on every touch, garbage or a missing key degrades to the default (off).
 *
 * Deliberately NOT routed through engram.py's `model --set` the way
 * Momentum/Decay-notices are: the engine never reads this value — it only
 * ever reaches the kickoff text the app composes (see reviewKickoff.ts's
 * `allNodeTypes`) — and `model --set` has no working path to add a new
 * leaf. `cmd_model` checks `getattr(args, "allow_new_key", False)`, but the
 * installed engine's argparse setup only registers `--allow-new-key` on the
 * UNRELATED `adjudication-stats` subcommand, not on `model` — so passing it
 * to `model --set` fails at the parser with "unrecognized arguments"
 * before `cmd_model` ever runs. A real upstream defect (vendor/engram is
 * sacred, never edited to work around it), not something this app can fix
 * by trying harder with the CLI flags. A purely local, app-owned preference
 * sidesteps it entirely — and is the architecturally correct home for a
 * value the engine never reads anyway. */

const KEY = 'engram-checkpoint-all-nodes'

export function loadCheckpointAllNodes(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function saveCheckpointAllNodes(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? 'on' : 'off')
  } catch {
    // best-effort — a failed save costs one re-pick, never a sitting
  }
}
