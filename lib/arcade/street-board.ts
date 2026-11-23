/**
 * 夢想商店街社交排行榜。名次與成績全部由資料庫 get_street_leaderboard 從互助、偷貨原始紀錄統計，
 * 前端只送「看哪一種榜」，不送任何分數、名次或會員編號。
 * 商店街經營排行沒有可信的伺服器數據（等級與店面來自瀏覽器存檔），所以沒有對應的資料庫榜單。
 */

export type BoardKind = 'business' | 'help' | 'steal'
export type ServerBoardKind = Exclude<BoardKind, 'business'>
export type BoardScope = 'global' | 'friends'
export type BoardPeriod = 'week' | 'last_week' | 'all'

export type BoardRow = {
  rank: number
  userId: string | null
  nickname: string
  avatarUrl: string | null
  score: number
  extra: number
  me: boolean
  published: boolean
}

export type BoardMe = { rank: number | null; score: number; extra: number; listed: boolean; published: boolean }

export type StreetBoard = {
  board: ServerBoardKind
  scope: BoardScope
  period: BoardPeriod
  weekStart: string | null
  weekEnd: string | null
  nextWeekAt: number
  total: number
  rows: BoardRow[]
  me: BoardMe | null
}

export const BOARD_KINDS: { id: BoardKind; label: string }[] = [
  { id: 'business', label: '經營' },
  { id: 'help', label: '互助' },
  { id: 'steal', label: '偷貨' },
]

export const BOARD_SCOPES: { id: BoardScope; label: string }[] = [
  { id: 'global', label: '全站' },
  { id: 'friends', label: '好友' },
]

export const BOARD_PERIODS: { id: BoardPeriod; label: string }[] = [
  { id: 'week', label: '本週' },
  { id: 'last_week', label: '上週' },
  { id: 'all', label: '累計' },
]

export const BOARD_TEXT: Record<ServerBoardKind, { score: string; extra: string }> = {
  help: { score: '幫忙', extra: '被幫忙' },
  steal: { score: '成功', extra: '失手' },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const whole = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null

function cleanName(value: unknown) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim() : ''
  return text ? text.slice(0, 20) : '店長'
}

const cleanAvatar = (value: unknown) =>
  typeof value === 'string' && value.length <= 500 && value.startsWith('https://') && value.includes('/member-avatars/') ? value : null

const asObject = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null)

const readDay = (value: unknown) => (typeof value === 'string' && DAY_RE.test(value) ? value : null)

/** expect 是這次請求的榜單種類；回應對不上就丟掉，避免快速切換時把別的榜畫上來。 */
export function parseStreetBoard(raw: unknown, expect: { board: ServerBoardKind; scope: BoardScope; period: BoardPeriod }): StreetBoard | null {
  const src = asObject(raw)
  if (!src || src.ok !== true) return null
  if (src.board !== expect.board || src.scope !== expect.scope || src.period !== expect.period) return null
  const total = whole(src.total, 0, 10_000_000)
  const nextWeekAt = typeof src.nextWeekAt === 'string' ? Date.parse(src.nextWeekAt) : NaN
  const weekStart = readDay(src.weekStart)
  const weekEnd = readDay(src.weekEnd)
  if (total == null || !Number.isFinite(nextWeekAt) || !Array.isArray(src.rows)) return null
  if (expect.period !== 'all' && (!weekStart || !weekEnd)) return null

  const rows: BoardRow[] = []
  for (const item of src.rows.slice(0, 50)) {
    const row = asObject(item)
    const rank = whole(row?.rank, 1, 10_000_000)
    const score = whole(row?.score, 0, 10_000_000)
    const extra = whole(row?.extra, 0, 10_000_000)
    if (!row || rank == null || score == null || extra == null || typeof row.me !== 'boolean' || typeof row.published !== 'boolean') return null
    const userId = row.published && typeof row.userId === 'string' && UUID_RE.test(row.userId) ? row.userId.toLowerCase() : null
    rows.push({ rank, userId, nickname: cleanName(row.nickname), avatarUrl: cleanAvatar(row.avatarUrl), score, extra, me: row.me, published: row.published })
  }

  let me: BoardMe | null = null
  const mine = asObject(src.me)
  if (mine) {
    const score = whole(mine.score, 0, 10_000_000)
    const extra = whole(mine.extra, 0, 10_000_000)
    const rank = mine.rank == null ? null : whole(mine.rank, 1, 10_000_000)
    if (score == null || extra == null || typeof mine.listed !== 'boolean' || typeof mine.published !== 'boolean') return null
    if (mine.listed && rank == null) return null
    me = { rank: mine.listed ? rank : null, score, extra, listed: mine.listed, published: mine.published }
  }

  return { board: expect.board, scope: expect.scope, period: expect.period, weekStart, weekEnd, nextWeekAt, total, rows, me }
}

/** 2026-10-26 → 10/26 */
export const shortDay = (day: string | null) => (day ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : '')

const REASONS: Record<string, string> = {
  invalid: '排行榜請求不正確，請重新整理',
}

export const boardReasonText = (reason: unknown) => (typeof reason === 'string' && REASONS[reason]) || '排行榜暫時無法讀取，請稍後再試'
