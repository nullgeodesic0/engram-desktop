import { useEffect, useRef } from 'react'
import { localToday } from './nodeIntervalHistory'

/** The one piece of actual logic here, pulled out as a pure function so it
 * has a test independent of the React effect around it (this codebase's
 * vitest config is plain `node` — no DOM, no renderHook precedent; see
 * newTopicPrefillFlow.ts's identical reasoning for extracting a decision
 * from a live effect). */
export function dateHasRolledOver(previous: string, current: string): boolean {
  return previous !== current
}

/** Fires `onRollover` once whenever the local calendar date has changed
 * since the last check — the fix for a KeepMounted view (Review's plate,
 * concretely) whose due queue/counts were fetched once at first visit and
 * never again, so a topic that crossed into "due today" overnight stayed
 * invisible until the app was restarted.
 *
 * Checked on window focus (mirrors App.tsx's own due-badge focus refresh —
 * same reasoning: don't make the learner wait on a poll interval after
 * switching back from another app) plus a 5-minute backstop interval for a
 * window that's simply never blurred (left open on a second monitor
 * overnight). Neither needs to be precise to the minute: a sleeping Mac's
 * timers pause and resume on wake, so the very next focus or tick after
 * waking observes the date change — there's no missed-rollover case to
 * design around, only "how long before the app notices," which 5 minutes
 * (or the next click into the window) comfortably bounds.
 *
 * `onRollover` is read through a ref (advanced-use-latest) so the effect
 * mounts its listeners exactly once — callers pass a fresh closure on every
 * render (this is a plain function prop, not useCallback'd, everywhere it's
 * used), and re-subscribing focus/interval on every render would be pure
 * waste for a check this cheap. */
export function useDateRollover(onRollover: () => void): void {
  const callbackRef = useRef(onRollover)
  callbackRef.current = onRollover
  const lastDateRef = useRef(localToday())

  useEffect(() => {
    function check() {
      const now = localToday()
      if (dateHasRolledOver(lastDateRef.current, now)) {
        lastDateRef.current = now
        callbackRef.current()
      }
    }
    window.addEventListener('focus', check)
    const interval = setInterval(check, 5 * 60_000)
    return () => {
      window.removeEventListener('focus', check)
      clearInterval(interval)
    }
  }, [])
}
