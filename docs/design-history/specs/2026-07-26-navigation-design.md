# Navigation — Browsing What You've Learned

**Date:** 2026-07-26
**Status:** Approved design (P2 of the surfacing round)

## Goal

Four gaps in getting around. The map is currently the *only* way to browse a topic's nodes; session history is per-topic or review-only with no global view; a node's dependency relationships are visible on the plate but never enumerable; and nothing remembers where you just were.

## Constraints (binding)

- Read-only toward engram state; no new engine surface. Every item reads data the app already fetches.
- The map is not replaced. The node table is a second view of the same data, reachable from the map, not instead of it.
- Reuse before building: `plateStats` for state vocabulary, `ancestorClosure`/`descendantPath` (already hub-boundary-aware) for relationships, `SessionHistoryDrawer`'s anchored viewer for opening a sitting, `humanizeNodeId` throughout.
- Night Atlas vocabulary; honest empty states; verification `npm run typecheck && npm run build`.
- **No computer control.** Verification is typecheck/build plus reading real data on disk. Anything only confirmable by eye is handed to the user.

## 1. Node table

A sortable, filterable list of a topic's nodes, toggled from the map's own header (map ↔ table, the map stays default). Columns: node, state, stability, due, reps/lapses, threshold flag. Sort by any column; filters for **due**, **threshold**, **lapsing** (lapses > 0), and **unencoded** (state `new`).

Rows open the same node detail the map's drawer uses — one detail surface, two ways in. Counts must reconcile with `plateStats` (the map's own summary) or one of them is lying.

This is the biggest ergonomic gap in the app: 39 nodes in grad-classical-mechanics are currently only reachable by hunting the plate or knowing the name to search.

## 2. Global session history

`SessionHistoryDrawer` gains an "everything" mode: every sitting across all topics and both loops, newest first, tagged by topic and kind. The index is already per-key, so this is an aggregation plus the existing anchored viewer — no new read path.

Reachable from the app menu and the palette. The per-topic and review-scoped modes stay exactly as they are.

## 3. What depends on this

In the node drawer and modal, two lists beside Provenance: **requires** (the full prerequisite chain, ordered root-first) and **unlocks** (everything downstream). Built from `ancestorClosure`/`descendantPath`, which already stop at hub boundaries — so a synthesis node can't make this read "everything."

Each entry is a link to that node. The map draws these as ink; this makes them readable, countable, and clickable — and it's the natural place to answer "why am I being asked this."

## 4. Recently viewed

A short list (cap ~8) of nodes and sittings you've opened, renderer-local (`localStorage`, the same discipline `calibrationStore.ts` uses — decorative, not app state). Surfaced in the palette's empty query state and on Home. Deduped by identity, newest first.

## Out of scope

Editing anything from these surfaces; cross-topic node comparison; saved filters.

## Verification

- Node table's filtered counts reconcile with `plateStats` for a real topic (grad-classical-mechanics, 39 nodes) — report the numbers.
- Global history lists sittings from more than one topic AND both loops.
- `requires`/`unlocks` for a spot-checked mid-graph node match what the map's trail highlights, and a hub-adjacent node doesn't enumerate the world.
- Recently-viewed survives a view switch, caps correctly, and dedupes.
