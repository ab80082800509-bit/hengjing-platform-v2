/** 訂單出貨的待賣家處理，與營運報表的未結案訂單不是同一個 SQL 條件。 */
export const SELLER_ACTION_QUEUE_LABEL = '待賣家處理'
export const OPEN_ORDER_METRIC_LABEL = '未結案訂單'

export const SELLER_ACTION_QUEUE_NOTE =
  '只列出待付款、待確認付款、待出貨，且未取消、未完成的訂單。不含待收貨。這不是營運報表的「未結案訂單」，兩個數字不該被當成同一個指標。'

export const OPEN_ORDER_METRIC_NOTE =
  '不受日期區間影響。條件是尚未完成、未取消、退款狀態為無的進行中訂單，含待收貨。這不是「訂單出貨」的「待賣家處理」。'

/**
 * 退款明細只讀逐筆 refundAmount。
 * 欄位不存在時回 undefined，呼叫端不可改看訂單總額。
 */
export function parseRefundAmount(value: unknown, present: boolean): number | null | undefined {
  if (!present) return undefined
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    const amount = Number(value)
    if (Number.isSafeInteger(amount)) return amount
  }
  return null
}

/**
 * 缺值、空值或無法解讀時都不是一筆可顯示的退款金額。
 * 這些結果不含訂單總額，不能拿訂單總額補上。
 */
export function refundLineAmount(trustedRefund: number | null | undefined):
  | { kind: 'amount'; amount: number }
  | { kind: 'missing' }
  | { kind: 'unreadable' } {
  if (trustedRefund === undefined) return { kind: 'missing' }
  if (trustedRefund === null || !Number.isSafeInteger(trustedRefund) || trustedRefund < 0) return { kind: 'unreadable' }
  return { kind: 'amount', amount: trustedRefund }
}

/**
 * 已完成明細只讀 completedRemainingAmount。
 * 欄位不存在時回 undefined。0 是合法金額。呼叫端不可改看訂單總額。
 */
export function parseCompletedRemainingAmount(value: unknown, present: boolean): number | null | undefined {
  if (!present) return undefined
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    const amount = Number(value)
    if (Number.isSafeInteger(amount)) return amount
  }
  return null
}

export function completedRemainingLineAmount(remaining: number | null | undefined):
  | { kind: 'amount'; amount: number }
  | { kind: 'missing' }
  | { kind: 'unreadable' } {
  if (remaining === undefined) return { kind: 'missing' }
  if (remaining === null || !Number.isSafeInteger(remaining) || remaining < 0) return { kind: 'unreadable' }
  return { kind: 'amount', amount: remaining }
}

export type CompletedRemainingPresentation =
  | { kind: 'amount'; amount: number; orderTotal: number }
  | { kind: 'missing'; orderTotal: number }
  | { kind: 'unreadable'; orderTotal: number }

/** 主要金額只來自剩餘明細。訂單總額只附在結果裡供另外標示，不會補上缺少的統計金額。 */
export function presentCompletedDetail(
  remaining: number | null | undefined,
  orderTotal: number,
): CompletedRemainingPresentation {
  const shown = completedRemainingLineAmount(remaining)
  if (shown.kind === 'amount') return { kind: 'amount', amount: shown.amount, orderTotal }
  if (shown.kind === 'missing') return { kind: 'missing', orderTotal }
  return { kind: 'unreadable', orderTotal }
}
