/**
 * 夢想商店街單人經營規則。純函式、不碰 DOM，畫面與存檔層都只透過這裡改動遊戲狀態。
 *
 * 經濟限制：金幣與經驗值只在夢想商店街內使用，不能換成 Pay 點數，也不連動商品、訂單或 Inventory。
 * 登入會員的存檔同步到雲端時，金幣與經驗由資料庫依 stats 增量、規則花費與伺服器獎勵紀錄重算，
 * 這裡算出的金幣只是畫面上的即時值（見 lib/arcade/street-cloud.ts）。
 *
 * 時間有兩種：
 * - sim.t：遊戲內經過的毫秒，只有畫面可見時才前進，顧客移動、耐心與製作都用它。
 * - clock：真實時間（epoch ms），只用在經營紀錄與「今日」統計。
 */

/** 存檔內容版本。瀏覽器鍵名仍沿用 v1，舊檔在讀取時升級，不換鍵。
 * v3：店面裝潢改為每間店各自一格（equipped.shops），v2 的 equipped.shop 讀進主店。 */
export const STREET_SAVE_VERSION = 3
const READABLE_SAVE_VERSIONS = [1, 2, 3] as const

export type ProductCategory = 'bake' | 'drink' | 'sweet' | 'gift'

export type ProductId =
  | 'croissant'
  | 'milktea'
  | 'cookie'
  | 'cocoa'
  | 'cake'
  | 'macaron'
  | 'lemonade'
  | 'roll'
  | 'tart'
  | 'coffee'
  | 'giftbox'
  | 'parfait'
  | 'sandwich'
  | 'choco'
  | 'wedding'
  | 'taro'
  | 'pineapple'
  | 'yolkcake'

export type StreetProduct = {
  id: ProductId
  name: string
  category: ProductCategory
  price: number
  xp: number
  makeMs: number
  unlock: number
  /** 從哪個內容版本開始供應；沒寫就是 1。 */
  since?: number
}

/**
 * 內容版本 2：新商品與新裝潢。資料庫套用商店街 v2 SQL 後，雲端存檔回覆才會帶 contentVersion 2；
 * 在那之前（含訪客只存本機）只開放 v1 內容，避免買了資料庫不認得的東西。只影響玩法，讀存檔不看這個開關。
 */
export const STREET_CONTENT_VERSION = 2
let liveContent = 1
export const setStreetContentVersion = (version: number) => {
  liveContent = version >= STREET_CONTENT_VERSION ? STREET_CONTENT_VERSION : 1
}
export const streetContentVersion = () => liveContent
const isLive = (item: { since?: number }) => (item.since ?? 1) <= liveContent

export const STREET_PRODUCTS: readonly StreetProduct[] = [
  { id: 'croissant', name: '奶油可頌', category: 'bake', price: 12, xp: 4, makeMs: 3000, unlock: 1 },
  { id: 'milktea', name: '珍珠奶茶', category: 'drink', price: 15, xp: 5, makeMs: 4000, unlock: 1 },
  { id: 'cookie', name: '奶油餅乾', category: 'bake', price: 8, xp: 3, makeMs: 2200, unlock: 1 },
  { id: 'cocoa', name: '熱可可', category: 'drink', price: 18, xp: 6, makeMs: 4800, unlock: 1 },
  { id: 'cake', name: '草莓蛋糕', category: 'sweet', price: 24, xp: 8, makeMs: 6000, unlock: 2 },
  { id: 'macaron', name: '馬卡龍', category: 'sweet', price: 20, xp: 7, makeMs: 5200, unlock: 2 },
  { id: 'lemonade', name: '檸檬氣泡', category: 'drink', price: 16, xp: 5, makeMs: 3200, unlock: 2 },
  { id: 'roll', name: '抹茶紅豆捲', category: 'bake', price: 30, xp: 10, makeMs: 7000, unlock: 3 },
  { id: 'tart', name: '水果塔', category: 'sweet', price: 34, xp: 11, makeMs: 7600, unlock: 3 },
  { id: 'coffee', name: '手沖咖啡', category: 'drink', price: 22, xp: 8, makeMs: 4500, unlock: 3 },
  { id: 'giftbox', name: '夢想禮盒', category: 'gift', price: 46, xp: 15, makeMs: 9000, unlock: 4 },
  { id: 'parfait', name: '莓果聖代', category: 'sweet', price: 36, xp: 12, makeMs: 6400, unlock: 4 },
  { id: 'sandwich', name: '火腿蛋堡', category: 'bake', price: 28, xp: 9, makeMs: 5000, unlock: 4 },
  { id: 'choco', name: '巧克力禮塔', category: 'gift', price: 54, xp: 18, makeMs: 10400, unlock: 5 },
  { id: 'wedding', name: '慶祝蛋糕', category: 'gift', price: 68, xp: 22, makeMs: 12000, unlock: 5 },
  { id: 'taro', name: '芋泥波波', category: 'drink', price: 21, xp: 7, makeMs: 4200, unlock: 2, since: 2 },
  { id: 'pineapple', name: '土鳳梨酥', category: 'bake', price: 26, xp: 9, makeMs: 5600, unlock: 3, since: 2 },
  { id: 'yolkcake', name: '蛋黃酥禮盒', category: 'gift', price: 58, xp: 19, makeMs: 10800, unlock: 5, since: 2 },
]

const PRODUCT_IDS = STREET_PRODUCTS.map((item) => item.id)
export const productSpec = (id: ProductId) => STREET_PRODUCTS.find((item) => item.id === id)!
const isProductId = (value: unknown): value is ProductId => PRODUCT_IDS.includes(value as ProductId)

export type ShopLevelSpec = {
  level: number
  name: string
  /** 升到這一級要花的金幣。 */
  cost: number
  /** 升到這一級需要的店長等級。 */
  needRank: number
  shelf: number
  batch: number
  stations: number
  /** 製作時間倍率，越小越快。 */
  speed: number
  patienceMs: number
  queue: number
  priceMul: number
  spawnMs: [number, number]
  maxItems: number
}

export const SHOP_LEVELS: readonly ShopLevelSpec[] = [
  { level: 1, name: '街角小麵包坊', cost: 0, needRank: 1, shelf: 3, batch: 2, stations: 1, speed: 1, patienceMs: 24000, queue: 2, priceMul: 1, spawnMs: [6500, 9500], maxItems: 2 },
  { level: 2, name: '暖暖麵包坊', cost: 150, needRank: 2, shelf: 4, batch: 2, stations: 2, speed: 0.9, patienceMs: 26000, queue: 3, priceMul: 1.1, spawnMs: [5500, 8500], maxItems: 2 },
  { level: 3, name: '雙層甜點屋', cost: 420, needRank: 4, shelf: 5, batch: 3, stations: 2, speed: 0.8, patienceMs: 28000, queue: 3, priceMul: 1.2, spawnMs: [5000, 7500], maxItems: 3 },
  { level: 4, name: '磚造人氣名店', cost: 1000, needRank: 6, shelf: 6, batch: 3, stations: 3, speed: 0.72, patienceMs: 30000, queue: 4, priceMul: 1.3, spawnMs: [4500, 7000], maxItems: 3 },
  { level: 5, name: '夢想旗艦店', cost: 2200, needRank: 9, shelf: 8, batch: 4, stations: 3, speed: 0.62, patienceMs: 32000, queue: 4, priceMul: 1.5, spawnMs: [4000, 6500], maxItems: 3 },
]

