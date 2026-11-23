import {
  GIFT_PRICE_RATE,
  MAX_SHOP_LEVEL,
  PASSER_CAP,
  SHOP_LEVELS,
  STREET_BUILDINGS,
  STREET_DECORS,
  STREET_GUEST_CAP,
  STREET_PRODUCTS,
  STREET_SAVE_VERSION,
  STREET_SITES,
  shopMenu,
  siteSpec,
  buyDecor,
  canFill,
  clearDecor,
  equipDecor,
  liveDecors,
  liveProducts,
  setStreetContentVersion,
  streetContentVersion,
  makeDuration,
  newSim,
  newStreet,
  orderValue,
  parseStreet,
  rankOf,
  rankStepXp,
  serve,
  setOpen,
  shelfCap,
  shopSpec,
  snapshot,
  startJob,
  stationCap,
  tick,
  unlockBuilding,
  upgrade,
  upgradeCheck,
  type BuildingId,
  type ProductId,
  type ShopId,
  type StreetState,
} from '../lib/arcade/street-rules'
import { marketplaceHref, readMarketplaceNav } from '../lib/marketplace-url'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}
const CLOCK = Date.UTC(2026, 9, 27, 4)
const stock = (partial: Partial<Record<ProductId, number>> = {}) => {
  const next = Object.fromEntries(STREET_PRODUCTS.map((item) => [item.id, 0])) as Record<ProductId, number>
  for (const [id, count] of Object.entries(partial)) next[id as ProductId] = count ?? 0
  return next
}
const run = (state: StreetState, ms: number, rand: () => number) => {
  const events = []
  for (let left = ms; left > 0; left -= 100) {
    const res = tick(state, Math.min(100, left), rand, CLOCK)
    state = res.state
    events.push(...res.events)
  }
  return { state, events }
}

// 資料表一致性
assert(SHOP_LEVELS.length === MAX_SHOP_LEVEL, '等級表長度錯誤')
assert(SHOP_LEVELS.every((s, i) => s.level === i + 1 && s.queue <= siteSpec('main').spots.length && s.shelf >= s.maxItems), '等級表數值不合理')
assert(SHOP_LEVELS.every((s, i) => i === 0 || (s.cost > SHOP_LEVELS[i - 1].cost && s.speed < SHOP_LEVELS[i - 1].speed)), '升級沒有實際改善')
assert(STREET_PRODUCTS.length >= 12 && STREET_PRODUCTS.length <= 18, '商品數量應為 12～18')
assert(new Set(STREET_PRODUCTS.map((p) => p.id)).size === STREET_PRODUCTS.length, '商品 id 重複')
assert(new Set(STREET_PRODUCTS.map((p) => `${p.price}:${p.xp}:${p.makeMs}`)).size === STREET_PRODUCTS.length, '商品收益或製作時間完全相同')
assert(['croissant', 'milktea', 'cake', 'roll', 'giftbox'].every((id) => STREET_PRODUCTS.some((p) => p.id === id)), '原有商品被移除')
assert(STREET_PRODUCTS.every((p) => p.unlock >= 1 && p.unlock <= MAX_SHOP_LEVEL && p.price > 0 && p.xp > 0 && p.makeMs > 0), '商品解鎖等級錯誤')
assert(rankOf(0).rank === 1 && rankOf(rankStepXp(1)).rank === 2 && rankOf(rankStepXp(1) - 1).rank === 1, '店長等級計算錯誤')

// 首次建立
let state: StreetState = { progress: newStreet(CLOCK), sim: newSim(newStreet(CLOCK)) }
assert(state.progress.shopLevel === 1 && state.progress.coins === 0 && state.progress.xp === 0 && !state.progress.open, '新店初始狀態錯誤')

// 未營業不會有顧客
let r = run(state, 20_000, seeded(1))
assert(!r.state.sim.customers.some((c) => c.kind === 'guest'), '休息中不該有顧客')
state = setOpen(r.state, true, CLOCK)
assert(state.progress.open && state.progress.tutorial === 1, '開店失敗')

