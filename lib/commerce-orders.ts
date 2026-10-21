import { supabase } from '@/lib/supabase'

export type BuyerOrderBucket = 'all' | 'unpaid' | 'toShip' | 'shipping' | 'done' | 'cancelled' | 'refund'
export type SellerOrderBucket = 'all' | 'pending'
export type SellerMetric = 'placed' | 'confirmed_collected' | 'completed' | 'pending' | 'cancelled' | 'refunded'

export type CommerceItem = {
  orderItemId: string
  productId: string
  name: string
  variantLabel: string
  qty: number
  unitPrice: number
  lineTotal: number
  refundedQty: number
  image: string | null
}

export type CommerceEvent = {
  eventType: string
  actorRole: string
  reasonCode: string | null
  createdAt: string
}

export type CommerceOrder = {
  orderId: string
  displayNo: string
  batchId: string
  sellerId: string
  storeName: string
  createdAt: string
  buyerStage: string
  buyerStageLabel: string
  buyerBucket: string
  paymentMethodLabel: string
  paymentStatus: string
  paymentIntegration: string
  fulfillmentMethodLabel: string
  fulfillmentStatus: string
  orderTotal: number
  itemsSubtotal: number
  shippingFeeStatus: string
  shippingFee: number | null
  currency: string
  canCancel: boolean
  actions: string[]
  notice: string
  stockHoldStatus: string
  stockHoldExpiresAt: string | null
  cancelStatus: string
  refundStatus: string
  items: CommerceItem[]
  recipient: { name: string; phone: string; address: string } | null
  events: CommerceEvent[]
}

export type OrderNotification = {
  id: string
  kind: string
  title: string
  body: string
  orderId: string
  displayNo: string
  readAt: string | null
  createdAt: string
}

export type SellerReport = {
  placedAmount: number
  placedCount: number
  placedAmountNote: string
  confirmedCollectedAmount: number
  confirmedCollectedCount: number
  confirmedCollectedNote: string
  completedAmount: number
  completedCount: number
  completedNote: string
  pendingCount: number
  pendingIgnoresRange: boolean
  pendingNote: string
  cancelledCount: number
  cancelledAmount: number
  refundCount: number
  refundAmount: number
  refundNote: string
}

export type MetricOrder = {
  orderId: string
  displayNo: string
  createdAt: string
  orderTotal: number
  buyerStage: string
  buyerStageLabel: string
}

type RpcResult<T> = { data: T | null; error: string | null }

const num = (value: unknown) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : 0
}

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

function parseItem(value: unknown): CommerceItem | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.orderItemId !== 'string') return null
  return {
    orderItemId: row.orderItemId,
    productId: text(row.productId),
    name: text(row.name, '商品'),
    variantLabel: text(row.variantLabel, '標準規格'),
    qty: num(row.qty),
    unitPrice: num(row.unitPrice),
    lineTotal: num(row.lineTotal),
    refundedQty: num(row.refundedQty),
    image: typeof row.image === 'string' && row.image.trim() ? row.image : null,
  }
}