export const MAX_SHOP_LEVEL = SHOP_LEVELS.length
export const shopSpec = (level: number) => SHOP_LEVELS[Math.min(MAX_SHOP_LEVEL, Math.max(1, level)) - 1]
export const unlockedProducts = (level: number) => STREET_PRODUCTS.filter((item) => item.unlock <= level && isLive(item))
export const liveProducts = () => STREET_PRODUCTS.filter(isLive)
const productsUpTo = (level: number) => STREET_PRODUCTS.filter((item) => item.unlock <= level)

/** 顧客外觀組合數。只影響當下街景，不寫進存檔。 */
export const CUSTOMER_LOOKS = 12

export type BuildingId = 'tea' | 'gift'

export type StreetBuilding = {
  id: BuildingId
  name: string
  cost: number
  needRank: number
  needShop: number
  /** 解鎖後加在共用經營規則上的效果，不另開一套結帳。 */
  bonus: string
}

export const STREET_BUILDINGS: readonly StreetBuilding[] = [
  { id: 'tea', name: '暖暖茶飲館', cost: 360, needRank: 3, needShop: 2, bonus: '接手飲品訂單、帶來自己的客人；飲品製作加快 15%，全店貨架 +1，工作台 +1' },
  { id: 'gift', name: '禮盒工坊', cost: 980, needRank: 6, needShop: 4, bonus: '接手禮盒訂單、帶來自己的客人；禮盒類售價 +12%，全店貨架 +1' },
]

export const buildingSpec = (id: BuildingId) => STREET_BUILDINGS.find((item) => item.id === id)!
const BUILDING_IDS = STREET_BUILDINGS.map((item) => item.id)
const isBuildingId = (value: unknown): value is BuildingId => BUILDING_IDS.includes(value as BuildingId)

/* ---------- 店家：主店與街邊店共用同一套顧客、訂單、庫存與結帳 ---------- */

export type ShopId = 'main' | BuildingId
/** north：北側人行道（沿 a 軸）；side：側街東側人行道（沿 b 軸）；south：南側人行道，只給路人。 */
export type StreetLane = 'north' | 'side' | 'south'

export type StreetSite = {
  id: ShopId
  /** 這間店接的商品類別。主店只接「還沒有已開幕專門店接手」的類別。 */
  sells: readonly ProductCategory[]
  lane: StreetLane
  /** 門口等候位置（沿 lane 的平面座標），依序開放；長度就是這間店的排隊上限。 */
  spots: readonly number[]
  /** 顧客從 lane 上哪幾端進出畫面。 */
  entries: readonly number[]
  /** 來客間隔 = 主店等級的 spawnMs × 這個倍率。 */
  spawnRate: number
  maxItems: number
}

/** 專門店的來客間隔倍率：每間約帶來主店 45% 的客流（1 / 2.2），新增客人而不是分走主店客人。 */
export const SPECIALTY_SPAWN_RATE = 2.2
/** 整條街同時在場（未離開）的顧客上限，控制手機效能與收益上限。 */
export const STREET_GUEST_CAP = 8
/** 路人只是街景，最多同時 4 位；每多一間已開幕的街邊店，路人間隔縮短 25%。 */
export const PASSER_CAP = 4
export const PASSER_BUSY_RATE = 0.25

const NORTH_ENTRIES = [-860, 660] as const
export const STREET_SITES: readonly StreetSite[] = [
  { id: 'main', sells: ['bake', 'drink', 'sweet', 'gift'], lane: 'north', spots: [-104, -168, -40, 24], entries: NORTH_ENTRIES, spawnRate: 1, maxItems: 3 },
  // 茶飲館再往左就會站到左下角的功能列後面，只開兩個等候位。
  { id: 'tea', sells: ['drink'], lane: 'north', spots: [-292, -238], entries: NORTH_ENTRIES, spawnRate: SPECIALTY_SPAWN_RATE, maxItems: 2 },
  { id: 'gift', sells: ['gift'], lane: 'side', spots: [292, 344, 240], entries: [720], spawnRate: SPECIALTY_SPAWN_RATE, maxItems: 1 },
]
export const PASSER_ENDS = [-900, 700] as const

export const siteSpec = (id: ShopId) => STREET_SITES.find((item) => item.id === id)!
const SHOP_IDS = STREET_SITES.map((item) => item.id)
const isShopId = (value: unknown): value is ShopId => SHOP_IDS.includes(value as ShopId)

export function isShopOpen(progress: { buildings: readonly BuildingId[] }, shop: ShopId) {
  return shop === 'main' || progress.buildings.includes(shop)
}

export function openShops(progress: { buildings: readonly BuildingId[] }): ShopId[] {
  return SHOP_IDS.filter((id) => isShopOpen(progress, id))
}

export function shopName(progress: { shopLevel: number }, shop: ShopId) {
  return shop === 'main' ? shopSpec(progress.shopLevel).name : buildingSpec(shop).name
}

/** 這間店目前能接的商品：已解鎖、屬於這間店的類別；主店讓出已有專門店接手的類別。 */
export function shopMenu(progress: { shopLevel: number; buildings: readonly BuildingId[] }, shop: ShopId) {
  if (!isShopOpen(progress, shop)) return []
  const site = siteSpec(shop)
  const taken = new Set<ProductCategory>()
  if (shop === 'main') {
    for (const other of STREET_SITES) if (other.id !== 'main' && isShopOpen(progress, other.id)) other.sells.forEach((c) => taken.add(c))
  }
  return unlockedProducts(progress.shopLevel).filter((item) => site.sells.includes(item.category) && !taken.has(item.category))
}

export const shopQueue = (level: number, shop: ShopId) => Math.min(siteSpec(shop).spots.length, shopSpec(level).queue)

/** 每間新店給共用貨架多一格，避免第二套庫存。 */
export const BUILDING_SHELF_BONUS = 1
export const TEA_MAKE_RATE = 0.85
export const GIFT_PRICE_RATE = 1.12
const STATION_LIMIT = 4

export type DecorSlot = 'shop' | 'street'
export type DecorId = 'lantern' | 'flower' | 'mat' | 'bunting' | 'lights' | 'planters' | 'parasols' | 'stalls'

export type StreetDecor = {
  id: DecorId
  name: string
  slot: DecorSlot
  cost: number
  needRank: number
  needShop: number
  blurb: string
  /** 店面裝潢能掛在哪些店：只列素材位置已對過的店，新店要自己加入才會出現。 */
  fits: readonly ShopId[]
  since?: number
}

