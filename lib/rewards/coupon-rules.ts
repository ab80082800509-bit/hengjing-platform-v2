/**
 * 第四批優惠券規則的對照規格。正式扣點與發券只認 Supabase。
 * 這裡不連線，也不能代替資料庫鎖。
 */
import {
  REWARD_ERRORS,
  USER_ID_PATTERN,
  assertPointBalanceCovers,
  emptyLedger,
  type LedgerState,
} from './foundation'

export const COUPON_EXCHANGE_COST = 100
export const COUPON_HOLD_DAYS = 30
export const GAME_POOL_LIMIT = 3

export const COUPON_ERRORS = {
  insufficient: REWARD_ERRORS.insufficient,
  alreadyHeld: '您已領取過此優惠券',
  unavailable: '此優惠券目前無法領取',
  soldOut: '此優惠券已被領完',
  poolFull: '每家店最多同時上架 3 張到簽到專區',
  internal: '扣點只能由資料庫內部交易呼叫',
  both: '刮卡沒有成功，優惠券與點數不能同時領取',
} as const

const DAY = /^\d{4}-\d{2}-\d{2}$/
const COUPON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CouponSource = 'shelf' | 'points' | 'scratch'

export type CouponTemplate = {
  id: string
  sellerId: string
  qty: number
  issued: number
  active: boolean
  deleted: boolean
  gamePool: boolean
  shelf: boolean
  startOn: string
  endOn: string
}

export type CouponHold = {
  userId: string
  couponId: string
  source: CouponSource
  claimedOn: string
  expiresOn: string
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function couponExpiresOn(claimedOn: string, couponEndOn: string): string {
  if (!DAY.test(claimedOn) || !DAY.test(couponEndOn)) throw new Error(COUPON_ERRORS.unavailable)
  const plus = addDays(claimedOn, COUPON_HOLD_DAYS)
  return plus < couponEndOn ? plus : couponEndOn
}

export function exchangeClaimKey(couponId: string): string {
  if (!COUPON_ID.test(couponId)) throw new Error(COUPON_ERRORS.unavailable)
  return `coupon_exchange:${couponId}`
}

function cloneLedger(state: LedgerState): LedgerState {
  return {
    accounts: { ...state.accounts },
    entries: state.entries.map((entry) => ({ ...entry })),
    claims: state.claims.map((entry) => ({ ...entry })),
    links: state.links.map((link) => ({ ...link })),
    inviteBonuses: state.inviteBonuses.map((bonus) => ({ ...bonus })),
  }
}

export function applyCouponPointDebit(
  state: LedgerState,
  input: { userId: string; couponId: string; taipeiDay: string; internal: boolean },
): { state: LedgerState; replayed: boolean; balance: number } {
  if (!input.internal) throw new Error(COUPON_ERRORS.internal)
  if (!USER_ID_PATTERN.test(input.userId)) throw new Error(REWARD_ERRORS.missingUser)
  if (!DAY.test(input.taipeiDay)) throw new Error(COUPON_ERRORS.unavailable)
  const claimKey = exchangeClaimKey(input.couponId)
  const existing = state.claims.find((claim) => claim.userId === input.userId && claim.claimKey === claimKey)
  const current = state.accounts[input.userId] ?? 0
  if (existing) {
    if (existing.kind !== 'coupon_exchange' || existing.delta !== -COUPON_EXCHANGE_COST) throw new Error(REWARD_ERRORS.rewrite)
    return { state, replayed: true, balance: current }
  }
  const balance = assertPointBalanceCovers(current, -COUPON_EXCHANGE_COST)
  const next = cloneLedger(state)
  const entry = {
    userId: input.userId,
    kind: 'coupon_exchange' as const,
    claimKey,
    delta: -COUPON_EXCHANGE_COST,
    balanceAfter: balance,
    taipeiDay: input.taipeiDay,
  }
  next.accounts[input.userId] = balance
  next.entries.push(entry)
  next.claims.push({ ...entry })
  return { state: next, replayed: false, balance }
}

function templateOpen(coupon: CouponTemplate, source: CouponSource, today: string): void {
  if (coupon.deleted || !coupon.active || coupon.startOn > today || coupon.endOn < today) throw new Error(COUPON_ERRORS.unavailable)
  if (source === 'shelf' && !coupon.shelf) throw new Error(COUPON_ERRORS.unavailable)
  if ((source === 'points' || source === 'scratch') && !coupon.gamePool) throw new Error(COUPON_ERRORS.unavailable)
  if (coupon.issued >= coupon.qty) throw new Error(COUPON_ERRORS.soldOut)
}

export function issueCoupon(
  coupon: CouponTemplate,
  holds: CouponHold[],
  input: { userId: string; source: CouponSource; today: string },
): { coupon: CouponTemplate; holds: CouponHold[]; replayed: boolean; hold: CouponHold } {
  const existing = holds.find((hold) => hold.userId === input.userId && hold.couponId === coupon.id)
  if (existing) {
    return { coupon, holds, replayed: true, hold: existing }
  }
  templateOpen(coupon, input.source, input.today)
  const hold: CouponHold = {
    userId: input.userId,
    couponId: coupon.id,
    source: input.source,
    claimedOn: input.today,
    expiresOn: couponExpiresOn(input.today, coupon.endOn),
  }
  return {
    coupon: { ...coupon, issued: coupon.issued + 1 },
    holds: [...holds, hold],
    replayed: false,
    hold,
  }
}

export function exchangeCoupon(
  state: LedgerState,
  coupon: CouponTemplate,
  holds: CouponHold[],
  input: { userId: string; today: string; internal: boolean },
): { state: LedgerState; coupon: CouponTemplate; holds: CouponHold[]; replayed: boolean; balance: number } {
  const existing = holds.find((hold) => hold.userId === input.userId && hold.couponId === coupon.id)
  if (existing) {
    const debit = applyCouponPointDebit(state, { ...input, couponId: coupon.id, taipeiDay: input.today })
    if (!debit.replayed || existing.source !== 'points') throw new Error(COUPON_ERRORS.alreadyHeld)
    return { state, coupon, holds, replayed: true, balance: debit.balance }
  }
  templateOpen(coupon, 'points', input.today)
  const debited = applyCouponPointDebit(state, { ...input, couponId: coupon.id, taipeiDay: input.today })
  if (debited.replayed) throw new Error(COUPON_ERRORS.both)
  const issued = issueCoupon(coupon, holds, { userId: input.userId, source: 'points', today: input.today })
  return {
    state: debited.state,
    coupon: issued.coupon,
    holds: issued.holds,
    replayed: false,
    balance: debited.balance,
  }
}

export function emptyCouponLedger(): LedgerState {
  return emptyLedger()
}
