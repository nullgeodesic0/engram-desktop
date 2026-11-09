import { describe, it, expect } from 'vitest'
import type { TopicListEntry } from '../../../shared/types'
import { buildMapIndex, firstDrawnTopic } from './mapTopicIndex'

function topic(over: Partial<TopicListEntry>): TopicListEntry {
  return { topic: 't', title: 'T', goal: '', nodes: 4, due: 0, states: { review: 1, learning: 1, new: 2 }, ...over }
}

const qho = topic({ topic: 'qho', title: 'Quantum Harmonic Oscillator', folder: 'Physics Quals', due: 7 })
const stat = topic({ topic: 'stat', title: 'Statistical Mechanics', folder: 'Physics Quals', due: 4 })
const fixed = topic({ topic: 'fixed', title: 'Fixed Income', folder: 'Quant Finance', due: 5 })
const bayes = topic({ topic: 'bayes', title: 'Bayesian Inference', due: 1, states: { review: 0, learning: 0, new: 4 } })
// Archived, filed, and with a due count the engine would never actually
// report — it must still never surface as work.
const linalg = topic({ topic: 'linalg', title: 'Linear Algebra Refresher', folder: 'Physics Quals', retired: 4, archivedAt: '2026-10-21', due: 9 })
const spanish = topic({ topic: 'spanish', title: 'Spanish Subjunctive', retired: 4, archivedAt: '2026-10-25' })
const all = [linalg, qho, stat, fixed, bayes, spanish]

describe('buildMapIndex', () => {
  it('groups live topics by folder, in the learner’s folder order, Unfiled last, archived kept apart', () => {
    const idx = buildMapIndex(all, { group: 'folder', sort: 'due', folderOrder: ['Quant Finance', 'Physics Quals'], query: '' })
    expect(idx.sections.map((s) => s.heading)).toEqual(['Quant Finance', 'Physics Quals', 'Unfiled'])
    expect(idx.sections[1].topics.map((t) => t.topic)).toEqual(['qho', 'stat'])
    expect(idx.sections[2].quiet).toBe(true)
    // An archived topic filed in Physics Quals is not in that folder's section.
    expect(idx.sections.flatMap((s) => s.topics).some((t) => t.topic === 'linalg')).toBe(false)
    expect(idx.archived.map((t) => t.topic)).toEqual(['linalg', 'spanish'])
    expect(idx.archivedTotal).toBe(2)
  })

  it('groups by state with only non-empty sections', () => {
    const idx = buildMapIndex(all, { group: 'state', sort: 'title', folderOrder: [], query: '' })
    expect(idx.sections.map((s) => s.heading)).toEqual(['Continue learning', 'Not started'])
    expect(idx.sections[0].topics.map((t) => t.topic)).toEqual(['fixed', 'qho', 'stat'])
  })

  it('filters live and archived topics with the same query, keeping the archived total', () => {
    const idx = buildMapIndex(all, { group: 'folder', sort: 'due', folderOrder: [], query: 'physics' })
    expect(idx.sections.map((s) => s.heading)).toEqual(['Physics Quals'])
    expect(idx.archived.map((t) => t.topic)).toEqual(['linalg'])
    expect(idx.archivedTotal).toBe(2)
    expect(idx.liveShown).toBe(2)
  })
})

describe('firstDrawnTopic', () => {
  it('opens on the first live topic as drawn, never an archived one', () => {
    expect(firstDrawnTopic(all, { group: 'folder', sort: 'due', folderOrder: ['Physics Quals'] })).toBe('qho')
    // The archived topic has the largest due count and the earliest title;
    // neither can pull it to the front.
    expect(firstDrawnTopic(all, { group: 'state', sort: 'title', folderOrder: [] })).toBe('fixed')
  })

  it('falls back to an archived topic only when nothing is live', () => {
    expect(firstDrawnTopic([spanish, linalg], { group: 'folder', sort: 'title', folderOrder: [] })).toBe('linalg')
    expect(firstDrawnTopic([], { group: 'folder', sort: 'due', folderOrder: [] })).toBeNull()
  })
})