const ALL_FRONTS: readonly ShopId[] = ['main', 'tea', 'gift']
export const STREET_DECORS: readonly StreetDecor[] = [
  { id: 'mat', name: '歡迎腳踏墊', slot: 'shop', cost: 60, needRank: 1, needShop: 1, blurb: '鋪在店門口', fits: ALL_FRONTS },
  { id: 'lantern', name: '暖色燈籠', slot: 'shop', cost: 90, needRank: 2, needShop: 1, blurb: '掛在雨棚兩側', fits: ALL_FRONTS },
  { id: 'flower', name: '窗台花箱', slot: 'shop', cost: 150, needRank: 3, needShop: 2, blurb: '掛在雨棚上的花環', fits: ALL_FRONTS },
  { id: 'bunting', name: '街口彩旗', slot: 'street', cost: 120, needRank: 2, needShop: 1, blurb: '橫過街道上空', fits: [] },
  { id: 'planters', name: '行道花圃', slot: 'street', cost: 170, needRank: 3, needShop: 2, blurb: '人行道兩端的花圃', fits: [] },
  { id: 'lights', name: '路燈串燈', slot: 'street', cost: 220, needRank: 4, needShop: 3, blurb: '沿人行道的小燈泡', fits: [] },
  { id: 'parasols', name: '街邊遮陽傘', slot: 'street', cost: 260, needRank: 5, needShop: 3, blurb: '人行道上的條紋大傘與小圓桌', fits: [], since: 2 },
  { id: 'stalls', name: '夜市小攤車', slot: 'street', cost: 340, needRank: 7, needShop: 4, blurb: '路口兩台亮燈的小攤車', fits: [], since: 2 },
]

export const decorSpec = (id: DecorId) => STREET_DECORS.find((item) => item.id === id)!
export const liveDecors = () => STREET_DECORS.filter(isLive)
const DECOR_IDS = STREET_DECORS.map((item) => item.id)
const isDecorId = (value: unknown): value is DecorId => DECOR_IDS.includes(value as DecorId)

/** 收藏是整條街共用（買一次），擺放是每間店各自一格，街道裝潢全街一格。 */
export type EquippedDecor = { street: DecorId | null; shops: Partial<Record<ShopId, DecorId>> }

export const shopDecor = (progress: { equipped: EquippedDecor }, shop: ShopId): DecorId | null => progress.equipped.shops[shop] ?? null
export const decorFits = (id: DecorId, shop: ShopId) => decorSpec(id).slot === 'street' || decorSpec(id).fits.includes(shop)

export function shelfCap(progress: { shopLevel: number; buildings: readonly BuildingId[] }) {
  return shopSpec(progress.shopLevel).shelf + progress.buildings.length * BUILDING_SHELF_BONUS
}

export function stationCap(progress: { shopLevel: number; buildings: readonly BuildingId[] }) {
  const extra = progress.buildings.includes('tea') ? 1 : 0
  return Math.min(STATION_LIMIT, shopSpec(progress.shopLevel).stations + extra)
}

export function makeDuration(progress: { shopLevel: number; buildings: readonly BuildingId[] }, product: ProductId) {
  const item = productSpec(product)
  const boost = progress.buildings.includes('tea') && item.category === 'drink' ? TEA_MAKE_RATE : 1
  return Math.round(item.makeMs * shopSpec(progress.shopLevel).speed * boost)
}

/** 店長等級：r 升 r+1 需要 50 + (r-1)*40 經驗。 */
export const rankStepXp = (rank: number) => 50 + (rank - 1) * 40
export const MAX_RANK = 30

export function rankOf(xp: number): { rank: number; into: number; need: number } {
  let rank = 1
  let left = Math.max(0, xp)
  while (rank < MAX_RANK && left >= rankStepXp(rank)) {
    left -= rankStepXp(rank)
    rank += 1
  }
  return { rank, into: left, need: rank >= MAX_RANK ? 0 : rankStepXp(rank) }
}

export const QUICK_TIP_FRACTION = 0.6
export const QUICK_TIP_RATE = 0.2
export const STREAK_EVERY = 5
export const STREAK_BONUS = 10

/* ---------- 場景幾何：位置都是街景平面座標（單位與畫面投影前相同） ---------- */

export const WALK_SPEED = 0.12
export const PASSER_SPEED = 0.094
const HAPPY_MS = 1100
const SAD_MS = 1000
const FIRST_SPAWN_MS = 1800

/* ---------- 型別 ---------- */

export type LogKind = 'serve' | 'miss' | 'upgrade' | 'rank' | 'open' | 'build' | 'decor' | 'help' | 'steal'
export type LogEntry = { at: number; kind: LogKind; text: string; coins: number }

export type StreetStats = {
  served: number
  missed: number
  itemsSold: number
  earned: number
  tips: number
  streak: number
  bestStreak: number
  /** 營業累計經驗，不含互助與偷貨獎勵；雲端存檔用它和 earned 相減得到這段時間的營業增量。 */
  xpEarned: number
}

export type DayStats = { day: string; served: number; missed: number; earned: number }

export type SavedJob = { product: ProductId; count: number; leftMs: number; totalMs: number }

export type StreetProgress = {
  v: typeof STREET_SAVE_VERSION
  createdAt: number
  shopLevel: number
  coins: number
  xp: number
  open: boolean
  stock: Record<ProductId, number>
  jobs: SavedJob[]
  stats: StreetStats
  today: DayStats
  log: LogEntry[]
  /** 新手提示進度：0 開店、1 服務、2 製作、3 升級、4 完成。 */
  tutorial: number
  /** 已解鎖的街邊店。第一間麵包坊用 shopLevel，不放在這裡。 */
  buildings: BuildingId[]
  ownedDecors: DecorId[]
  equipped: EquippedDecor
  /** 送出好友互助領取前先存下的領取鍵；回覆遺失時用同一把鍵重領，資料庫會回放同一筆結果。 */
  helpClaimPending: string | null
  /** 已入帳的領取鍵，回放時用來避免同一筆互助獎勵加兩次。 */
  helpClaimsApplied: string[]
  /** 趣味偷貨獎勵的領取鍵，與好友互助分開記，規則相同。 */
  stealClaimPending: string | null
  stealClaimsApplied: string[]
}

export type CustomerPhase = 'walk' | 'wait' | 'happy' | 'sad' | 'leave'

export type Customer = {
  id: number
  kind: 'guest' | 'passer'
  /** 顧客生成時就決定的目標店，之後不會改；路人為 null。 */
  shop: ShopId | null
  look: number
  phase: CustomerPhase
  x0: number
  x1: number
  t0: number
  t1: number
  slot: number
  order: ProductId[]
  patienceMs: number
  waitUntil: number
  mood: 'happy' | 'sad' | null
}

export type Job = { id: number; product: ProductId; count: number; t0: number; t1: number }

export type StreetSim = {
  t: number
  seq: number
  customers: Customer[]
  jobs: Job[]
  /** 每間店各自的下一位來客時間；新開幕的店第一次經過 tick 時補上。 */
  nextSpawn: Partial<Record<ShopId, number>>
  nextPasser: number
}

export type StreetState = { progress: StreetProgress; sim: StreetSim }

export type StreetEvent =
  | { type: 'arrive'; customer: Customer }
  | { type: 'missed'; customer: Customer }
  | { type: 'made'; product: ProductId; count: number }
  | { type: 'served'; customer: Customer; coins: number; base: number; tip: number; bonus: number; xp: number }
  | { type: 'rankUp'; rank: number }
  | { type: 'upgraded'; level: number }

export type Rand = () => number

