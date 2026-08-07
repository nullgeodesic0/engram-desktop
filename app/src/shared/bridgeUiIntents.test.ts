import { describe, it, expect } from 'vitest'
import { bridgeUiIntent } from './bridgeUiIntents'

describe('bridgeUiIntent — hostile / malformed payloads', () => {
  it('ignores an unknown tool name', () => {
    expect(bridgeUiIntent('no_such_tool', { phase: 'walk' })).toBeNull()
  })

  it('ignores a non-object payload', () => {
    for (const p of [null, undefined, 'walk', 42, ['walk']]) {
      expect(bridgeUiIntent('session_phase', p)).toBeNull()
    }
  })

  it('never throws on any tool with a garbage payload', () => {
    const tools = [
      'session_phase', 'beat_outcome', 'show_figure', 'render_ticket', 'suggest_action',
      'progress_note', 'spotlight_node', 'annotate_node', 'report_verdict',
      'render_comparison', 'render_steps', 'render_formula', 'cite_source',
    ]
    const garbage = [{}, { a: 1 }, { fields: 'x' }, { steps: 5 }, { left: 1, right: 2 }, { where: 'no' }]
    for (const t of tools) {
      for (const g of garbage) expect(() => bridgeUiIntent(t, g)).not.toThrow()
    }
  })
})

describe('bridgeUiIntent — existing vocabulary (parity with the old inline ladders)', () => {
  it('session_phase', () => {
    expect(bridgeUiIntent('session_phase', { phase: 'grading' })).toEqual({ kind: 'phase', phase: 'grading' })
    expect(bridgeUiIntent('session_phase', { phase: '  ' })).toBeNull()
    expect(bridgeUiIntent('session_phase', { phase: 7 })).toBeNull()
  })

  it('beat_outcome accepts only known beats and outcomes', () => {
    expect(bridgeUiIntent('beat_outcome', { beat: 'verify', outcome: 'confirmed' })).toEqual({
      kind: 'beat-outcome', beat: 'verify', outcome: 'confirmed',
    })
    // 'visited' is the app's own default, never something the tutor reports.
    expect(bridgeUiIntent('beat_outcome', { beat: 'verify', outcome: 'visited' })).toBeNull()
    expect(bridgeUiIntent('beat_outcome', { beat: 'wander', outcome: 'confirmed' })).toBeNull()
  })

  it('show_figure — title optional, body required', () => {
    expect(bridgeUiIntent('show_figure', { body: '| a | b |' })).toEqual({
      kind: 'figure', title: null, body: '| a | b |',
    })
    expect(bridgeUiIntent('show_figure', { title: 'Ladder', body: 'x' })).toEqual({
      kind: 'figure', title: 'Ladder', body: 'x',
    })
    expect(bridgeUiIntent('show_figure', { title: 5, body: 'x' })).toBeNull()
    expect(bridgeUiIntent('show_figure', { title: 'Ladder' })).toBeNull()
  })

  it('render_ticket requires at least one well-formed field', () => {
    expect(bridgeUiIntent('render_ticket', { kind: 'review', fields: [{ key: 'due', value: '5' }] })).toEqual({
      kind: 'ticket', ticket: { kind: 'review', mode: null, fields: [{ key: 'due', value: '5' }] },
    })
    expect(bridgeUiIntent('render_ticket', { kind: 'review', fields: [] })).toBeNull()
    expect(bridgeUiIntent('render_ticket', { kind: 'review', fields: [{ key: 'due' }] })).toBeNull()
    expect(bridgeUiIntent('render_ticket', { fields: [{ key: 'a', value: 'b' }] })).toBeNull()
  })

  it('suggest_action caps at 3 and rejects unknown kinds', () => {
    expect(bridgeUiIntent('suggest_action', { actions: [{ label: 'Open', kind: 'open_explorable', arg: '/p.html' }] })).toEqual({
      kind: 'actions', actions: [{ label: 'Open', kind: 'open_explorable', arg: '/p.html' }],
    })
    expect(bridgeUiIntent('suggest_action', { actions: [{ label: 'x', kind: 'rm_rf' }] })).toBeNull()
    const four = Array.from({ length: 4 }, () => ({ label: 'x', kind: 'go_review' }))
    expect(bridgeUiIntent('suggest_action', { actions: four })).toBeNull()
    // An empty list is legitimate — it's how the tutor clears its own chips.
    expect(bridgeUiIntent('suggest_action', { actions: [] })).toEqual({ kind: 'actions', actions: [] })
  })

  it('annotate_node needs a topic, a node, and at least one latex field', () => {
    expect(bridgeUiIntent('annotate_node', { topic: 't', node: 'n', latex_label: 'E=mc^2' })).toEqual({
      kind: 'annotate', topicId: 't', nodeId: 'n', latexLabel: 'E=mc^2', latexClaim: null,
    })
    expect(bridgeUiIntent('annotate_node', { topic: 't', node: 'n' })).toBeNull()
    expect(bridgeUiIntent('annotate_node', { topic: 't', latex_claim: 'x' })).toBeNull()
  })

  it('report_verdict routes through the shared parseVerdictHint', () => {
    expect(bridgeUiIntent('report_verdict', { kind: 'canonical', text: 'The answer is x.' })).toEqual({
      kind: 'verdict-hint', hint: { kind: 'canonical', text: 'The answer is x.' },
    })
    expect(bridgeUiIntent('report_verdict', { kind: 'praise', text: 'nice' })).toBeNull()
  })
})

