/**
 * Two learner gestures the lecture-notes card raises from deep inside the
 * transcript, where the session view's state is out of reach: "open these
 * notes" and "I've read them". A window event rather than a prop threaded
 * through every mark-rendering call site — the card is rendered by history
 * replays too, which have no session to send into, and simply have no
 * listener.
 */
const OPEN_EVENT = 'engram:lecture-notes-open'
const READ_EVENT = 'engram:lecture-notes-read'

export interface LectureNotesRef {
  topic: string
  node: string
  title: string
}

export function requestOpenLectureNotes(ref: LectureNotesRef): void {
  window.dispatchEvent(new CustomEvent<LectureNotesRef>(OPEN_EVENT, { detail: ref }))
}

export function onOpenLectureNotes(fn: (ref: LectureNotesRef) => void): () => void {
  const handler = (e: Event): void => fn((e as CustomEvent<LectureNotesRef>).detail)
  window.addEventListener(OPEN_EVENT, handler)
  return () => window.removeEventListener(OPEN_EVENT, handler)
}

export function announceLectureNotesRead(ref: LectureNotesRef): void {
  window.dispatchEvent(new CustomEvent<LectureNotesRef>(READ_EVENT, { detail: ref }))
}

export function onLectureNotesRead(fn: (ref: LectureNotesRef) => void): () => void {
  const handler = (e: Event): void => fn((e as CustomEvent<LectureNotesRef>).detail)
  window.addEventListener(READ_EVENT, handler)
  return () => window.removeEventListener(READ_EVENT, handler)
}

/** Whether the notes are closed for the cold VERIFY probe. One value for the
 * whole window: the live session view sets it, and every surface that could
 * open the notes (the transcript card, the header button) reads it. */
let locked = false
const lockListeners = new Set<() => void>()

export function setLectureNotesLocked(value: boolean): void {
  if (locked === value) return
  locked = value
  for (const fn of lockListeners) fn()
}

export function lectureNotesLocked(): boolean {
  return locked
}

export function subscribeLectureNotesLock(fn: () => void): () => void {
  lockListeners.add(fn)
  return () => lockListeners.delete(fn)
}