// 顧客出現、走到店門口、等待
r = run(state, 12_000, seeded(2))
const arrived = r.events.find((e) => e.type === 'arrive')
assert(Boolean(arrived), '顧客沒有走到店門口')
state = r.state
const waiting = state.sim.customers.find((c) => c.kind === 'guest' && c.phase === 'wait')!
assert(Boolean(waiting) && waiting.order.length >= 1, '等待中的顧客沒有需求')
assert(state.sim.customers.filter((c) => c.kind === 'guest' && c.phase !== 'leave').length <= shopSpec(1).queue, '超過排隊位置')

// 庫存不足無法服務，製作補貨後可以服務
state = { ...state, progress: { ...state.progress, stock: stock() } }
assert(!serve(state, waiting.id, CLOCK).ok, '缺貨時不應能服務')
const product = waiting.order[0]
const job = startJob(state, product)
assert(job.ok, '無法製作')
if (!job.ok) throw new Error()
assert(!startJob(job.state, product).ok, '同一商品不可重複製作')
assert(!startJob(job.state, product === 'croissant' ? 'milktea' : 'croissant').ok, 'Lv.1 只有一座工作台')
assert(!startJob(job.state, 'cake').ok, '未解鎖商品不可製作')
const filled = stock()
for (const id of waiting.order) filled[id] = 3
state = { ...job.state, progress: { ...job.state.progress, stock: filled } }
const before = state.progress
assert(canFill(before, waiting.order), '補貨後應可服務')
const served = serve(state, waiting.id, CLOCK)
assert(served.ok, '服務失敗')
if (!served.ok) throw new Error()
const ev = served.events.find((e) => e.type === 'served')
if (ev?.type !== 'served') throw new Error('沒有服務事件')
assert(ev.base === orderValue(waiting.order, 1), '收益計算錯誤')
assert(served.state.progress.coins === before.coins + ev.coins, '金幣沒有正確增加')
assert(served.state.progress.xp > before.xp, '經驗沒有增加')
assert(served.state.progress.stats.served === 1 && served.state.progress.log[0].kind === 'serve', '經營紀錄錯誤')
assert(!serve(served.state, waiting.id, CLOCK).ok, '同一位顧客不可重複結帳')

// 服務後顧客離開並被移除
r = run(served.state, 15_000, seeded(3))
assert(!r.state.sim.customers.some((c) => c.id === waiting.id), '顧客沒有離開')

// 耐心耗盡會錯過並重設連續
state = setOpen({ progress: newStreet(CLOCK), sim: newSim(newStreet(CLOCK)) }, true, CLOCK)
state = { ...state, progress: { ...state.progress, stock: stock() } }
r = run(state, 45_000, seeded(4))
assert(r.events.some((e) => e.type === 'missed') && r.state.progress.stats.missed >= 1 && r.state.progress.stats.streak === 0, '錯過顧客未記錄')

// 升級條件與效果
let rich: StreetState = { progress: { ...newStreet(CLOCK), coins: 149, xp: rankStepXp(1) }, sim: newSim(newStreet(CLOCK)) }
assert(upgradeCheck(rich.progress).ok === false && !upgrade(rich, CLOCK).ok, '金幣不足不可升級')
rich = { ...rich, progress: { ...rich.progress, coins: 1000, xp: 0 } }
assert(!upgrade(rich, CLOCK).ok, '店長等級不足不可升級')
rich = { ...rich, progress: { ...rich.progress, xp: rankStepXp(1) } }
const up = upgrade(rich, CLOCK)
assert(up.ok, '條件達成卻不能升級')
if (!up.ok) throw new Error()
assert(up.state.progress.shopLevel === 2 && up.state.progress.coins === 1000 - shopSpec(2).cost, '升級扣款錯誤')
assert(startJob(up.state, 'cake').ok, 'Lv.2 應解鎖草莓蛋糕')

