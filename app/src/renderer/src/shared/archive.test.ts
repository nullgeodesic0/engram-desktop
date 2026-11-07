import { describe, it, expect } from 'vitest'
import type { DayActivity, Misconception, TopicListEntry } from '../../../shared/types'
import {
  archivedTopicIds,
  countedOpenMisconceptions,
  daysWithout,
  excludedFromStats,
  isArchivedTopic,
  liveNodeCounts,
  partitionArchived,
} from './archive'
import { computeShownTopicGrade, computeTopicGrade } from './topicGrade'
import { moveFolder, orderFolders, renameFolderInRegistry } from './folderRegistry'
import { groupTopicsByFolder } from './topicFolders'

function topic(over: Partial<TopicListEntry>): TopicListEntry {
  return {
    topic: 't',
    title: 'T',
    goal: '',
    nodes: 4,
    due: 0,
    states: { review: 2, learning: 1, new: 1 },
    ...over,
  }
}

const live = topic({ topic: 'live', title: 'Live', due: 3 })
const archived = topic({ topic: 'arch', title: 'Arch', retired: 4, archivedAt: '2026-10-21' })
const partly = topic({
  topic: 'part',
  title: 'Part',
  retired: 2,
  liveStates: { review: 2, learning: 0, new: 0 },
})

describe('archive predicates', () => {
  it('archived means every node retired; partial retirement is not archived', () => {
    expect(isArchivedTopic(archived)).toBe(true)
    expect(isArchivedTopic(partly)).toBe(false)
    expect(isArchivedTopic(live)).toBe(false)
    // Sparse field from an older engine: never reads as archived.
    expect(isArchivedTopic(topic({ retired: undefined }))).toBe(false)
    // Zero-of-zero is not archived either.
    expect(isArchivedTopic(topic({ nodes: 0, retired: 0 }))).toBe(false)
  })

  it('partitions without dropping or duplicating', () => {
    const { live: l, archived: a } = partitionArchived([live, archived, partly])
    expect(l.map((t) => t.topic)).toEqual(['live', 'part'])
    expect(a.map((t) => t.topic)).toEqual(['arch'])
    expect([...archivedTopicIds([live, archived, partly])]).toEqual(['arch'])
  })

  it('the switch empties the exclusion set', () => {
    expect([...excludedFromStats([live, archived], false)]).toEqual(['arch'])
    expect(excludedFromStats([live, archived], true).size).toBe(0)
    expect(excludedFromStats(null, false).size).toBe(0)
  })

  it('live node counts leave retired concepts out of coverage', () => {
    expect(liveNodeCounts(partly)).toEqual({ nodes: 2, review: 2 })
    expect(liveNodeCounts(live)).toEqual({ nodes: 4, review: 2 })
  })
})

describe('archive filters', () => {
  const days: DayActivity[] = [
    {
      date: '2026-11-01',
      count: 3,
      items: [
        { topic: 'live', node: 'a', grade: 'recalled' },
        { topic: 'arch', node: 'b', grade: 'lapsed' },
        { topic: 'arch', node: 'c', grade: 'partial' },
      ] as DayActivity['items'],
    },
  ]

  it('removes excluded topics from day items and recounts', () => {
    const out = daysWithout(days, new Set(['arch']))
    expect(out[0].count).toBe(1)
    expect(out[0].items.map((i) => i.topic)).toEqual(['live'])
    // No exclusion: the very same array back, untouched.
    expect(daysWithout(days, new Set())).toBe(days)
  })

  it('sets aside an archived topic’s open misconceptions unless counted', () => {
    const rows: Misconception[] = [
      { id: '1', ts: '2026-10-01', topic: 'live', node: 'a', description: '', status: 'open' },
      { id: '2', ts: '2026-10-01', topic: 'arch', node: 'b', description: '', status: 'open' },
      { id: '3', ts: '2026-10-01', topic: 'live', node: 'c', description: '', status: 'resolved' },
    ]
    expect(countedOpenMisconceptions(rows, [live, archived], false).map((m) => m.id)).toEqual(['1'])
    expect(countedOpenMisconceptions(rows, [live, archived], true).map((m) => m.id)).toEqual(['1', '2'])
  })
})

describe('archive grades', () => {
  it('total-work coverage reads only the non-retired nodes', () => {
    const g = computeTopicGrade({
      receipts: [],
      topic: 'part',
      topicEntry: partly,
      misconceptions: [],
      days: [],
      picks: [],
      mode: 'total',
    })
    // 2 of the 2 kept nodes are consolidated — not 2 of 4.
    expect(g.components.coverage.raw).toBe(1)
  })

  it('an archived topic’s grade is frozen at its archive date', () => {
    // An open misconception filed before archiving ages past the grace
    // window only AFTER the archive date; the frozen grade must not see it
    // age, and must ignore anything filed after archiving.
    const misconceptions: Misconception[] = [
      { id: 'a', ts: '2026-06-01', topic: 'arch', node: 'n', description: '', status: 'resolved', resolved_ts: '2026-06-02' },
      { id: 'b', ts: '2026-06-01', topic: 'arch', node: 'n', description: '', status: 'resolved', resolved_ts: '2026-06-02' },
      { id: 'c', ts: '2026-06-01', topic: 'arch', node: 'n', description: '', status: 'resolved', resolved_ts: '2026-06-02' },
      { id: 'late', ts: '2026-11-01', topic: 'arch', node: 'n', description: '', status: 'open' },
    ]
    const shown = computeShownTopicGrade({
      receipts: [],
      topicEntry: archived,
      misconceptions,
      days: [],
      picks: [],
      mode: 'total',
    })
    expect(shown.final).toBe(true)
    expect(shown.components.conceptual.n).toBe(3)
    expect(shown.components.conceptual.score).toBe(100)
    // A live topic is graded live.
    expect(computeShownTopicGrade({ receipts: [], topicEntry: live, misconceptions: [], days: [], picks: [], mode: 'total' }).final).toBe(
      false,
    )
  })
})

describe('folder order', () => {
  it('orders by the stored order, then alphabetically', () => {
    expect(orderFolders(['B', 'a', 'C', 'd'], ['C', 'a'])).toEqual(['C', 'a', 'B', 'd'])
    expect(orderFolders(['B', 'a'], [])).toEqual(['a', 'B'])
  })

  it('moves one step and stops at the ends', () => {
    expect(moveFolder(['x', 'y', 'z'], 'y', -1)).toEqual(['y', 'x', 'z'])
    expect(moveFolder(['x', 'y', 'z'], 'z', 1)).toEqual(['x', 'y', 'z'])
  })

  it('renames in place', () => {
    expect(renameFolderInRegistry(['a', 'Old', 'c'], 'old', 'New')).toEqual(['a', 'New', 'c'])
  })

  it('folder groups follow the stored order, Unfiled last', () => {
    const ts = [topic({ topic: '1', folder: 'Beta' }), topic({ topic: '2', folder: 'Alpha' }), topic({ topic: '3' })]
    expect(groupTopicsByFolder(ts, 'title', { order: ['Beta', 'Alpha'] }).map((g) => g.name)).toEqual(['Beta', 'Alpha', 'Unfiled'])
  })
})
