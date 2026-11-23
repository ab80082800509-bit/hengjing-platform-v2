import type { CouponKind } from '@/components/seller/coupon-utils'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = new Set<CouponKind>(['cash', 'percent', 'gift', 'freeship'])
const SOURCES = new Set(['shelf', 'points', 'scratch'])

export type SellerCouponRecord = {
  id: string
  sellerId: string
  code: string
  name: string
  kind: CouponKind
  amount: number
  percent?: number
  maxDiscount?: number
  gift?: string
  minSpend: number
  qty: number
  redeemed: number
  usedOrders: number
  listed: boolean
  shelf: boolean
  cost: number
  active: boolean
  deleted: boolean
  startAt: string
  endAt: string
}

export type WalletCouponRecord = {
  id: string
  couponId: string
  code: string
  sellerId: string
  sellerName: string
  source: 'shelf' | 'points' | 'scratch'
  kind: CouponKind
  amount: number
  percent?: number
  maxDiscount?: number
  gift?: string
  minSpend: number
  claimedAt: string
  expiresAt: string
  status: 'unused' | 'expired'
}

export type CouponClaimResult = {
  replayed: boolean
  balance: number
  hold: WalletCouponRecord
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function day(value: unknown): string | null {
  return typeof value === 'string' && DAY.test(value) ? value : null
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function benefit(row: Record<string, unknown>): Pick<SellerCouponRecord, 'kind' | 'amount' | 'percent' | 'maxDiscount' | 'gift' | 'minSpend'> | null {
  const kind = text(row.kind)
  if (!kind || !KINDS.has(kind as CouponKind)) return null
  const amount = whole(row.amount)
  const minSpend = whole(row.minSpend)
  if (amount === null || amount < 0 || minSpend === null || minSpend < 1) return null
  const percent = row.percent === undefined || row.percent === null ? 0 : whole(row.percent)
  if (percent === null || percent < 0) return null
  const maxDiscount = row.maxDiscount === undefined || row.maxDiscount === null ? undefined : whole(row.maxDiscount)
  if (maxDiscount === null || (maxDiscount !== undefined && maxDiscount < 1)) return null
  const gift = row.gift === undefined || row.gift === null || row.gift === '' ? '' : text(row.gift)
  if (gift === null) return null
  if (kind === 'gift' && gift === '') return null
  return { kind: kind as CouponKind, amount, percent: percent || undefined, maxDiscount, gift: gift || undefined, minSpend }
}

export function parseSellerCoupon(value: unknown): SellerCouponRecord | null {
  const row = record(value)
  if (!row) return null
  const id = uuid(row.id)
  const sellerId = uuid(row.sellerId)
  const code = text(row.code)
  const name = text(row.name)
  const fields = benefit(row)
  const qty = whole(row.qty)
  const redeemed = whole(row.redeemed)
  const startAt = day(row.startAt)
  const endAt = day(row.endAt)
  if (!id || !sellerId || !code || !name || !fields || qty === null || qty < 1 || redeemed === null || redeemed < 0 || redeemed > qty) return null
  if (!startAt || !endAt || typeof row.listed !== 'boolean' || typeof row.shelf !== 'boolean' || typeof row.active !== 'boolean') return null
  if (row.usedOrders !== 0 || row.cost !== 100) return null
  return {
    id,
    sellerId,
    code,
    name,
    ...fields,
    qty,
    redeemed,
    usedOrders: 0,
    listed: row.listed,
    shelf: row.shelf,
    cost: 100,
    active: row.active,
    deleted: row.deleted === true,
    startAt,
    endAt,
  }
}

export function parseSellerCouponList(value: unknown): SellerCouponRecord[] | null {
  if (!Array.isArray(value)) return null
  const rows: SellerCouponRecord[] = []
  for (const item of value) {
    const parsed = parseSellerCoupon(item)
    if (!parsed) return null
    rows.push(parsed)
  }
  return rows
}

export function parseWalletCoupon(value: unknown): WalletCouponRecord | null {
  const row = record(value)
  if (!row) return null
  const id = uuid(row.id)
  const couponId = uuid(row.couponId)
  const sellerId = uuid(row.sellerId)
  const code = text(row.code)
  const sellerName = text(row.sellerName)
  const source = text(row.source)
  const fields = benefit(row)
  const claimedAt = day(row.claimedAt)
  const expiresAt = day(row.expiresAt)
  if (!id || !couponId || !sellerId || !code || !sellerName || !source || !SOURCES.has(source) || !fields || !claimedAt || !expiresAt) return null
  if (row.status !== 'unused' && row.status !== 'expired') return null
  if (expiresAt < claimedAt) return null
  return {
    id,
    couponId,
    code,
    sellerId,
    sellerName,
    source: source as WalletCouponRecord['source'],
    ...fields,
    claimedAt,
    expiresAt,
    status: row.status,
  }
}

export function parseWalletList(value: unknown): WalletCouponRecord[] | null {
  if (!Array.isArray(value)) return null
  const rows: WalletCouponRecord[] = []
  for (const item of value) {
    const parsed = parseWalletCoupon(item)
    if (!parsed) return null
    rows.push(parsed)
  }
  return rows
}

export function parseCouponClaim(value: unknown): CouponClaimResult | null {
  const row = record(value)
  if (!row || typeof row.replayed !== 'boolean') return null
  const balance = whole(row.balance)
  const hold = parseWalletCoupon(row.hold)
  if (balance === null || balance < 0 || !hold) return null
  return { replayed: row.replayed, balance, hold }
}

export type CouponPointOffer = {
  couponId: string
  enabled: boolean
  pointsCost: number
  pointsQty: number
  pointsIssued: number
  endsOn: string
}

export type PointOfferCoupon = SellerCouponRecord & { sellerName: string; held: boolean; offer: CouponPointOffer }

export type PointOfferMall = { balance: number; coupons: PointOfferCoupon[] }

export type PointOfferClaimResult = CouponClaimResult & { cost: number }

export function parseCouponPointOffer(value: unknown): CouponPointOffer | null {
  const row = record(value)
  if (!row) return null
  const couponId = uuid(row.couponId)
  const pointsCost = whole(row.pointsCost)
  const pointsQty = whole(row.pointsQty)
  const pointsIssued = whole(row.pointsIssued)
  const endsOn = day(row.endsOn)
  if (!couponId || typeof row.enabled !== 'boolean' || !endsOn) return null
  if (pointsCost === null || pointsCost < 1 || pointsQty === null || pointsQty < 1 || pointsIssued === null || pointsIssued < 0 || pointsIssued > pointsQty) return null
  return { couponId, enabled: row.enabled, pointsCost, pointsQty, pointsIssued, endsOn }
}

export function parseCouponPointOfferList(value: unknown): CouponPointOffer[] | null {
  if (!Array.isArray(value)) return null
  const rows: CouponPointOffer[] = []
  for (const item of value) {
    const parsed = parseCouponPointOffer(item)
    if (!parsed) return null
    rows.push(parsed)
  }
  return rows
}

export function parsePointOfferMall(value: unknown): PointOfferMall | null {
  const row = record(value)
  if (!row || !Array.isArray(row.coupons) || row.coupons.length > 60) return null
  const balance = whole(row.balance)
  if (balance === null || balance < 0) return null
  const coupons: PointOfferCoupon[] = []
  for (const item of row.coupons) {
    const coupon = parseSellerCoupon(item)
    const extra = record(item)
    const offer = parseCouponPointOffer(extra?.offer)
    if (!coupon || !extra || !offer || offer.couponId !== coupon.id || typeof extra.held !== 'boolean') return null
    coupons.push({ ...coupon, sellerName: text(extra.sellerName) ?? '商家', held: extra.held, offer })
  }
  return { balance, coupons }
}

export function parsePointOfferClaim(value: unknown): PointOfferClaimResult | null {
  const base = parseCouponClaim(value)
  const cost = whole(record(value)?.cost)
  if (!base || cost === null || cost < 1) return null
  return { ...base, cost }
}

export function pointOfferFailureMessage(message: string): string {
  if (/PGRST202|PGRST205|schema cache|Could not find the function/i.test(message)) return '賣家授權點數兌換還沒套用到目前資料庫，點數與優惠券都沒有變更'
  if (/permission denied|42501/i.test(message)) return '點數兌換權限不足，點數與庫存沒有變更'
  if (/failed to fetch|network|timeout/i.test(message)) return '網路異常。請再試一次；若剛才已經成功，重新整理會看到同一筆，不會重複扣點'
  if (/jwt|not authenticated|請先登入/i.test(message)) return '請先登入'
  for (const known of [
    '尚未通過賣家審核',
    '找不到此折價券',
    '不能管理其他商家的優惠券',
    '點數兌換設定不正確',
    '兌換所需點數需介於 1–100,000 點',
    '可兌換數量需介於 1–10,000 張',
    '可兌換數量不可超過發行總數量',
    '可兌換數量不可低於已兌換數量',
    '點數兌換截止日不可晚於優惠券結束日',
    '點數兌換截止日不可早於今天',
    '請先上架此優惠券，再開放點數兌換',
    '此優惠券未開放 Pay 點數兌換',
    '此優惠券的點數兌換已過期',
    '此優惠券的點數兌換已兌完',
    '兌換所需點數已變更，請重新整理後再確認',
    '不能兌換自己賣場的優惠券',
    '您已領取過此優惠券',
    '點數不足',
  ]) {
    if (message.includes(known)) return known
  }
  return '點數兌換沒有完成，點數與庫存沒有變更'
}

export function couponFailureMessage(message: string): string {
  if (/permission denied|42501/i.test(message)) return '優惠券權限不足，點數與庫存沒有變更。這不是登入狀態問題'
  if (/failed to fetch|network|timeout/i.test(message)) return '網路異常。請再試一次；若剛才已經成功，重新整理會看到同一筆，不會重複扣點或超發'
  if (/PGRST202|schema cache|Could not find the function/i.test(message)) return '優惠券功能尚未完成資料庫更新'
  if (/jwt|not authenticated|請先登入/i.test(message)) return '請先登入'
  for (const known of [
    '尚未通過賣家審核',
    '找不到此折價券',
    '不能管理其他商家的優惠券',
    '此折扣碼已被使用，請換一組',
    '已有會員領取，不能修改使用條件',
    '已經開始的優惠券不能改開始日期',
    '發行數量不可低於已領取數量',
    '每家店最多同時上架 3 張到簽到專區',
    '此優惠券目前無法領取',
    '此優惠券已被領完',
    '您已領取過此優惠券',
    '點數不足',
    '優惠券兌換沒有完成，點數與庫存都沒有變更',
    '優惠券內容不正確',
  ]) {
    if (message.includes(known)) return known
  }
  return '優惠券沒有完成，點數與庫存沒有變更'
}
