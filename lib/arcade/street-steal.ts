/**
 * 夢想商店街的趣味偷貨與探索商店街。
 * 次數、冷卻、成功率與獎勵都由資料庫 street_steal_settings 回傳，前端不另外寫死；
 * 這裡的判斷只決定按鈕狀態，真正能不能偷、偷到多少，一律以資料庫回覆為準。
 * 偷到的是系統另外生成的夢想金幣，屋主不會少任何東西。
 */
import type { BuildingId } from './street-rules'
import type { FriendState } from './street-help'

export type StealStatus = {
  enabled: boolean
  usedToday: number
  dailyLimit: number
  pairLimit: number
  ownerLimit: number
  cooldownSeconds: number
  cooldownUntil: number | null
  successPercent: number
  coinsMin: number
  coinsMax: number
  xp: number
  unclaimedCoins: number
  unclaimedXp: number
  unclaimedCount: number
}

export type StealLogRow = { nickname: string; outcome: 'success' | 'miss'; coins: number; at: number }

export type MyStreetSteal = { allowSteal: boolean; stolenToday: number; log: StealLogRow[]; steal: StealStatus }

export type StealTarget = { allowSteal: boolean; player: boolean; triedToday: number; ownerToday: number; steal: StealStatus }

export type StealResult = { replay: boolean; outcome: 'success' | 'miss'; coins: number; xp: number; steal: StealStatus }

export type StealClaim = { claimKey: string; replay: boolean; coins: number; xp: number; count: number; names: string[]; steal: StealStatus }

export type ExploreStreet = {
  ownerId: string
  nickname: string
  avatarUrl: string | null
  shopLevel: number
  buildings: BuildingId[]
  likes: number
  todayVisitors: number
  friend: FriendState
  allowSteal: boolean
  triedToday: number
}

export type ExplorePage = { offset: number; hasMore: boolean; streets: ExploreStreet[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const whole = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null

function cleanName(value: unknown) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim() : ''
  return text ? text.slice(0, 20) : '店長'
}

const cleanAvatar = (value: unknown) =>
  typeof value === 'string' && value.length <= 500 && value.startsWith('https://') && value.includes('/member-avatars/') ? value : null

const asObject = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null)

export function parseStealStatus(raw: unknown): StealStatus | null {
  const src = asObject(raw)
  if (!src) return null
  const nums = {
    usedToday: whole(src.usedToday, 0, 1000),
    dailyLimit: whole(src.dailyLimit, 0, 50),
    pairLimit: whole(src.pairLimit, 0, 10),
    ownerLimit: whole(src.ownerLimit, 0, 200),
    cooldownSeconds: whole(src.cooldownSeconds, 0, 86400),
    successPercent: whole(src.successPercent, 0, 100),
    coinsMin: whole(src.coinsMin, 0, 1000),
    coinsMax: whole(src.coinsMax, 0, 1000),
    xp: whole(src.xp, 0, 1000),
    unclaimedCoins: whole(src.unclaimedCoins, 0, 1_000_000),
    unclaimedXp: whole(src.unclaimedXp, 0, 1_000_000),
    unclaimedCount: whole(src.unclaimedCount, 0, 1_000_000),
  }
  if (typeof src.enabled !== 'boolean' || Object.values(nums).some((n) => n == null)) return null
  const until = typeof src.cooldownUntil === 'string' ? Date.parse(src.cooldownUntil) : NaN
  return { enabled: src.enabled, ...(nums as { [K in keyof typeof nums]: number }), cooldownUntil: Number.isFinite(until) ? until : null }
}

const readOutcome = (value: unknown) => (value === 'success' || value === 'miss' ? value : null)

export function parseMyStreetSteal(raw: unknown): MyStreetSteal | null {
  const src = asObject(raw)
  const steal = parseStealStatus(src?.steal)
  const stolenToday = whole(src?.stolenToday, 0, 1_000_000)
  if (!src || src.ok !== true || typeof src.allowSteal !== 'boolean' || !steal || stolenToday == null || !Array.isArray(src.log)) return null
  const log: StealLogRow[] = []
  for (const item of src.log.slice(0, 20)) {
    const row = asObject(item)
    const outcome = readOutcome(row?.outcome)
    const coins = whole(row?.coins, 0, 1000)
    const at = typeof row?.at === 'string' ? Date.parse(row.at) : NaN
    if (!row || !outcome || coins == null || !Number.isFinite(at)) return null
    log.push({ nickname: cleanName(row.nickname), outcome, coins, at })
  }
  return { allowSteal: src.allowSteal, stolenToday, log, steal }
}

export function parseStealTarget(raw: unknown): StealTarget | null {
  const src = asObject(raw)
  const steal = parseStealStatus(src?.steal)
  const triedToday = whole(src?.triedToday, 0, 1000)
  const ownerToday = whole(src?.ownerToday, 0, 1_000_000)
  if (!src || src.ok !== true || typeof src.allowSteal !== 'boolean' || typeof src.player !== 'boolean' || !steal || triedToday == null || ownerToday == null) return null
  return { allowSteal: src.allowSteal, player: src.player, triedToday, ownerToday, steal }
}