/* ---------- 建立與還原 ---------- */

const emptyStock = (): Record<ProductId, number> => {
  const stock = {} as Record<ProductId, number>
  for (const id of PRODUCT_IDS) stock[id] = 0
  return stock
}

const emptyEquipped = (): EquippedDecor => ({ street: null, shops: {} })

function readBuildings(value: unknown, shopLevel: number): BuildingId[] {
  if (!Array.isArray(value)) return []
  const buildings: BuildingId[] = []
  for (const id of value) {
    if (!isBuildingId(id) || buildings.includes(id) || shopLevel < buildingSpec(id).needShop) continue
    buildings.push(id)
  }
  return buildings
}

function readDecors(value: unknown, shopLevel: number): DecorId[] {
  if (!Array.isArray(value)) return []
  const owned: DecorId[] = []
  for (const id of value) {
    if (!isDecorId(id) || owned.includes(id) || shopLevel < decorSpec(id).needShop) continue
    owned.push(id)
  }
  return owned
}

function readEquipped(value: unknown, owned: readonly DecorId[], buildings: readonly BuildingId[], version: number): EquippedDecor {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const valid = (id: unknown, slot: DecorSlot): id is DecorId => isDecorId(id) && owned.includes(id) && decorSpec(id).slot === slot
  const shops: Partial<Record<ShopId, DecorId>> = {}
  // v2 只有一格店面裝潢，畫在麵包坊上，升級後歸給主店。
  const shopSrc = (version >= 3 && src.shops && typeof src.shops === 'object' ? src.shops : { main: src.shop }) as Record<string, unknown>
  for (const shop of SHOP_IDS) {
    const id = shopSrc[shop]
    if (valid(id, 'shop') && decorFits(id, shop) && isShopOpen({ buildings }, shop)) shops[shop] = id
  }
  return { street: valid(src.street, 'street') ? src.street : null, shops }
}

export function taipeiDay(clock: number) {
  return new Date(clock + 8 * 3600_000).toISOString().slice(0, 10)
}

export function newStreet(clock: number): StreetProgress {
  return {
    v: STREET_SAVE_VERSION,
    createdAt: clock,
    shopLevel: 1,
    coins: 0,
    xp: 0,
    open: false,
    stock: { ...emptyStock(), croissant: 2, milktea: 1 },
    jobs: [],
    stats: { served: 0, missed: 0, itemsSold: 0, earned: 0, tips: 0, streak: 0, bestStreak: 0, xpEarned: 0 },
    today: { day: taipeiDay(clock), served: 0, missed: 0, earned: 0 },
    log: [],
    tutorial: 0,
    buildings: [],
    ownedDecors: [],
    equipped: emptyEquipped(),
    helpClaimPending: null,
    helpClaimsApplied: [],
    stealClaimPending: null,
    stealClaimsApplied: [],
  }
}

const int = (value: unknown, min: number, max: number, fallback = min) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(max, Math.max(min, n))
}
const BIG = 1_000_000_000
const LOG_MAX = 12
const CLAIM_KEEP = 20
const CLAIM_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const claimKey = (value: unknown) => (typeof value === 'string' && CLAIM_KEY_RE.test(value.toLowerCase()) ? value.toLowerCase() : null)

/** 存檔只信任結構，數值全部夾在規則範圍內；版本不符或結構錯誤就回傳 null。 */
export function parseStreet(raw: unknown): StreetProgress | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  if (!READABLE_SAVE_VERSIONS.includes(src.v as 1 | 2 | 3)) return null
  const version = src.v as number
  const shopLevel = int(src.shopLevel, 1, MAX_SHOP_LEVEL, 1)
  const spec = shopSpec(shopLevel)
  const buildings = version >= 2 ? readBuildings(src.buildings, shopLevel) : []
  const ownedDecors = version >= 2 ? readDecors(src.ownedDecors, shopLevel) : []
  const equipped = version >= 2 ? readEquipped(src.equipped, ownedDecors, buildings, version) : emptyEquipped()
  const cap = shelfCap({ shopLevel, buildings })
  const stations = stationCap({ shopLevel, buildings })
  const unlocked = new Set(productsUpTo(shopLevel).map((item) => item.id))
  const stockSrc = (src.stock && typeof src.stock === 'object' ? src.stock : {}) as Record<string, unknown>
  const stock = emptyStock()
  for (const id of PRODUCT_IDS) stock[id] = unlocked.has(id) ? int(stockSrc[id], 0, cap, 0) : 0
  const jobs: SavedJob[] = []
  if (Array.isArray(src.jobs)) {
    for (const item of src.jobs) {
      if (!item || typeof item !== 'object' || jobs.length >= stations) continue
      const job = item as Record<string, unknown>
      if (!isProductId(job.product) || !unlocked.has(job.product) || jobs.some((j) => j.product === job.product)) continue
      const totalMs = int(job.totalMs, 1, 60_000, 1)
      jobs.push({ product: job.product, count: int(job.count, 1, spec.batch, 1), leftMs: int(job.leftMs, 0, totalMs, 0), totalMs })
    }
  }
  const statsSrc = (src.stats && typeof src.stats === 'object' ? src.stats : {}) as Record<string, unknown>
  const stats: StreetStats = {
    served: int(statsSrc.served, 0, BIG),
    missed: int(statsSrc.missed, 0, BIG),
    itemsSold: int(statsSrc.itemsSold, 0, BIG),
    earned: int(statsSrc.earned, 0, BIG),
    tips: int(statsSrc.tips, 0, BIG),
    streak: int(statsSrc.streak, 0, BIG),
    bestStreak: int(statsSrc.bestStreak, 0, BIG),
    xpEarned: int(statsSrc.xpEarned, 0, BIG),
  }
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak)
  const todaySrc = (src.today && typeof src.today === 'object' ? src.today : {}) as Record<string, unknown>
  const today: DayStats = {
    day: typeof todaySrc.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(todaySrc.day) ? todaySrc.day : '1970-01-01',
    served: int(todaySrc.served, 0, BIG),
    missed: int(todaySrc.missed, 0, BIG),
    earned: int(todaySrc.earned, 0, BIG),
  }
  const log: LogEntry[] = []
  if (Array.isArray(src.log)) {
    for (const item of src.log.slice(0, LOG_MAX)) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      if (!['serve', 'miss', 'upgrade', 'rank', 'open', 'build', 'decor', 'help', 'steal'].includes(entry.kind as string) || typeof entry.text !== 'string') continue
      log.push({ at: int(entry.at, 0, Number.MAX_SAFE_INTEGER), kind: entry.kind as LogKind, text: entry.text.slice(0, 60), coins: int(entry.coins, 0, BIG) })
    }
  }
  return {
    v: STREET_SAVE_VERSION,
    createdAt: int(src.createdAt, 0, Number.MAX_SAFE_INTEGER),
    shopLevel,
    coins: int(src.coins, 0, BIG),
    xp: int(src.xp, 0, BIG),
    open: src.open === true,
    stock,
    jobs,
    stats,
    today,
    log,
    tutorial: int(src.tutorial, 0, 4),
    buildings,
    ownedDecors,
    equipped,
    helpClaimPending: claimKey(src.helpClaimPending),
    helpClaimsApplied: Array.isArray(src.helpClaimsApplied)
      ? [...new Set(src.helpClaimsApplied.map(claimKey).filter((key): key is string => key !== null))].slice(0, CLAIM_KEEP)
      : [],
    stealClaimPending: claimKey(src.stealClaimPending),
    stealClaimsApplied: Array.isArray(src.stealClaimsApplied)
      ? [...new Set(src.stealClaimsApplied.map(claimKey).filter((key): key is string => key !== null))].slice(0, CLAIM_KEEP)
      : [],
  }
}

