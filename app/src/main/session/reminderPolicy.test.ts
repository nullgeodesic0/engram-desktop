import { describe, expect, it } from 'vitest'
import { badgeFigure, notificationCopy, parseReminderTime, reminderDue } from './reminderPolicy'
import type { NotifierSettings } from '../../shared/types'

const base: NotifierSettings = {
  remindersEnabled: true,
  cadenceMinutes: 30,
  dockBadgeEnabled: true,
  badgeStyle: 'sitting',
  sittingMinutes: 25,
  reminderTime: null,
}

describe('badgeFigure', () => {
  it('caps at one sitting so a backlog never grows on the icon', () => {
    expect(badgeFigure(base, 80, 6)).toBe(6)
    expect(badgeFigure(base, 3, 6)).toBe(3)
  })
  it('shows the raw count in count style or without a pace model', () => {
    expect(badgeFigure({ ...base, badgeStyle: 'count' }, 80, 6)).toBe(80)
    expect(badgeFigure(base, 80, null)).toBe(80)
  })
  it('clears when off or empty', () => {
    expect(badgeFigure({ ...base, dockBadgeEnabled: false }, 80, 6)).toBe(0)
    expect(badgeFigure(base, 0, 6)).toBe(0)
  })
})

describe('parseReminderTime', () => {
  it('accepts HH:MM and rejects junk', () => {
    expect(parseReminderTime('19:30')).toEqual({ h: 19, m: 30 })
    expect(parseReminderTime('7:05')).toEqual({ h: 7, m: 5 })
    expect(parseReminderTime('25:00')).toBeNull()
    expect(parseReminderTime('after coffee')).toBeNull()
    expect(parseReminderTime(null)).toBeNull()
  })
})

describe('reminderDue', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m)
  const timed = { ...base, reminderTime: '19:00' }

  it('waits for the committed time, then fires once that day', () => {
    expect(reminderDue(timed, { lastNotifiedAt: null, lastSignature: null, signature: 'a' }, at(18, 59))).toBe(false)
    expect(reminderDue(timed, { lastNotifiedAt: null, lastSignature: null, signature: 'a' }, at(19, 0))).toBe(true)
    const firedAt = at(19, 2).toISOString()
    expect(reminderDue(timed, { lastNotifiedAt: firedAt, lastSignature: 'a', signature: 'b' }, at(21))).toBe(false)
  })

  it('fires again the next day', () => {
    const yesterday = new Date(2026, 10, 10, 19, 1).toISOString()
    expect(reminderDue(timed, { lastNotifiedAt: yesterday, lastSignature: 'a', signature: 'a' }, at(19, 5))).toBe(true)
  })

  it('keeps the rolling cadence without a time', () => {
    const recent = at(12, 50).toISOString()
    expect(reminderDue(base, { lastNotifiedAt: recent, lastSignature: 'a', signature: 'a' }, at(13))).toBe(false)
    expect(reminderDue(base, { lastNotifiedAt: recent, lastSignature: 'a', signature: 'b' }, at(13))).toBe(true)
    expect(reminderDue(base, { lastNotifiedAt: recent, lastSignature: 'a', signature: 'a' }, at(13, 30))).toBe(true)
  })
})

describe('notificationCopy', () => {
  it('states the sitting, not the backlog', () => {
    const c = notificationCopy(base, 40, { items: 5, minutes: '25 min' })
    expect(c.body).toBe('5 items, about 25 min at your pace. The rest can wait.')
    expect(c.title).not.toMatch(/40/)
  })
  it('never claims a duration it has no measurement for', () => {
    const c = notificationCopy(base, 4, null)
    expect(c.body).not.toMatch(/minute|min/)
  })
})