// 存檔還原與竄改
const snap = snapshot(up.state)
const parsed = parseStreet(JSON.parse(JSON.stringify(snap)))
assert(parsed !== null && parsed.shopLevel === 2 && parsed.coins === snap.coins, '存檔還原錯誤')
const forged = parseStreet({ ...snap, shopLevel: 99, coins: -5, stock: { croissant: 999, giftbox: 5 } })
assert(forged !== null && forged.shopLevel === MAX_SHOP_LEVEL && forged.coins === 0 && forged.stock.croissant === shopSpec(MAX_SHOP_LEVEL).shelf, '竄改存檔未被夾住')
assert(parseStreet({ ...snap, v: 99 }) === null && parseStreet('x') === null, '錯誤版本應被丟棄')
const legacy = parseStreet({ ...snap, v: 1, buildings: ['tea'], ownedDecors: ['lantern'], equipped: { shop: 'lantern', street: null } })
assert(legacy !== null && legacy.v === STREET_SAVE_VERSION && legacy.shopLevel === snap.shopLevel && legacy.coins === snap.coins && legacy.xp === snap.xp && legacy.buildings.length === 0 && legacy.ownedDecors.length === 0, '舊存檔沒有升級保留進度')
const lowForged = parseStreet({ ...snap, shopLevel: 1, stock: { giftbox: 5 } })
assert(lowForged !== null && lowForged.stock.giftbox === 0, '未解鎖商品不應有庫存')

// 長時間自動經營：能持續賺錢並升到滿級
let auto: StreetState = setOpen({ progress: newStreet(CLOCK), sim: newSim(newStreet(CLOCK)) }, true, CLOCK)
const rand = seeded(9)
for (let i = 0; i < 400_000 && auto.progress.shopLevel < MAX_SHOP_LEVEL; i += 1) {
  auto = tick(auto, 100, rand, CLOCK).state
  for (const c of auto.sim.customers) {
    if (c.kind === 'guest' && c.phase === 'wait') {
      const res = serve(auto, c.id, CLOCK)
      if (res.ok) auto = res.state
    }
  }
  for (const p of STREET_PRODUCTS) {
    const res = startJob(auto, p.id)
    if (res.ok) auto = res.state
  }
  const u = upgrade(auto, CLOCK)
  if (u.ok) auto = u.state
}
assert(auto.progress.shopLevel === MAX_SHOP_LEVEL, `自動經營沒升到滿級（停在 Lv.${auto.progress.shopLevel}）`)
const minutes = auto.sim.t / 60000
console.log(`自動經營 ${minutes.toFixed(1)} 分鐘升到 Lv.${MAX_SHOP_LEVEL}，服務 ${auto.progress.stats.served} 位，錯過 ${auto.progress.stats.missed} 位`)
const after = run(auto, 60_000, seeded(10))
assert(after.events.some((e) => e.type === 'arrive'), '滿級後應持續有顧客')

// 街邊店：扣款、不可重複、效果進到共用規則
let shop = setOpen({ progress: { ...newStreet(CLOCK), coins: 2000, xp: rankStepXp(1) + rankStepXp(2) }, sim: newSim(newStreet(CLOCK)) }, true, CLOCK)
assert(!unlockBuilding(shop, 'tea', CLOCK).ok, '店面等級不足不可開茶飲館')
shop = { ...shop, progress: { ...shop.progress, shopLevel: 2 } }
const tea = unlockBuilding(shop, 'tea', CLOCK)
assert(tea.ok, '茶飲館應可開幕')
if (!tea.ok) throw new Error()
assert(tea.state.progress.coins === 2000 - STREET_BUILDINGS[0].cost && tea.state.progress.buildings.includes('tea'), '開幕扣款錯誤')
assert(!unlockBuilding(tea.state, 'tea', CLOCK).ok, '不可重複開幕')
assert(shelfCap(tea.state.progress) === shopSpec(2).shelf + 1, '茶飲館應增加貨架')
assert(stationCap(tea.state.progress) === shopSpec(2).stations + 1, '茶飲館應增加工作台')
assert(makeDuration(tea.state.progress, 'milktea') < makeDuration({ shopLevel: 2, buildings: [] }, 'milktea'), '飲品製作應變快')
assert(makeDuration(tea.state.progress, 'croissant') === makeDuration({ shopLevel: 2, buildings: [] }, 'croissant'), '非飲品不該被茶飲館加速')
const giftPrice = orderValue(['giftbox'], 4, ['gift'])
assert(giftPrice > orderValue(['giftbox'], 4), '禮盒工坊應提高禮盒售價')
assert(orderValue(['croissant'], 4, ['gift']) === orderValue(['croissant'], 4), '禮盒加成不該影響其他商品')
assert(Math.round(46 * GIFT_PRICE_RATE * shopSpec(4).priceMul) === giftPrice, '禮盒加成計算錯誤')

