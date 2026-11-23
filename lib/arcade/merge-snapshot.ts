/**
 * 只接受資料庫回傳、而且沒有 Pay 點入帳的合成進度。
 * 解析失敗時畫面不改本地數字。
 */
import {
  MERGE_CELLS,
  MERGE_GAME_VERSION,
  MERGE_QUEST_COINS,
  MERGE_QUEST_TARGET,
  MERGE_QUEST_XP,
  MERGE_REGEN_SECONDS,
  MERGE_TUNING_STATUS,
  itemParts,
  maxShopLevelFor,
  producerCap,
  type MergeOrder,
} from './merge-rules'

export type MergeSnapshot = {
  exists: true
  replayed: boolean
  gameVersion: typeof MERGE_GAME_VERSION
  revision: number
  coins: number
  xp: number
  shopLevel: number
  cells: (string | null)[]
  catalog: string[]
  orders: MergeOrder[]
  orderSerial: number
  lifetimeOrders: number
  ordersCompletedToday: number
  questTarget: number
  questClaimed: boolean
  questRewardCoins: number
  questRewardXp: number
  producerCharges: number
  producerCap: number
  producerAnchor: string
  serverNow: string
  regenSeconds: number
  taipeiDay: string
  payPointsDelta: 0
  payoutEnabled: false
  tuningStatus: typeof MERGE_TUNING_STATUS
  upgradeCost: number | null
  updatedAt: string
  /** 1＝舊資料庫（最高 Lv.5），2＝已套用合成 v2（Lv.6 水果線）。 */
  contentVersion: 1 | 2
}

export type MergeEmptySnapshot = {
  exists: false
  replayed: false
  payPointsDelta: 0
  payoutEnabled: false
  tuningStatus: typeof MERGE_TUNING_STATUS
  taipeiDay: string
  gameVersion: typeof MERGE_GAME_VERSION
}

export type MergeRead = MergeSnapshot | MergeEmptySnapshot

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function whole(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null
  return value
}

function flag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return null
  return value
}

function closedPayout(body: Record<string, unknown>): boolean {
  return body.payPointsDelta === 0 && body.payoutEnabled === false && body.tuningStatus === MERGE_TUNING_STATUS
}

function parseOrder(value: unknown): MergeOrder | null {
  const body = record(value)
  if (!body) return null
  const id = text(body.id, 80)
  const itemId = text(body.itemId, 20)
  const qty = whole(body.qty, 1, 5)
  const coins = whole(body.coins, 0, 500)
  const xp = whole(body.xp, 0, 500)
  if (!id || !itemId || qty == null || coins == null || xp == null || !itemParts(itemId)) return null
  if (!/^ord-\d+-\d+$/.test(id)) return null
  return { id, itemId, qty, coins, xp }
}

