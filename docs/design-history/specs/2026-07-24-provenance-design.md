# Provenance — Node History from the Topic Map

**Date:** 2026-07-24
**Status:** Approved design (Project C of the records round)

## Goal

From any node on the topic map, reach the actual conversations where that node was learned: the sitting where it was first encoded, and every review sitting that audited it — opened read-only, scrolled to the relevant exchange.

## Constraints (binding)

- Read-only over existing files: session-index entries and their on-disk transcripts (`~/.claude/projects/**/<sessionId>.jsonl`). Engram's own files untouched; no new writes anywhere but a cache file in the app's userData.
- No session spawns from any provenance surface (same contract as the history browser).
- Scanning is lazy and cached — never re-parse an unchanged transcript (mtime-keyed, same discipline as `topicsCache.ts`).
- Verification per task: `npm run typecheck && npm run build`.

## Components

### 1. Transcript scanner (`app/src/main/session/sessionScan.ts`)

For a topic: walk the session-index entries for that topic (learn) plus the `review` kind. For each transcript file, extract per-node grading events with their anchor (the index of the transcript entry the event lives in):

- **Encode events**: learn sittings' receipt batches (`receipt --file` tool_results — parse with the same loose-JSON discipline as `gradeResult.ts`; each array item names its node) and pretest `rate --kind pretest` results.
- **Review events**: review sittings' single `rate` tool_results naming the node.

Cache shape (userData `session-scan-cache.json`): `{ [transcriptPath]: { mtimeMs, events: [{node, topic, kind: 'encode'|'pretest'|'review', anchor, date}] } }`. A scan request re-reads only stale/missing entries.

Public API: `nodeProvenance(topic) → { [nodeId]: { firstEncoded: {sessionId, date, anchor} | null, reviews: [{sessionId, date, anchor}] } }` — firstEncoded is the earliest encode/pretest event; reviews sorted newest first. Exposed through readHandlers + preload as `window.engram.nodeProvenance(topic)`.

### 2. Anchored read-only viewer (extend `SessionHistoryDrawer.tsx`)

New optional props: `initialSessionId` and `anchorIndex`. When set, the drawer opens directly on that sitting, auto-scrolls to the message at the anchor, and applies a highlight treatment (warm hairline wash, fades after a beat — motion tokens, reduced-motion safe). The anchor's transcript-entry index maps to the drawer's timeline index via the same conversion the drawer already performs; when the mapping misses (malformed entry), fall back to opening the sitting at the top — never an error state.

### 3. Map provenance section (`TopicMapView.tsx`)

In the node drawer and node modal: a Provenance block —

- `First encoded — <date>` (absent for nodes still `new`; pretest counts as first contact and is labeled `Pretested — <date>`).
- `Reviewed <N> times` with the list of review sittings (date + grade when the scan captured it), newest first.
- Clicking any entry opens the anchored viewer for that sitting. Loading state is a quiet fig-caption; a topic with no scanned history shows nothing (no empty chrome).

## Out of scope

Cross-topic provenance rollups; editing/annotating history; excerpt-only cards (full-sitting-scrolled was chosen); scanning transcripts not referenced by the session index.

## Verification

- A node in grad-classical-mechanics shows its real first-encode date; clicking opens the sitting scrolled to the graded exchange, highlighted.
- A node reviewed in past review sittings lists them; each opens scrolled to that node's rate exchange.
- Second open of the same topic performs zero re-parsing (cache hit — verified by timing or a debug counter in the task report).
- `ps` shows no claude process from any provenance interaction.