export function newSim(progress: StreetProgress): StreetSim {
  let seq = 1
  const jobs: Job[] = progress.jobs.map((job) => ({ id: seq++, product: job.product, count: job.count, t0: job.leftMs - job.totalMs, t1: job.leftMs }))
  return { t: 0, seq, customers: [], jobs, nextSpawn: {}, nextPasser: 1200 }
}

/** 第一位客人錯開進場，三間店不會同一刻一起冒出顧客。 */
const firstSpawn = (shop: ShopId) => FIRST_SPAWN_MS + SHOP_IDS.indexOf(shop) * 1600

/** 存檔時把進行中的製作換成「剩餘時間」，顧客屬於當下的街景，不存。 */
export function snapshot(state: StreetState): StreetProgress {
  const { progress, sim } = state
  return {
    ...progress,
    jobs: sim.jobs.map((job) => ({ product: job.product, count: job.count, leftMs: Math.max(0, Math.round(job.t1 - sim.t)), totalMs: Math.round(job.t1 - job.t0) })),
  }
}

/* ---------- 查詢 ---------- */

export function customerX(c: Customer, t: number) {
  if (c.phase !== 'walk' && c.phase !== 'leave') return c.x1
  const span = c.t1 - c.t0
  const k = span <= 0 ? 1 : Math.min(1, Math.max(0, (t - c.t0) / span))
  return c.x0 + (c.x1 - c.x0) * k
}

export const customerLane = (c: Customer): StreetLane => (c.shop ? siteSpec(c.shop).lane : 'south')

/** 顧客在店門口時面對的店門位置（沿 lane），畫面用來決定人物朝向。 */
export const customerDoor = (c: Customer) => (c.shop ? siteSpec(c.shop).spots[0] : 0)

export function canFill(progress: StreetProgress, order: ProductId[]) {
  const need = countOrder(order)
  return PRODUCT_IDS.every((id) => (need[id] ?? 0) <= progress.stock[id])
}

export function countOrder(order: ProductId[]) {
  const need: Partial<Record<ProductId, number>> = {}
  for (const id of order) need[id] = (need[id] ?? 0) + 1
  return need
}

export function orderValue(order: ProductId[], level: number, buildings: readonly BuildingId[] = []) {
  const gift = buildings.includes('gift')
  const sum = order.reduce((total, id) => {
    const item = productSpec(id)
    return total + item.price * (gift && item.category === 'gift' ? GIFT_PRICE_RATE : 1)
  }, 0)
  return Math.round(sum * shopSpec(level).priceMul)
}

export type UpgradeCheck = { ok: true; spec: ShopLevelSpec } | { ok: false; reason: 'max' | 'rank' | 'coins'; spec: ShopLevelSpec | null }

export function upgradeCheck(progress: StreetProgress): UpgradeCheck {
  if (progress.shopLevel >= MAX_SHOP_LEVEL) return { ok: false, reason: 'max', spec: null }
  const spec = shopSpec(progress.shopLevel + 1)
  if (rankOf(progress.xp).rank < spec.needRank) return { ok: false, reason: 'rank', spec }
  if (progress.coins < spec.cost) return { ok: false, reason: 'coins', spec }
  return { ok: true, spec }
}

/* ---------- 動作 ---------- */

const rollDay = (progress: StreetProgress, clock: number): StreetProgress => {
  const day = taipeiDay(clock)
  return progress.today.day === day ? progress : { ...progress, today: { day, served: 0, missed: 0, earned: 0 } }
}
const pushLog = (log: LogEntry[], entry: LogEntry) => [entry, ...log].slice(0, LOG_MAX)

export function setOpen(state: StreetState, open: boolean, clock: number): StreetState {
  if (state.progress.open === open) return state
  const progress = {
    ...state.progress,
    open,
    tutorial: open && state.progress.tutorial === 0 ? 1 : state.progress.tutorial,
    log: pushLog(state.progress.log, { at: clock, kind: 'open' as const, text: open ? '開始營業' : '暫停營業', coins: 0 }),
  }
  if (!open) return { progress, sim: state.sim }
  const nextSpawn: Partial<Record<ShopId, number>> = {}
  for (const shop of openShops(progress)) nextSpawn[shop] = Math.min(state.sim.nextSpawn[shop] ?? Infinity, state.sim.t + firstSpawn(shop))
  return { progress, sim: { ...state.sim, nextSpawn } }
}

export type ActionResult = { ok: true; state: StreetState; events: StreetEvent[] } | { ok: false; error: string }

/** 好友互助獎勵：數值來自資料庫領取回覆，只加夢想金幣與經驗，不算進營業統計。 */
export function applyHelpReward(state: StreetState, coins: number, xp: number, text: string, clock: number): ActionResult {
  return applyBonus(state, coins, xp, text, clock, 'help')
}

/** 趣味偷貨獎勵：系統另外生成的夢想金幣與經驗，不是從屋主身上扣的，也不算進營業統計。 */
export function applyStealReward(state: StreetState, coins: number, xp: number, text: string, clock: number): ActionResult {
  return applyBonus(state, coins, xp, text, clock, 'steal')
}

function applyBonus(state: StreetState, coins: number, xp: number, text: string, clock: number, kind: 'help' | 'steal'): ActionResult {
  const c = Math.max(0, Math.floor(coins))
  const x = Math.max(0, Math.floor(xp))
  if (!c && !x) return { ok: false, error: kind === 'help' ? '沒有可領的互助獎勵' : '沒有可領的偷貨獎勵' }
  const progress = state.progress
  const before = rankOf(progress.xp).rank
  const after = rankOf(progress.xp + x).rank
  let log = pushLog(progress.log, { at: clock, kind, text: text.slice(0, 60), coins: c })
  if (after > before) log = pushLog(log, { at: clock, kind: 'rank', text: `店長升到 Lv.${after}`, coins: 0 })
  const events: StreetEvent[] = after > before ? [{ type: 'rankUp', rank: after }] : []
  return {
    ok: true,
    state: { progress: { ...progress, coins: Math.min(BIG, progress.coins + c), xp: Math.min(BIG, progress.xp + x), log }, sim: state.sim },
    events,
  }
}

/** 領取前先決定這次的領取鍵；已有未結清的鍵就沿用，斷線後重領會拿到資料庫同一筆回放。 */
export function beginHelpClaim(progress: StreetProgress, freshKey: string): { progress: StreetProgress; key: string } {
  if (progress.helpClaimPending) return { progress, key: progress.helpClaimPending }
  const key = claimKey(freshKey)
  if (!key) throw new Error('領取鍵格式不正確')
  return { progress: { ...progress, helpClaimPending: key }, key }
}

