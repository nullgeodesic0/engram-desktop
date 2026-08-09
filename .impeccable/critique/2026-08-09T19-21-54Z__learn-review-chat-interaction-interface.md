---
timestamp: 2026-08-09T19-21-54Z
slug: learn-review-chat-interaction-interface
---
# Critique — Learn/Review chat interaction interface

**Method:** dual-agent (A: design review, isolated · B: detector + browser evidence, isolated)
**Target:** the transcript surface — ChatScrollRegion / ChatMessageView / MessageComposer / 33 `ritual/` cards
**Mode:** hybrid, Read-dominant (~70/30) · **Date:** 2026-08-09

## Design Health Score — 28/40

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Excellent classified activity labels; ZERO `aria-live` on a streaming transcript |
| 2 | Match System / Real World | 3 | Private vocabulary (walk, rite, chamber, `s 4.2d → 7.1d`) unglossed at point of use |
| 3 | User Control and Freedom | 3 | Strong exits; open AskCard has none by design; confidence pick has no undo |
| 4 | Consistency and Standards | 2 | MarkFrame exists and 8 cards bypass it; 19 distinct card widths in one column |
| 5 | Error Prevention | 4 | Best axis in the app — attestation gate, deferAsk, seeded shuffle, no-priming rail |
| 6 | Recognition Rather Than Recall | 2 | The chamber BLURS the probe during free recall (was 3 on A's read; B's measure confirms severity) |
| 7 | Flexibility and Efficiency | 3 | ⌘⏎, 1–9 picks; chamber/pins/minimap/Stop all mouse-only; 1–9 undocumented |
| 8 | Aesthetic and Minimalist Design | 2 | Measured 106–127 chars/line against a 45–90 target — density is over the line, not at it |
| 9 | Error Recovery | 3 | Honest per-kind headlines; raw log dump; danger ink on a validation error |
| 10 | Help and Documentation | 3 | Rigorous keyboard reference that omits every transcript accelerator |
| **Total** | | **28/40** | **Fair–Good** |

## Priority Issues

- **[P0] The recall chamber blurs the question.** ProbeCard renders inside the `chamber-blur` wrapper (`ReviewSessionView.tsx:2105`); that class is `filter: blur(7px); pointer-events: none`. Pressing "◐ Begin recall" makes the probe unreadable and non-interactive. Verified in source.
- **[P1] The reading measure is 32–41% too wide.** `.transcript-measure` caps at 92ch = 908.5px, which buys 106–127 real characters (median ~119) because CSS `ch` is the width of `0` and the serif's lowercase is ~26% narrower. This is the primary reading surface, read 20–70 min at a stretch.
- **[P1] The lapse and the milestone both flash danger red.** Both carry `ritual-misconception-in` → `--ink-accent: danger`, and `mark-settle-in` opens at a 15% wash. LapseRite flashes alarm while its copy says "a lapse resets the interval, not the work". Verified in source.
- **[P1] `--color-text-faint` is unreadable everywhere.** Max 2.46:1 on any surface (1.84 on the ProbeCard band). 9 of 20 dark-theme failures are this one token, at 9–10px, carrying scheduling data.
- **[P1] MarkFrame is bypassed by 8 cards**, re-accumulating the exact padding drift it was built to end (`px-4 py-3`, `px-2.5 py-1`, `px-3.5 py-3`). 19 distinct card widths, 691px of right-edge variance.
- **[P2] No `aria-live`, no headings, no landmarks, scroller has no `tabindex`.** A keyboard-only user cannot scroll the transcript; a screen-reader user hears nothing stream.
- **[P2] Danger ink misuse at the surface's edges** — ~20 sites including `ui/Button`'s `danger` variant and the TitleBar close button. DESIGN.md also contradicts itself: :171 forbids the dismiss-chip use that :267 sanctions.

## Tooling finding

The deterministic scan returned `[]` and that is evidence of nothing. A planted canary of 11 known defects was caught 0/11 scoped and 2/11 unscoped (both bounce-easing). The TSX path is regex-only and this codebase uses `var(--color-*)` tokens and Tailwind arbitrary values, neither of which it resolves. 59 rules exist; the scoped run skips most of them.

## Strengths

- Bridge cards are architecturally prevented from becoming load-bearing — one classifier, no view state, shared by live render AND replay, every field `typeof`-checked.
- Retrieval protection is defended in depth AT THE SCREEN: queue-rail attribute stripping, seeded option shuffle, deferAsk serialization.
- The canonical reveal is structurally gated on a real grade receipt — the app's most emphatic typography is reserved for text that provably follows a receipt.