// 裝潢：預覽確認後入收藏，卸下後可再套用，不重複扣款
let decor = { progress: { ...newStreet(CLOCK), coins: 100, xp: rankStepXp(1) }, sim: newSim(newStreet(CLOCK)) }
const bought = buyDecor(decor, 'mat', CLOCK)
assert(bought.ok, '應能收藏腳踏墊')
if (!bought.ok) throw new Error()
assert(bought.state.progress.coins === 100 - STREET_DECORS.find((item) => item.id === 'mat')!.cost, '裝潢扣款錯誤')
assert(bought.state.progress.equipped.shops.main === 'mat' && bought.state.progress.ownedDecors.includes('mat'), '裝潢沒有套用')
assert(!buyDecor(bought.state, 'mat', CLOCK).ok, '不可重複購買')
const cleared = clearDecor(bought.state, 'shop', CLOCK)
assert(cleared.ok && cleared.state.progress.equipped.shops.main === undefined && cleared.state.progress.ownedDecors.includes('mat'), '卸下不該失去收藏')
if (!cleared.ok) throw new Error()
const again = equipDecor(cleared.state, 'mat', CLOCK)
assert(again.ok && again.state.progress.coins === cleared.state.progress.coins && again.state.progress.equipped.shops.main === 'mat', '重新套用不該扣款')
const savedDecor = parseStreet(JSON.parse(JSON.stringify(snapshot(again.ok ? again.state : decor))))
assert(savedDecor !== null && savedDecor.equipped.shops.main === 'mat' && savedDecor.ownedDecors.includes('mat'), '裝潢沒有寫進存檔')
assert(!buyDecor(decor, 'flower', CLOCK).ok, '未達店面等級不可買花箱')

/* ---------- 多店經營 ---------- */

const allOpen = (level: number, buildings: BuildingId[]): StreetState => {
  const base = { ...newStreet(CLOCK), shopLevel: level, coins: 5000, xp: 20_000, buildings, tutorial: 4 }
  return setOpen({ progress: base, sim: newSim(base) }, true, CLOCK)
}
const guestsOf = (s: StreetState, shop: ShopId) => s.sim.customers.filter((c) => c.kind === 'guest' && c.shop === shop)

// 只有主店：所有顧客都到主店，且站在主店的等候位置
let solo = run(allOpen(3, []), 60_000, seeded(21)).state
assert(solo.sim.customers.filter((c) => c.kind === 'guest').every((c) => c.shop === 'main'), '只有主店時顧客應全部到主店')
assert(guestsOf(solo, 'main').every((c) => c.phase !== 'wait' || c.x1 === siteSpec('main').spots[c.slot]), '主店顧客沒有站在主店等候位置')

// 菜單分工：專門店開幕後主店讓出該類別；未開幕的店沒有菜單
assert(shopMenu(allOpen(2, []).progress, 'tea').length === 0 && shopMenu(allOpen(4, []).progress, 'gift').length === 0, '未開幕的店不該有菜單')
assert(shopMenu(allOpen(2, []).progress, 'main').some((p) => p.category === 'drink'), '茶飲館開幕前主店應賣飲品')
assert(!shopMenu(allOpen(2, ['tea']).progress, 'main').some((p) => p.category === 'drink'), '茶飲館開幕後主店不該再接飲品')
assert(shopMenu(allOpen(2, ['tea']).progress, 'tea').every((p) => p.category === 'drink'), '茶飲館只接飲品')
assert(shopMenu(allOpen(5, ['tea', 'gift']).progress, 'gift').map((p) => p.id).join() === 'giftbox,choco,wedding', '禮盒工坊菜單錯誤')

