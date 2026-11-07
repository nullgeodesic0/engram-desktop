import { describe, it, expect } from 'vitest'
import { pendingQuestion } from './pendingQuestion'
import type { ChatMessage } from '../../../shared/chatMessages'

const msg = (role: 'assistant' | 'user', text: string, id = Math.random().toString()): ChatMessage =>
  ({ id, role, text, timestamp: 0 }) as ChatMessage

describe('pendingQuestion', () => {
  it('keeps the question and drops the instructions after it', () => {
    const m = msg(
      'assistant',
      'You encoded the Hamiltonian eleven days ago:\n\n$$H = \\frac{p^2}{2m}$$\n\n**From memory:** why is $H$ quadratic in *both* $x$ and $p$? One or two sentences, then pick your confidence.',
    )
    expect(pendingQuestion([m])).toEqual({ text: '**From memory:** why is $H$ quadratic in *both* $x$ and $p$?', index: 0 })
  })

  it('is empty once the learner has replied', () => {
    expect(pendingQuestion([msg('assistant', 'Why?'), msg('user', 'Because.')])).toBeNull()
  })

  it('is empty when the tutor asked nothing', () => {
    expect(pendingQuestion([msg('assistant', 'Good. That is the core idea.')])).toBeNull()
  })

  it('ignores question marks inside code and display maths', () => {
    const m = msg('assistant', 'What does this print?\n\n```\nx = a ? b : c\n```\n\n$$\n? \n$$')
    expect(pendingQuestion([m])?.text).toBe('What does this print?')
  })

  it('refuses a paragraph too long to be a reminder', () => {
    expect(pendingQuestion([msg('assistant', 'a'.repeat(400) + '?')])).toBeNull()
  })
})
