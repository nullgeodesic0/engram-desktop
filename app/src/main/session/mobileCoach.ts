import { readReceiptsHistory, type DayActivity, type WeekRetention } from '../engramCli/receiptsHistory'
import { engramRead } from '../engramCli/readOnly'

/**
 * Coach: what the record says about how you learn.
 *
 * The desktop's version reads the whole record and has room to argue with it.
 * This one answers the two questions a phone can answer honestly — is it
 * coming back, and am I turning up — plus what is owed by way of unresolved
 * misconceptions.
 *
 * ## Measurement, not encouragement
 *
 * Everything here is a count or a rate the engine already recorded. There is
 * no streak, no goal, no "you're on a roll". The desktop's voice rule holds
 * on glass: state what is true and stop. A phone is exactly where a streak
 * would do the most damage, because the app it is competing with for that
 * two-minute slot is built entirely out of them.
 *
 * ## Why misconceptions are a count
 *
 * A misconception is the learner's own wrong idea in their own words. The
 * count says there is something to resolve; the text belongs at the desk with
 * the session that can actually work on it, and shipping it to a pocket buys
 * nothing the number does not.
 */

export interface CoachDay {
  date: string
  count: number
}

export interface CoachWeek {
  weekStart: string
  total: number
  recalled: number
  /** Null for a week with no retrievals — kept rather than dropped, because a
   * silent week is a fact and closing the gap would draw a continuous line
   * through a fortnight where nothing happened. */
  rate: number | null
}

export interface MobileCoach {
  days: CoachDay[]
  weeks: CoachWeek[]
  /** Retrievals recalled over retrievals attempted, across the weeks that
   * measured anything. Null before there is anything to divide. */
  retentionRate: number | null
  openMisconceptions: number
}

/** Weeks of daily activity the strip draws. Enough to see a rhythm, few
 * enough that each day is still a legible mark at phone width. */
const WEEKS_OF_DAYS = 4

export function projectCoach(
  days: DayActivity[],
  weeks: WeekRetention[],
  weeksOfDays: number,
  openMisconceptions = 0,
): MobileCoach {
  const recent = days.slice(-weeksOfDays * 7).map((d) => ({ date: d.date, count: d.count }))

  const measured = weeks.filter((w) => w.total > 0)
  const attempted = measured.reduce((sum, w) => sum + w.total, 0)
  const recalled = measured.reduce((sum, w) => sum + w.recalled, 0)

  return {
    days: recent,
    weeks: weeks.map((w) => ({
      weekStart: w.weekStart,
      total: w.total,
      recalled: w.recalled,
      rate: w.rate,
    })),
    // Weighted by attempts rather than averaging the weekly rates: a week with
    // two retrievals should not count as much as one with forty.
    retentionRate: attempted > 0 ? recalled / attempted : null,
    openMisconceptions,
  }
}

export async function buildCoach(): Promise<MobileCoach> {
  const [history, misconceptions] = await Promise.all([
    readReceiptsHistory(),
    engramRead<unknown[]>('misconception', ['list']).catch(() => [] as unknown[]),
  ])
  const open = (misconceptions as { resolved?: unknown }[]).filter(
    (row) => row?.resolved !== true,
  ).length
  return projectCoach(history.days, history.weeks, WEEKS_OF_DAYS, open)
}
