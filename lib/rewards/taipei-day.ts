/**
 * 台北日曆日的對照實作，用來測試與未來畫面顯示。
 * 發獎不得呼叫這支函式決定資格。資格只認 Supabase 的 public.taipei_today()，
 * 該函式使用資料庫交易時鐘與 Asia/Taipei，不讀取瀏覽器時間。
 */
export const TAIPEI_TIME_ZONE = 'Asia/Taipei'

export const TAIPEI_DAY_VECTORS = [
  { iso: '2026-10-22T00:00:00.000Z', day: '2026-10-22' },
  { iso: '2026-10-21T16:00:00.000Z', day: '2026-10-22' },
  { iso: '2026-10-22T15:59:59.000Z', day: '2026-10-22' },
  { iso: '2026-10-22T16:00:00.000Z', day: '2026-10-23' },
] as const

export function taipeiCalendarDate(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new Error('無法計算台北日期')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    numberingSystem: 'latn',
  }).formatToParts(instant)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error('無法計算台北日期')
  return `${year}-${month}-${day}`
}
