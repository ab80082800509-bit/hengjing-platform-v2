import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseCompletedRemainingAmount,
  presentCompletedDetail,
} from '../lib/metric-amount'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

type Line = { quantity: number; refundedQty: number; unitPrice: number }
type Order = { orderId: string; orderTotal: number; lines: Line[] }

/** 與 seller_operations_report、completed 明細同一口徑，不用訂單總額代入。 */
function lineRemaining(line: Line): number | null {
  if (!Number.isInteger(line.quantity) || !Number.isInteger(line.refundedQty) || !Number.isInteger(line.unitPrice)) return null
  if (line.quantity <= 0 || line.unitPrice <= 0 || line.refundedQty < 0 || line.refundedQty > line.quantity) return null
  const amount = (line.quantity - line.refundedQty) * line.unitPrice
  if (!Number.isSafeInteger(amount)) return null
  return amount
}

function completedFromLines(orders: Order[]) {
  let count = 0
  let amount = 0
  const rows: { orderId: string; orderTotal: number; completedRemainingAmount: number }[] = []
  for (const order of orders) {
    if (order.lines.length === 0) continue
    let orderAmount = 0
    let include = false
    for (const line of order.lines) {
      const part = lineRemaining(line)
      if (part == null) return null
      orderAmount += part
      if (line.quantity > line.refundedQty) include = true
    }
    if (!Number.isSafeInteger(orderAmount)) return null
    amount += orderAmount
    if (include) {
      count += 1
      rows.push({
        orderId: order.orderId,
        orderTotal: order.orderTotal,
        completedRemainingAmount: orderAmount,
      })
    }
  }
  if (!Number.isSafeInteger(amount)) return null
  return { count, amount, rows }
}

const partial = (5 - 2) * 100
const untouched = (2 - 0) * 150
const fullyRefunded = (4 - 4) * 80
const multi = ((2 - 0) * 100) + ((3 - 3) * 50) + ((4 - 1) * 40)
assert(partial === 300 && untouched === 300 && fullyRefunded === 0 && multi === 320, '手算口徑')

const stats = completedFromLines([
  { orderId: 'partial', orderTotal: 500, lines: [{ quantity: 5, refundedQty: 2, unitPrice: 100 }] },
  { orderId: 'untouched', orderTotal: 360, lines: [{ quantity: 2, refundedQty: 0, unitPrice: 150 }] },
  { orderId: 'full', orderTotal: 320, lines: [{ quantity: 4, refundedQty: 4, unitPrice: 80 }] },
  {
    orderId: 'multi',
    orderTotal: 540,
    lines: [
      { quantity: 2, refundedQty: 0, unitPrice: 100 },
      { quantity: 3, refundedQty: 3, unitPrice: 50 },
      { quantity: 4, refundedQty: 1, unitPrice: 40 },
    ],
  },
])
if (!stats) throw new Error('合法明細必須算得出金額')
assert(stats.count === 3, '全部退貨不計入筆數，多項商品仍算一筆')
assert(stats.amount === partial + untouched + fullyRefunded + multi, '金額含全部退貨的 0，但不含訂單總額')
assert(stats.amount === 920, '四種情境合計 920')
assert(stats.rows.map((row) => row.orderId).join() === 'partial,untouched,multi', '全部退貨的訂單不出現在明細')
assert(stats.rows[0].completedRemainingAmount === 300 && stats.rows[0].orderTotal === 500, '部分退貨保留原訂單總額')
assert(stats.rows[1].completedRemainingAmount === 300 && stats.rows[1].orderTotal === 360, '未退貨也不改用訂單總額')
assert(stats.rows[2].completedRemainingAmount === 320 && stats.rows[2].orderTotal === 540, '多項商品只留一列，退光的項目貢獻 0')
assert(stats.rows.every((row) => row.completedRemainingAmount !== row.orderTotal), '這組例子的統計金額都不等於訂單總額')
assert(stats.rows.reduce((sum, row) => sum + row.completedRemainingAmount, 0) === stats.amount, '明細合計等於報表口徑')

const invalid = completedFromLines([
  { orderId: 'bad', orderTotal: 999, lines: [{ quantity: 2, refundedQty: 3, unitPrice: 10 }] },
])
assert(invalid == null, '無法計算時不要改報訂單總額')

const zeroShown = presentCompletedDetail(0, 500)
assert(zeroShown.kind === 'amount' && zeroShown.amount === 0 && zeroShown.orderTotal === 500, '0 元仍是統計金額')
assert(parseCompletedRemainingAmount('0', true) === 0, '整數字串 0 可讀')
assert(parseCompletedRemainingAmount(880, false) === undefined, '沒有統計欄位時不可採用另一個金額')
const missing = presentCompletedDetail(parseCompletedRemainingAmount(880, false), 880)
assert(missing.kind === 'missing' && !('amount' in missing) && missing.orderTotal === 880, '缺少欄位時不產生統計金額')
assert(parseCompletedRemainingAmount(12.5, true) === null, '非整數不可讀')
assert(parseCompletedRemainingAmount(-1, true) === null, '負數不可讀')
assert(parseCompletedRemainingAmount(null, true) === null, '空值不可讀成 0')
const unreadable = presentCompletedDetail(null, 880)
assert(unreadable.kind === 'unreadable' && !('amount' in unreadable), '無法解讀時不改放訂單總額')

