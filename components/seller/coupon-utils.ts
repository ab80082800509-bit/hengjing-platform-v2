export type CouponKind = 'cash' | 'percent' | 'gift' | 'freeship'
export type CouponStatus = 'upcoming' | 'active' | 'paused' | 'soldout' | 'expired'

export interface CouponBenefit {
  kind?: CouponKind
  amount: number
  percent?: number
  maxDiscount?: number
  gift?: string
}

export interface CouponLike extends CouponBenefit {
  id: string
  sellerId: string
  code: string
  name?: string
  minSpend: number
  qty: number
  redeemed: number
  usedOrders: number
  listed: boolean
  shelf?: boolean
  cost: number
  active: boolean
  startAt?: string
  endAt?: string
  exclusive?: boolean
  founderPrize?: boolean
  deleted?: boolean
}

export interface CouponDraft {
  name: string
  code: string
  kind: CouponKind
  amount: number
  percent: number
  maxDiscount: number
  gift: string
  minSpend: number
  qty: number
  startAt: string
  endAt: string
  listed: boolean
  shelf: boolean
}

export const DEFAULT_REDEEM_COST = 100

const nt = (n: number) => `NT$ ${n.toLocaleString('en-US')}`

export const kindOf = (c: { kind?: CouponKind }): CouponKind => c.kind ?? 'cash'

export const remainOf = (c: { qty: number; redeemed: number }) => Math.max(0, c.qty - c.redeemed)

export const inWindow = (c: { startAt?: string; endAt?: string }, today: string) =>
  (!c.startAt || c.startAt <= today) && (!c.endAt || c.endAt >= today)

export function couponStatus(c: CouponLike, today: string): CouponStatus {
  if (c.endAt && c.endAt < today) return 'expired'
  if (!c.active) return 'paused'
  if (remainOf(c) <= 0) return 'soldout'
  if (c.startAt && c.startAt > today) return 'upcoming'
  return 'active'
}

/** 90 -> "9"、85 -> "8.5"、75 -> "7.5"（percent 為買家實付的百分比） */
export const foldLabel = (percent: number) => String(Math.round(percent) / 10)

export function couponTitle(c: CouponBenefit & { minSpend: number }): string {
  const min = `滿 ${nt(c.minSpend)}`
  switch (kindOf(c)) {
    case 'freeship':
      return `${min} 免運`
    case 'percent': {
      const cap = c.maxDiscount ? `（最高折 ${nt(c.maxDiscount)}）` : ''
      return `${min} 享 ${foldLabel(c.percent ?? 100)} 折${cap}`
    }
    case 'gift':
      return `${min} 贈「${c.gift ?? '指定贈品'}」`
    default:
      return `${min} 折 ${nt(c.amount)}`
  }
}

/** 折抵金額（贈品券不折抵商品金額）。結帳預覽與下單共用，確保兩邊結果一致。 */
export function couponDiscount(c: CouponBenefit, subtotal: number, shipping: number): number {
  switch (kindOf(c)) {
    case 'freeship':
      return shipping
    case 'percent': {
      const raw = Math.floor((subtotal * (100 - (c.percent ?? 100))) / 100)
      return Math.max(0, Math.min(raw, c.maxDiscount || Infinity, subtotal))
    }
    case 'gift':
      return 0
    default:
      return Math.min(c.amount, subtotal)
  }
}

/** 刮刮卡獎項的短標題 */
export function couponHeadline(c: CouponBenefit): string {
  switch (kindOf(c)) {
    case 'freeship':
      return '免運券'
    case 'percent':
      return `${foldLabel(c.percent ?? 100)} 折券`
    case 'gift':
      return '贈品券'
    default:
      return `折 ${nt(c.amount)}`
  }
}

/** 券包磚塊上的兩行標示 */
export function couponBadge(c: CouponBenefit): { label: string; value: string } {
  switch (kindOf(c)) {
    case 'freeship':
      return { label: '免運', value: '運費' }
    case 'percent':
      return { label: '折扣', value: `${foldLabel(c.percent ?? 100)} 折` }
    case 'gift':
      return { label: '贈品', value: '滿額贈' }
    default:
      return { label: '折抵', value: nt(c.amount) }
  }
}

export const slashDate = (d: string) => d.replace(/-/g, '/')

export const STATUS_LABEL: Record<CouponStatus, string> = {
  active: '進行中',
  paused: '已下架',
  soldout: '已完售',
  expired: '已過期',
  upcoming: '尚未開始',
}

export const KIND_LABEL: Record<CouponKind, string> = {
  cash: '滿額折',
  percent: '打折',
  gift: '贈禮',
  freeship: '免運',
}

/** 領取後實際使用的比例；店內折扣碼沒有領取紀錄時回傳 null */
export const conversionOf = (c: { redeemed: number; usedOrders: number }): number | null =>
  c.redeemed > 0 ? Math.min(100, Math.round((c.usedOrders / c.redeemed) * 100)) : null

export function couponToDraft(c: CouponLike): CouponDraft {
  return {
    name: c.name ?? '',
    code: c.code,
    kind: kindOf(c),
    amount: c.amount,
    percent: c.percent ?? 0,
    maxDiscount: c.maxDiscount ?? 0,
    gift: c.gift ?? '',
    minSpend: c.minSpend,
    qty: c.qty,
    startAt: c.startAt ?? '',
    endAt: c.endAt ?? '',
    listed: c.listed,
    shelf: !!c.shelf,
  }
}
