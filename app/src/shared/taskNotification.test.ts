import { describe, it, expect } from 'vitest'
import { isTaskNotificationContent, parseCurriculumReturn } from './taskNotification'

const CURRICULUM = JSON.stringify({
  topic: 'quantum-codes-from-annealing',
  title: 'Arc 3',
  goal: 'understand',
  order: ['a', 'b'],
  // Values deliberately empty: parseCurriculumReturn only ever counts keys,
  // and this fixture must not carry answer-side fields (D4).
  nodes: { a: {}, b: {}, c: {} },
})

function envelope(result: string, status = 'completed'): string {
  return `<task-notification>\n<task-id>t1</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<output-file>/tmp/x</output-file>\n<status>${status}</status>\n<result>${result}</result>\n</task-notification>`
}

describe('isTaskNotificationContent', () => {
  it('matches the bare envelope', () => {
    expect(isTaskNotificationContent(envelope(CURRICULUM))).toBe(true)
  })

  it('matches the system-preamble delivery variant', () => {
    const prefixed = `[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event, NOT a message from the user.\n\n${envelope(CURRICULUM)}`
    expect(isTaskNotificationContent(prefixed)).toBe(true)
  })

  it('leaves a genuine learner turn that merely quotes an envelope alone', () => {
    expect(isTaskNotificationContent(`why did I see <task-notification> printed in my chat?`)).toBe(false)
    expect(isTaskNotificationContent('a normal free-recall answer about annealing')).toBe(false)
  })
})

describe('parseCurriculumReturn', () => {
  it('extracts topic and node count from a curriculum result', () => {
    expect(parseCurriculumReturn(envelope(CURRICULUM))).toEqual({
      topic: 'quantum-codes-from-annealing',
      nodeCount: 3,
    })
  })

  it('accepts a fenced result body', () => {
    expect(parseCurriculumReturn(envelope('```json\n' + CURRICULUM + '\n```'))).toEqual({
      topic: 'quantum-codes-from-annealing',
      nodeCount: 3,
    })
  })

  it('rejects an assessor audit result (array shape)', () => {
    const audit = '```json\n[{"node":"n1","kind":"audit","agree":true}]\n```'
    expect(parseCurriculumReturn(envelope(audit))).toBeNull()
  })

  it('rejects an incomplete notification and prose results', () => {
    expect(parseCurriculumReturn(envelope(CURRICULUM, 'running'))).toBeNull()
    expect(parseCurriculumReturn(envelope('Async agent launched.'))).toBeNull()
  })
})
