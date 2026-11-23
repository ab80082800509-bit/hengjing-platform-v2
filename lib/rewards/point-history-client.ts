/**
 * 會員中心的完整點數流水只呼叫 get_my_point_history。
 * 不傳會員編號，也不在瀏覽器改餘額或重算點數。
 */
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from './member-session'

export const POINT_HISTORY_PAGE_SIZE = 20

export type PointHistoryItem = {
  id: string
  date: string
  at: string
  source: string
  delta: number
  balanceAfter: number
}

export type PointHistoryCursor = {
  at: string
  id: string
}

export type PointHistoryPage = {
  rows: PointHistoryItem[]
  next: PointHistoryCursor | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

export function parsePointHistoryPage(value: unknown): PointHistoryPage | null {
  if (!isRecord(value) || !Array.isArray(value.rows)) return null
  const rows: PointHistoryItem[] = []
  for (const raw of value.rows) {
    if (!isRecord(raw)) return null
    const id = typeof raw.id === 'string' ? raw.id : ''
    const date = typeof raw.date === 'string' ? raw.date : ''
    const at = typeof raw.at === 'string' ? raw.at : ''
    const source = typeof raw.source === 'string' ? raw.source : ''
    const delta = wholeNumber(raw.delta)
    const balanceAfter = wholeNumber(raw.balanceAfter)
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !at || !source || delta == null || balanceAfter == null) return null
    rows.push({ id, date, at, source, delta, balanceAfter })
  }
  if (value.next == null) return { rows, next: null }
  if (!isRecord(value.next)) return null
  const at = typeof value.next.at === 'string' ? value.next.at : ''
  const id = typeof value.next.id === 'string' ? value.next.id : ''
  if (!at || !id) return null
  return { rows, next: { at, id } }
}

export async function fetchMyPointHistory(
  cursor?: PointHistoryCursor | null,
  uiUserId?: string | null,
): Promise<{ data: PointHistoryPage | null; error: string | null }> {
  const session = await memberAccessToken(uiUserId)
  if (!session.token || session.userMatch === false) {
    return { data: null, error: '請先登入' }
  }
  const args: Record<string, unknown> = { p_limit: POINT_HISTORY_PAGE_SIZE }
  if (cursor) {
    args.p_before_created_at = cursor.at
    args.p_before_id = cursor.id
  }
  try {
    const { data, error } = await supabase.rpc('get_my_point_history', args).setHeader('Authorization', `Bearer ${session.token}`)
    if (error) return { data: null, error: '點數紀錄暫時無法讀取' }
    const payload = typeof data === 'string' ? JSON.parse(data) as unknown : data
    const page = parsePointHistoryPage(payload)
    if (!page) return { data: null, error: '點數紀錄暫時無法讀取' }
    return { data: page, error: null }
  } catch {
    return { data: null, error: '點數紀錄暫時無法讀取' }
  }
}
