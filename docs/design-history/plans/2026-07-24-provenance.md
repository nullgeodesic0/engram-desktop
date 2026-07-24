# Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Node → real history: first-encode sitting and every review sitting reachable from the topic map, opened read-only and scrolled to the exchange. Spec: `../specs/2026-07-24-provenance-design.md`.

**Architecture:** Main-process transcript scanner with an mtime cache → `nodeProvenance(topic)` IPC → map UI section → SessionHistoryDrawer anchor mode.

**Tech Stack:** existing only.

## Global Constraints

- Read-only toward `~/.claude/learning` and transcripts; only write is `session-scan-cache.json` in userData.
- No session spawn reachable from provenance surfaces.
- Loose-JSON parsing discipline for receipt/rate results (reuse/extend `shared/gradeResult.ts` helpers — do not fork the logic).
- Never re-parse an unchanged transcript (mtime cache, `topicsCache.ts` discipline).
- Verification per task: `cd app && npm run typecheck && npm run build`.

---

### Task 1: Transcript scanner + IPC

**Files:**
- Create: `app/src/main/session/sessionScan.ts`
- Modify: `app/src/main/ipc/readHandlers.ts`, `app/src/preload/index.ts`, `app/src/shared/types.ts`

**Interfaces:**
- Consumes: `sessionHistoryFor`-equivalent index reads (import from `sessionIndex.ts` — `sessionHistoryFor(key)`), transcript path resolution (find how `getTranscript` resolves sessionId → jsonl path in sessionHandlers and reuse that helper — extract if inline), `parseGradeResults`/`parseGradeResult` from `app/src/shared/gradeResult.ts`.
- Produces (types in shared/types.ts):
  ```ts
  interface ProvenanceEvent { sessionId: string; date: string; anchor: number; kind: 'encode' | 'pretest' | 'review'; grade: string | null }
  interface NodeProvenance { firstEncoded: ProvenanceEvent | null; reviews: ProvenanceEvent[] }
  // window.engram.nodeProvenance(topic): Promise<Record<string, NodeProvenance>>
  ```
- Detection rules (mirror the renderer's detectors — read LearnSessionView's looksLikeReceiptCall/looksLikePretestRate and ReviewSessionView's rate detection to copy their patterns): a transcript entry whose assistant message carries a Bash tool_use matching receipt/rate; the FOLLOWING entries' matching tool_result (by tool_use_id) is parsed for node grades. `anchor` = index of the tool_result entry in the transcript line order.
- Cache: userData `session-scan-cache.json` `{ [path]: { mtimeMs, events } }`; scan(topic) = for each indexed sitting (topic key + 'review' key), stat file, reuse or re-parse; review-kind events filtered to nodes of the requested topic (events store topic when derivable from the rate result; when a rate result lacks topic, match node ids against the topic's graph — accept the topic's node-id set as a parameter).

- [ ] Implement scanner + cache; wire IPC `engram:nodeProvenance` in readHandlers + preload + types.
- [ ] Self-check with a throwaway `node` script against real transcripts (grad-classical-mechanics): print the provenance map, confirm the sprint sitting from 2026-07-24 appears as encode for canonical-transformations-poisson-brackets with a plausible anchor. Include output in the report.
- [ ] Verify typecheck+build; commit `feat(provenance): transcript scanner with mtime cache + nodeProvenance IPC`.

### Task 2: Anchored viewer mode

**Files:**
- Modify: `app/src/renderer/src/components/SessionHistoryDrawer.tsx`, `app/src/renderer/src/index.css` (highlight keyframe)

**Interfaces:**
- Produces: new optional props `initialSessionId?: string`, `anchorIndex?: number` — when set, drawer opens that sitting directly, maps transcript-entry index → timeline index (the drawer's buildHistoryTimeline already walks entries; have it record each timeline item's source entry index so the mapping is exact), scrolls it into view (`scrollIntoView({block:'center'})` after render), and applies a one-shot `.provenance-highlight` (warm hairline wash fading over `calc(var(--dur-base)*2)`, reduced-motion covered by global kill-switch).
- Consumes: existing drawer internals; motion tokens.

- [ ] Add source-entry-index tracking to the timeline builder; anchor mapping falls back to top-of-sitting when no timeline item matches.
- [ ] Props + scroll + highlight; list pane still available (back to list works).
- [ ] Verify typecheck+build; commit `feat(provenance): history drawer opens anchored to an exchange`.

### Task 3: Map provenance section

**Files:**
- Modify: `app/src/renderer/src/app/TopicMapView.tsx`

**Interfaces:**
- Consumes: `window.engram.nodeProvenance(topic)` (loaded per topic alongside annotations; cache in state), the anchored drawer (Task 2), `fig-caption`/list row patterns.
- Produces: Provenance block in node drawer + modal: `First encoded — <date>` / `Pretested — <date>` line; `Reviewed N times` list (date + grade), newest first; entries are buttons (focus-ring, aria-labels) opening the anchored drawer. Nodes with no events render nothing. Loading = quiet fig-caption.

- [ ] Load provenance with the topic (invalidate on topic switch); render blocks; wire drawer opens (drawer needs the topic's history key: topic id for encode/pretest events, 'review' for review events — carry the key on ProvenanceEvent? kind → key mapping is enough).
- [ ] Verify typecheck+build; commit `feat(provenance): node history reachable from the map`.
