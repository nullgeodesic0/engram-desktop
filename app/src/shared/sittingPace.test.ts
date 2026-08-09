import { describe, it, expect } from 'vitest'
import {
  buildPaceModel, secondsForTopic, planSitting, humanMinutes, DEFAULT_SECONDS_PER_ITEM,
  sittingOptions, nearestOption,
} from './sittingPace'

const s = (topic: string, ...secs: number[]) => secs.map((seconds) => ({ topic, seconds }))

describe('buildPaceModel', () => {
  it('takes the median per topic, so a coffee break does not set the pace', () => {
    // Four normal items and one 30-minute gap.
    const m = buildPaceModel(s('physics', 300, 300, 360, 240, 1800))
    expect(m.byTopic.physics.medianSeconds).toBe(300)
    expect(m.byTopic.physics.samples).toBe(5)
  })

  it('ignores impossible samples rather than averaging them in', () => {
    const m = buildPaceModel([...s('t', 300, 300), { topic: 't', seconds: 0 }, { topic: 't', seconds: NaN }])
    expect(m.byTopic.t.samples).toBe(2)
  })

  it('reports nothing rather than guessing with no data', () => {
    const m = buildPaceModel([])
    expect(m.overallMedianSeconds).toBeNull()
    expect(m.totalSamples).toBe(0)
  })
})

describe('secondsForTopic — and how it says where the number came from', () => {
  it('uses the topic once it has enough of its own history', () => {
    const m = buildPaceModel([...s('quantum', 462, 462, 462), ...s('other', 60, 60, 60)])
    expect(secondsForTopic(m, 'quantum')).toEqual({ seconds: 462, basis: 'topic' })
  })

  it('falls back to the overall median for a thin topic', () => {
    const m = buildPaceModel([...s('new-topic', 900), ...s('established', 300, 300, 300, 300)])
    const r = secondsForTopic(m, 'new-topic')
    expect(r.basis).toBe('overall')
    expect(r.seconds).toBe(300)
  })

  it('falls back to the historical assumption when there is no data at all', () => {
    expect(secondsForTopic(buildPaceModel([]), 'anything')).toEqual({
      seconds: DEFAULT_SECONDS_PER_ITEM, basis: 'default',
    })
  })
})

describe('planSitting', () => {
  // Measured: quantum ~7.7 min, classical ~5.0 min an item.
  const model = buildPaceModel([...s('quantum', 462, 462, 462), ...s('classical', 300, 300, 300)])

  it('charges each item its OWN topic, not an average', () => {
    // 25 min = 1500s. 462 + 300 + 300 = 1062 fits; a fourth quantum item
    // would make 1524 and does not. A flat average would have promised more.
    const plan = planSitting(25, ['quantum', 'classical', 'classical', 'quantum'], model)
    expect(plan.items).toBe(3)
    expect(plan.predictedSeconds).toBe(1062)
    expect(plan.overruns).toBe(false)
  })

  it('lets a cheaper queue go further in the same budget', () => {
    // Same 25 minutes, all classical: 5 items at 300s exactly fills it.
    expect(planSitting(25, Array(8).fill('classical'), model).items).toBe(5)
  })

  it('stops at the budget instead of promising the whole queue', () => {
    const plan = planSitting(10, Array(12).fill('quantum'), model)
    expect(plan.items).toBe(1)
    expect(plan.overruns).toBe(false)
  })

  it('still offers one item when even one overruns, and says so', () => {
    // A 5-minute budget against an 11-minute Lenin item.
    const lenin = buildPaceModel(s('lenin', 660, 660, 660))
    const plan = planSitting(5, ['lenin', 'lenin'], lenin)
    expect(plan.items).toBe(1)
    expect(plan.overruns).toBe(true)
  })

  it('is empty for an empty queue', () => {
    expect(planSitting(10, [], model)).toEqual({ items: 0, predictedSeconds: 0, overruns: false })
  })

  it('reproduces the flat old behaviour when nothing has been measured', () => {
    // 10 minutes at the historical 60s assumption is 10 items.
    expect(planSitting(10, Array(20).fill('x'), buildPaceModel([])).items).toBe(10)
  })
})

describe('humanMinutes', () => {
  it('rounds the way a person would say it', () => {
    expect(humanMinutes(30)).toBe('under a minute')
    expect(humanMinutes(300)).toBe('5 min')
    expect(humanMinutes(1524)).toBe('25 min')
  })
})

describe('sittingOptions — budgets that mean something', () => {
  it('offers a quarter, a half, and the whole queue', () => {
    // 18 items at ~4 min = ~72 min, the case from a real screenshot.
    expect(sittingOptions(72 * 60)).toEqual([20, 35, 70])
  })

  it('always makes the largest option a FULL clear', () => {
    const o = sittingOptions(50 * 60)
    expect(o[o.length - 1]).toBe(50)
  })

  it('collapses duplicates rather than offering the same budget twice', () => {
    // A tiny queue: quarter, half and full all round to 5.
    expect(sittingOptions(4 * 60)).toEqual([5])
  })

  it('falls back to the old fixed set when nothing is known', () => {
    expect(sittingOptions(0)).toEqual([5, 10, 25])
    expect(sittingOptions(NaN)).toEqual([5, 10, 25])
  })

  it('never offers less than five minutes', () => {
    expect(Math.min(...sittingOptions(30))).toBeGreaterThanOrEqual(5)
  })
})

describe('nearestOption', () => {
  it('snaps a remembered budget onto the current set', () => {
    expect(nearestOption(25, [20, 35, 70])).toBe(20)
    expect(nearestOption(40, [20, 35, 70])).toBe(35)
  })
})