export function parseCommerceOrder(value: unknown): CommerceOrder | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.orderId !== 'string' || typeof row.displayNo !== 'string') return null
  const recipient = row.recipient && typeof row.recipient === 'object'
    ? {
        name: text((row.recipient as Record<string, unknown>).name),
        phone: text((row.recipient as Record<string, unknown>).phone),
        address: text((row.recipient as Record<string, unknown>).address),
      }
    : null
  const events = Array.isArray(row.events)
    ? row.events.flatMap((event) => {
        if (!event || typeof event !== 'object') return []
        const item = event as Record<string, unknown>
        if (typeof item.createdAt !== 'string') return []
        return [{
          eventType: text(item.eventType, 'event'),
          actorRole: text(item.actorRole),
          reasonCode: typeof item.reasonCode === 'string' ? item.reasonCode : null,
          createdAt: item.createdAt,
        }]
      })
    : []
  return {
    orderId: row.orderId,
    displayNo: row.displayNo,
    batchId: text(row.batchId),
    sellerId: text(row.sellerId),
    storeName: text(row.storeName, '賣場'),
    createdAt: text(row.createdAt),
    buyerStage: text(row.buyerStage),
    buyerStageLabel: text(row.buyerStageLabel, '處理中'),
    buyerBucket: text(row.buyerBucket),
    paymentMethodLabel: text(row.paymentMethodLabel),
    paymentStatus: text(row.paymentStatus),
    paymentIntegration: text(row.paymentIntegration),
    fulfillmentMethodLabel: text(row.fulfillmentMethodLabel),
    fulfillmentStatus: text(row.fulfillmentStatus),
    orderTotal: num(row.orderTotal),
    itemsSubtotal: num(row.itemsSubtotal),
    shippingFeeStatus: text(row.shippingFeeStatus),
    shippingFee: row.shippingFee == null ? null : num(row.shippingFee),
    currency: text(row.currency, 'TWD'),
    canCancel: row.canCancel === true,
    actions: Array.isArray(row.actions) ? row.actions.filter((item): item is string => typeof item === 'string') : [],
    notice: text(row.notice),
    stockHoldStatus: text(row.stockHoldStatus),
    stockHoldExpiresAt: typeof row.stockHoldExpiresAt === 'string' ? row.stockHoldExpiresAt : null,
    cancelStatus: text(row.cancelStatus),
    refundStatus: text(row.refundStatus),
    items: Array.isArray(row.items) ? row.items.flatMap((item) => {
      const parsed = parseItem(item)
      return parsed ? [parsed] : []
    }) : [],
    recipient,
    events,
  }
}

function parseOrders(data: unknown): CommerceOrder[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    const parsed = parseCommerceOrder(item)
    return parsed ? [parsed] : []
  })
}

function rpcError(error: { message?: string } | null) {
  return error?.message || '查詢失敗，請再試一次'
}

export async function listMyBuyerOrders(bucket: BuyerOrderBucket): Promise<RpcResult<CommerceOrder[]>> {
  const { data, error } = await supabase.rpc('list_my_buyer_orders', { p_bucket: bucket })
  if (error) return { data: null, error: rpcError(error) }
  return { data: parseOrders(data), error: null }
}

export async function listMySellerOrders(bucket: SellerOrderBucket): Promise<RpcResult<CommerceOrder[]>> {
  const { data, error } = await supabase.rpc('list_my_seller_orders', { p_bucket: bucket })
  if (error) return { data: null, error: rpcError(error) }
  return { data: parseOrders(data), error: null }
}

export async function getOrderDetail(orderId: string): Promise<RpcResult<CommerceOrder>> {
  const { data, error } = await supabase.rpc('get_order_detail', { p_order_id: orderId })
  if (error) return { data: null, error: rpcError(error) }
  const order = parseCommerceOrder(data)
  if (!order) return { data: null, error: '找不到這張訂單' }
  return { data: order, error: null }
}

export async function cancelMyOrder(orderId: string, role: 'buyer' | 'seller'): Promise<RpcResult<{ message: string }>> {
  const { data, error } = role === 'buyer'
    ? await supabase.rpc('buyer_cancel_order', { p_order_id: orderId })
    : await supabase.rpc('seller_cancel_unpaid_order', { p_order_id: orderId })
  if (error) return { data: null, error: rpcError(error) }
  const row = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  if (row.ok !== true) return { data: null, error: text(row.message, '這張訂單目前不能取消') }
  return { data: { message: text(row.message, '訂單已取消') }, error: null }
}

