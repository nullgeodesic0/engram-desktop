import { describe, it, expect } from 'vitest'
import { addFolderToRegistry, removeFolderFromRegistry, allFolderNames } from './folderRegistry'
import { groupTopicsByFolder, UNFILED } from './topicFolders'
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

describe('addFolderToRegistry', () => {
  it('normalizes and appends', () => {
    expect(addFolderToRegistry([], '  Physics  ')).toEqual(['Physics'])
  })
  it('refuses empties and case-insensitive duplicates', () => {
    expect(addFolderToRegistry(['Physics'], '   ')).toEqual(['Physics'])
    expect(addFolderToRegistry(['Physics'], 'physics')).toEqual(['Physics'])
  })
})

describe('removeFolderFromRegistry', () => {
  it('removes case-insensitively and leaves the rest', () => {
    expect(removeFolderFromRegistry(['Physics', 'Finance'], 'PHYSICS')).toEqual(['Finance'])
  })
})

describe('allFolderNames', () => {
  it('is the union of in-use and registered, alphabetical', () => {
    const topics = [topic({ topic: 'a', folder: 'Physics' })]
    expect(allFolderNames(topics, ['Finance'])).toEqual(['Finance', 'Physics'])
  })
  it('an in-use folder shows even when the registry never heard of it', () => {
    expect(allFolderNames([topic({ topic: 'a', folder: 'Orphan' })], [])).toEqual(['Orphan'])
  })
  it('a registered folder shows even with nothing in it', () => {
    expect(allFolderNames([], ['Empty'])).toEqual(['Empty'])
  })
  it('the in-use spelling wins over a differently-cased registry entry', () => {
    expect(allFolderNames([topic({ topic: 'a', folder: 'Physics' })], ['physics'])).toEqual(['Physics'])
  })
})

describe('groupTopicsByFolder organize-mode options', () => {
  it('alwaysShow keeps an empty folder on screen as a drop target', () => {
    const groups = groupTopicsByFolder([topic({ topic: 'a' })], 'title', {
      alwaysShow: ['Empty'],
      includeEmptyUnfiled: true,
    })
    expect(groups.map((g) => g.name)).toEqual(['Empty', UNFILED])
    expect(groups[0].topics).toEqual([])
  })

  it('includeEmptyUnfiled keeps Unfiled available when everything is filed', () => {
    const groups = groupTopicsByFolder([topic({ topic: 'a', folder: 'F' })], 'title', { includeEmptyUnfiled: true })
    expect(groups.map((g) => g.name)).toEqual(['F', UNFILED])
    expect(groups[1].topics).toEqual([])
  })

  it('without the options an emptied folder and an empty Unfiled both disappear', () => {
    const groups = groupTopicsByFolder([topic({ topic: 'a', folder: 'F' })], 'title')
    expect(groups.map((g) => g.name)).toEqual(['F'])
  })

  it('alwaysShow never duplicates a folder that also has topics', () => {
    const groups = groupTopicsByFolder([topic({ topic: 'a', folder: 'F' })], 'title', { alwaysShow: ['F'] })
    expect(groups.map((g) => g.name)).toEqual(['F'])
    expect(groups[0].topics.map((t) => t.topic)).toEqual(['a'])
  })
})
