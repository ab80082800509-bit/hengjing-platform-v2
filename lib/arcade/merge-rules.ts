/**
 * Pay 服合成小舖的規則。
 * 金幣、經驗與升級成本都尚未正式簽核。
 * 這個模組不連線、不發 Pay 點，也不能代替資料庫鎖。
 * 正式進度只接受資料庫交易算過的結果。
 */
export const MERGE_GAME_VERSION = 'stage6-batch1'
export const MERGE_TUNING_STATUS = 'pending_approval' as const
export const MERGE_TUNING_CONFIRMED = false as const
export const MERGE_CELLS = 30
export const MERGE_REGEN_SECONDS = 30
export const MERGE_QUEST_TARGET = 3
export const MERGE_QUEST_COINS = 24
export const MERGE_QUEST_XP = 12
/** 內容版本 2：Lv.6 與水果線。資料庫要套用合成 v2 SQL 才會回傳 contentVersion 2。 */
export const MERGE_CONTENT_VERSION = 2
export const MERGE_MAX_SHOP_LEVEL = 6
export const MERGE_ACTIVE_ORDERS = 2
export const MERGE_UPGRADE_COST = [0, 30, 80, 160, 320, 600] as const
export const MERGE_ORDER_COINS = [0, 6, 12, 20, 32, 48] as const
export const MERGE_ORDER_XP = [0, 4, 8, 12, 18, 24] as const

export const MERGE_CHAINS = [
  { id: 'tea', unlockLevel: 1, since: 1, names: ['茶葉', '溫杯', '清茶', '奶茶', '金盞'] },
  { id: 'snack', unlockLevel: 2, since: 1, names: ['糯米', '湯圓', '紅龜粿', '發糕', '喜餅'] },
  { id: 'gift', unlockLevel: 3, since: 1, names: ['卡片', '紙袋', '絲帶', '禮盒', '招牌禮'] },
  { id: 'fruit', unlockLevel: 6, since: 2, names: ['鳳梨', '芒果', '鳳梨酥', '芒果冰', '水果禮籃'] },
] as const

/** 舊資料庫（contentVersion 1）最高只到 Lv.5，也還不認得水果線。 */
export function maxShopLevelFor(contentVersion: number): number {
  return contentVersion >= 2 ? MERGE_MAX_SHOP_LEVEL : 5
}

export const MERGE_ERRORS = {
  open: '商店已經開張',
  needStart: '請先開始營業',
  login: '請先登入',
  action: '這個動作不能使用',
  payload: '動作內容不正確',
  actionKey: '動作編號不正確',
  conflict: '遊戲進度已更新，請重新整理',
  empty: '這裡沒有商品',
  sameCell: '要選兩個不同位置',
  occupied: '這個位置已經有商品',
  mergePair: '要兩件相同商品才能合成',
  maxItem: '這件商品已經是最高階',
  badItem: '商品資料不正確',
  noCharge: '原料補貨還沒準備好',
  full: '棋盤已滿，先合成或交付訂單',
  order: '找不到這張顧客訂單',
  serveCount: '交付數量不對',
  serveDup: '交付位置重複',
  serveItem: '交付的商品不符合訂單',
  coins: '遊戲金幣不足',
  maxShop: '商店已經升到目前開放的最高級',
  quest: '今日顧客任務還沒完成',
  questDone: '今天的顧客任務已經領過',
  range: '顧客訂單不正確',
} as const

const ITEM_RE = /^(tea|snack|gift|fruit)-([1-5])$/

export type MergeOrder = {
  id: string
  itemId: string
  qty: number
  coins: number
  xp: number
}

export type MergeState = {
  coins: number
  xp: number
  shopLevel: number
  cells: (string | null)[]
  catalog: string[]
  orders: MergeOrder[]
  orderSerial: number
  lifetimeOrders: number
  questDay: string
  ordersCompletedToday: number
  questClaimed: boolean
  producerCharges: number
  producerAnchorMs: number
  actionSeq: number
  revision: number
  gameVersion: string
}

export type MergeClock = {
  nowMs: number
  taipeiDay: string
}

export type MergeAction =
  | { type: 'start' }
  | { type: 'move'; from: number; to: number }
  | { type: 'merge'; from: number; to: number }
  | { type: 'spawn'; to: number }
  | { type: 'serve'; orderId: string; cells: number[] }
  | { type: 'upgrade' }
  | { type: 'claim_quest' }

export function mix32(seq: number): number {
  return (Math.imul(seq + 1, 1664525) + 1013904223) >>> 0
}

export function producerCap(shopLevel: number): number {
  return 4 + shopLevel
}

export function upgradeCost(shopLevel: number): number | null {
  if (shopLevel < 1 || shopLevel >= MERGE_MAX_SHOP_LEVEL) return null
  return MERGE_UPGRADE_COST[shopLevel] ?? null
}

export function unlockedChains(shopLevel: number) {
  return MERGE_CHAINS.filter((chain) => chain.unlockLevel <= shopLevel)
}

export function itemParts(itemId: string): { chain: string; level: number } | null {
  const match = ITEM_RE.exec(itemId)
  if (!match) return null
  return { chain: match[1], level: Number(match[2]) }
}