// 三間店同時營業：每間都有自己的顧客、訂單符合該店類別、位置不重疊
let busy = allOpen(5, ['tea', 'gift'])
const seen = new Map<ShopId, number>()
let peak = 0
const rand3 = seeded(31)
for (let i = 0; i < 1800; i += 1) {
  busy = tick(busy, 100, rand3, CLOCK).state
  const live = busy.sim.customers.filter((c) => c.kind === 'guest' && c.phase !== 'leave')
  peak = Math.max(peak, live.length)
  assert(busy.sim.customers.filter((c) => c.kind === 'passer').length <= PASSER_CAP, '路人超過上限')
  for (const c of live) {
    seen.set(c.shop!, (seen.get(c.shop!) ?? 0) + 1)
    const menu = new Set(shopMenu(busy.progress, c.shop!).map((p) => p.id))
    assert(c.order.length > 0 && c.order.every((id) => menu.has(id)), `${c.shop} 顧客點了不屬於該店的商品`)
    assert(c.order.length <= siteSpec(c.shop!).maxItems, '訂單件數超過該店上限')
  }
  for (const shop of ['main', 'tea', 'gift'] as const) {
    const slots = live.filter((c) => c.shop === shop).map((c) => c.slot)
    assert(new Set(slots).size === slots.length, `${shop} 兩位顧客搶同一個等候位置`)
  }
}
assert(['main', 'tea', 'gift'].every((shop) => (seen.get(shop as ShopId) ?? 0) > 0), '三間店同時營業時每間都應有顧客')
assert(peak <= STREET_GUEST_CAP, '同時在場顧客超過上限')

// 客流隨店數增加，而不是把主店的客人拆走
const arrivals = (buildings: BuildingId[]) => {
  let s = allOpen(5, buildings)
  const r = seeded(41)
  const counted = new Set<number>()
  for (let i = 0; i < 6000; i += 1) {
    s = tick(s, 100, r, CLOCK).state
    for (const c of s.sim.customers) {
      if (c.kind !== 'guest' || c.phase !== 'wait' || counted.has(c.id)) continue
      counted.add(c.id)
      const res = serve(s, c.id, CLOCK)
      if (res.ok) s = res.state
    }
    // 貨架永遠補滿，只量客流
    s = { ...s, progress: { ...s.progress, stock: Object.fromEntries(STREET_PRODUCTS.map((p) => [p.id, shelfCap(s.progress)])) as Record<ProductId, number> } }
  }
  return { total: counted.size, coins: s.progress.coins - 5000 }
}
const flow1 = arrivals([])
const flow3 = arrivals(['tea', 'gift'])
console.log(`10 分鐘客流：只有主店 ${flow1.total} 位／${flow1.coins} 金；三店 ${flow3.total} 位／${flow3.coins} 金`)
assert(flow3.total > flow1.total * 1.3, '多開店之後總客流應明顯增加')
assert(flow3.total < flow1.total * 2.2, '多開店之後客流增加不應失控')

// 結帳只結被點的那位：茶飲館顧客的錢與庫存只來自他自己的訂單
const pick = (s: StreetState, shop: ShopId) => s.sim.customers.find((c) => c.kind === 'guest' && c.shop === shop && c.phase === 'wait')
let dual = allOpen(5, ['tea', 'gift'])
const rand4 = seeded(51)
for (let i = 0; i < 3000 && !(pick(dual, 'tea') && pick(dual, 'main')); i += 1) dual = tick(dual, 100, rand4, CLOCK).state
const teaGuest = pick(dual, 'tea')!
const mainGuest = pick(dual, 'main')!
assert(Boolean(teaGuest && mainGuest), '找不到同時等待的茶飲館與主店顧客')
dual = { ...dual, progress: { ...dual.progress, stock: Object.fromEntries(STREET_PRODUCTS.map((p) => [p.id, 3])) as Record<ProductId, number> } }
const teaServed = serve(dual, teaGuest.id, CLOCK)
assert(teaServed.ok, '茶飲館顧客應可結帳')
if (!teaServed.ok) throw new Error()
const teaEv = teaServed.events.find((e) => e.type === 'served')
assert(teaEv?.type === 'served' && teaEv.customer.id === teaGuest.id && teaEv.customer.shop === 'tea', '結帳對象錯誤')
assert(teaEv?.type === 'served' && teaEv.base === orderValue(teaGuest.order, 5, ['tea', 'gift']), '茶飲館收益應沿用原本的售價公式')
assert(teaServed.state.sim.customers.find((c) => c.id === mainGuest.id)?.phase === 'wait', '結帳茶飲館不該動到主店顧客')
for (const id of STREET_PRODUCTS.map((p) => p.id)) {
  const used = teaGuest.order.filter((x) => x === id).length
  assert(teaServed.state.progress.stock[id] === 3 - used, '庫存扣錯商品')
}
assert(teaServed.state.progress.log[0].text.startsWith('暖暖茶飲館'), '經營紀錄沒有標出店名')
// 結帳後離開、重新渲染（多次 tick）都不會換店
let after2 = teaServed.state
for (let i = 0; i < 200; i += 1) {
  after2 = tick(after2, 100, rand4, CLOCK).state
  const c = after2.sim.customers.find((x) => x.id === teaGuest.id)
  if (!c) break
  assert(c.shop === 'tea' && c.look === teaGuest.look && c.order.join() === teaGuest.order.join(), '顧客離開途中換了店或換了身分')
}
// 未開幕的店即使被竄改出顧客也不能成交
const forgedGuest = { ...mainGuest, id: 9999, shop: 'gift' as const }
const noGift = allOpen(5, ['tea'])
const forgedState = { ...noGift, sim: { ...noGift.sim, customers: [forgedGuest] } }
assert(!serve(forgedState, 9999, CLOCK).ok, '未開幕的店不可成交')