const displayed = [zeroShown, missing, unreadable]
const displayedSum = displayed.reduce((sum, item) => sum + (item.kind === 'amount' ? item.amount : 0), 0)
assert(displayedSum === 0, '缺少或無法解讀的列不能用訂單總額補進合計')

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')
const previous = read('supabase/migrations/20261022021200_seller_metric_refund_lines.sql')
const formal = read('supabase/migrations/20261022140000_seller_metric_completed_remaining.sql')
const preview = read('supabase/manual/20261022140000_seller_metric_completed_remaining_preview.sql')
const orders = read('lib/commerce-orders.ts')
const ui = read('components/commerce-orders.tsx')

function functionBody(sql: string) {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.seller_orders_for_metric')
  const end = sql.indexOf('REVOKE ALL ON FUNCTION public.seller_orders_for_metric')
  assert(start >= 0 && end > start, '找不到函式本體')
  return sql.slice(start, end)
}

function refundPrefix(fn: string) {
  const marker = fn.indexOf('-- refund_line_v1')
  const end = fn.indexOf('END IF;', marker)
  assert(marker >= 0 && end > marker, '找不到退款分類')
  return fn.slice(0, end + 'END IF;'.length)
}

const completedOr = `
          OR (
            metric = 'completed'
            AND o.completed_at IS NOT NULL
            AND o.fulfillment_status = 'completed'
            AND o.completed_at >= p_from AND o.completed_at < p_to
            AND oi.quantity > oi.refunded_qty
          )`

const oldFn = functionBody(previous)
const newFn = functionBody(formal)
assert(refundPrefix(oldFn) === refundPrefix(newFn), '退款分類與前面的判斷必須維持原樣')
const oldTail = oldFn.slice(refundPrefix(oldFn).length)
assert(oldTail.includes(completedOr), '舊版共用查詢應仍含已完成條件，作為對照')
const completedMarker = newFn.indexOf('-- completed_remaining_v1')
const completedEnd = newFn.indexOf('END IF;', completedMarker)
assert(completedMarker > refundPrefix(newFn).length && completedEnd > completedMarker, '找不到已完成分類')
const newTail = newFn.slice(completedEnd + 'END IF;'.length)
assert(newTail === oldTail.replace(completedOr, ''), 'placed、confirmed_collected、pending、cancelled 的共用查詢必須維持原樣')
assert(!newTail.includes("metric = 'completed'"), '共用查詢不應再處理已完成分類')
assert(!newTail.includes('completedRemainingAmount'), '其他分類不應多出剩餘明細金額')

const completedBranch = newFn.slice(completedMarker, completedEnd)
assert(completedBranch.includes("'orderTotal', o.order_total"), '已完成分類仍回傳原訂單總額')
assert(completedBranch.includes("'completedRemainingAmount', coalesce(sum((oi.quantity - oi.refunded_qty) * oi.unit_price), 0)"), '剩餘金額算式必須與營運報表相同')
assert(completedBranch.includes('HAVING bool_or(oi.quantity > oi.refunded_qty)'), '全部退貨的訂單不列入明細')
assert(completedBranch.includes('LIMIT 100'), '已完成明細維持 100 筆上限')
assert(completedBranch.includes('不修改那支函式'), '已完成金額註明沿用營運報表算式')
assert(!formal.includes('CREATE OR REPLACE FUNCTION public.seller_operations_report'), '這次不修改營運報表函式')

function executable(sql: string) {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.seller_orders_for_metric')
  const end = sql.indexOf('END $$;', start)
  assert(start >= 0 && end > start, '找不到可執行定義')
  return sql.slice(start, end + 'END $$;'.length)
}

assert(executable(formal) === executable(preview), '預演與正式 migration 的函式定義必須相同')
assert(formal.trimEnd().endsWith('COMMIT;'), '正式檔以 COMMIT 結束')
assert(preview.trimEnd().endsWith('ROLLBACK;'), '預演檔以 ROLLBACK 結束')
assert(!formal.includes('ROLLBACK'), '正式檔不應回復')
assert(!preview.includes('\nCOMMIT;'), '預演檔不應提交')
assert(!previous.includes('completedRemainingAmount'), '既有退款 migration 不應被改寫')
assert(orders.includes("order.completedRemainingAmount = parseCompletedRemainingAmount(row.completedRemainingAmount, true)"), '前端只解析剩餘明細欄位')
assert(!orders.includes('completedRemainingAmount: row.orderTotal') && !orders.includes('completedRemainingAmount: num('), '解析時不可把訂單總額寫進統計金額')
assert(ui.includes('presentCompletedDetail(row.completedRemainingAmount, row.orderTotal)'), '已完成明細改走剩餘金額')
assert(ui.includes('不是這筆退款金額'), '退款明細文案保持不變')
const completedStart = ui.indexOf('completedShown ?')
const completedUi = ui.slice(completedStart, ui.indexOf('formatTwd(row.orderTotal)', completedStart))
assert(completedUi.includes('formatTwd(completedShown.amount)'), '主要金額使用剩餘明細')
assert(completedUi.includes('formatTwd(completedShown.orderTotal)'), '訂單總額另外標示')
assert(!completedUi.includes('formatTwd(row.orderTotal)'), '已完成分類的主要金額不可改顯示訂單總額')

console.log('completed remaining checks ok')
