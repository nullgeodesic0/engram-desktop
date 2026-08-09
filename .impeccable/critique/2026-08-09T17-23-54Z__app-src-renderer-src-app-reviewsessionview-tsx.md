---
timestamp: 2026-08-09T17-23-54Z
slug: app-src-renderer-src-app-reviewsessionview-tsx
---
# Critique — Review Page

**Method:** dual-agent (A: design review, isolated · B: detector + browser evidence, isolated)
**Target:** `app/src/renderer/src/app/ReviewSessionView.tsx` (+ `ReadyRoomPlate.tsx`, `SittingRuler.tsx`, `SessionMasthead.tsx`)
**Mode:** Operate · **Date:** 2026-08-09

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Dragging the ruler refetches a differently-sized queue; the axis rescales under the hand dragging it. |
| 2 | Match System / Real World | 3 | Bare unlabeled `<input type="time">` renders `--:-- --`; "runs past this" has no antecedent. |
| 3 | User Control and Freedom | 1 | `closed-unexpectedly` renders a red panel with NO control; copy says "safe to start a new session" and offers no way to. |
| 4 | Consistency and Standards | 2 | Review is the cool environment; the entire ready room is warm ink. 4 danger-ink uses outside a learner lapse. |
| 5 | Error Prevention | 1 | `sessionCapRef = capForMins(mins)` (flat 60s/item) contradicts the pace-based plan the plate just showed. |
| 6 | Recognition Rather Than Recall | 3 | Per-item cost / overdue age / pace basis are `title`-only — hover-only, absent for keyboard and SR. |
| 7 | Flexibility and Efficiency | 3 | Real arrow-key path on the slider; no Home/End, no start shortcut, no bulk action on a 30+ backlog. |
| 8 | Aesthetic and Minimalist Design | 2 | The ruler was built to replace five captions; four are still rendered beneath it. Four controls write one variable. |
| 9 | Error Recovery | 1 | Crash panel names no cause, offers no retry, no partial-sitting export. |
| 10 | Help and Documentation | 2 | The checkpoint tradeoff lives in a `title` tooltip — the one thing a learner must understand before electing it. |
| **Total** | | **20/40** | **Needs work** |

Applicable max 40; no heuristics scored n/a.

## Design Specificity Verdict

Authored for this product, decisively. The ruler's snap-to-item-edge rule and `RulerItem` being a probe-incapable type are derived from measured facts and product doctrine, not from category habit. Two things pull the other way: the intake row is a generic settings strip bolted beside the signature instrument, and the whole surface is inked warm in the cool environment.

**Deterministic scan:** 0 findings across 4 files, all scopes, exit 0. A canary control proved the TSX path is regex-only — it does not evaluate contrast, Tailwind color/radius, or type scale. Treat clean as "no dated-easing/known-literal patterns", not "no defects".

## Priority Issues

- **[P0] `closed-unexpectedly` is a dead end.** Red panel, no control, KeepMounted so navigating away doesn't reset. Fix: render the crash panel *above* the ready plate (`phase === 'ready' || phase === 'closed-unexpectedly'`) and add a resume button.
- **[P1] The ruler rescales under the hand dragging it.** `sittingPrefs.mins` is in the queue-refetch deps; `capForMins(mins) === mins`. Fix: fetch once at a fixed generous cap; the budget must not size the queue.
- **[P1] Plate and header disagree within a second.** `sessionCapRef` uses `capForMins`, kickoff uses `planSitting`. Fix: size the session by the number that was shown.
- **[P1] 10px node names fail contrast in both themes.** 2.38:1 dark, 2.89:1 light — below 3:1, at the smallest size, carrying the only content naming *what* is due.
- **[P1] The closing record hides behind a mouse-only `aria-hidden` nub.** Peak-end broken; unreachable by keyboard.
- **[P2] Four controls write one variable, three lie.** Uncontrolled time input goes stale; presets show nothing selected; `loadSittingPrefs` discards any budget that isn't 5/10/25.
- **[P2] Wrong ink.** Warm throughout a cool environment on unconsolidated items; 4 danger-ink uses outside a learner lapse (export failure, crash panel, Stop hover, checkpoint lint).

## Evidence Notes

- 15 focusables, DOM order == tab order, no positive tabindex, every *button* named.
- The `role="group"` wrapper of both SegmentedControls receives neither `aria-label` nor `aria-labelledby` — SR announces two unlabeled groups. Root is `overflow-hidden`, clipping `.focus-ring` on end segments.
- Primary CTA not reachable at 820x620 without 254px of scroll (lower bound; real shell is narrower/taller).
- Ruler slider exposes full ARIA (`valuemin/max/now/text`, label) and is focusable.
- Probe-leak check: fixture probe/claim/rubric strings never rendered. Doctrine holds.
- Ruler inside/outside fill differ by 1.58:1 — below 3:1, but backed by solid-vs-dashed border, so not hue-only.
- Touch targets under 24px: ALL pill (38x21), pin-tacks (20x20).