export function parseStealResult(raw: unknown): StealResult | null {
  const src = asObject(raw)
  const steal = parseStealStatus(src?.steal)
  const outcome = readOutcome(src?.outcome)
  const coins = whole(src?.coins, 0, 1000)
  const xp = whole(src?.xp, 0, 1000)
  if (!src || src.ok !== true || typeof src.replay !== 'boolean' || !steal || !outcome || coins == null || xp == null) return null
  if (outcome === 'miss' && (coins || xp)) return null
  return { replay: src.replay, outcome, coins, xp, steal }
}

export function parseStealClaim(raw: unknown): StealClaim | null {
  const src = asObject(raw)
  const coins = whole(src?.coins, 0, 1_000_000)
  const xp = whole(src?.xp, 0, 1_000_000)
  const steal = parseStealStatus(src?.steal)
  if (!src || src.ok !== true || coins == null || xp == null || !steal || !Array.isArray(src.entries)) return null
  if (typeof src.claimKey !== 'string' || !UUID_RE.test(src.claimKey) || typeof src.replay !== 'boolean') return null
  const names = [...new Set(src.entries.map((row) => cleanName(asObject(row)?.nickname)))]
  return { claimKey: src.claimKey.toLowerCase(), replay: src.replay, coins, xp, count: src.entries.length, names, steal }
}

const readFriend = (value: unknown): FriendState | null =>
  value === 'none' || value === 'outgoing' || value === 'incoming' || value === 'accepted' ? value : null

export function parseExplorePage(raw: unknown): ExplorePage | null {
  const src = asObject(raw)
  const offset = whole(src?.offset, 0, 1000)
  if (!src || src.ok !== true || offset == null || typeof src.hasMore !== 'boolean' || !Array.isArray(src.streets)) return null
  const streets: ExploreStreet[] = []
  for (const item of src.streets.slice(0, 50)) {
    const row = asObject(item)
    if (!row || typeof row.ownerId !== 'string' || !UUID_RE.test(row.ownerId)) return null
    const shopLevel = whole(row.shopLevel, 1, 5)
    const likes = whole(row.likes, 0, 1_000_000_000)
    const todayVisitors = whole(row.todayVisitors, 0, 1_000_000_000)
    const triedToday = whole(row.triedToday, 0, 1000)
    const friend = readFriend(row.friend)
    if (shopLevel == null || likes == null || todayVisitors == null || triedToday == null || !friend || typeof row.allowSteal !== 'boolean') return null
    const buildings = Array.isArray(row.buildings) ? row.buildings.filter((id): id is BuildingId => id === 'tea' || id === 'gift') : []
    streets.push({
      ownerId: row.ownerId.toLowerCase(),
      nickname: cleanName(row.nickname),
      avatarUrl: cleanAvatar(row.avatarUrl),
      shopLevel,
      buildings,
      likes,
      todayVisitors,
      friend,
      allowSteal: row.allowSteal,
      triedToday,
    })
  }
  return { offset, hasMore: src.hasMore, streets }
}

export type StealGate = { ok: true; left: number } | { ok: false; reason: string }

/** 只決定按鈕能不能按；資料庫會再檢查公開狀態、屋主開關、參與資格、次數與冷卻。 */
export function stealGate(target: StealTarget | null, now: number): StealGate {
  if (!target) return { ok: false, reason: '讀取中' }
  const s = target.steal
  if (!s.enabled) return { ok: false, reason: '趣味偷貨暫停中' }
  if (!target.allowSteal) return { ok: false, reason: '屋主沒有開放偷貨' }
  if (target.triedToday >= s.pairLimit) return { ok: false, reason: '今天已經來偷過了' }
  if (s.usedToday >= s.dailyLimit) return { ok: false, reason: `今天的 ${s.dailyLimit} 次已用完` }
  if (target.ownerToday >= s.ownerLimit) return { ok: false, reason: '這條街今天被偷太多次了' }
  if (s.cooldownUntil && s.cooldownUntil > now) return { ok: false, reason: `冷卻中，${Math.ceil((s.cooldownUntil - now) / 1000)} 秒` }
  return { ok: true, left: s.dailyLimit - s.usedToday }
}

const REASONS: Record<string, string> = {
  self: '不能偷自己的商店街',
  closed: '這條商店街沒有公開',
  owner_off: '屋主沒有開放趣味偷貨',
  not_player: '先建立自己的商店街才能偷貨',
  already: '今天已經來這條街偷過了',
  limit: '今天的偷貨次數已用完，明天再來',
  owner_full: '這條街今天被偷太多次了，換一家吧',
  cooldown: '手腳太快了，冷卻中稍等一下',
  disabled: '趣味偷貨暫停中',
  invalid: '請求不正確，請重新整理',
}

export const stealReasonText = (reason: unknown) => (typeof reason === 'string' && REASONS[reason]) || '這次沒有完成，請稍後再試'
