/**
 * 夢想商店街好友互助的讀取與畫面判斷。
 * 次數、冷卻與獎勵數值都由資料庫 street_help_settings 回傳，前端不另外寫死，
 * 這裡的判斷只決定按鈕狀態；真正能不能幫、能不能領，一律以資料庫回覆為準。
 */

export type StreetFriend = {
  userId: string
  nickname: string
  avatarUrl: string | null
  published: boolean
  helpedToday: boolean
  helpedMeToday: boolean
}

export type StreetHelpStatus = {
  enabled: boolean
  usedToday: number
  dailyLimit: number
  receivedToday: number
  receiveLimit: number
  cooldownSeconds: number
  cooldownUntil: number | null
  requestLimit: number
  maxFriends: number
  helperCoins: number
  helperXp: number
  ownerCoins: number
  unclaimedCoins: number
  unclaimedXp: number
  unclaimedCount: number
}

export type MyStreetFriends = {
  friends: StreetFriend[]
  incoming: StreetFriend[]
  outgoing: StreetFriend[]
  help: StreetHelpStatus
}

export type FriendState = 'none' | 'outgoing' | 'incoming' | 'accepted'

export type HelpClaim = { claimKey: string; replay: boolean; coins: number; xp: number; count: number; names: string[]; help: StreetHelpStatus }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const whole = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null

function cleanName(value: unknown) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim() : ''
  return text ? text.slice(0, 20) : '店長'
}

function readFriend(raw: unknown): StreetFriend | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  if (typeof src.userId !== 'string' || !UUID_RE.test(src.userId)) return null
  const avatar = typeof src.avatarUrl === 'string' && src.avatarUrl.startsWith('https://') && src.avatarUrl.includes('/member-avatars/') ? src.avatarUrl : null
  return {
    userId: src.userId.toLowerCase(),
    nickname: cleanName(src.nickname),
    avatarUrl: avatar,
    published: src.published === true,
    helpedToday: src.helpedToday === true,
    helpedMeToday: src.helpedMeToday === true,
  }
}

function readList(raw: unknown) {
  if (!Array.isArray(raw)) return null
  const out: StreetFriend[] = []
  for (const item of raw.slice(0, 500)) {
    const friend = readFriend(item)
    if (!friend) return null
    out.push(friend)
  }
  return out
}

export function parseHelpStatus(raw: unknown): StreetHelpStatus | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  const nums = {
    usedToday: whole(src.usedToday, 0, 1000),
    dailyLimit: whole(src.dailyLimit, 0, 50),
    receivedToday: whole(src.receivedToday, 0, 1000),
    receiveLimit: whole(src.receiveLimit, 0, 100),
    cooldownSeconds: whole(src.cooldownSeconds, 0, 86400),
    requestLimit: whole(src.requestLimit, 0, 50),
    maxFriends: whole(src.maxFriends, 1, 500),
    helperCoins: whole(src.helperCoins, 0, 1000),
    helperXp: whole(src.helperXp, 0, 1000),
    ownerCoins: whole(src.ownerCoins, 0, 1000),
    unclaimedCoins: whole(src.unclaimedCoins, 0, 1_000_000),
    unclaimedXp: whole(src.unclaimedXp, 0, 1_000_000),
    unclaimedCount: whole(src.unclaimedCount, 0, 1_000_000),
  }
  if (typeof src.enabled !== 'boolean' || Object.values(nums).some((n) => n == null)) return null
  const until = typeof src.cooldownUntil === 'string' ? Date.parse(src.cooldownUntil) : NaN
  return { enabled: src.enabled, ...(nums as { [K in keyof typeof nums]: number }), cooldownUntil: Number.isFinite(until) ? until : null }
}

export function parseMyStreetFriends(raw: unknown): MyStreetFriends | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  if (src.ok !== true) return null
  const friends = readList(src.friends)
  const incoming = readList(src.incoming)
  const outgoing = readList(src.outgoing)
  const help = parseHelpStatus(src.help)
  if (!friends || !incoming || !outgoing || !help) return null
  return { friends, incoming, outgoing, help }
}

export function parseHelpClaim(raw: unknown): HelpClaim | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  const coins = whole(src.coins, 0, 1_000_000)
  const xp = whole(src.xp, 0, 1_000_000)
  const help = parseHelpStatus(src.help)
  if (src.ok !== true || coins == null || xp == null || !help || !Array.isArray(src.entries)) return null
  if (typeof src.claimKey !== 'string' || !UUID_RE.test(src.claimKey) || typeof src.replay !== 'boolean') return null
  const names = [...new Set(src.entries.map((row) => cleanName((row as Record<string, unknown> | null)?.nickname)))]
  return { claimKey: src.claimKey.toLowerCase(), replay: src.replay, coins, xp, count: src.entries.length, names, help }
}

export function friendStateOf(list: MyStreetFriends | null, userId: string): FriendState {
  if (!list) return 'none'
  const id = userId.toLowerCase()
  if (list.friends.some((row) => row.userId === id)) return 'accepted'
  if (list.incoming.some((row) => row.userId === id)) return 'incoming'
  if (list.outgoing.some((row) => row.userId === id)) return 'outgoing'
  return 'none'
}

export type HelpGate = { ok: true } | { ok: false; reason: string }

/** 只決定按鈕能不能按；資料庫會再檢查一次好友關係、次數、冷卻與屋主上限。 */
export function helpGate(list: MyStreetFriends | null, ownerId: string, now: number): HelpGate {
  if (!list) return { ok: false, reason: '讀取好友中' }
  const friend = list.friends.find((row) => row.userId === ownerId.toLowerCase())
  if (!friend) return { ok: false, reason: '成為好友後才能幫忙' }
  const h = list.help
  if (!h.enabled) return { ok: false, reason: '好友互助暫停中' }
  if (friend.helpedToday) return { ok: false, reason: '今天已經幫過這位好友' }
  if (h.usedToday >= h.dailyLimit) return { ok: false, reason: `今天的 ${h.dailyLimit} 次幫忙已用完` }
  if (h.cooldownUntil && h.cooldownUntil > now) return { ok: false, reason: `休息一下，${Math.ceil((h.cooldownUntil - now) / 1000)} 秒後再幫` }
  return { ok: true }
}

const REASONS: Record<string, string> = {
  self: '不能幫自己或加自己為好友',
  closed: '這條商店街沒有公開',
  pending: '邀請已送出，等對方回覆',
  duplicate: '今天已經邀請過這位會員',
  limit: '今天的次數已用完，明天再來',
  full: '好友人數已達上限',
  missing: '找不到這筆邀請',
  not_friend: '成為好友後才能幫忙',
  already: '今天已經幫過這位好友',
  owner_full: '這位好友今天收到的幫忙已滿',
  cooldown: '幫得太快了，稍等一下再幫',
  disabled: '好友互助暫停中',
  invalid: '請求不正確，請重新整理',
}

export const helpReasonText = (reason: unknown) => (typeof reason === 'string' && REASONS[reason]) || '這次沒有完成，請稍後再試'