describe('bridgeUiIntent — expanded vocabulary', () => {
  it('render_comparison needs both labelled sides', () => {
    expect(
      bridgeUiIntent('render_comparison', {
        title: 'Canonical vs grand canonical',
        left: { label: 'Canonical', body: 'fixed $N$' },
        right: { label: 'Grand canonical', body: 'fixed $\\mu$' },
      }),
    ).toEqual({
      kind: 'comparison',
      title: 'Canonical vs grand canonical',
      left: { label: 'Canonical', body: 'fixed $N$' },
      right: { label: 'Grand canonical', body: 'fixed $\\mu$' },
    })
    expect(bridgeUiIntent('render_comparison', { left: { label: 'a', body: 'b' } })).toBeNull()
    expect(bridgeUiIntent('render_comparison', { left: { label: 'a' }, right: { label: 'c', body: 'd' } })).toBeNull()
  })

  it('render_steps accepts bare strings and {text,note} rungs', () => {
    expect(bridgeUiIntent('render_steps', { steps: ['first', { text: 'second', note: 'because' }] })).toEqual({
      kind: 'steps', title: null, steps: [{ text: 'first' }, { text: 'second', note: 'because' }],
    })
  })

  it('render_steps refuses an empty or oversized ladder', () => {
    expect(bridgeUiIntent('render_steps', { steps: [] })).toBeNull()
    expect(bridgeUiIntent('render_steps', { steps: Array.from({ length: 13 }, (_, i) => `s${i}`) })).toBeNull()
    // Exactly at the cap is fine.
    const twelve = bridgeUiIntent('render_steps', { steps: Array.from({ length: 12 }, (_, i) => `s${i}`) })
    expect(twelve && twelve.kind === 'steps' && twelve.steps.length).toBe(12)
  })

  it('render_formula — where clause optional, capped, and all-or-nothing per row', () => {
    expect(bridgeUiIntent('render_formula', { latex: 'Z=\\sum e^{-\\beta E}' })).toEqual({
      kind: 'formula', latex: 'Z=\\sum e^{-\\beta E}', caption: null, where: [],
    })
    expect(
      bridgeUiIntent('render_formula', {
        latex: 'Z=\\sum e^{-\\beta E}',
        caption: 'the partition function',
        where: [{ symbol: '\\beta', meaning: '$1/k_BT$' }],
      }),
    ).toEqual({
      kind: 'formula',
      latex: 'Z=\\sum e^{-\\beta E}',
      caption: 'the partition function',
      where: [{ symbol: '\\beta', meaning: '$1/k_BT$' }],
    })
    expect(bridgeUiIntent('render_formula', { latex: 'x', where: [{ symbol: 'a' }] })).toBeNull()
    expect(bridgeUiIntent('render_formula', { latex: 'x', where: Array.from({ length: 9 }, () => ({ symbol: 'a', meaning: 'b' })) })).toBeNull()
    expect(bridgeUiIntent('render_formula', { caption: 'no latex' })).toBeNull()
  })

  it('cite_source — label required, locator and note optional', () => {
    expect(bridgeUiIntent('cite_source', { label: 'Hull 8e' })).toEqual({
      kind: 'citation', label: 'Hull 8e', locator: null, note: null,
    })
    expect(bridgeUiIntent('cite_source', { label: 'Hull 8e', locator: 'ch. 13', note: 'the tree derivation' })).toEqual({
      kind: 'citation', label: 'Hull 8e', locator: 'ch. 13', note: 'the tree derivation',
    })
    expect(bridgeUiIntent('cite_source', { locator: 'p. 4' })).toBeNull()
    expect(bridgeUiIntent('cite_source', { label: 'x', locator: 12 })).toBeNull()
  })
})
