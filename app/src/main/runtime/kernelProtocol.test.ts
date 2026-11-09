import { describe, expect, it } from 'vitest'
import { LineSplitter, parseKernelLine } from './kernelProtocol'
import { appendOutput, MAX_OUTPUT_CHARS } from '../../shared/cellOutputs'

describe('kernel protocol', () => {
  it('parses every message the kernel sends', () => {
    expect(parseKernelLine('{"type":"ready","python":"3.12.13","packages":{"numpy":"2.3.0"}}')).toEqual({
      type: 'ready',
      python: '3.12.13',
      packages: { numpy: '2.3.0' },
    })
    expect(parseKernelLine('{"id":3,"type":"stream","name":"stderr","text":"w\\n"}')).toEqual({
      type: 'output',
      id: 3,
      output: { type: 'stream', name: 'stderr', text: 'w\n' },
    })
    expect(parseKernelLine('{"id":3,"type":"value","text":"42"}')).toMatchObject({
      output: { type: 'value', text: '42' },
    })
    expect(parseKernelLine('{"id":3,"type":"figure","svg":"<svg/>","png":"AA=="}')).toMatchObject({
      output: { type: 'figure', svg: '<svg/>', png: 'AA==' },
    })
    expect(
      parseKernelLine('{"id":3,"type":"error","ename":"ValueError","evalue":"bad","traceback":["a","b"],"line":7}'),
    ).toMatchObject({
      output: {
        type: 'error',
        ename: 'ValueError',
        evalue: 'bad',
        traceback: ['a', 'b'],
        line: 7,
      },
    })
    expect(parseKernelLine('{"id":3,"type":"done","ok":true,"ms":41}')).toEqual({
      type: 'done',
      id: 3,
      ok: true,
      ms: 41,
    })
    expect(parseKernelLine('{"id":4,"type":"vars","vars":[{"name":"x","type":"int","repr":"1"}]}')).toMatchObject({
      vars: [{ name: 'x' }],
    })
  })

  it('ignores lines that are not protocol messages', () => {
    expect(parseKernelLine('not json')).toBeNull()
    expect(parseKernelLine('{"type":"stream","text":"no id"}')).toBeNull()
    expect(parseKernelLine('{"id":1,"type":"mystery"}')).toBeNull()
  })

  it('splits a chunked stream into whole lines', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(s.push(':2}\n\n')).toEqual(['{"b":2}'])
  })

  it('merges consecutive chunks of one stream and caps runaway output', () => {
    let out = appendOutput([], { type: 'stream', name: 'stdout', text: 'a' })
    out = appendOutput(out, { type: 'stream', name: 'stdout', text: 'b' })
    out = appendOutput(out, { type: 'stream', name: 'stderr', text: 'c' })
    expect(out).toEqual([
      { type: 'stream', name: 'stdout', text: 'ab' },
      { type: 'stream', name: 'stderr', text: 'c' },
    ])
    let big = appendOutput([], {
      type: 'stream',
      name: 'stdout',
      text: 'x'.repeat(MAX_OUTPUT_CHARS - 1),
    })
    big = appendOutput(big, { type: 'stream', name: 'stdout', text: 'yyyy' })
    big = appendOutput(big, { type: 'stream', name: 'stdout', text: 'zzzz' })
    expect(big).toHaveLength(1)
    expect((big[0] as { text: string }).text).toMatch(/output truncated\n$/)
    expect((big[0] as { text: string }).text).not.toContain('z')
  })
})
