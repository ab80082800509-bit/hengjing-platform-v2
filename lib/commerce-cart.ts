/**
 * 購物車的純資料轉換。
 * 已登入會員的寫入仍走既有 add_cart_item / list_my_cart / set_cart_item_qty / remove_cart_item。
 * 這裡不建立資料表，也不開啟結帳。
 */

export const LEGACY_CART_KEY = 'hj-cart'
export const CART_MIGRATION_MARKER_KEY = 'hj-cart-migrated'

export type CartVariant = Record<string, string>

export type RemoteCartLine = {
  key: string
  cartItemId?: string
  productId: string
  variant: CartVariant
  qty: number
  sellerId?: string
  name?: string
  image?: string
  unitPrice?: number | null
  purchasable?: boolean
  unavailableReason?: string
}

export function variantToken(variant: CartVariant): string {
  return JSON.stringify(Object.keys(variant).sort().map((key) => [key, variant[key]]))
}

export function lineIdentity(line: { productId: string; variant: CartVariant }): string {
  return `${line.productId}|${variantToken(line.variant)}`
}

export function cartCounts(lines: { qty: number }[]): { items: number; pieces: number; label: string } {
  const items = lines.length
  const pieces = lines.reduce((sum, line) => sum + line.qty, 0)
  return { items, pieces, label: `${items} 項商品，共 ${pieces} 件` }
}

export function migrationToken(userId: string, raw: string | null): string {
  const text = `${userId}\n${raw ?? ''}`
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index)
  }
  return `${userId}:${(hash >>> 0).toString(16)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function asVariant(value: unknown): CartVariant | null {
  const row = asRecord(value)
  if (!row) return null
  const variant: CartVariant = {}
  for (const [key, item] of Object.entries(row)) {
    if (typeof item !== 'string') return null
    variant[key] = item
  }
  return variant
}

export function parseLegacyCart(raw: string | null): RemoteCartLine[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      const line = asRecord(item)
      if (!line || typeof line.productId !== 'string') return []
      if (typeof line.qty !== 'number' || !Number.isInteger(line.qty) || line.qty < 1) return []
      const variant = asVariant(line.variant)
      if (!variant) return []
      return [{
        key: typeof line.key === 'string' ? line.key : lineIdentity({ productId: line.productId, variant }),
        productId: line.productId,
        variant,
        qty: line.qty,
      }]
    })
  } catch {
    return []
  }
}

/**
 * 伺服器已有同一商品與同一規格時整筆略過，避免 add_cart_item 的衝突更新把數量再累加一次。
 * 舊清單裡同一規格的重複列只合併成一筆後送出一次。原始 hj-cart 文字不在這裡刪除。
 */
export function legacyLinesToImport(local: RemoteCartLine[], remote: RemoteCartLine[]): RemoteCartLine[] {
  const present = new Set(remote.map(lineIdentity))
  const merged = new Map<string, RemoteCartLine>()
  for (const line of local) {
    const id = lineIdentity(line)
    if (present.has(id)) continue
    const previous = merged.get(id)
    if (!previous) {
      merged.set(id, { ...line, variant: { ...line.variant } })
      continue
    }
    previous.qty += line.qty
  }
  return [...merged.values()]
}

export function parseCartPlan(payload: unknown): { lines: RemoteCartLine[] } | null {
  const row = asRecord(payload)
  if (!row || !Array.isArray(row.lines)) return null
  const lines: RemoteCartLine[] = []
  for (const item of row.lines) {
    const line = asRecord(item)
    if (!line || typeof line.productId !== 'string' || !line.productId) return null
    if (typeof line.qty !== 'number' || !Number.isInteger(line.qty) || line.qty < 1) return null
    const variant = line.variant == null ? {} : asVariant(line.variant)
    if (!variant) return null
    const cartItemId = typeof line.cartItemId === 'string' && line.cartItemId ? line.cartItemId : undefined
    const issues = Array.isArray(line.issues) ? line.issues : []
    const firstIssue = issues.map(asRecord).find((issue) => issue && typeof issue.message === 'string')
    const purchasable = line.purchasable === true
    lines.push({
      key: cartItemId || lineIdentity({ productId: line.productId, variant }),
      cartItemId,
      productId: line.productId,
      variant,
      qty: line.qty,
      sellerId: typeof line.sellerId === 'string' ? line.sellerId : undefined,
      name: typeof line.name === 'string' ? line.name : undefined,
      image: typeof line.image === 'string' ? line.image : undefined,
      unitPrice: typeof line.unitPrice === 'number' && Number.isInteger(line.unitPrice) ? line.unitPrice : null,
      purchasable,
      unavailableReason: purchasable ? undefined : (firstIssue?.message as string | undefined) || '此商品目前不能結帳',
    })
  }
  return { lines }
}

export function findSellerForMember<T extends { id: string; userId?: string; verify?: string }>(
  sellers: T[],
  memberId: string,
): T | undefined {
  if (!memberId) return undefined
  const byMember = sellers.filter((seller) => !!seller.userId && seller.userId === memberId)
  return byMember.find((seller) => seller.verify === 'approved') ?? byMember[0] ?? sellers.find((seller) => seller.id === memberId)
}

export function cartSellerKey(seller: { id: string; userId?: string }, memberId: string): string {
  return seller.userId && seller.userId === memberId ? seller.userId : seller.id
}

export function legacyCartPayload(lines: RemoteCartLine[]): string {
  return JSON.stringify(lines.map((line) => ({
    key: line.key,
    productId: line.productId,
    variant: line.variant,
    qty: line.qty,
  })))
}
