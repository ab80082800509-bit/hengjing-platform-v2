/**
 * 瀏覽器只呼叫優惠券入口。
 * 不傳會員編號、點數或庫存增量，也不在本機改餘額。
 */
import type { CouponDraft } from '@/components/seller/coupon-utils'
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from './member-session'
import {
  couponFailureMessage,
  parseCouponClaim,
  parseCouponPointOffer,
  parseCouponPointOfferList,
  parsePointOfferClaim,
  parsePointOfferMall,
  parseSellerCoupon,
  parseSellerCouponList,
  parseWalletList,
  pointOfferFailureMessage,
  type CouponClaimResult,
  type CouponPointOffer,
  type PointOfferClaimResult,
  type PointOfferMall,
  type SellerCouponRecord,
  type WalletCouponRecord,
} from './coupon-snapshot'

async function memberRpc(
  name: string,
  args: Record<string, unknown>,
  uiUserId?: string | null,
  failure: (message: string) => string = couponFailureMessage,
): Promise<{ data: unknown; error: string | null }> {
  const session = await memberAccessToken(uiUserId)
  if (!session.token) return { data: null, error: failure(session.error ?? '請先登入') }
  try {
    const { data, error } = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${session.token}`)
    if (error) return { data: null, error: failure(`${error.code ?? ''} ${error.message}`) }
    return { data: typeof data === 'string' ? JSON.parse(data) as unknown : data, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { data: null, error: failure(message) }
  }
}

function draftPayload(draft: CouponDraft) {
  return {
    name: draft.name,
    code: draft.code,
    kind: draft.kind,
    amount: draft.amount,
    percent: draft.percent,
    maxDiscount: draft.maxDiscount,
    gift: draft.gift,
    minSpend: draft.minSpend,
    qty: draft.qty,
    startAt: draft.startAt,
    endAt: draft.endAt,
    listed: draft.listed,
    shelf: draft.shelf,
  }
}

export async function fetchMySellerCoupons(uiUserId?: string | null): Promise<{ data: SellerCouponRecord[] | null; error: string | null }> {
  const result = await memberRpc('list_my_seller_coupons', {}, uiUserId)
  if (result.error) return { data: null, error: result.error }
  const parsed = parseSellerCouponList(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '優惠券清單無法讀取' }
}

export async function fetchStoreCoupons(sellerId: string): Promise<{ data: SellerCouponRecord[] | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('list_store_coupons', { p_seller_id: sellerId })
    if (error) return { data: null, error: couponFailureMessage(error.message) }
    const payload = typeof data === 'string' ? JSON.parse(data) as unknown : data
    const parsed = parseSellerCouponList(payload)
    return parsed ? { data: parsed, error: null } : { data: null, error: '賣場優惠券無法讀取' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { data: null, error: couponFailureMessage(message) }
  }
}

export async function fetchMyCouponWallet(uiUserId?: string | null): Promise<{ data: WalletCouponRecord[] | null; error: string | null }> {
  const result = await memberRpc('list_my_coupon_wallet', {}, uiUserId)
  if (result.error) return { data: null, error: result.error }
  const parsed = parseWalletList(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '券包無法讀取。請重新整理；已經領到的券不會消失' }
}

export async function saveMySellerCoupon(id: string | null, draft: CouponDraft, uiUserId?: string | null): Promise<{ data: SellerCouponRecord | null; error: string | null }> {
  const result = await memberRpc('save_my_seller_coupon', { p_id: id, p_draft: draftPayload(draft) }, uiUserId)
  if (result.error) return { data: null, error: result.error }
  const parsed = parseSellerCoupon(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '優惠券儲存後無法讀取，請重新整理確認' }
}

export async function setMySellerCouponFlag(
  id: string,
  flag: 'active' | 'game_pool' | 'shelf',
  enabled: boolean,
  uiUserId?: string | null,
): Promise<{ data: SellerCouponRecord | null; error: string | null }> {
  const result = await memberRpc('set_my_seller_coupon_flag', { p_id: id, p_flag: flag, p_enabled: enabled }, uiUserId)
  if (result.error) return { data: null, error: result.error }
  const parsed = parseSellerCoupon(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '優惠券狀態無法讀取，請重新整理確認' }
}

export async function deleteMySellerCoupon(id: string, uiUserId?: string | null): Promise<{ error: string | null }> {
  const result = await memberRpc('delete_my_seller_coupon', { p_id: id }, uiUserId)
  if (result.error) return { error: result.error }
  const parsed = parseSellerCoupon(result.data)
  return parsed?.deleted ? { error: null } : { error: '優惠券沒有刪除，請重新整理確認' }
}

export async function claimStorefrontCoupon(couponId: string, uiUserId?: string | null): Promise<{ data: CouponClaimResult | null; error: string | null }> {
  const result = await memberRpc('claim_storefront_coupon', { p_coupon_id: couponId }, uiUserId)
  if (result.error) return { data: null, error: result.error }
  const parsed = parseCouponClaim(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '領取結果無法讀取。請重新整理；若已領到，不會再扣一次庫存' }
}

export async function exchangeMyCoupon(couponId: string, uiUserId?: string | null): Promise<{ data: CouponClaimResult | null; error: string | null }> {
  const result = await memberRpc('exchange_my_coupon', { p_coupon_id: couponId }, uiUserId)
  if (result.error) return { data: null, error: result.error }
  const parsed = parseCouponClaim(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '兌換結果無法讀取。請重新整理；若點數已扣，券會在券包，不會再扣一次' }
}

export async function fetchMyCouponPointOffers(uiUserId?: string | null): Promise<{ data: CouponPointOffer[] | null; error: string | null }> {
  const result = await memberRpc('list_my_coupon_point_offers', {}, uiUserId, pointOfferFailureMessage)
  if (result.error) return { data: null, error: result.error }
  const parsed = parseCouponPointOfferList(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '點數兌換設定無法讀取' }
}

export async function saveMyCouponPointOffer(
  couponId: string,
  offer: { enabled: boolean; pointsCost: number; pointsQty: number; endsOn: string },
  uiUserId?: string | null,
): Promise<{ data: CouponPointOffer | null; error: string | null }> {
  const result = await memberRpc(
    'save_my_coupon_point_offer',
    { p_coupon_id: couponId, p_enabled: offer.enabled, p_points_cost: offer.pointsCost, p_points_qty: offer.pointsQty, p_ends_on: offer.endsOn },
    uiUserId,
    pointOfferFailureMessage,
  )
  if (result.error) return { data: null, error: result.error }
  const parsed = parseCouponPointOffer(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '點數兌換設定儲存後無法讀取，請重新整理確認' }
}

export async function fetchPointOfferCoupons(uiUserId?: string | null): Promise<{ data: PointOfferMall | null; error: string | null }> {
  const result = await memberRpc('list_point_offer_coupons', {}, uiUserId, pointOfferFailureMessage)
  if (result.error) return { data: null, error: result.error }
  const parsed = parsePointOfferMall(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '購物優惠區資料格式不正確，沒有顯示任何券' }
}

export async function exchangeMyPointOffer(couponId: string, expectedCost: number, uiUserId?: string | null): Promise<{ data: PointOfferClaimResult | null; error: string | null }> {
  const result = await memberRpc('exchange_my_point_offer', { p_coupon_id: couponId, p_expected_cost: expectedCost }, uiUserId, pointOfferFailureMessage)
  if (result.error) return { data: null, error: result.error }
  const parsed = parsePointOfferClaim(result.data)
  return parsed ? { data: parsed, error: null } : { data: null, error: '兌換結果無法讀取。請重新整理；若點數已扣，券會在券包，不會再扣一次' }
}
