/**
 * 每件商品對目前會員的兌換狀態。商城 v2 由資料庫 get_my_points_mall.perks 回傳真實狀態；
 * 資料庫還是 v1（沒有 perks 欄位）時，只有原有 15 件能照舊判斷，新 25 件顯示「尚未上架」。
 * 這裡只決定畫面怎麼說，扣點與所有檢查仍在 purchase_my_perk 交易內。
 */
import { UNLOCK_TEXT, perkDefinitionById, type PerkDefinition } from './perk-catalog'

export const MALL_STATES = ['available', 'owned', 'closed', 'not_started', 'ended', 'sold_out', 'locked', 'short'] as const
export type MallServerState = (typeof MALL_STATES)[number]
export type MallPerkStateKind = MallServerState | 'unlisted' | 'loading' | 'paused' | 'guest'

export type MallPerkServer = {
  id: string
  cost: number
  state: MallServerState
  unlockTarget?: number
  unlockProgress?: number
  opensOn?: string
  closesOn?: string
  stockLimit?: number
  stockLeft?: number
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : undefined)

export function parseMallPerks(value: unknown): MallPerkServer[] | null {
  if (!Array.isArray(value) || value.length > 200) return null
  const out: MallPerkServer[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !perkDefinitionById.has(row.id)) continue
    if (!Number.isInteger(row.cost) || (row.cost as number) <= 0) return null
    if (typeof row.state !== 'string' || !(MALL_STATES as readonly string[]).includes(row.state)) return null
    out.push({
      id: row.id,
      cost: row.cost as number,
      state: row.state as MallServerState,
      unlockTarget: int(row.unlockTarget),
      unlockProgress: int(row.unlockProgress),
      opensOn: typeof row.opensOn === 'string' && DAY.test(row.opensOn) ? row.opensOn : undefined,
      closesOn: typeof row.closesOn === 'string' && DAY.test(row.closesOn) ? row.closesOn : undefined,
      stockLimit: int(row.stockLimit),
      stockLeft: int(row.stockLeft),
    })
  }
  return out
}

export type PerkView = {
  kind: MallPerkStateKind
  /** 顯示用價格：有資料庫價格就用資料庫的。 */
  cost: number
  /** 按鈕或狀態標籤上的短字 */
  label: string
  /** 補充說明（解鎖進度、開賣日、剩餘數量） */
  note?: string
  canBuy: boolean
}

const slash = (day: string) => day.slice(5).replace('-', '/')
const prevDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function perkView(
  perk: PerkDefinition,
  ctx: {
    loggedIn: boolean
    owned: boolean
    balance: number | null
    /** null：還在讀取或讀取失敗 */
    purchaseOpen: boolean | null
    paused?: boolean
    server: ReadonlyMap<string, MallPerkServer> | null
  },
): PerkView {
  const row = ctx.server?.get(perk.id)
  const cost = row?.cost ?? perk.cost
  const stock = row?.stockLeft != null && row.stockLimit != null ? `限量 ${row.stockLimit}，剩 ${row.stockLeft}` : undefined
  if (ctx.owned) return { kind: 'owned', cost, label: perk.category === 'sticker' ? '已擁有・聊天可用' : '已擁有', canBuy: false }
  if (!ctx.loggedIn) return { kind: 'guest', cost, label: '登入後兌換', canBuy: false }
  if (ctx.paused) return { kind: 'paused', cost, label: '暫停兌換', canBuy: false }
  if (ctx.purchaseOpen == null) return { kind: 'loading', cost, label: '讀取中', canBuy: false }
  if (!row) {
    if (perk.category === 'sticker' && (ctx.server || perk.since === 2)) {
      return { kind: 'unlisted', cost, label: '已停止販售', note: '聊天貼圖登入即可使用，不再扣點', canBuy: false }
    }
    if (ctx.server || perk.since === 2) return { kind: 'unlisted', cost, label: '尚未上架', note: '商城資料庫還沒有這件商品', canBuy: false }
    if (!ctx.purchaseOpen) return { kind: 'closed', cost, label: '兌換未開放', canBuy: false }
    if (ctx.balance != null && ctx.balance < cost) return { kind: 'short', cost, label: '點數不足', note: `還差 ${cost - ctx.balance} 點`, canBuy: false }
    return { kind: 'available', cost, label: '兌換', canBuy: ctx.balance != null }
  }
  switch (row.state) {
    case 'owned':
      return { kind: 'owned', cost, label: '已擁有', canBuy: false }
    case 'closed':
      return { kind: 'closed', cost, label: '兌換未開放', canBuy: false }
    case 'not_started':
      return { kind: 'not_started', cost, label: '尚未開始', note: row.opensOn ? `${slash(row.opensOn)} 開賣` : undefined, canBuy: false }
    case 'ended':
      return { kind: 'ended', cost, label: '已過期', note: '販售期已結束，已兌換的收藏永久保留', canBuy: false }
    case 'sold_out':
      return { kind: 'sold_out', cost, label: '已售完', note: stock, canBuy: false }
    case 'locked': {
      const unlock = perk.unlock
      const target = row.unlockTarget ?? unlock?.target ?? 0
      const text = unlock ? UNLOCK_TEXT[unlock.metric](target) : '尚未達成解鎖條件'
      return { kind: 'locked', cost, label: '未解鎖', note: `${text}（目前 ${row.unlockProgress ?? 0}）`, canBuy: false }
    }
    case 'short': {
      const gap = ctx.balance != null ? cost - ctx.balance : null
      return { kind: 'short', cost, label: '點數不足', note: gap && gap > 0 ? `還差 ${gap} 點` : undefined, canBuy: false }
    }
    default: {
      const until = row.closesOn ? `販售至 ${slash(prevDay(row.closesOn))}` : undefined
      return { kind: 'available', cost, label: '兌換', note: [until, stock].filter(Boolean).join('・') || undefined, canBuy: true }
    }
  }
}
