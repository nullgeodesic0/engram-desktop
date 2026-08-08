/** The one message the app puts in the learner's mouth to ask for a
 * transcription.
 *
 * This is a USER TURN with the app's words in it, which is the most
 * doctrine-sensitive thing the app can produce — it reaches the tutor, and
 * through the stash it can reach the assessor. So it is written to say only
 * three things, all of them plumbing:
 *
 *   1. which files, in which order (navigation the learner performed by
 *      picking them);
 *   2. transcribe verbatim, errors included, through a subagent that is given
 *      nothing but the paths and that instruction;
 *   3. the learner will confirm it before it counts.
 *
 * It says nothing about how to teach, what to skip, or how to grade. It does
 * not mention the node, the claim, or the rubric. Point (2) is the load-
 * bearing one: "including any errors" is what stops a tutor that already
 * knows the answer from quietly repairing a sign on its way past, which would
 * inflate a grade the assessor then certifies.
 *
 * Deliberately phrased to contain "[Attached files" so `checkDoctrine`'s
 * injected-message collector catches it — see D3.kickoff. Changing a word
 * here should require re-pinning a hash, because a sentence added here would
 * carry the app's authority into the learner's own turn. */

export interface HandwritingRequest {
  /** Absolute paths, in the page order the learner chose. */
  pages: string[]
}

/** Compose the request. Returns null for an empty selection rather than
 * sending a message about nothing. */
export function handwritingRequestMessage(req: HandwritingRequest): string | null {
  if (req.pages.length === 0) return null
  const list = req.pages.join(', ')
  const count = req.pages.length === 1 ? '1 page' : `${req.pages.length} pages`
  return `[Attached files — my handwritten work, ${count} in order: ${list}] Transcribe this to LaTeX exactly as written, including any errors, using a subagent given only the image paths and that instruction. Then call propose_transcription with the result. I will check the transcription before it counts as my answer.`
}
