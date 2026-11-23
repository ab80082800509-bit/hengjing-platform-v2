/**
 * 連續簽到的對照規格，給測試與程式審查用。
 * 正式發獎不呼叫這支函式。資格、天數與點數只認 Supabase 的
 * public.checkin_cycle_from_days，而且「今天」只認 public.taipei_today()。
 *
 * 沿用既有簽到畫面：中斷一天從第 1 天重算；連續滿 7 天後，下一次也從第 1 天重算。
 */
import { CHECKIN_REWARDS } from './foundation'

const CYCLE = CHECKIN_REWARDS.length

export type CheckinCycle = {
  checkedToday: boolean
  checkedDays: number
  nextDelta: number | null
  todayDelta: number | null
  claimDelta: number
  claimCycleDay: number
}

function parseDay(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('無法計算台北日期')
  const [year, month, date] = day.split('-').map(Number)
  const utc = Date.UTC(year, month - 1, date)
  const check = new Date(utc)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
    throw new Error('無法計算台北日期')
  }
  return utc
}

export function shiftCalendarDay(day: string, delta: number): string {
  return new Date(parseDay(day) + delta * 86_400_000).toISOString().slice(0, 10)
}

function rewardForCycleDay(cycleDay: number): number {
  const reward = CHECKIN_REWARDS[cycleDay - 1]
  if (reward === undefined) throw new Error('簽到點數必須是已確認的 10、15、20 或 50')
  return reward
}

function firstDay(): CheckinCycle {
  return {
    checkedToday: false,
    checkedDays: 0,
    nextDelta: CHECKIN_REWARDS[0],
    todayDelta: null,
    claimDelta: CHECKIN_REWARDS[0],
    claimCycleDay: 1,
  }
}

export function checkinCycleFromDays(days: readonly string[], today: string): CheckinCycle {
  parseDay(today)
  const unique = [...new Set(days.filter((day) => parseDay(day) <= parseDay(today)))].sort()
  if (unique.length === 0) return firstDay()

  const latest = unique[unique.length - 1]
  const yesterday = shiftCalendarDay(today, -1)
  const checkedToday = latest === today
  if (!checkedToday && latest !== yesterday) return firstDay()

  const end = checkedToday ? today : latest
  const present = new Set(unique)
  let cursor = end
  let runLength = 0
  while (present.has(cursor)) {
    runLength += 1
    cursor = shiftCalendarDay(cursor, -1)
  }

  if (checkedToday) {
    const cycleDay = ((runLength - 1) % CYCLE) + 1
    const delta = rewardForCycleDay(cycleDay)
    return {
      checkedToday: true,
      checkedDays: cycleDay,
      nextDelta: null,
      todayDelta: delta,
      claimDelta: delta,
      claimCycleDay: cycleDay,
    }
  }

  const nextIndex = runLength % CYCLE
  const checkedDays = nextIndex === 0 ? 0 : nextIndex
  const cycleDay = nextIndex === 0 ? 1 : nextIndex + 1
  const delta = rewardForCycleDay(cycleDay)
  return {
    checkedToday: false,
    checkedDays,
    nextDelta: delta,
    todayDelta: null,
    claimDelta: delta,
    claimCycleDay: cycleDay,
  }
}
