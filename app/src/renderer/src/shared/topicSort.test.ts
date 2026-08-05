import { describe, it, expect } from 'vitest'
import { sortTopics, isArchivedTopic, consolidatedFraction, TOPIC_SORT_OPTIONS } from './topicSort'
import type { TopicListEntry } from '../../../shared/types'

function topic(over: Partial<TopicListEntry> & { topic: string }): TopicListEntry {
  return {
    title: over.topic,
    goal: '',
    nodes: 10,
    due: 0,
    states: { review: 0, learning: 0, new: 10 },
    ...over,
  }
}

const ids = (list: TopicListEntry[]) => list.map((t) => t.topic)

describe('sortTopics', () => {
  it('due: most waiting first', () => {
    const list = [topic({ topic: 'a', due: 1 }), topic({ topic: 'b', due: 9 }), topic({ topic: 'c', due: 4 })]
    expect(ids(sortTopics(list, 'due'))).toEqual(['b', 'c', 'a'])
  })

  it('title: alphabetical by TITLE, not slug', () => {
    const list = [
      topic({ topic: 'z-slug', title: 'Alpha' }),
      topic({ topic: 'a-slug', title: 'Zulu' }),
      topic({ topic: 'm-slug', title: 'Mike' }),
    ]
    expect(ids(sortTopics(list, 'title'))).toEqual(['z-slug', 'm-slug', 'a-slug'])
  })

  it('progress: furthest consolidated first, and a zero-node topic never NaNs', () => {
    const list = [
      topic({ topic: 'half', nodes: 10, states: { review: 5, learning: 0, new: 5 } }),
      topic({ topic: 'done', nodes: 10, states: { review: 10, learning: 0, new: 0 } }),
      topic({ topic: 'empty', nodes: 0, states: { review: 0, learning: 0, new: 0 } }),
    ]
    expect(ids(sortTopics(list, 'progress'))).toEqual(['done', 'half', 'empty'])
    expect(consolidatedFraction(list[2])).toBe(0)
  })

  it('size: largest first', () => {
    const list = [topic({ topic: 'small', nodes: 3 }), topic({ topic: 'big', nodes: 90 })]
    expect(ids(sortTopics(list, 'size'))).toEqual(['big', 'small'])
  })

  it('archived topics sink to the bottom under every key', () => {
    const archived = topic({ topic: 'archived', title: 'AAA', nodes: 10, retired: 10, due: 99 })
    const live = topic({ topic: 'live', title: 'ZZZ', nodes: 1, due: 0 })
    for (const key of TOPIC_SORT_OPTIONS.map((o) => o.value)) {
      expect(ids(sortTopics([archived, live], key)), key).toEqual(['live', 'archived'])
    }
    expect(isArchivedTopic(archived)).toBe(true)
    expect(isArchivedTopic(live)).toBe(false)
  })

  it('a partly-retired topic is NOT archived, and a sparse `retired` never reads as archived', () => {
    expect(isArchivedTopic(topic({ topic: 'partial', nodes: 10, retired: 4 }))).toBe(false)
    expect(isArchivedTopic(topic({ topic: 'old-engine', nodes: 10 }))).toBe(false)
    expect(isArchivedTopic(topic({ topic: 'no-nodes', nodes: 0, retired: 0 }))).toBe(false)
  })

  it('ties break on title deterministically — same input order in, same order out', () => {
    const list = [
      topic({ topic: 'c', title: 'Charlie', due: 3 }),
      topic({ topic: 'a', title: 'Alpha', due: 3 }),
      topic({ topic: 'b', title: 'Bravo', due: 3 }),
    ]
    expect(ids(sortTopics(list, 'due'))).toEqual(['a', 'b', 'c'])
    // Re-sorting an already-sorted list is a fixed point (no jitter between renders).
    expect(ids(sortTopics(sortTopics(list, 'due'), 'due'))).toEqual(['a', 'b', 'c'])
  })

  it('never mutates the caller’s array', () => {
    const list = [topic({ topic: 'a', due: 1 }), topic({ topic: 'b', due: 9 })]
    const before = ids(list)
    sortTopics(list, 'due')
    expect(ids(list)).toEqual(before)
  })

  it('empty and single-item lists are safe', () => {
    expect(sortTopics([], 'due')).toEqual([])
    expect(ids(sortTopics([topic({ topic: 'only' })], 'progress'))).toEqual(['only'])
  })
})
