/**
 * Oral exams: the wire types between main, the renderer and the tutor.
 *
 * An oral exam is a pack problem of type "oral" (see problems.ts) that runs
 * in a Learn sitting. The learner starts it from Labs; the tutor, as
 * examiner, asks each question through the oral_exam bridge tool; the
 * learner answers aloud with the lecture notes locked; the speech layer
 * transcribes the answer on the device and the learner confirms the
 * transcript. Up to two follow-ups per question, from the pack's list. At
 * the end the learner picks a confidence for each question, still blind,
 * and only then does the tutor get the answers to grade.
 */

import type { Confidence } from './labs'

/** How long a learner's Start in Labs stays good for the tutor to open the exam. */
export const ORAL_REQUEST_TTL_MS = 2 * 60 * 60 * 1000
/** A confirmed transcript may not run past this. */
export const ORAL_ANSWER_MAX = 6000
/** Above this share of words changed, a confirmed transcript counts as rewritten, not corrected. */
export const ORAL_EDIT_LIMIT = 0.25

/** One question or follow-up, put to the learner. */
export interface OralAskRequest {
  sessionId: string
  requestId: string
  exam: string
  title: string
  kind: 'question' | 'follow-up'
  questionId: string
  followUpId: string | null
  /** 1-based number of the question this turn belongs to, and how many there are. */
  index: number
  total: number
  prompt: string
  seconds: number
  /** False when the speech layer is missing: the card says how to install it. */
  speechReady: boolean
}

/** The confidence round that ends the exam. */
export interface OralFinishRequest {
  sessionId: string
  requestId: string
  exam: string
  title: string
  questions: { id: string; prompt: string }[]
}

/** Sent when an exam starts or ends in a sitting, so the view can lock and unlock. */
export interface OralState {
  sessionId: string
  /** The running exam, or null once it has ended. */
  exam: string | null
  title: string
  pack: string
  problem: string
}

export interface OralTurn {
  questionId: string
  followUpId: string | null
  prompt: string
  askedAt: string
  answeredAt: string | null
  /** From the card appearing to the recording's end. */
  seconds: number
  limit: number
  timedOut: boolean
  /** What the speech layer heard. Empty when nothing was transcribed. */
  transcript: string
  /** What the learner confirmed. This is the answer. */
  confirmed: string
  /** Share of words changed from the transcript, 0 to 1. */
  edited: number
  audio: string | null
}

export type OralExamStatus = 'running' | 'done' | 'abandoned'

export interface OralExamRecord {
  id: string
  seq: number
  sessionId: string
  startedAt: string
  endedAt: string | null
  status: OralExamStatus
  turns: OralTurn[]
  /** By question id, picked at the end, before any grading. */
  confidences: Record<string, Confidence> | null
}

/** What Labs shows of a problem's oral exams. */
export interface OralExamsView {
  exams: OralExamRecord[]
  speechReady: boolean
  /** A Start not yet taken up by the tutor. */
  pending: boolean
}

/** Word-level edit distance over the longer of the two, so a corrected word or two stays small. */
export function editShare(heard: string, confirmed: string): number {
  const a = heard.toLowerCase().split(/\s+/).filter(Boolean)
  const b = confirmed.toLowerCase().split(/\s+/).filter(Boolean)
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0 || b.length === 0) return 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return Math.min(1, prev[b.length] / Math.max(a.length, b.length))
}

export function formatSeconds(s: number): string {
  const n = Math.max(0, Math.round(s))
  const m = Math.floor(n / 60)
  const r = n % 60
  return m === 0 ? `${r} s` : r === 0 ? `${m} min` : `${m} min ${r} s`
}