export function parseSellerReport(value: unknown): SellerReport | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (!('placedAmount' in row) || !('pendingCount' in row)) return null
  return {
    placedAmount: num(row.placedAmount),
    placedCount: num(row.placedCount),
    placedAmountNote: text(row.placedAmountNote, '此區間成立訂單的商品金額，不代表已收款'),
    confirmedCollectedAmount: num(row.confirmedCollectedAmount),
    confirmedCollectedCount: num(row.confirmedCollectedCount),
    confirmedCollectedNote: text(row.confirmedCollectedNote),
    completedAmount: num(row.completedAmount),
    completedCount: num(row.completedCount),
    completedNote: text(row.completedNote),
    pendingCount: num(row.pendingCount),
    pendingIgnoresRange: row.pendingIgnoresRange === true,
    pendingNote: text(row.pendingNote, '目前仍待處理的訂單數，不受日期區間影響'),
    cancelledCount: num(row.cancelledCount),
    cancelledAmount: num(row.cancelledAmount),
    refundCount: num(row.refundCount),
    refundAmount: num(row.refundAmount),
    refundNote: text(row.refundNote),
  }
}

export async function sellerOperationsReport(from: string, to: string): Promise<RpcResult<SellerReport>> {
  const { data, error } = await supabase.rpc('seller_operations_report', { p_from: from, p_to: to })
  if (error) return { data: null, error: rpcError(error) }
  const report = parseSellerReport(data)
  if (!report) return { data: null, error: '報表資料不完整' }
  return { data: report, error: null }
}

export async function sellerOrdersForMetric(metric: SellerMetric, from: string, to: string): Promise<RpcResult<MetricOrder[]>> {
  const { data, error } = await supabase.rpc('seller_orders_for_metric', { p_metric: metric, p_from: from, p_to: to })
  if (error) return { data: null, error: rpcError(error) }
  if (!Array.isArray(data)) return { data: [], error: null }
  return {
    data: data.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      if (typeof row.orderId !== 'string') return []
      return [{
        orderId: row.orderId,
        displayNo: text(row.displayNo),
        createdAt: text(row.createdAt),
        orderTotal: num(row.orderTotal),
        buyerStage: text(row.buyerStage),
        buyerStageLabel: text(row.buyerStageLabel, '處理中'),
      }]
    }),
    error: null,
  }
}

export async function listMyOrderNotifications(limit = 20): Promise<RpcResult<OrderNotification[]>> {
  const { data, error } = await supabase.rpc('list_my_order_notifications', { p_limit: limit })
  if (error) return { data: null, error: rpcError(error) }
  if (!Array.isArray(data)) return { data: [], error: null }
  return {
    data: data.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      if (typeof row.id !== 'string' || typeof row.orderId !== 'string') return []
      return [{
        id: row.id,
        kind: text(row.kind),
        title: text(row.title, '訂單通知'),
        body: text(row.body),
        orderId: row.orderId,
        displayNo: text(row.displayNo),
        readAt: typeof row.readAt === 'string' ? row.readAt : null,
        createdAt: text(row.createdAt),
      }]
    }),
    error: null,
  }
}

export async function markOrderNotificationRead(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('mark_order_notification_read', { p_id: id })
  return error ? rpcError(error) : null
}

export function formatTwd(value: number) {
  return `NT$ ${Math.trunc(value).toLocaleString('en-US')}`
}

export function formatTaipei(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function taipeiRange(preset: 'today' | '7' | '30') {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const start = new Date(`${today}T00:00:00+08:00`)
  const day = 86400000
  const back = preset === 'today' ? 0 : preset === '7' ? 6 : 29
  return {
    from: new Date(start.getTime() - back * day).toISOString(),
    to: new Date(start.getTime() + day).toISOString(),
  }
}

export function customTaipeiRange(fromDate: string, toDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return null
  const from = new Date(`${fromDate}T00:00:00+08:00`)
  const to = new Date(`${toDate}T00:00:00+08:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null
  return { from: from.toISOString(), to: new Date(to.getTime() + 86400000).toISOString() }
}
