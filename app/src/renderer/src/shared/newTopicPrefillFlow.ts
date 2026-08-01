// Pure decision logic for LearnSessionView's `openNewTopicSignal` effect —
// extracted specifically so this piece of the modal-prefill state machine
// has a regression test without a React/jsdom harness (this codebase's
// vitest config is deliberately plain `node`; see vitest.config.ts's own
// comment — there is no existing precedent here for testing a component's
// live behavior, so pulling the DECISION out into a plain function is the
// testable seam, same idiom as main/deepLinkQueue.ts on the main-process
// side).
//
// Coordinator-review regression this exists to guard (NEW-1): an earlier
// version of the "don't clobber in-progress typing" fix moved
// `setModalPrefill(...)` entirely inside the `newTopicPrefill && !newTopicOpen`
// branch, deleting the unconditional null-ing the effect used to do. That
// left `modalPrefill` holding a stale deep-link payload after ANY path that
// closes the modal without going through the explicit Cancel/X handler —
// concretely, clicking Start (LearnSessionView's startNewTopic sets
// newTopicOpen=false but never touches modalPrefill) — so a later plain ⌘N
// silently reseeded the New Topic modal with the earlier attacker-controlled
// text, on a modal the learner believed they'd opened fresh themselves.

export type ModalPrefillDecision<T> =
  | { action: 'seed'; prefill: T }
  | { action: 'clear' }
  | { action: 'keepAndNoteDropped' }
  | { action: 'keep' }

/** Called every time `openNewTopicSignal` bumps. `wasAlreadyOpen` is the
 * modal's `newTopicOpen` state from BEFORE this signal is acted on (i.e.
 * before the caller's own `setNewTopicOpen(true)`); `incomingPrefill` is
 * whatever `newTopicPrefill` prop is attached to this same signal bump
 * (`null`/`undefined` for a plain ⌘N or shelf click).
 *
 * - Modal was closed, a real prefill arrived: `seed` — the caller applies
 *   it and forces a remount (a fresh open always gets fresh state).
 * - Modal was closed, no prefill: `clear` — this is the fix for NEW-1
 *   above: ANY reopen of a currently-closed modal must start from a clean
 *   slate, since there is no guarantee the modal's last close routed through
 *   the one handler (`onClose`) that used to be the sole place clearing
 *   `modalPrefill`.
 * - Modal was ALREADY open and a real prefill arrived: `keepAndNoteDropped`
 *   — the learner may be mid-typing into the live instance; forcibly
 *   reseeding it (see prefillEpoch's own history) would silently destroy
 *   that. The caller surfaces this to the learner (a banner note) rather
 *   than dropping it with no trace.
 * - Modal was already open, no prefill (a plain re-trigger while it's
 *   already showing): `keep` — a pure no-op, same as before this fix
 *   existed. */
export function decideModalPrefillOnOpenSignal<T>(wasAlreadyOpen: boolean, incomingPrefill: T | null | undefined): ModalPrefillDecision<T> {
  if (!wasAlreadyOpen) {
    return incomingPrefill ? { action: 'seed', prefill: incomingPrefill } : { action: 'clear' }
  }
  return incomingPrefill ? { action: 'keepAndNoteDropped' } : { action: 'keep' }
}