/** 入帳與標記已入帳放在同一份存檔；同一把鍵回放第二次只清掉待領，不再加金幣。 */
export function settleHelpClaim(state: StreetState, key: string, coins: number, xp: number, text: string, clock: number): { state: StreetState; events: StreetEvent[]; applied: boolean } {
  const id = claimKey(key)
  const progress = state.progress
  const pending = progress.helpClaimPending === id ? null : progress.helpClaimPending
  if (!id || progress.helpClaimsApplied.includes(id)) {
    return { state: { progress: { ...progress, helpClaimPending: pending }, sim: state.sim }, events: [], applied: false }
  }
  const res = applyHelpReward(state, coins, xp, text, clock)
  const base = res.ok ? res.state.progress : progress
  return {
    state: { progress: { ...base, helpClaimPending: pending, helpClaimsApplied: [id, ...base.helpClaimsApplied].slice(0, CLAIM_KEEP) }, sim: state.sim },
    events: res.ok ? res.events : [],
    applied: res.ok,
  }
}

export function beginStealClaim(progress: StreetProgress, freshKey: string): { progress: StreetProgress; key: string } {
  if (progress.stealClaimPending) return { progress, key: progress.stealClaimPending }
  const key = claimKey(freshKey)
  if (!key) throw new Error('領取鍵格式不正確')
  return { progress: { ...progress, stealClaimPending: key }, key }
}

export function settleStealClaim(state: StreetState, key: string, coins: number, xp: number, text: string, clock: number): { state: StreetState; events: StreetEvent[]; applied: boolean } {
  const id = claimKey(key)
  const progress = state.progress
  const pending = progress.stealClaimPending === id ? null : progress.stealClaimPending
  if (!id || progress.stealClaimsApplied.includes(id)) {
    return { state: { progress: { ...progress, stealClaimPending: pending }, sim: state.sim }, events: [], applied: false }
  }
  const res = applyStealReward(state, coins, xp, text, clock)
  const base = res.ok ? res.state.progress : progress
  return {
    state: { progress: { ...base, stealClaimPending: pending, stealClaimsApplied: [id, ...base.stealClaimsApplied].slice(0, CLAIM_KEEP) }, sim: state.sim },
    events: res.ok ? res.events : [],
    applied: res.ok,
  }
}

export function startJob(state: StreetState, product: ProductId): ActionResult {
  const { progress, sim } = state
  const spec = shopSpec(progress.shopLevel)
  const item = productSpec(product)
  const stations = stationCap(progress)
  if (!isLive(item)) return { ok: false, error: `${item.name}即將開放` }
  if (item.unlock > progress.shopLevel) return { ok: false, error: `店面 Lv.${item.unlock} 才能製作${item.name}` }
  if (sim.jobs.some((job) => job.product === product)) return { ok: false, error: `${item.name}正在製作中` }
  if (sim.jobs.length >= stations) return { ok: false, error: `工作台全部在忙（${stations} 座）` }
  const room = shelfCap(progress) - progress.stock[product]
  if (room <= 0) return { ok: false, error: `${item.name}的貨架已經滿了` }
  const count = Math.min(spec.batch, room)
  const ms = makeDuration(progress, product)
  const job: Job = { id: sim.seq, product, count, t0: sim.t, t1: sim.t + ms }
  return {
    ok: true,
    state: {
      progress: progress.tutorial === 2 ? { ...progress, tutorial: 3 } : progress,
      sim: { ...sim, seq: sim.seq + 1, jobs: [...sim.jobs, job] },
    },
    events: [],
  }
}

export function serve(state: StreetState, customerId: number, clock: number): ActionResult {
  const { sim } = state
  let progress = rollDay(state.progress, clock)
  const c = sim.customers.find((item) => item.id === customerId)
  if (!c || c.kind !== 'guest' || c.phase !== 'wait' || !c.shop) return { ok: false, error: '這位顧客目前不能服務' }
  if (!isShopOpen(progress, c.shop)) return { ok: false, error: `${shopName(progress, c.shop)}尚未開幕` }
  if (!canFill(progress, c.order)) {
    const need = countOrder(c.order)
    const short = PRODUCT_IDS.filter((id) => (need[id] ?? 0) > progress.stock[id]).map((id) => productSpec(id).name)
    return { ok: false, error: `貨架上的${short.join('、')}不夠` }
  }
  const stock = { ...progress.stock }
  for (const id of c.order) stock[id] -= 1
  const base = orderValue(c.order, progress.shopLevel, progress.buildings)
  const left = (c.waitUntil - sim.t) / c.patienceMs
  const tip = left >= QUICK_TIP_FRACTION ? Math.ceil(base * QUICK_TIP_RATE) : 0
  const streak = progress.stats.streak + 1
  const bonus = streak % STREAK_EVERY === 0 ? STREAK_BONUS : 0
  const coins = base + tip + bonus
  const xp = c.order.reduce((total, id) => total + productSpec(id).xp, 0)
  const before = rankOf(progress.xp).rank
  const after = rankOf(progress.xp + xp).rank
  const names = c.order.map((id) => productSpec(id).name).join('、')
  const where = c.shop === 'main' ? '' : `${shopName(progress, c.shop)}・`
  let log = pushLog(progress.log, { at: clock, kind: 'serve', text: `${where}賣出 ${names}${tip ? '（快速小費）' : ''}`, coins })
  if (after > before) log = pushLog(log, { at: clock, kind: 'rank', text: `店長升到 Lv.${after}`, coins: 0 })
  progress = {
    ...progress,
    stock,
    coins: Math.min(BIG, progress.coins + coins),
    xp: Math.min(BIG, progress.xp + xp),
    stats: {
      ...progress.stats,
      served: progress.stats.served + 1,
      itemsSold: progress.stats.itemsSold + c.order.length,
      earned: progress.stats.earned + coins,
      tips: progress.stats.tips + tip,
      streak,
      bestStreak: Math.max(progress.stats.bestStreak, streak),
      xpEarned: Math.min(BIG, progress.stats.xpEarned + xp),
    },
    today: { ...progress.today, served: progress.today.served + 1, earned: progress.today.earned + coins },
    log,
    tutorial: progress.tutorial < 2 ? 2 : progress.tutorial,
  }
  const served: Customer = { ...c, phase: 'happy', t0: sim.t, t1: sim.t + HAPPY_MS, mood: 'happy' }
  const events: StreetEvent[] = [{ type: 'served', customer: served, coins, base, tip, bonus, xp }]
  if (after > before) events.push({ type: 'rankUp', rank: after })
  return { ok: true, state: { progress, sim: { ...sim, customers: sim.customers.map((item) => (item.id === c.id ? served : item)) } }, events }
}

