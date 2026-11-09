/**
 * Handing a lab milestone to the tutor, in the learner's own words.
 *
 * Grading a lab's explain-back changes how a VERIFY production reaches the
 * stash (see the D5-pinned learn-skill.checked-production-protocol.md
 * overlay), so it runs only on the learner's own hand-in, the way every other
 * learner election travels: as a sentence in their turn, never as
 * app-authored system prompt. The app only prefills the composer; the learner
 * reads it and presses Send, or does not.
 */

/** The hand-in sentence the overlay keys on. */
export const LAB_HANDOFF_OPENING = "I'm handing in a checked lab milestone."

/** The composer text for a hand-in: the sentence, the request, then the signed report and answers. */
export function labHandoffMessage(production: string): string {
  return (
    `${LAB_HANDOFF_OPENING} Please follow the learn skill's "Checked lab productions" protocol: ` +
    'verify the report with check_report and grade my explain-back as recorded.\n\n' +
    production.trim()
  )
}
