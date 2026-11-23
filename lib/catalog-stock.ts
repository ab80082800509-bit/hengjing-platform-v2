/**
 * 前台欄位現貨估算。對齊第一批 commerce_build_plan 的現貨桶，不扣除未到期保留。
 *
 * 1. 組合商品（兩層以上規格且 combo_stock 是物件）：完整規格取該 combo key，缺 key 為 0。
 * 2. 其他商品：有 option_stock key 的選項，該 key 是此選項上限。
 * 3. products.stock 一律是共享上限。組合與不同規格都要一起占用。
 * 4. 可售數量 = 現貨 − 未到期 held。前端讀不到 inventory_reservations，
 *    也沒有 commerce_active_held 的執行權，所以這裡不把保留量當成 0，
 *    回傳值只是欄位現貨上限，不是最終可售數量。
 *
 * 即時可售要走既有 SECURITY DEFINER 的計算（quote_checkout 對單一已選規格會算 availableQty）。
 * quote_checkout 不是結帳成功，不能把 ok 顯示成交易已確認。
 * 若要給未登入的商品頁使用，最小做法是另加唯讀 public_stock_quote，
 * 只回傳公開商品的 availableQty，不開放保留明細，也不寫訂單。此檔不執行 SQL。
 */

export type StockProduct = {
  stock: number
  variants: { name: string; options: string[] }[]
  optionStock?: Record<string, number> | null
  comboStock?: Record<string, number> | null
}

export type StockLine = {
  variant: Record<string, string>
  qty: number
}

export type StockView = {
  /** null 表示現貨欄位無法解讀，不是 0。 */
  onHand: number | null
  /** true 表示規格還沒選完，數字是符合範圍的現貨合計，再受共享庫存封頂。 */
  aggregate: boolean
}

export const optKey = (group: string, option: string) => `${group}|${option}`

export const comboKey = (product: StockProduct, sel: Record<string, string>) =>
  product.variants.map((group) => optKey(group.name, sel[group.name] ?? '')).join('::')

export const usesComboStock = (product: StockProduct) =>
  product.variants.length > 1 && !!product.comboStock && typeof product.comboStock === 'object'

const readStock = (value: unknown): number | null => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) return null
    return value
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value.trim()) && value.trim().length <= 9) return Number(value.trim())
  return null
}

const hasOwn = (record: Record<string, number> | null | undefined, key: string) =>
  !!record && Object.prototype.hasOwnProperty.call(record, key)

export const selectionComplete = (product: StockProduct, sel: Record<string, string>) =>
  product.variants.length === 0 || product.variants.every((group) => {
    const picked = sel[group.name]
    return !!picked && group.options.includes(picked)
  })

export function stockView(product: StockProduct, sel: Record<string, string>): StockView {
  const shared = readStock(product.stock)
  if (shared == null) return { onHand: null, aggregate: false }
  if (usesComboStock(product)) {
    const matches = product.variants.reduce<Record<string, string>[]>((acc, group) => (
      acc.flatMap((partial) => group.options.map((option) => ({ ...partial, [group.name]: option })))
    ), [{}]).filter((combo) => Object.entries(sel).every(([group, option]) => combo[group] === option))
    if (!selectionComplete(product, sel)) {
      let sum = 0
      for (const combo of matches) {
        const key = comboKey(product, combo)
        if (!hasOwn(product.comboStock, key)) continue
        const qty = readStock(product.comboStock?.[key])
        if (qty == null) return { onHand: null, aggregate: true }
        sum += qty
      }
      return { onHand: Math.min(shared, sum), aggregate: true }
    }
    const key = comboKey(product, sel)
    const comboQty = hasOwn(product.comboStock, key) ? readStock(product.comboStock?.[key]) : 0
    if (comboQty == null) return { onHand: null, aggregate: false }
    return { onHand: Math.min(shared, comboQty), aggregate: false }
  }
  let cap = shared
  for (const [group, option] of Object.entries(sel)) {
    const key = optKey(group, option)
    if (!hasOwn(product.optionStock, key)) continue
    const qty = readStock(product.optionStock?.[key])
    if (qty == null) return { onHand: null, aggregate: false }
    cap = Math.min(cap, qty)
  }
  return { onHand: cap, aggregate: false }
}

/** 單一選項按鈕。非組合商品只看共享庫存與此選項自己的上限，不被其他已選規格的 0 一起反灰。 */
export function optionFieldState(
  product: StockProduct,
  sel: Record<string, string>,
  group: string,
  option: string,
): 'ok' | 'out' | 'unknown' {
  const shared = readStock(product.stock)
  if (shared == null) return 'unknown'
  if (shared === 0) return 'out'
  if (usesComboStock(product)) {
    const view = stockView(product, { ...sel, [group]: option })
    if (view.onHand == null) return 'unknown'
    return view.onHand === 0 ? 'out' : 'ok'
  }
  const key = optKey(group, option)
  if (!hasOwn(product.optionStock, key)) return 'ok'
  const qty = readStock(product.optionStock?.[key])
  if (qty == null) return 'unknown'
  return qty === 0 ? 'out' : 'ok'
}

export function optionFieldOnHand(
  product: StockProduct,
  sel: Record<string, string>,
  group: string,
  option: string,
): number | null {
  if (usesComboStock(product)) return stockView(product, { ...sel, [group]: option }).onHand
  const shared = readStock(product.stock)
  if (shared == null) return null
  const key = optKey(group, option)
  if (!hasOwn(product.optionStock, key)) return shared
  const qty = readStock(product.optionStock?.[key])
  if (qty == null) return null
  return Math.min(shared, qty)
}

/**
 * 這條購物車規格還能放到幾件。siblings 是同一商品的其他列。
 * 同時受共享 products.stock、option_stock、combo_stock 限制。
 * 無法解讀時回 null，呼叫端不可改當成 0 或最終可售。
 */
export function maxLineOnHand(product: StockProduct, variant: Record<string, string>, siblings: StockLine[]): number | null {
  const shared = readStock(product.stock)
  if (shared == null) return null
  let usedShared = 0
  for (const line of siblings) {
    if (!Number.isInteger(line.qty) || line.qty < 1) return null
    usedShared += line.qty
  }
  let cap = Math.max(0, shared - usedShared)
  if (usesComboStock(product)) {
    const key = comboKey(product, variant)
    const comboQty = hasOwn(product.comboStock, key) ? readStock(product.comboStock?.[key]) : 0
    if (comboQty == null) return null
    let used = 0
    for (const line of siblings) {
      if (comboKey(product, line.variant) === key) used += line.qty
    }
    return Math.min(cap, Math.max(0, comboQty - used))
  }
  for (const [group, option] of Object.entries(variant)) {
    const key = optKey(group, option)
    if (!hasOwn(product.optionStock, key)) continue
    const qty = readStock(product.optionStock?.[key])
    if (qty == null) return null
    let used = 0
    for (const line of siblings) {
      if (line.variant[group] === option) used += line.qty
    }
    cap = Math.min(cap, Math.max(0, qty - used))
  }
  return cap
}
