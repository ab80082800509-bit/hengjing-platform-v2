import { maxLineOnHand, optionFieldState, stockView, type StockProduct } from '../lib/catalog-stock'
import { OPEN_ORDER_METRIC_LABEL, parseRefundAmount, refundLineAmount, SELLER_ACTION_QUEUE_LABEL } from '../lib/metric-amount'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const combo: StockProduct = {
  stock: 5,
  variants: [
    { name: '顏色', options: ['紅', '藍'] },
    { name: '尺寸', options: ['S', 'M'] },
  ],
  comboStock: {
    '顏色|紅::尺寸|S': 10,
    '顏色|紅::尺寸|M': 4,
    '顏色|藍::尺寸|S': 4,
    '顏色|藍::尺寸|M': 4,
  },
}

const shared = stockView(combo, { 顏色: '紅', 尺寸: 'S' })
assert(shared.onHand === 5 && shared.aggregate === false, '完整組合必須同時受共享庫存與 combo 庫存限制')

const partial = stockView(combo, { 顏色: '紅' })
assert(partial.onHand === 5 && partial.aggregate === true, '未選完的組合合計不可超過共享庫存')

const missingKey = stockView({ ...combo, comboStock: { '顏色|紅::尺寸|M': 4 } }, { 顏色: '紅', 尺寸: 'S' })
assert(missingKey.onHand === 0, '缺少的 combo key 依正式規則是 0，不是無限')

const unreadable = stockView(
  { ...combo, comboStock: { ...combo.comboStock, '顏色|紅::尺寸|S': Number.NaN } },
  { 顏色: '紅', 尺寸: 'S' },
)
assert(unreadable.onHand === null, '無法解讀的組合庫存不能當成 0')

const options: StockProduct = {
  stock: 10,
  variants: [{ name: '顏色', options: ['紅', '藍'] }],
  optionStock: { '顏色|紅': 8, '顏色|藍': 8 },
}
assert(stockView(options, { 顏色: '紅' }).onHand === 8, '規格庫存要比共享庫存更緊時採用規格庫存')
assert(optionFieldState({ ...options, stock: 0 }, {}, '顏色', '紅') === 'out', '共享庫存為 0 時選項不可售')
assert(optionFieldState(options, { 顏色: '紅' }, '顏色', '藍') === 'ok', '另一個已選規格不應把這個選項反灰')

const room = maxLineOnHand(options, { 顏色: '藍' }, [{ variant: { 顏色: '紅' }, qty: 6 }])
assert(room === 4, '不同規格要一起占用共享庫存，藍最多再 4 件')

const comboRoom = maxLineOnHand(combo, { 顏色: '藍', 尺寸: 'S' }, [{ variant: { 顏色: '紅', 尺寸: 'S' }, qty: 3 }])
assert(comboRoom === 2, '不同組合要一起占用共享庫存')

assert(maxLineOnHand(options, { 顏色: '紅' }, [{ variant: { 顏色: '藍' }, qty: 1.5 }]) === null, '數量無法確認時不能當成 0')

const differentLabels = (left: string, right: string) => left !== right
assert(differentLabels(SELLER_ACTION_QUEUE_LABEL, OPEN_ORDER_METRIC_LABEL), '待賣家處理與未結案訂單必須使用不同名稱')
assert(differentLabels(SELLER_ACTION_QUEUE_LABEL, '待處理'), '待賣家處理不能再沿用會和報表混淆的舊名稱')
assert(refundLineAmount(undefined).kind === 'missing', '沒有退款金額時不可改看訂單總額')
assert(refundLineAmount(null).kind === 'unreadable', '無法解讀的退款金額不可當成 0')
const shown = refundLineAmount(120)
assert(shown.kind === 'amount' && shown.amount === 120, '退款明細使用退款金額')
assert(!('orderTotal' in shown), '退款結果不含訂單總額')
const zero = refundLineAmount(0)
assert(zero.kind === 'amount' && zero.amount === 0, '零元退款仍顯示退款金額')
assert(parseRefundAmount(880, false) === undefined, '沒有退款欄位時不可採用另一個金額')
assert(parseRefundAmount(120, true) === 120, '退款欄位的整數就是退款金額')
assert(parseRefundAmount('120', true) === 120, '整數字串退款金額可讀')
assert(parseRefundAmount(12.5, true) === null, '非整數退款金額不可讀')
assert(parseRefundAmount(-1, true) === null, '負數退款金額不可讀')

console.log('batch3 static checks ok')