export function itemName(itemId: string): string {
  const parts = itemParts(itemId)
  const chain = MERGE_CHAINS.find((entry) => entry.id === parts?.chain)
  if (!parts || !chain) return '未知商品'
  return chain.names[parts.level - 1] ?? '未知商品'
}

export function nextItem(itemId: string): string | null {
  const parts = itemParts(itemId)
  if (!parts || parts.level >= 5) return null
  return `${parts.chain}-${parts.level + 1}`
}

export function clerkRank(xp: number): string {
  if (xp >= 300) return '招牌店長'
  if (xp >= 140) return '店長候補'
  if (xp >= 60) return '熟手店員'
  if (xp >= 20) return '櫃檯店員'
  return '見習店員'
}

export function makeOrder(shopLevel: number, serial: number, actionSeq: number): MergeOrder {
  const chains = unlockedChains(shopLevel)
  const chain = chains[serial % chains.length] ?? MERGE_CHAINS[0]
  const maxAsk = Math.min(chain.names.length, shopLevel + 1)
  const ask = 1 + (serial % maxAsk)
  const qty = ask === 1 ? 2 : 1
  return {
    id: `ord-${actionSeq}-${serial}`,
    itemId: `${chain.id}-${ask}`,
    qty,
    coins: MERGE_ORDER_COINS[ask] * qty,
    xp: MERGE_ORDER_XP[ask],
  }
}

export function regenCharges(state: Pick<MergeState, 'producerCharges' | 'producerAnchorMs' | 'shopLevel'>, nowMs: number) {
  const cap = producerCap(state.shopLevel)
  const elapsed = Math.floor((nowMs - state.producerAnchorMs) / 1000)
  const gained = Math.floor(elapsed / MERGE_REGEN_SECONDS)
  if (gained <= 0) return { charges: state.producerCharges, anchorMs: state.producerAnchorMs }
  if (state.producerCharges >= cap) return { charges: cap, anchorMs: nowMs }
  const charges = Math.min(cap, state.producerCharges + gained)
  const used = charges - state.producerCharges
  return {
    charges,
    anchorMs: charges >= cap ? nowMs : state.producerAnchorMs + used * MERGE_REGEN_SECONDS * 1000,
  }
}

function assertCell(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= MERGE_CELLS) throw new Error(MERGE_ERRORS.payload)
}

function assertDay(day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(MERGE_ERRORS.payload)
}

function addCatalog(catalog: string[], itemId: string): string[] {
  return catalog.includes(itemId) ? catalog : [...catalog, itemId]
}

function emptyBoard(): (string | null)[] {
  const cells: (string | null)[] = Array.from({ length: MERGE_CELLS }, () => null)
  cells[0] = 'tea-1'
  cells[1] = 'tea-1'
  cells[2] = 'tea-1'
  return cells
}

function rollDay(state: MergeState, day: string): MergeState {
  if (state.questDay === day) return state
  return { ...state, questDay: day, ordersCompletedToday: 0, questClaimed: false }
}

function bump(state: MergeState): MergeState {
  return { ...state, actionSeq: state.actionSeq + 1, revision: state.revision + 1 }
}

function withRegen(state: MergeState, nowMs: number): MergeState {
  const next = regenCharges(state, nowMs)
  return { ...state, producerCharges: next.charges, producerAnchorMs: next.anchorMs }
}

export function createMergeShop(clock: MergeClock): MergeState {
  assertDay(clock.taipeiDay)
  if (!Number.isFinite(clock.nowMs)) throw new Error(MERGE_ERRORS.payload)
  const level = 1
  return {
    coins: 0,
    xp: 0,
    shopLevel: level,
    cells: emptyBoard(),
    catalog: ['tea-1'],
    orders: [makeOrder(level, 0, 0), makeOrder(level, 1, 0)],
    orderSerial: 2,
    lifetimeOrders: 0,
    questDay: clock.taipeiDay,
    ordersCompletedToday: 0,
    questClaimed: false,
    producerCharges: producerCap(level),
    producerAnchorMs: clock.nowMs,
    actionSeq: 0,
    revision: 1,
    gameVersion: MERGE_GAME_VERSION,
  }
}

function prepare(state: MergeState, clock: MergeClock): MergeState {
  assertDay(clock.taipeiDay)
  return bump(withRegen(rollDay(state, clock.taipeiDay), clock.nowMs))
}

function move(state: MergeState, from: number, to: number): MergeState {
  assertCell(from)
  assertCell(to)
  if (from === to) throw new Error(MERGE_ERRORS.sameCell)
  const source = state.cells[from]
  if (!source) throw new Error(MERGE_ERRORS.empty)
  const cells = state.cells.slice()
  cells[from] = state.cells[to] ?? null
  cells[to] = source
  return { ...state, cells }
}

