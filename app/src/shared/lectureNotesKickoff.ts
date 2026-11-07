/**
 * The learner's election of Lecture Notes, in their own words.
 *
 * Lecture notes put an explanation BEFORE the predict/struggle beats, which
 * is exactly what dialogue-grammar.md's generation-first rule forbids by
 * default. The licence is the learner's own choice (the grammar's autonomy
 * article), so the election travels the way every other learner election
 * does: as a sentence in the learner's turn, never as app-authored system
 * prompt. Pinned by checkDoctrine; the protocol it names is the
 * learn-skill.lecture-notes-protocol.md overlay, and the bridge tool's own
 * description carries the writing rules for an install where the overlay
 * has not been applied.
 */

/** Appended to a fresh /learn kickoff when the Settings toggle is on. */
export const LECTURE_NOTES_ON =
  'I have turned on Lecture Notes in Settings. For each concept in this sitting that is new to me (never encoded before, and not the capstone), please follow the learn skill\'s "Lecture notes" protocol: before its OPEN A GAP beat, write my lecture notes for that concept and give them to me with publish_lecture_notes, then wait until I say I have read them. After that, run the usual beats; at VERIFY I will answer from memory with the notes closed.'

/** Sent ahead of the learner's next message when they turned the toggle
 * off during a sitting that had elected it. */
export const LECTURE_NOTES_OFF =
  'I have turned Lecture Notes off in Settings: from the next concept on, please skip the lecture notes and run the usual beats.'

/** The learner's "I've read them" turn, sent by the notes card's button. */
export function lectureNotesReadMessage(title: string): string {
  return `I've read the lecture notes for ${title}. I'm ready to start the concept.`
}

/** Whether a sitting's transcript says the learner elected notes — the
 * latest of the two declarations wins. Reads only the learner's own lines. */
export function lectureNotesElectedInTranscript(lines: unknown[]): boolean | null {
  let elected: boolean | null = null
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue
    const l = line as { type?: unknown; message?: { content?: unknown } }
    if (l.type !== 'user') continue
    const content = l.message?.content
    const texts: string[] =
      typeof content === 'string'
        ? [content]
        : Array.isArray(content)
          ? content
              .filter((b): b is { type: 'text'; text: string } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
              .map((b) => b.text)
          : []
    for (const t of texts) {
      if (t.includes(LECTURE_NOTES_ON)) elected = true
      if (t.includes(LECTURE_NOTES_OFF)) elected = false
    }
  }
  return elected
}
