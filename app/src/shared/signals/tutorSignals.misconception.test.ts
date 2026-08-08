import { describe, it, expect } from 'vitest'
import { parseMisconceptionAdds } from './tutorSignals'

const add = (cmd: string) => parseMisconceptionAdds(cmd)

describe('parseMisconceptionAdds — the wording must be real or absent', () => {
  it('keeps an inline description', () => {
    const r = add('python3 "$E" misconception add --topic t --node fd-entropy --description "Treats S as extensive by assumption."')
    expect(r).toEqual([{ node: 'fd-entropy', text: 'Treats S as extensive by assumption.' }])
  })

  it('does not render a shell VARIABLE as the wording', () => {
    // Reported live: the pin showed the literal text "$DESC".
    const r = add('DESC="..."\npython3 "$E" misconception add --node fd-microcanonical-entropy --description "$DESC"')
    expect(r).toHaveLength(1)
    expect(r[0].text).toBe('')
    expect(r[0].node).toBe('fd-microcanonical-entropy')
  })

  it('handles the braced form too', () => {
    expect(add('misconception add --node n-x --description "${DESC}"')[0].text).toBe('')
  })

  it('still suppresses a command substitution', () => {
    expect(add('misconception add --node n-x --description "$(cat "$D/m.txt")"')[0].text).toBe('')
  })

  it('NEVER suppresses a description that merely contains maths', () => {
    // Every LaTeX misconception in this app has dollars in it.
    const cases = [
      'Thinks $E=mc^2$ applies to rest mass only.',
      'Writes $x$ where $x^{2}$ belongs.',
      'Confuses $\\beta$ with $1/T$.',
      '$S = k_B \\ln \\Omega$ misapplied to a non-isolated system.',
    ]
    for (const c of cases) {
      const r = add(`misconception add --node n-x --description "${c}"`)
      expect(r[0].text, c).toBe(c)
    }
  })

  it('captures several adds in one command, in order', () => {
    const r = add(
      'misconception add --node a-one --description "first"\nmisconception add --node b-two --description "second"',
    )
    expect(r.map((x) => [x.node, x.text])).toEqual([['a-one', 'first'], ['b-two', 'second']])
  })
})