// 新開幕的店立刻開始有自己的客人
let opening = allOpen(2, [])
opening = { ...opening, progress: { ...opening.progress, xp: 20_000, coins: 1000 } }
const opened = unlockBuilding(opening, 'tea', CLOCK)
assert(opened.ok, '茶飲館應能開幕')
if (!opened.ok) throw new Error()
const afterOpen = run(opened.state, 20_000, seeded(61)).state
assert(guestsOf(afterOpen, 'tea').length > 0, '茶飲館開幕後沒有自己的顧客')

/* ---------- 各店獨立裝潢 ---------- */

let deco = allOpen(5, ['tea', 'gift'])
const mat = buyDecor(deco, 'mat', CLOCK, 'tea')
assert(mat.ok, '應能為茶飲館收藏腳踏墊')
if (!mat.ok) throw new Error()
deco = mat.state
assert(deco.progress.equipped.shops.tea === 'mat' && !deco.progress.equipped.shops.main && !deco.progress.equipped.shops.gift, '裝潢茶飲館影響到其他店')
const coinsAfterBuy = deco.progress.coins
const matMain = equipDecor(deco, 'mat', CLOCK, 'main')
assert(matMain.ok && matMain.state.progress.coins === coinsAfterBuy, '已收藏的裝潢套到其他店不該再扣款')
if (!matMain.ok) throw new Error()
deco = matMain.state
const lantern = buyDecor(deco, 'lantern', CLOCK, 'gift')
assert(lantern.ok, '應能為禮盒工坊收藏燈籠')
if (!lantern.ok) throw new Error()
deco = lantern.state
const shopsNow = deco.progress.equipped.shops
assert(shopsNow.main === 'mat' && shopsNow.tea === 'mat' && shopsNow.gift === 'lantern', '各店裝潢互相覆蓋')
const swapTea = equipDecor(deco, 'lantern', CLOCK, 'tea')
assert(swapTea.ok && swapTea.state.progress.equipped.shops.tea === 'lantern' && swapTea.state.progress.equipped.shops.main === 'mat', '更換 A 店裝潢改到 B 店')
if (!swapTea.ok) throw new Error()
const clearGift = clearDecor(swapTea.state, 'shop', CLOCK, 'gift')
assert(clearGift.ok && !clearGift.state.progress.equipped.shops.gift && clearGift.state.progress.equipped.shops.tea === 'lantern' && clearGift.state.progress.ownedDecors.includes('lantern'), '卸下 A 店裝潢影響到其他店或收藏')
if (!clearGift.ok) throw new Error()
const street = buyDecor(clearGift.state, 'bunting', CLOCK, 'gift')
assert(street.ok && street.state.progress.equipped.street === 'bunting' && street.state.progress.equipped.shops.tea === 'lantern', '街道裝潢不該改到店面')
if (!street.ok) throw new Error()
const reloaded = parseStreet(JSON.parse(JSON.stringify(snapshot(street.state))))
assert(reloaded !== null && reloaded.v === STREET_SAVE_VERSION && reloaded.equipped.street === 'bunting' && STREET_SITES.every((site) => reloaded.equipped.shops[site.id] === street.state.progress.equipped.shops[site.id]), '各店裝潢沒有正確存檔')
assert(!buyDecor(allOpen(5, ['tea']), 'mat', CLOCK, 'gift').ok, '未開幕的店不能裝潢')
assert(STREET_SITES.every((site) => STREET_DECORS.filter((d) => d.slot === 'shop').every((d) => d.fits.includes(site.id))), '現有三間店應都適用三款店面裝潢')

