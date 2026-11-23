/**
 * 已登入會員的購物車只呼叫既有 RPC。
 * 不讀 checkout_enabled，也不呼叫 place_checkout。
 */
import { supabase } from '@/lib/supabase'
import { memberAccessToken } from '@/lib/rewards/member-session'
import { parseCartPlan, type CartVariant, type RemoteCartLine } from '@/lib/commerce-cart'

export type CartRpcResult = { lines: RemoteCartLine[] | null; error: string | null }

function cartError(message: string): string {
  if (/PGRST202|schema cache|Could not find the function|does not exist|交易設定不存在/i.test(message)) {
    return '購物車還沒有接到這個環境的資料庫，瀏覽器裡的舊購物車沒有被清空'
  }
  if (/jwt|請先登入|permission denied|row-level/i.test(message)) return '請先登入後再使用購物車'
  return message
}

async function callCart(name: string, args: Record<string, unknown>, uiUserId: string): Promise<CartRpcResult> {
  const session = await memberAccessToken(uiUserId)
  if (!session.token) return { lines: null, error: '請先登入後再使用購物車' }
  try {
    const { data, error } = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${session.token}`)
    if (error) return { lines: null, error: cartError(error.message) }
    const payload = typeof data === 'string' ? JSON.parse(data) as unknown : data
    const parsed = parseCartPlan(payload)
    if (!parsed) return { lines: null, error: '購物車資料不完整，沒有改動瀏覽器裡的舊購物車' }
    return { lines: parsed.lines, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch'
    return { lines: null, error: cartError(message) }
  }
}

export function listMyCart(uiUserId: string): Promise<CartRpcResult> {
  return callCart('list_my_cart', {}, uiUserId)
}

export function addCartItem(uiUserId: string, productId: string, variant: CartVariant, qty: number): Promise<CartRpcResult> {
  return callCart('add_cart_item', { p_product_id: productId, p_variant: variant, p_qty: qty }, uiUserId)
}

export function setCartItemQty(uiUserId: string, itemId: string, qty: number): Promise<CartRpcResult> {
  return callCart('set_cart_item_qty', { p_item_id: itemId, p_qty: qty }, uiUserId)
}

export function removeCartItem(uiUserId: string, itemId: string): Promise<CartRpcResult> {
  return callCart('remove_cart_item', { p_item_id: itemId }, uiUserId)
}