export function upgrade(state: StreetState, clock: number): ActionResult {
  const check = upgradeCheck(state.progress)
  if (!check.ok) {
    if (check.reason === 'max') return { ok: false, error: '店面已經是最高等級' }
    if (check.reason === 'rank') return { ok: false, error: `店長需要 Lv.${check.spec!.needRank}` }
    return { ok: false, error: `金幣不足，還差 ${check.spec!.cost - state.progress.coins}` }
  }
  const spec = check.spec
  const progress: StreetProgress = {
    ...state.progress,
    shopLevel: spec.level,
    coins: state.progress.coins - spec.cost,
    log: pushLog(state.progress.log, { at: clock, kind: 'upgrade', text: `店面升級為 Lv.${spec.level}「${spec.name}」`, coins: spec.cost }),
    tutorial: 4,
  }
  // 已在排隊的顧客耐心跟著新等級延長。
  const extra = spec.patienceMs - shopSpec(spec.level - 1).patienceMs
  const customers = state.sim.customers.map((c) =>
    c.kind === 'guest' && c.phase === 'wait' ? { ...c, patienceMs: c.patienceMs + extra, waitUntil: c.waitUntil + extra } : c,
  )
  return { ok: true, state: { progress, sim: { ...state.sim, customers } }, events: [{ type: 'upgraded', level: spec.level }] }
}

export type Gate = { ok: true } | { ok: false; reason: string }

export function buildingCheck(progress: StreetProgress, id: BuildingId): Gate {
  if (progress.buildings.includes(id)) return { ok: false, reason: '已經開幕' }
  const spec = buildingSpec(id)
  if (progress.shopLevel < spec.needShop) return { ok: false, reason: `店面需要 Lv.${spec.needShop}` }
  if (rankOf(progress.xp).rank < spec.needRank) return { ok: false, reason: `店長需要 Lv.${spec.needRank}` }
  if (progress.coins < spec.cost) return { ok: false, reason: `還差 ${spec.cost - progress.coins} 金幣` }
  return { ok: true }
}

export function unlockBuilding(state: StreetState, id: BuildingId, clock: number): ActionResult {
  const check = buildingCheck(state.progress, id)
  if (!check.ok) return { ok: false, error: check.reason }
  const spec = buildingSpec(id)
  const buildings = [...state.progress.buildings, id]
  return {
    ok: true,
    state: {
      progress: {
        ...state.progress,
        coins: state.progress.coins - spec.cost,
        buildings,
        log: pushLog(state.progress.log, { at: clock, kind: 'build', text: `開幕「${spec.name}」`, coins: spec.cost }),
      },
      sim: { ...state.sim, nextSpawn: { ...state.sim.nextSpawn, [id]: state.sim.t + FIRST_SPAWN_MS } },
    },
    events: [],
  }
}

/** shop 是要擺放的店；街道裝潢不看 shop。 */
export function decorCheck(progress: StreetProgress, id: DecorId, shop: ShopId = 'main'): Gate {
  const spec = decorSpec(id)
  if (spec.slot === 'shop') {
    if (!isShopOpen(progress, shop)) return { ok: false, reason: '這間店還沒開幕' }
    if (!decorFits(id, shop)) return { ok: false, reason: '這間店不適用' }
  }
  if (progress.ownedDecors.includes(id)) return { ok: true }
  if (!isLive(spec)) return { ok: false, reason: '即將開放' }
  if (progress.shopLevel < spec.needShop) return { ok: false, reason: `店面需要 Lv.${spec.needShop}` }
  if (rankOf(progress.xp).rank < spec.needRank) return { ok: false, reason: `店長需要 Lv.${spec.needRank}` }
  if (progress.coins < spec.cost) return { ok: false, reason: `還差 ${spec.cost - progress.coins} 金幣` }
  return { ok: true }
}

const placeDecor = (equipped: EquippedDecor, slot: DecorSlot, shop: ShopId, id: DecorId | null): EquippedDecor => {
  if (slot === 'street') return { ...equipped, street: id }
  const shops = { ...equipped.shops }
  if (id) shops[shop] = id
  else delete shops[shop]
  return { ...equipped, shops }
}

const decorTarget = (progress: StreetProgress, id: DecorId, shop: ShopId) => (decorSpec(id).slot === 'street' ? '街道' : shopName(progress, shop))

const withDecor = (progress: StreetProgress, id: DecorId, shop: ShopId, coins: number, text: string, clock: number, spent: number): StreetProgress => {
  const spec = decorSpec(id)
  const ownedDecors = progress.ownedDecors.includes(id) ? progress.ownedDecors : [...progress.ownedDecors, id]
  return {
    ...progress,
    coins,
    ownedDecors,
    equipped: placeDecor(progress.equipped, spec.slot, shop, id),
    log: pushLog(progress.log, { at: clock, kind: 'decor', text, coins: spent }),
  }
}

export function buyDecor(state: StreetState, id: DecorId, clock: number, shop: ShopId = 'main'): ActionResult {
  if (state.progress.ownedDecors.includes(id)) return { ok: false, error: '已經收藏，直接套用即可' }
  const check = decorCheck(state.progress, id, shop)
  if (!check.ok) return { ok: false, error: check.reason }
  const spec = decorSpec(id)
  return {
    ok: true,
    state: {
      progress: withDecor(state.progress, id, shop, state.progress.coins - spec.cost, `收藏「${spec.name}」並套用到${decorTarget(state.progress, id, shop)}`, clock, spec.cost),
      sim: state.sim,
    },
    events: [],
  }
}

export function equipDecor(state: StreetState, id: DecorId, clock: number, shop: ShopId = 'main'): ActionResult {
  if (!state.progress.ownedDecors.includes(id)) return { ok: false, error: '還沒收藏這項裝潢' }
  const check = decorCheck(state.progress, id, shop)
  if (!check.ok) return { ok: false, error: check.reason }
  const spec = decorSpec(id)
  const current = spec.slot === 'street' ? state.progress.equipped.street : shopDecor(state.progress, shop)
  if (current === id) return { ok: false, error: '已經套用中' }
  return {
    ok: true,
    state: {
      progress: withDecor(state.progress, id, shop, state.progress.coins, `${decorTarget(state.progress, id, shop)}套用「${spec.name}」`, clock, 0),
      sim: state.sim,
    },
    events: [],
  }
}

export function clearDecor(state: StreetState, slot: DecorSlot, clock: number, shop: ShopId = 'main'): ActionResult {
  const current = slot === 'street' ? state.progress.equipped.street : shopDecor(state.progress, shop)
  if (!current) return { ok: false, error: '這個位置沒有裝潢' }
  return {
    ok: true,
    state: {
      progress: {
        ...state.progress,
        equipped: placeDecor(state.progress.equipped, slot, shop, null),
        log: pushLog(state.progress.log, { at: clock, kind: 'decor', text: `${decorTarget(state.progress, current, shop)}卸下「${decorSpec(current).name}」`, coins: 0 }),
      },
      sim: state.sim,
    },
    events: [],
  }
}

/* ---------- 時間推進 ---------- */

const MAX_STEP_MS = 250
const between = (rand: Rand, [lo, hi]: [number, number]) => lo + rand() * (hi - lo)

/** 同一畫面盡量不重複外觀；12 種都在場時才允許重複。仍只消耗一次亂數。 */
function pickLook(rand: Rand, used: Set<number>) {
  const free: number[] = []
  for (let i = 0; i < CUSTOMER_LOOKS; i += 1) if (!used.has(i)) free.push(i)
  const pool = free.length > 0 ? free : Array.from({ length: CUSTOMER_LOOKS }, (_, i) => i)
  return pool[Math.floor(rand() * pool.length)]
}