// 舊存檔相容：v2 的單一店面裝潢歸給主店，收藏與街道裝潢保留
const v2 = { ...JSON.parse(JSON.stringify(snapshot(street.state))), v: 2, equipped: { shop: 'lantern', street: 'bunting' } }
const fromV2 = parseStreet(v2)
assert(fromV2 !== null && fromV2.equipped.shops.main === 'lantern' && !fromV2.equipped.shops.tea && fromV2.equipped.street === 'bunting' && fromV2.ownedDecors.includes('mat') && fromV2.buildings.join() === 'tea,gift', 'v2 存檔升級後裝潢或店面遺失')
const forgedShops = parseStreet({ ...snapshot(street.state), buildings: ['tea'], equipped: { street: null, shops: { gift: 'lantern', tea: 'bunting', main: 'flower' } } })
assert(forgedShops !== null && !forgedShops.equipped.shops.gift && !forgedShops.equipped.shops.tea && !forgedShops.equipped.shops.main, '竄改的店面裝潢未被丟棄')

// 網址
const nav = readMarketplaceNav(new URLSearchParams('page=arcade&game=street'))
assert(nav.page === 'arcade' && nav.game === 'street', '商店街網址讀取錯誤')
assert(marketplaceHref('/', nav) === '/?page=arcade&game=street', '商店街網址輸出錯誤')
assert(readMarketplaceNav(new URLSearchParams('page=arcade&game=blocks')).game === 'blocks', '方塊網址不可受影響')

/* ---------- 內容版本 2：資料庫還沒套用前不開放新商品與新裝潢 ---------- */
/* 這裡直接給高等級，只測內容開關。實際升級解鎖見 scripts/run-street-unlock-local-test.ts。 */
{
  assert(streetContentVersion() === 1 && liveProducts().length === 15 && liveDecors().length === 6, '預設只能開放 v1 內容')
  const rich = allOpen(5, ['tea', 'gift'])
  const richer: StreetState = { ...rich, progress: { ...rich.progress, coins: 99_999, xp: 99_999 } }
  const taroV1 = startJob(richer, 'taro')
  assert(!taroV1.ok && taroV1.error.includes('即將開放'), 'v1 資料庫時不能製作新商品')
  assert(!buyDecor(richer, 'stalls', CLOCK).ok, 'v1 資料庫時不能買新裝潢')
  assert(shopMenu(richer.progress, 'main').every((p) => (p.since ?? 1) === 1), 'v1 資料庫時新商品不能出現在菜單')
  const saved = parseStreet({ ...snapshot(richer), stock: { ...snapshot(richer).stock, taro: 2, yolkcake: 1 } })
  assert(saved?.stock.taro === 2 && saved.stock.yolkcake === 1, '讀存檔不能因為內容開關而丟掉新商品庫存')
  setStreetContentVersion(2)
  assert(liveProducts().length === 18 && liveDecors().length === 8, 'v2 要開放全部內容')
  assert(startJob(richer, 'taro').ok && buyDecor(richer, 'stalls', CLOCK).ok, 'v2 要能製作新商品與買新裝潢')
  assert(shopMenu(richer.progress, 'gift').some((p) => p.id === 'yolkcake'), 'v2 禮盒工坊要賣蛋黃酥禮盒')
  for (const p of STREET_PRODUCTS.filter((item) => item.since === 2)) {
    const lv = SHOP_LEVELS[p.unlock - 1]
    const capPrice = Math.max(...STREET_PRODUCTS.filter((x) => x.unlock <= p.unlock && (x.since ?? 1) === 1).map((x) => x.price))
    const capXp = Math.max(...STREET_PRODUCTS.filter((x) => x.unlock <= p.unlock && (x.since ?? 1) === 1).map((x) => x.xp))
    assert(lv && p.price <= capPrice && p.xp <= capXp && p.makeMs >= 2200, `${p.name} 超過資料庫的營業上限`)
  }
  setStreetContentVersion(1)
}

console.log('dream street checks passed')
