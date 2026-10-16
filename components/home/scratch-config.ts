export type PrizeKind = 'coupon' | 'points' | 'founder' | 'none'

export const SCRATCH_BASE_CHANCES = 1
export const SCRATCH_SHARE_BONUS = 1
export const SCRATCH_MAX_CHANCES = 2
export const FOUNDER_DAILY_QUOTA = 5
export const COUPON_FALLBACK_POINTS = 20
export const FOUNDER_FALLBACK_POINTS = 30
export const COUPON_BONUS_POINTS = 2
export const FOUNDER_BONUS_POINTS = 5
export const NONE_GUARANTEE_POINTS = 3
export const RECYCLE_POINTS = 3

export const PRIZE_TABLE: { kind: PrizeKind; label: string; odds: number; detail: string }[] = [
  {
    kind: 'coupon',
    label: '賣家專屬折價券 + 保底點數',
    odds: 25,
    detail: `刮中後發送至「我的優惠券包」並另贈 ${COUPON_BONUS_POINTS} 點；不想要可分解換 ${RECYCLE_POINTS} 點`,
  },
  { kind: 'points', label: '平台簽到紅利點數', odds: 65, detail: '隨機 10～50 點平台通用點數，可到簽到點數商城兌換賣家折價券' },
  {
    kind: 'founder',
    label: '創始特約店大額優惠券 + 保底點數',
    odds: 5,
    detail: `創始特約店大額折價券並另贈 ${FOUNDER_BONUS_POINTS} 點，每日限量，發完改發紅利點數`,
  },
  { kind: 'none', label: '再接再厲（保底點數）', odds: 5, detail: `沒刮中大獎也有保底 ${NONE_GUARANTEE_POINTS} 點平台通用點數，每次刮卡都有收穫` },
]

const POINT_AMOUNTS = [
  { amount: 10, weight: 40 },
  { amount: 15, weight: 30 },
  { amount: 20, weight: 18 },
  { amount: 30, weight: 9 },
  { amount: 50, weight: 3 },
]

export type ScratchOutcome =
  | { kind: 'points'; points: number; fallbackFrom?: 'coupon' | 'founder' }
  | {
      kind: 'coupon' | 'founder'
      couponId: string
      code: string
      sellerId: string
      sellerName: string
      headline: string
      title: string
      minSpend: number
      bonusPoints: number
    }
  | { kind: 'none'; points: number }

export interface ScratchCard {
  id: string
  outcome: ScratchOutcome
  revealed: boolean
  walletId?: string
  recycled?: boolean
}

export function rollPrizeKind(random: () => number = Math.random): PrizeKind {
  const r = random() * 100
  let acc = 0
  for (const p of PRIZE_TABLE) {
    acc += p.odds
    if (r < acc) return p.kind
  }
  return 'none'
}

export function rollPointAmount(random: () => number = Math.random): number {
  const total = POINT_AMOUNTS.reduce((s, p) => s + p.weight, 0)
  let r = random() * total
  for (const p of POINT_AMOUNTS) {
    r -= p.weight
    if (r < 0) return p.amount
  }
  return POINT_AMOUNTS[0].amount
}
