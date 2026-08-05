import { describe, it, expect } from 'vitest'
import { folderNames, groupTopicsByFolder, normalizeFolderName, UNFILED } from './topicFolders'
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

describe('normalizeFolderName', () => {
  it('trims, and empty means unfiled rather than a folder named ""', () => {
    expect(normalizeFolderName('  Physics  ')).toBe('Physics')
    expect(normalizeFolderName('')).toBeNull()
    expect(normalizeFolderName('   ')).toBeNull()
  })
  it('collapses internal whitespace so near-identical names are one folder', () => {
    expect(normalizeFolderName('Physics   Quals')).toBe('Physics Quals')
  })
})

describe('folderNames', () => {
  it('alphabetical, de-duplicated case-insensitively, unfiled excluded', () => {
    const list = [
      topic({ topic: 'a', folder: 'Physics' }),
      topic({ topic: 'b', folder: 'physics' }),
      topic({ topic: 'c', folder: 'Finance' }),
      topic({ topic: 'd' }),
      topic({ topic: 'e', folder: '   ' }),
    ]
    expect(folderNames(list)).toEqual(['Finance', 'Physics'])
  })
  it('empty list has no folders', () => {
    expect(folderNames([])).toEqual([])
  })
})

describe('groupTopicsByFolder', () => {
  it('folders alphabetical, Unfiled always last', () => {
    const list = [
      topic({ topic: 'loose' }),
      topic({ topic: 'z', folder: 'Zoology' }),
      topic({ topic: 'a', folder: 'Anatomy' }),
    ]
    const groups = groupTopicsByFolder(list, 'title')
    expect(groups.map((g) => g.name)).toEqual(['Anatomy', 'Zoology', UNFILED])
    expect(groups[2].unfiled).toBe(true)
    expect(groups[0].unfiled).toBe(false)
  })

  it('sorts within each folder by the shared key', () => {
    const list = [
      topic({ topic: 'low', folder: 'F', due: 1 }),
      topic({ topic: 'high', folder: 'F', due: 9 }),
    ]
    expect(groupTopicsByFolder(list, 'due')[0].topics.map((t) => t.topic)).toEqual(['high', 'low'])
  })

  it('emits no group for a folder that has no topics — an emptied folder disappears', () => {
    const groups = groupTopicsByFolder([topic({ topic: 'a', folder: 'Kept' })], 'title')
    expect(groups.map((g) => g.name)).toEqual(['Kept'])
  })

  it('all-unfiled yields only the Unfiled group; empty input yields nothing', () => {
    expect(groupTopicsByFolder([topic({ topic: 'a' })], 'title').map((g) => g.name)).toEqual([UNFILED])
    expect(groupTopicsByFolder([], 'title')).toEqual([])
  })

  it('whitespace-only folder reads as unfiled, not as its own group', () => {
    const groups = groupTopicsByFolder([topic({ topic: 'a', folder: '  ' })], 'title')
    expect(groups.map((g) => g.name)).toEqual([UNFILED])
  })

  it('every topic lands in exactly one group', () => {
    const list = [
      topic({ topic: 'a', folder: 'X' }),
      topic({ topic: 'b', folder: 'Y' }),
      topic({ topic: 'c' }),
      topic({ topic: 'd', folder: 'X' }),
    ]
    const groups = groupTopicsByFolder(list, 'title')
    const placed = groups.flatMap((g) => g.topics.map((t) => t.topic)).sort()
    expect(placed).toEqual(['a', 'b', 'c', 'd'])
  })
})