function merge(state: MergeState, from: number, to: number): MergeState {
  assertCell(from)
  assertCell(to)
  if (from === to) throw new Error(MERGE_ERRORS.sameCell)
  const source = state.cells[from]
  const target = state.cells[to]
  if (!source || !target) throw new Error(MERGE_ERRORS.mergePair)
  if (!itemParts(source) || !itemParts(target)) throw new Error(MERGE_ERRORS.badItem)
  if (source !== target) throw new Error(MERGE_ERRORS.mergePair)
  const produced = nextItem(source)
  if (!produced) throw new Error(MERGE_ERRORS.maxItem)
  const cells = state.cells.slice()
  cells[from] = null
  cells[to] = produced
  return { ...state, cells, catalog: addCatalog(state.catalog, produced) }
}

function spawn(state: MergeState, to: number, nowMs: number): MergeState {
  assertCell(to)
  if (state.cells[to]) throw new Error(MERGE_ERRORS.occupied)
  const cap = producerCap(state.shopLevel)
  let charges = state.producerCharges
  let anchorMs = state.producerAnchorMs
  if (charges >= cap) anchorMs = nowMs
  if (charges < 1) throw new Error(MERGE_ERRORS.noCharge)
  charges -= 1
  const itemId = `${unlockedChains(state.shopLevel)[mix32(state.actionSeq) % unlockedChains(state.shopLevel).length]?.id ?? 'tea'}-1`
  const cells = state.cells.slice()
  cells[to] = itemId
  return { ...state, cells, producerCharges: charges, producerAnchorMs: anchorMs, catalog: addCatalog(state.catalog, itemId) }
}

function serve(state: MergeState, orderId: string, indexes: number[]): MergeState {
  const order = state.orders.find((entry) => entry.id === orderId)
  if (!order) throw new Error(MERGE_ERRORS.order)
  if (!Array.isArray(indexes) || indexes.length !== order.qty) throw new Error(MERGE_ERRORS.serveCount)
  if (new Set(indexes).size !== indexes.length) throw new Error(MERGE_ERRORS.serveDup)
  indexes.forEach(assertCell)
  if (indexes.some((index) => state.cells[index] !== order.itemId)) throw new Error(MERGE_ERRORS.serveItem)
  if (order.coins < 0 || order.coins > 500 || order.xp < 0 || order.xp > 500) throw new Error(MERGE_ERRORS.range)
  const cells = state.cells.slice()
  indexes.forEach((index) => {
    cells[index] = null
  })
  const replacement = makeOrder(state.shopLevel, state.orderSerial, state.actionSeq)
  return {
    ...state,
    cells,
    coins: state.coins + order.coins,
    xp: state.xp + order.xp,
    orders: [...state.orders.filter((entry) => entry.id !== order.id), replacement],
    orderSerial: state.orderSerial + 1,
    lifetimeOrders: state.lifetimeOrders + 1,
    ordersCompletedToday: state.ordersCompletedToday + 1,
  }
}

function upgrade(state: MergeState): MergeState {
  const cost = upgradeCost(state.shopLevel)
  if (cost == null) throw new Error(MERGE_ERRORS.maxShop)
  if (state.coins < cost) throw new Error(MERGE_ERRORS.coins)
  const shopLevel = state.shopLevel + 1
  let catalog = state.catalog
  if (shopLevel === 2) catalog = addCatalog(catalog, 'snack-1')
  if (shopLevel === 3) catalog = addCatalog(catalog, 'gift-1')
  if (shopLevel === 6) catalog = addCatalog(catalog, 'fruit-1')
  return { ...state, coins: state.coins - cost, shopLevel, catalog }
}

function claimQuest(state: MergeState): MergeState {
  if (state.questClaimed) throw new Error(MERGE_ERRORS.questDone)
  if (state.ordersCompletedToday < MERGE_QUEST_TARGET) throw new Error(MERGE_ERRORS.quest)
  return {
    ...state,
    coins: state.coins + MERGE_QUEST_COINS,
    xp: state.xp + MERGE_QUEST_XP,
    questClaimed: true,
  }
}

export function applyMergeAction(
  state: MergeState | null,
  action: MergeAction,
  clock: MergeClock,
  expectedRevision?: number,
): MergeState {
  if (action.type === 'start') {
    if (state) return state
    return createMergeShop(clock)
  }
  if (!state) throw new Error(MERGE_ERRORS.needStart)
  if (expectedRevision !== undefined && expectedRevision !== state.revision) throw new Error(MERGE_ERRORS.conflict)
  const ready = prepare(state, clock)
  if (action.type === 'move') return move(ready, action.from, action.to)
  if (action.type === 'merge') return merge(ready, action.from, action.to)
  if (action.type === 'spawn') return spawn(ready, action.to, clock.nowMs)
  if (action.type === 'serve') return serve(ready, action.orderId, action.cells)
  if (action.type === 'upgrade') return upgrade(ready)
  if (action.type === 'claim_quest') return claimQuest(ready)
  throw new Error(MERGE_ERRORS.action)
}

export function firstEmptyCell(cells: (string | null)[]): number | null {
  const index = cells.findIndex((cell) => cell == null)
  return index === -1 ? null : index
}

export function cellsForOrder(cells: (string | null)[], itemId: string, qty: number): number[] | null {
  const found = cells.flatMap((cell, index) => (cell === itemId ? [index] : [])).slice(0, qty)
  return found.length === qty ? found : null
}