export function parseMergeRead(value: unknown): MergeRead | null {
  const body = record(value)
  if (!body || !closedPayout(body) || body.gameVersion !== MERGE_GAME_VERSION) return null
  const taipeiDay = text(body.taipeiDay, 10)
  if (!taipeiDay || !/^\d{4}-\d{2}-\d{2}$/.test(taipeiDay)) return null
  if (body.exists === false) {
    if (body.replayed !== false) return null
    return {
      exists: false,
      replayed: false,
      payPointsDelta: 0,
      payoutEnabled: false,
      tuningStatus: MERGE_TUNING_STATUS,
      taipeiDay,
      gameVersion: MERGE_GAME_VERSION,
    }
  }
  if (body.exists !== true) return null
  const replayed = flag(body.replayed)
  const revision = whole(body.revision, 1, 1_000_000_000)
  const coins = whole(body.coins, 0, 1_000_000_000)
  const xp = whole(body.xp, 0, 1_000_000_000)
  const contentVersion = body.contentVersion === 2 ? 2 : 1
  const shopLevel = whole(body.shopLevel, 1, maxShopLevelFor(contentVersion))
  const orderSerial = whole(body.orderSerial, 0, 1_000_000_000)
  const lifetimeOrders = whole(body.lifetimeOrders, 0, 1_000_000_000)
  const ordersCompletedToday = whole(body.ordersCompletedToday, 0, 1_000_000)
  const questClaimed = flag(body.questClaimed)
  const producerCharges = whole(body.producerCharges, 0, 100)
  const upgradeCost = body.upgradeCost === null ? null : whole(body.upgradeCost, 1, 100_000)
  const producerAnchor = text(body.producerAnchor, 64)
  const serverNow = text(body.serverNow, 64)
  const updatedAt = text(body.updatedAt, 64)
  if (
    replayed == null || revision == null || coins == null || xp == null || shopLevel == null
    || orderSerial == null || lifetimeOrders == null || ordersCompletedToday == null || questClaimed == null
    || producerCharges == null || upgradeCost === undefined || !producerAnchor || !serverNow || !updatedAt
    || body.questTarget !== MERGE_QUEST_TARGET || body.questRewardCoins !== MERGE_QUEST_COINS
    || body.questRewardXp !== MERGE_QUEST_XP || body.regenSeconds !== MERGE_REGEN_SECONDS
    || body.producerCap !== producerCap(shopLevel)
  ) return null
  if (!Array.isArray(body.cells) || body.cells.length !== MERGE_CELLS) return null
  const cells: (string | null)[] = []
  for (const cell of body.cells) {
    if (cell === null) {
      cells.push(null)
      continue
    }
    if (typeof cell !== 'string' || !itemParts(cell)) return null
    cells.push(cell)
  }
  if (!Array.isArray(body.catalog) || body.catalog.length > 40) return null
  const catalog: string[] = []
  for (const item of body.catalog) {
    if (typeof item !== 'string' || !itemParts(item) || catalog.includes(item)) return null
    catalog.push(item)
  }
  if (!Array.isArray(body.orders) || body.orders.length > 4) return null
  const orders: MergeOrder[] = []
  for (const order of body.orders) {
    const parsed = parseOrder(order)
    if (!parsed) return null
    orders.push(parsed)
  }
  return {
    exists: true,
    replayed,
    gameVersion: MERGE_GAME_VERSION,
    revision,
    coins,
    xp,
    shopLevel,
    cells,
    catalog,
    orders,
    orderSerial,
    lifetimeOrders,
    ordersCompletedToday,
    questTarget: MERGE_QUEST_TARGET,
    questClaimed,
    questRewardCoins: MERGE_QUEST_COINS,
    questRewardXp: MERGE_QUEST_XP,
    producerCharges,
    producerCap: producerCap(shopLevel),
    producerAnchor,
    serverNow,
    regenSeconds: MERGE_REGEN_SECONDS,
    taipeiDay,
    payPointsDelta: 0,
    payoutEnabled: false,
    tuningStatus: MERGE_TUNING_STATUS,
    upgradeCost,
    updatedAt,
    contentVersion,
  }
}

export function mergeFailureMessage(message: string): string {
  const text = message.replace(/\s+/g, ' ').trim()
  const known = [
    '請先登入',
    '請先開始營業',
    '商店已經開張',
    '動作編號不正確',
    '動作內容不正確',
    '這個動作不能使用',
    '遊戲進度已更新，請重新整理',
    '這裡沒有商品',
    '要選兩個不同位置',
    '這個位置已經有商品',
    '要兩件相同商品才能合成',
    '這件商品已經是最高階',
    '商品資料不正確',
    '原料補貨還沒準備好',
    '棋盤已滿，先合成或交付訂單',
    '找不到這張顧客訂單',
    '交付數量不對',
    '交付位置重複',
    '交付的商品不符合訂單',
    '遊戲金幣不足',
    '商店已經升到目前開放的最高級',
    '今日顧客任務還沒完成',
    '今天的顧客任務已經領過',
    '顧客訂單不正確',
    '遊戲進度只能由合成交易更新',
  ]
  const hit = known.find((item) => text.includes(item))
  if (hit) return hit
  if (/could not find the function|schema cache|does not exist|PGRST202|42883/i.test(text)) {
    return '合成小舖的進度保存還沒套用到目前資料庫'
  }
  if (/failed to fetch|network|timeout/i.test(text)) return '網路沒有完成，遊戲進度沒有變更'
  return '遊戲進度沒有變更'
}

export function mergeSaveUnavailable(message: string): boolean {
  return message === '合成小舖的進度保存還沒套用到目前資料庫'
}
