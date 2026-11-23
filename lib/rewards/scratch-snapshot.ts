import type { CouponKind } from '@/components/seller/coupon-utils'
import { SCRATCH_POINT_VALUES, type ScratchOutcomeKind } from './scratch-rules'

const POINT_VALUES = new Set<number>(SCRATCH_POINT_VALUES)
const OUTCOMES = new Set<string>(['points', 'none', 'coupon_fallback', 'founder_fallback', 'coupon'])
const COUPON_KINDS = new Set<CouponKind>(['cash', 'percent', 'gift', 'freeship'])

export type ScratchCouponSnapshot = {
  holdId: string
  couponId: string
  code: string
  sellerId: string
  sellerName: string
  name: string
  kind: CouponKind
  amount: number
  percent: number
  maxDiscount: number | null
  gift: string
  minSpend: number
  expiresOn: string
}

export type ScratchCardSnapshot = {
  id: string
  slot: 1 | 2
  outcomeKind: ScratchOutcomeKind | 'coupon'
  points: number
  revealed: boolean
  coupon: ScratchCouponSnapshot | null
}

export type ScratchSnapshot = {
  balance: number
  taipeiDay: string
  baseChances: 1
  bonusChances: 0 | 1
  chancesTotal: 1 | 2
  used: number
  chancesLeft: number
  inviteBonusToday: boolean
  replayed: boolean
  awardedDelta: number | null
  card: ScratchCardSnapshot | null
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function readCoupon(value: unknown): ScratchCouponSnapshot | null | undefined {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (!isUuid(row.holdId) || !isUuid(row.couponId) || !isUuid(row.sellerId)) return undefined
  if (typeof row.code !== 'string' || typeof row.sellerName !== 'string' || typeof row.name !== 'string') return undefined
  if (typeof row.kind !== 'string' || !COUPON_KINDS.has(row.kind as CouponKind)) return undefined
  if (typeof row.amount !== 'number' || typeof row.percent !== 'number' || typeof row.minSpend !== 'number') return undefined
  if (row.maxDiscount !== null && typeof row.maxDiscount !== 'number') return undefined
  if (typeof row.gift !== 'string' || !isDay(row.expiresOn)) return undefined
  return {
    holdId: row.holdId,
    couponId: row.couponId,
    code: row.code,
    sellerId: row.sellerId,
    sellerName: row.sellerName,
    name: row.name,
    kind: row.kind as CouponKind,
    amount: row.amount,
    percent: row.percent,
    maxDiscount: row.maxDiscount,
    gift: row.gift,
    minSpend: row.minSpend,
    expiresOn: row.expiresOn,
  }
}

function readCard(value: unknown): ScratchCardSnapshot | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (!isUuid(row.id)) return undefined
  if (row.slot !== 1 && row.slot !== 2) return undefined
  if (typeof row.outcomeKind !== 'string' || !OUTCOMES.has(row.outcomeKind)) return undefined
  if (typeof row.points !== 'number' || !Number.isInteger(row.points)) return undefined
  if (typeof row.revealed !== 'boolean') return undefined
  const coupon = readCoupon(row.coupon)
  if (coupon === undefined) return undefined
  if (row.outcomeKind === 'coupon') {
    if (row.points !== 0 || !coupon) return undefined
  } else if (!POINT_VALUES.has(row.points) || coupon) {
    return undefined
  }
  if (row.outcomeKind === 'none' && row.points !== 3) return undefined
  if (row.outcomeKind === 'coupon_fallback' && row.points !== 20) return undefined
  if (row.outcomeKind === 'founder_fallback' && row.points !== 30) return undefined
  if (row.outcomeKind === 'points' && row.points === 3) return undefined
  return {
    id: row.id,
    slot: row.slot,
    outcomeKind: row.outcomeKind as ScratchCardSnapshot['outcomeKind'],
    points: row.points,
    revealed: row.revealed,
    coupon,
  }
}

export function parseScratchSnapshot(value: unknown): ScratchSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.balance !== 'number' || !Number.isInteger(row.balance) || row.balance < 0) return null
  if (!isDay(row.taipeiDay)) return null
  if (row.baseChances !== 1) return null
  if (row.bonusChances !== 0 && row.bonusChances !== 1) return null
  const bonusChances = row.bonusChances
  const chancesTotal = (1 + bonusChances) as 1 | 2
  if (row.chancesTotal !== chancesTotal) return null
  if (typeof row.used !== 'number' || !Number.isInteger(row.used) || row.used < 0 || row.used > chancesTotal) return null
  if (row.chancesLeft !== chancesTotal - row.used) return null
  if (typeof row.inviteBonusToday !== 'boolean' || row.inviteBonusToday !== (bonusChances === 1)) return null
  if (typeof row.replayed !== 'boolean') return null
  const card = readCard(row.card)
  if (card === undefined) return null
  if (card && card.slot > row.used) return null
  const awardedDelta = row.awardedDelta === null ? null : row.awardedDelta
  if (!(awardedDelta === null || (typeof awardedDelta === 'number' && POINT_VALUES.has(awardedDelta)))) return null
  if (card?.outcomeKind === 'coupon' && awardedDelta !== null) return null
  if (awardedDelta !== null && (row.replayed || !card || card.points !== awardedDelta)) return null
  return {
    balance: row.balance,
    taipeiDay: row.taipeiDay,
    baseChances: 1,
    bonusChances,
    chancesTotal,
    used: row.used,
    chancesLeft: chancesTotal - row.used,
    inviteBonusToday: row.inviteBonusToday,
    replayed: row.replayed,
    awardedDelta,
    card,
  }
}

export function scratchFailureMessage(message: string, action: 'read' | 'draw' | 'reveal'): string {
  if (/permission denied|42501/i.test(message)) return '刮卡權限不足，點數沒有變動。這不是登入狀態問題'
  if (/failed to fetch|network|timeout/i.test(message)) {
    return '網路異常。請再試一次；若剛才已經刮開，會看到同一張結果，不會重複入帳'
  }
  if (/PGRST202|schema cache|Could not find the function/i.test(message)) return '刮卡功能尚未完成資料庫更新，點數沒有變動'
  if (/jwt|not authenticated|請先登入/i.test(message)) return '請先登入'
  if (message.includes('今日刮卡次數已用完')) return '今日刮卡次數已用完，台灣時間 00:00 後再來'
  if (message.includes('邀請加碼次數尚未成立')) return '邀請加碼還沒有成立，這次沒有扣次數'
  if (message.includes('刮卡沒有成功')) return '刮卡沒有成功，點數沒有增加'
  if (message.includes('找不到會員')) return '找不到會員，點數沒有變動'
  if (message.includes('目前沒有可揭曉的刮卡')) return '目前沒有可揭曉的刮卡'
  if (action === 'reveal') return '揭曉狀態沒有保存。請再試一次；已經入帳的點數不會再發一次'
  if (action === 'draw') return '刮卡沒有成功，點數沒有增加'
  return '刮卡狀態暫時無法讀取'
}
