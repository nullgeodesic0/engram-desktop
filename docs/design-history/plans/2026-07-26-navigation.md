# Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the four navigation items per `../specs/2026-07-26-navigation-design.md`.

**Architecture:** All renderer-side over data already fetched. Two of the four (table, dependents) are new views of the topic graph `TopicMapView` already holds; one extends an existing drawer; one is local storage.

**Tech Stack:** existing only; no new deps.

## Global Constraints

- **No computer control / no launching the app.** Verification is `cd app && npm run typecheck && npm run build` plus reading real data on disk (`~/.claude/learning/graphs/*.json`, transcripts) and read-only `engram.py` calls. Visual-only questions go to the user.
- Read-only toward engram; no new engine reads.
- Reuse, don't reimplement: `plateStats` (state counts), `ancestorClosure`/`descendantPath` in `components/graph2d/plate.ts` (hub-boundary-aware), `SessionHistoryDrawer`'s anchored viewer, `humanizeNodeId`, `friendlyErrorText`.
- Night Atlas vocabulary; honest empty states; no scolding copy.

---

### Task 1: Node table

**Files:**
- Create: `app/src/renderer/src/components/NodeTable.tsx`
- Modify: `app/src/renderer/src/app/TopicMapView.tsx` (map ↔ table toggle in the header; the table reuses the existing node drawer for detail)

**Interfaces:**
- Consumes the `TopicGraph` TopicMapView already holds, plus its `retrievability` map. Columns: node (humanized), state, stability (`fsrs.s`), due (local-date discipline — see `GraphView`'s `dueStatusFor`), reps/lapses, threshold. Sortable by each; filters: due / threshold / lapsing (`fsrs.lapses > 0`) / unencoded (`state === 'new'`).
- Row click sets `selectedNode` — the SAME drawer the map opens. Do not build a second detail surface.
- Table is a peer of `GraphView` inside the existing plate container; the toggle is view-local state, default map.
- Tabular numerals on every number; the map's own state vocabulary (`stateLabel`) reused verbatim.

- [ ] Build the table + toggle.
- [ ] **Reconcile:** filtered counts vs `plateStats(graph, retrievability)` for grad-classical-mechanics — paste both sets of numbers in the report. A mismatch means one of them is wrong; find out which before proceeding.
- [ ] Verify + commit `feat(map): a node table beside the plate`.

### Task 2: What depends on this

**Files:**
- Modify: `app/src/renderer/src/app/TopicMapView.tsx` (node drawer + node modal)

**Interfaces:**
- Two lists beside `ProvenanceBlock`: **Requires** (prerequisite chain, root-first) and **Unlocks** (downstream), from `ancestorClosure`/`descendantPath` in `components/graph2d/plate.ts`. Read those functions first — they already stop at hub boundaries, which is what keeps a synthesis node from enumerating the whole graph.
- Entries are buttons setting `selectedNode` (same pattern the misconception ledger's node links use).
- Renders nothing for a node with neither (roots have no requires; leaves have no unlocks) — no empty chrome.

- [ ] Implement both lists.
- [ ] Sanity: for one mid-graph node and one hub-adjacent node in grad-classical-mechanics, report the counts and confirm the hub-adjacent one doesn't list the world.
- [ ] Verify + commit `feat(map): requires and unlocks, enumerated`.

### Task 3: Global session history

**Files:**
- Modify: `app/src/renderer/src/components/SessionHistoryDrawer.tsx`, `app/src/renderer/src/App.tsx` (menu/palette entry), `app/src/main/appMenu.ts` (a Session-menu item)

**Interfaces:**
- New drawer mode: `historyKey === '*'` (or an explicit `scope: 'all'` prop — choose and document) listing every sitting across all topics and both kinds, newest first, each row tagged with its topic and kind. Aggregate by calling `sessionHistoryFor` per known key: topic ids from `topics()`, plus `'review'`, plus the legacy `'learn'` key (the provenance scanner learned that early sittings live under it — see `main/session/sessionScan.ts`).
- Existing per-topic and review modes unchanged — verify by reading their call sites before editing.
- Selecting a sitting uses the drawer's existing transcript path unchanged.

- [ ] Implement the mode + entry points.
- [ ] Sanity: report how many sittings it finds and confirm the list spans >1 topic and both kinds.
- [ ] Verify + commit `feat(history): every sitting in one place`.

### Task 4: Recently viewed

**Files:**
- Create: `app/src/renderer/src/shared/recentlyViewed.ts`
- Modify: `app/src/renderer/src/components/CommandPalette.tsx` (empty-query state), `app/src/renderer/src/app/HomeView.tsx`, and the places that open a node/sitting (TopicMapView's node open, SessionHistoryDrawer's sitting select)

**Interfaces:**
- `recordView(entry)` / `recentViews()` over `localStorage`, ring-buffered at 8, deduped by identity (topic+node, or sessionId), newest first. Follow `shared/calibrationStore.ts`'s shape and its "decorative, renderer-local, not app state" framing.
- Palette: shown under the nav commands when the query is empty — it must not displace them or interfere with the two-phase index load.
- Home: a quiet row, hidden entirely when empty.

- [ ] Store + recording call sites + both surfaces.
- [ ] Verify cap/dedupe/newest-first by exercising the pure functions in a throwaway node script; paste the output.
- [ ] Verify + commit `feat(nav): recently viewed`.