function rollOrder(pool: readonly StreetProduct[], level: number, maxItems: number, rand: Rand): ProductId[] {
  const spec = shopSpec(level)
  const r = rand()
  const rolled = spec.maxItems >= 3 ? (r < 0.5 ? 1 : r < 0.85 ? 2 : 3) : r < 0.72 ? 1 : 2
  const size = Math.min(rolled, maxItems)
  const order: ProductId[] = []
  for (let i = 0; i < size; i += 1) {
    // 新解鎖的商品出現機率略高，升級後立刻感受得到差異。
    const weights = pool.map((item) => {
      const fresh = item.unlock === level && level > 1 ? 1.55 : 1
      const staple = item.id === 'croissant' || item.id === 'milktea' ? 1.25 : 1
      return fresh * staple
    })
    let pick = rand() * weights.reduce((a, b) => a + b, 0)
    let chosen = pool[0]
    for (let k = 0; k < pool.length; k += 1) {
      pick -= weights[k]
      if (pick <= 0) {
        chosen = pool[k]
        break
      }
    }
    order.push(chosen.id)
  }
  return order.sort((a, b) => PRODUCT_IDS.indexOf(a) - PRODUCT_IDS.indexOf(b))
}

/** 推進遊戲時間。單次最多 250ms，切到背景或卡頓時不會一口氣跳過整段營業。 */
export function tick(state: StreetState, dtMs: number, rand: Rand, clock: number): { state: StreetState; events: StreetEvent[] } {
  const dt = Math.min(MAX_STEP_MS, Math.max(0, dtMs))
  if (dt === 0) return { state, events: [] }
  const events: StreetEvent[] = []
  let progress = state.progress
  const t = state.sim.t + dt
  let seq = state.sim.seq
  const spec = shopSpec(progress.shopLevel)

  let jobs = state.sim.jobs
  if (jobs.some((job) => job.t1 <= t)) {
    const stock = { ...progress.stock }
    jobs = jobs.filter((job) => {
      if (job.t1 > t) return true
      const added = Math.min(job.count, shelfCap(progress) - stock[job.product])
      stock[job.product] += Math.max(0, added)
      events.push({ type: 'made', product: job.product, count: Math.max(0, added) })
      return false
    })
    progress = { ...progress, stock }
  }

  const customers: Customer[] = []
  for (const c of state.sim.customers) {
    if (c.phase === 'walk' && t >= c.t1) {
      if (c.kind === 'passer') continue
      const waiting: Customer = { ...c, phase: 'wait', t0: t, t1: t, waitUntil: t + c.patienceMs }
      events.push({ type: 'arrive', customer: waiting })
      customers.push(waiting)
    } else if (c.phase === 'wait' && t >= c.waitUntil) {
      const sad: Customer = { ...c, phase: 'sad', t0: t, t1: t + SAD_MS, mood: 'sad' }
      events.push({ type: 'missed', customer: sad })
      progress = rollDay(progress, clock)
      progress = {
        ...progress,
        stats: { ...progress.stats, missed: progress.stats.missed + 1, streak: 0 },
        today: { ...progress.today, missed: progress.today.missed + 1 },
        log: pushLog(progress.log, { at: clock, kind: 'miss', text: `${c.shop && c.shop !== 'main' ? `${shopName(progress, c.shop)}・` : ''}顧客等太久，失望離開`, coins: 0 }),
      }
      customers.push(sad)
    } else if ((c.phase === 'happy' || c.phase === 'sad') && t >= c.t1) {
      // 從離自己最近的出口離開，沿原本的人行道走，不會穿到別間店。
      const entries = c.shop ? siteSpec(c.shop).entries : PASSER_ENDS
      const exit = entries.reduce((best, x) => (Math.abs(x - c.x1) < Math.abs(best - c.x1) ? x : best), entries[0])
      customers.push({ ...c, phase: 'leave', x0: c.x1, x1: exit, t0: t, t1: t + Math.abs(exit - c.x1) / WALK_SPEED })
    } else if (c.phase === 'leave' && t >= c.t1) {
      continue
    } else {
      customers.push(c)
    }
  }

  // 每間已開幕的店各自排程來客：目標店、等候位置與訂單在這裡一次決定，之後跟著顧客走到離開。
  const nextSpawn: Partial<Record<ShopId, number>> = {}
  const usedLooks = new Set(customers.map((c) => c.look))
  const shops = openShops(progress)
  let present = customers.filter((c) => c.kind === 'guest' && c.phase !== 'leave').length
  for (const shop of shops) {
    const due = state.sim.nextSpawn[shop] ?? t + firstSpawn(shop)
    if (!progress.open) {
      nextSpawn[shop] = Math.max(due, t)
      continue
    }
    if (t < due) {
      nextSpawn[shop] = due
      continue
    }
    const site = siteSpec(shop)
    const menu = shopMenu(progress, shop)
    const taken = new Set(customers.filter((c) => c.kind === 'guest' && c.shop === shop && c.phase !== 'leave').map((c) => c.slot))
    const slot = site.spots.slice(0, shopQueue(progress.shopLevel, shop)).findIndex((_, i) => !taken.has(i))
    if (slot < 0 || menu.length === 0 || present >= STREET_GUEST_CAP) {
      nextSpawn[shop] = t + 1500
      continue
    }
    const x0 = site.entries.length > 1 && rand() >= 0.5 ? site.entries[1] : site.entries[0]
    const x1 = site.spots[slot]
    const look = pickLook(rand, usedLooks)
    usedLooks.add(look)
    customers.push({
      id: seq++,
      kind: 'guest',
      shop,
      look,
      phase: 'walk',
      x0,
      x1,
      t0: t,
      t1: t + Math.abs(x1 - x0) / WALK_SPEED,
      slot,
      order: rollOrder(menu, progress.shopLevel, Math.min(site.maxItems, spec.maxItems), rand),
      patienceMs: spec.patienceMs,
      waitUntil: 0,
      mood: null,
    })
    present += 1
    const [lo, hi] = spec.spawnMs
    nextSpawn[shop] = t + between(rand, [lo * site.spawnRate, hi * site.spawnRate])
  }

  let nextPasser = state.sim.nextPasser
  if (t >= nextPasser) {
    const passers = customers.filter((c) => c.kind === 'passer').length
    if (passers < PASSER_CAP) {
      const fromLeft = rand() < 0.5
      const [west, east] = PASSER_ENDS
      const x0 = fromLeft ? west : east
      const x1 = fromLeft ? east : west
      const look = pickLook(rand, usedLooks)
      usedLooks.add(look)
      customers.push({ id: seq++, kind: 'passer', shop: null, look, phase: 'walk', x0, x1, t0: t, t1: t + Math.abs(x1 - x0) / PASSER_SPEED, slot: -1, order: [], patienceMs: 0, waitUntil: 0, mood: null })
    }
    const busy = 1 + (shops.length - 1) * PASSER_BUSY_RATE
    nextPasser = t + (5000 + rand() * 7000) / busy
  }

  return { state: { progress, sim: { t, seq, customers, jobs, nextSpawn, nextPasser } }, events }
}
