import { CHECKIN_POINT_VALUES } from './foundation'

const POINT_VALUES = new Set<number>(CHECKIN_POINT_VALUES)

export type CheckinLedgerEntry = {
  id: string
  delta: number
  label: string
  at: string
}

export type CheckinSnapshot = {
  balance: number
  taipeiDay: string
  checkedToday: boolean
  checkedDays: number
  nextDelta: number | null
  todayDelta: number | null
  entries: CheckinLedgerEntry[]
  replayed?: boolean
  awardedDelta: number | null
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isPoint(value: unknown): value is number {
  return typeof value === 'number' && POINT_VALUES.has(value)
}

export function parseCheckinSnapshot(value: unknown): CheckinSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const { balance, checkedDays, checkedToday, taipeiDay, nextDelta, todayDelta } = row
  if (typeof balance !== 'number' || !Number.isInteger(balance) || balance < 0) return null
  if (typeof checkedDays !== 'number' || !Number.isInteger(checkedDays) || checkedDays < 0 || checkedDays > 7) return null
  if (typeof checkedToday !== 'boolean' || !isDay(taipeiDay)) return null
  if (!(nextDelta === null || isPoint(nextDelta))) return null
  if (!(todayDelta === null || isPoint(todayDelta))) return null
  if (checkedToday) {
    if (checkedDays < 1 || nextDelta !== null || todayDelta === null) return null
  } else if (todayDelta !== null || nextDelta === null || checkedDays > 6) return null
  if (!Array.isArray(row.entries)) return null

  const entries: CheckinLedgerEntry[] = []
  for (const entry of row.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 80 || /[<>]/.test(item.id)) return null
    if (!isPoint(item.delta)) return null
    if (typeof item.label !== 'string' || item.label.length < 1 || item.label.length > 40 || /[<>]/.test(item.label)) return null
    if (!isDay(item.at)) return null
    entries.push({ id: item.id, delta: item.delta, label: item.label, at: item.at })
  }
  if (checkedToday && !entries.some((entry) => entry.at === taipeiDay && entry.delta === todayDelta)) return null

  const awardedDelta = isPoint(row.awardedDelta) ? row.awardedDelta : null
  return {
    balance,
    taipeiDay,
    checkedToday,
    checkedDays,
    nextDelta,
    todayDelta,
    entries,
    replayed: typeof row.replayed === 'boolean' ? row.replayed : undefined,
    awardedDelta,
  }
}

export function checkinFailureMessage(message: string, action: 'read' | 'claim'): string {
  if (/failed to fetch|network|fetch|timeout/i.test(message)) {
    return action === 'claim' ? '網路異常，簽到沒有成功，點數沒有變動' : '網路異常，點數暫時無法讀取'
  }
  if (/jwt|not authenticated|permission denied|請先登入/i.test(message)) return '請先登入'
  if (/PGRST202|schema cache|Could not find the function/i.test(message)) {
    return '簽到功能尚未完成資料庫更新，點數沒有變動'
  }
  if (message.includes('找不到會員')) return '找不到會員，點數沒有變動'
  if (message.includes('簽到沒有成功')) return '簽到沒有成功，點數沒有變動'
  return action === 'claim' ? '簽到沒有成功，點數沒有變動' : '點數暫時無法讀取，不會顯示示範點數'
}
