/**
 * 夢想商店街的公開展示。只從私人進度抽出店面、裝潢與街區，
 * 金幣、庫存、訂單、經驗與經營紀錄留在本機 v3 存檔，不進公開街景。
 * 按讚與拜訪的去重規則在這裡先寫死，資料庫草案必須用同一套規則。
 */
import { EMPTY_NAV, marketplaceHref } from '@/lib/marketplace-url'
import {
  MAX_SHOP_LEVEL,
  STREET_SAVE_VERSION,
  parseStreet,
  type BuildingId,
  type DecorId,
  type EquippedDecor,
  type StreetProgress,
} from './street-rules'

export type StreetExhibit = {
  shopLevel: number
  buildings: BuildingId[]
  equipped: EquippedDecor
}

export type MyStreetSocial = {
  published: boolean
  likes: number
  visitors: number
  todayVisitors: number
  revision: number
  updatedAt: string | null
  exhibit: StreetExhibit | null
}

export type PublicStreet = {
  ownerId: string
  nickname: string
  avatarUrl: string | null
  avatarTone: number
  likes: number
  likedByMe: boolean
  visitors: number
  todayVisitors: number
  revision: number
  updatedAt: string | null
  exhibit: StreetExhibit
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const whole = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null
  return value
}

/** 公開連結只帶街景頁與會員編號，不帶搜尋、賣家後台或其他遊戲。 */
export function streetVisitHref(pathname: string, ownerId: string) {
  return marketplaceHref(pathname, { ...EMPTY_NAV, page: 'arcade', game: 'street', visit: ownerId })
}

export function projectStreetExhibit(progress: Pick<StreetProgress, 'shopLevel' | 'buildings' | 'equipped'>): StreetExhibit | null {
  const shopLevel = whole(progress.shopLevel, 1, MAX_SHOP_LEVEL)
  if (shopLevel == null) return null
  const parsed = parseStreet({
    v: STREET_SAVE_VERSION,
    createdAt: 0,
    shopLevel,
    coins: 0,
    xp: 0,
    open: false,
    stock: {},
    jobs: [],
    stats: {},
    today: {},
    log: [],
    tutorial: 4,
    buildings: progress.buildings,
    ownedDecors: decorIds(progress.equipped),
    equipped: progress.equipped,
  })
  if (!parsed || parsed.shopLevel !== shopLevel) return null
  return { shopLevel: parsed.shopLevel, buildings: parsed.buildings, equipped: parsed.equipped }
}

/** 訪客畫面上的街。營業開關關掉，避免把屋主的顧客、訂單和收益算進這台裝置。 */
export function exhibitStreet(exhibit: StreetExhibit): StreetProgress {
  const parsed = parseStreet({
    v: STREET_SAVE_VERSION,
    createdAt: 0,
    shopLevel: exhibit.shopLevel,
    coins: 0,
    xp: 0,
    open: false,
    stock: {},
    jobs: [],
    stats: {},
    today: {},
    log: [],
    tutorial: 4,
    buildings: exhibit.buildings,
    ownedDecors: decorIds(exhibit.equipped),
    equipped: exhibit.equipped,
  })
  if (!parsed) throw new Error('公開街景無法顯示')
  return parsed
}

export function exhibitSig(exhibit: StreetExhibit) {
  const shops = (['main', 'tea', 'gift'] as const).map((id) => `${id}:${exhibit.equipped.shops[id] ?? ''}`).join(',')
  return `${exhibit.shopLevel}|${exhibit.buildings.join(',')}|${exhibit.equipped.street ?? ''}|${shops}`
}

function decorIds(equipped: EquippedDecor | null | undefined): DecorId[] {
  if (!equipped) return []
  const ids = Object.values(equipped.shops ?? {})
  if (equipped.street) ids.push(equipped.street)
  return ids.filter((id): id is DecorId => typeof id === 'string')
}

function cleanNickname(value: unknown) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim() : ''
  return text ? text.slice(0, 20) : '店長'
}

function cleanAvatar(value: unknown) {
  if (typeof value !== 'string' || value.length > 500) return null
  if (!value.startsWith('https://') || !value.includes('/member-avatars/')) return null
  return value
}

function readExhibit(src: Record<string, unknown>): StreetExhibit | null {
  if (typeof src.shopLevel !== 'number') return null
  const equipped = src.equipped && typeof src.equipped === 'object' ? src.equipped as EquippedDecor : { street: null, shops: {} }
  return projectStreetExhibit({
    shopLevel: src.shopLevel,
    buildings: Array.isArray(src.buildings) ? src.buildings as BuildingId[] : [],
    equipped,
  })
}

export function parseMyStreetSocial(raw: unknown): MyStreetSocial | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  if (src.ok !== true || typeof src.published !== 'boolean') return null
  const likes = whole(src.likes, 0, 1_000_000_000)
  const visitors = whole(src.visitors, 0, 1_000_000_000)
  const todayVisitors = whole(src.todayVisitors, 0, 1_000_000_000)
  const revision = whole(src.revision, 0, 1_000_000_000)
  if (likes == null || visitors == null || todayVisitors == null || revision == null) return null
  const exhibit = src.shopLevel == null ? null : readExhibit(src)
  if (src.shopLevel != null && !exhibit) return null
  if (src.published && !exhibit) return null
  const updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : null
  return { published: src.published, likes, visitors, todayVisitors, revision, updatedAt, exhibit }
}

export function parsePublicStreet(raw: unknown, expectedOwner: string): PublicStreet | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  if (src.ok !== true || typeof src.ownerId !== 'string') return null
  if (!UUID_RE.test(expectedOwner) || src.ownerId.toLowerCase() !== expectedOwner.toLowerCase()) return null
  const mine = parseMyStreetSocial({ ...src, published: true })
  if (!mine?.exhibit || typeof src.likedByMe !== 'boolean') return null
  return {
    ownerId: src.ownerId.toLowerCase(),
    nickname: cleanNickname(src.nickname),
    avatarUrl: cleanAvatar(src.avatarUrl),
    avatarTone: whole(src.avatarTone, 0, 5) ?? 0,
    likes: mine.likes,
    likedByMe: src.likedByMe,
    visitors: mine.visitors,
    todayVisitors: mine.todayVisitors,
    revision: mine.revision,
    updatedAt: mine.updatedAt,
    exhibit: mine.exhibit,
  }
}

/** 沒有紀錄時第一次按是讚；已經是讚就取消。同一會員不會有第二列。 */
export function nextLikeActive(current: boolean | null) {
  return current !== true
}

export function activeLikeCount(rows: readonly { memberId: string; active: boolean }[]) {
  const seen = new Set<string>()
  let count = 0
  for (const row of rows) {
    if (seen.has(row.memberId)) continue
    seen.add(row.memberId)
    if (row.active) count += 1
  }
  return count
}

export type VisitMark = { memberId: string; day: string }

/** 屋主自己不算。同一會員在同一個台北日再進同一條街，也不再加一次。 */
export function recordVisit(ownerId: string, memberId: string, day: string, seen: readonly VisitMark[]) {
  if (!ownerId || !memberId || ownerId === memberId) return { counted: false, seen: [...seen] }
  if (seen.some((row) => row.memberId === memberId && row.day === day)) return { counted: false, seen: [...seen] }
  return { counted: true, seen: [...seen, { memberId, day }] }
}

export function visitorStats(seen: readonly VisitMark[], today: string) {
  return {
    visitors: new Set(seen.map((row) => row.memberId)).size,
    todayVisitors: seen.filter((row) => row.day === today).length,
  }
}
