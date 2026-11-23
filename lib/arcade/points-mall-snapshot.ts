/** 解析 get_my_points_mall 的唯讀總覽。兌換仍走既有的 purchase_my_perk / exchange_my_coupon。 */
import { parseSellerCoupon, type SellerCouponRecord } from '@/lib/rewards/coupon-snapshot'
import { parseMallPerks, type MallPerkServer } from '@/lib/rewards/perk-mall-state'

export type MallCoupon = SellerCouponRecord & { sellerName: string; held: boolean }

export type PointsMallState = {
  balance: number
  perkPurchaseEnabled: boolean
  couponExchangeCost: number
  coupons: MallCoupon[]
  pointsCouponCount: number
  benefitsOpen: false
  /** 1：資料庫只有原 15 件；2：40 件且每件附真實狀態。 */
  catalogVersion: 1 | 2
  perks: MallPerkServer[] | null
}

export function parsePointsMall(value: unknown): PointsMallState | null {
  const body = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!body || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  if (!Number.isInteger(row.balance) || (row.balance as number) < 0) return null
  if (typeof row.perkPurchaseEnabled !== 'boolean' || row.couponExchangeCost !== 100 || row.benefitsOpen !== false) return null
  if (!Array.isArray(row.coupons) || row.coupons.length > 60 || !Number.isInteger(row.pointsCouponCount)) return null
  const coupons: MallCoupon[] = []
  for (const item of row.coupons) {
    const coupon = parseSellerCoupon(item)
    const extra = item as Record<string, unknown>
    if (!coupon || typeof extra.held !== 'boolean') return null
    coupons.push({ ...coupon, sellerName: typeof extra.sellerName === 'string' && extra.sellerName ? extra.sellerName : '商家', held: extra.held })
  }
  const v2 = row.catalogVersion === 2
  const perks = v2 ? parseMallPerks(row.perks) : null
  if (v2 && !perks) return null
  return {
    balance: row.balance as number,
    perkPurchaseEnabled: row.perkPurchaseEnabled,
    couponExchangeCost: 100,
    coupons,
    pointsCouponCount: row.pointsCouponCount as number,
    benefitsOpen: false,
    catalogVersion: v2 ? 2 : 1,
    perks,
  }
}
