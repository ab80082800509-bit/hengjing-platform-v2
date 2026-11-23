export type PrizeKind = 'coupon' | 'points' | 'founder' | 'none'

export const SCRATCH_BASE_CHANCES = 1
export const SCRATCH_SHARE_BONUS = 1
export const SCRATCH_MAX_CHANCES = 2
export const COUPON_FALLBACK_POINTS = 20
export const FOUNDER_FALLBACK_POINTS = 30
export const COUPON_BONUS_POINTS = 2
export const FOUNDER_BONUS_POINTS = 5
export const NONE_GUARANTEE_POINTS = 3
export const RECYCLE_POINTS = 3

export const PRIZE_TABLE: { kind: PrizeKind; label: string; odds: number; detail: string }[] = [
  {
    kind: 'coupon',
    label: '一般優惠券',
    odds: 25,
    detail: `商家已授權且仍可發的優惠券會放入券包，不另贈 ${COUPON_BONUS_POINTS} 點。沒有可發的券時改入帳 ${COUPON_FALLBACK_POINTS} 點，不會同時領券和點數。`,
  },
  {
    kind: 'points',
    label: '紅利點數',
    odds: 65,
    detail: '10、15、20、30 或 50 點，權重 40／30／18／9／3，由伺服器寫入正式點數帳本。',
  },
  {
    kind: 'founder',
    label: '創始優惠券',
    odds: 5,
    detail: `每日 5 張上限已取消，也尚未確認創始券的發行者與額度，所以不會建立創始券。刮中這一格仍入帳 ${FOUNDER_FALLBACK_POINTS} 點，不另贈 ${FOUNDER_BONUS_POINTS} 點。`,
  },
  {
    kind: 'none',
    label: '保底點數',
    odds: 5,
    detail: `沒有中大獎也會入帳保底 ${NONE_GUARANTEE_POINTS} 點。`,
  },
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
