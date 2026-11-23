// 隔離資料庫驗收：夢想商店街高等級商品與裝潢必須靠 upgrade() 跨過門檻。
// 測試會員與存檔只存在本機 docker 的一個交易裡，結尾 ROLLBACK。不可拿來當成正式會員人工驗收。
// 用法：npx tsx scripts/run-street-unlock-local-test.ts [容器名稱]
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  SHOP_LEVELS,
  buyDecor,
  clearDecor,
  decorSpec,
  equipDecor,
  makeDuration,
  newSim,
  newStreet,
  productSpec,
  rankOf,
  rankStepXp,
  setStreetContentVersion,
  shopSpec,
  snapshot,
  startJob,
  tick,
  unlockBuilding,
  upgrade,
  type DecorId,
  type ProductId,
  type StreetProgress,
  type StreetState,
} from '../lib/arcade/street-rules'

const CLOCK = Date.parse('2026-10-29T12:00:00+08:00')
const container = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'supabase_db_hengjing-stage45-local'
setStreetContentVersion(2)

let clientPasses = 0
const pass = (label: string) => {
  clientPasses += 1
  console.log(`PASS ${label}`)
}
const fail = (label: string, detail = ''): never => {
  throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ''}`)
}

const xpToReach = (rank: number) => {
  let xp = 0
  for (let r = 1; r < rank; r += 1) xp += rankStepXp(r)
  return xp
}

const assertSame = (label: string, before: StreetState, after: StreetState) => {
  if (JSON.stringify(snapshot(before)) !== JSON.stringify(snapshot(after))) fail(label, '進度被改動')
  if (before.sim.jobs.length !== after.sim.jobs.length || before.sim.t !== after.sim.t) fail(label, '製作或時間被改動')
}

const rejectJob = (state: StreetState, id: ProductId, message: string) => {
  const copy = JSON.parse(JSON.stringify(state)) as StreetState
  const res = startJob(state, id)
  if (res.ok) fail(`${productSpec(id).name}不該能製作`)
  if (res.error !== message) fail(`${productSpec(id).name}拒絕原因`, res.error)
  assertSame(`${productSpec(id).name}製作被拒`, state, copy)
  pass(`${productSpec(id).name}未達條件拒絕：${res.error}`)
}

const rejectDecor = (state: StreetState, id: DecorId, message: string) => {
  const copy = JSON.parse(JSON.stringify(state)) as StreetState
  const res = buyDecor(state, id, CLOCK)
  if (res.ok) fail(`${decorSpec(id).name}不該能購買`)
  if (res.error !== message) fail(`${decorSpec(id).name}拒絕原因`, res.error)
  assertSame(`${decorSpec(id).name}購買被拒`, state, copy)
  pass(`${decorSpec(id).name}未達條件拒絕：${res.error}`)
}

const rejectUpgrade = (state: StreetState, message: string) => {
  const copy = JSON.parse(JSON.stringify(state)) as StreetState
  const res = upgrade(state, CLOCK)
  if (res.ok) fail('不該能升級', message)
  if (res.error !== message) fail('升級拒絕原因', res.error)
  assertSame('升級被拒', state, copy)
  pass(`升級被拒：${res.error}`)
}

const arrange = (progress: StreetProgress, patch: Partial<StreetProgress> & { shopLevel?: never }): StreetState => {
  if (Object.prototype.hasOwnProperty.call(patch, 'shopLevel')) fail('測試直接改了店面等級')
  const next: StreetProgress = {
    ...progress,
    ...patch,
    stock: { ...progress.stock, ...(patch.stock ?? {}) },
    stats: { ...progress.stats, ...(patch.stats ?? {}) },
    ownedDecors: patch.ownedDecors ?? progress.ownedDecors,
    equipped: patch.equipped ?? progress.equipped,
  }
  return { progress: next, sim: newSim(next) }
}

const mustUpgrade = (state: StreetState, upgrades: { n: number }): StreetState => {
  const from = state.progress.shopLevel
  const spec = shopSpec(from + 1)
  const res = upgrade(state, CLOCK)
  if (!res.ok) fail(`Lv.${from} 升 Lv.${spec.level}`, res.error)
  const p = res.state.progress
  if (p.shopLevel !== from + 1 || p.coins !== state.progress.coins - spec.cost) fail(`Lv.${spec.level} 扣款`, `${p.shopLevel}/${p.coins}`)
  if (p.xp !== state.progress.xp || p.stats.served !== state.progress.stats.served || p.stats.earned !== state.progress.stats.earned || p.stats.xpEarned !== state.progress.stats.xpEarned) {
    fail(`Lv.${spec.level} 升級改到經驗或營業紀錄`)
  }
  if (p.stock.croissant !== state.progress.stock.croissant || JSON.stringify(p.ownedDecors) !== JSON.stringify(state.progress.ownedDecors)) {
    fail(`Lv.${spec.level} 升級改到持有物`)
  }
  upgrades.n += 1
  if (p.shopLevel !== 1 + upgrades.n) fail('店面等級不是依 upgrade() 逐級增加', String(p.shopLevel))
  pass(`upgrade() 升到店面 Lv.${p.shopLevel}，扣 ${spec.cost}，店長仍是 Lv.${rankOf(p.xp).rank}`)
  return res.state
}

const craft = (state: StreetState, id: ProductId): StreetState => {
  const before = state.progress
  const started = startJob(state, id)
  if (!started.ok) fail(`製作${productSpec(id).name}`, started.error)
  const batch = shopSpec(before.shopLevel).batch
  const added = Math.min(batch, shopSpec(before.shopLevel).shelf - before.stock[id])
  const ms = makeDuration(before, id)
  let cur = started.state
  for (let waited = 0; cur.progress.stock[id] === before.stock[id] && waited <= ms + 1000; waited += 250) {
    cur = tick(cur, 250, () => 0, CLOCK).state
  }
  const p = cur.progress
  if (p.stock[id] !== before.stock[id] + added) fail(`${productSpec(id).name}產量`, String(p.stock[id]))
  if (p.coins !== before.coins || p.xp !== before.xp || p.shopLevel !== before.shopLevel) fail(`${productSpec(id).name}製作改到金幣、經驗或等級`)
  if (p.stats.served !== before.stats.served || p.stats.earned !== before.stats.earned || p.stats.xpEarned !== before.stats.xpEarned) {
    fail(`${productSpec(id).name}製作改到營業紀錄`)
  }
  pass(`製成${productSpec(id).name} ${added} 份，金幣仍是 ${p.coins}（售價 ${productSpec(id).price} 不在製作時扣）`)
  return cur
}

const importable = (progress: StreetProgress) => {
  const items = progress.stats.itemsSold
  const served = progress.stats.served
  const unit = Math.ceil(18 * 1.12)
  const maxEarned = Math.ceil(items * unit * 1.2) + served * 12
  if (progress.shopLevel !== 1) fail('匯入起點必須是 Lv.1')
  if (items > served * 2 || progress.xp > items * 6 || progress.stats.earned < progress.coins || progress.stats.earned > maxEarned) {
    fail('門檻存檔不符合伺服器轉移上限', JSON.stringify({ items, served, xp: progress.xp, earned: progress.stats.earned, maxEarned }))
  }
}

const near = (coins: number, rank: number): StreetProgress => {
  const xp = xpToReach(rank)
  if (rankOf(xp).rank !== rank || rankOf(xp - 1).rank !== rank - 1) fail('店長經驗門檻', `${rank}/${xp}`)
  const progress = newStreet(CLOCK)
  const itemsSold = Math.max(10, Math.ceil(xp / 6))
  const served = Math.max(10, Math.ceil(itemsSold / 2))
  progress.coins = coins
  progress.xp = xp
  progress.tutorial = 4
  progress.stats = { ...progress.stats, served, itemsSold, earned: coins, xpEarned: xp }
  importable(progress)
  return progress
}

type Expect = {
  label: string
  ok: boolean
  reason?: string
  shopLevel: number
  coins: number
  xp: number
  served: number
  earned: number
  xpEarned: number
  stock: Partial<Record<ProductId, number>>
  decors: string[]
  street: string | null
  shops: Record<string, string>
}
type Step = { op: 'import' | 'save' | 'read'; progress?: StreetProgress; expect: Expect }
type Group = { id: string; email: string; steps: Step[] }

const view = (label: string, progress: StreetProgress, stock: Partial<Record<ProductId, number>>, extra: Partial<Expect> = {}): Expect => ({
  label,
  ok: true,
  shopLevel: progress.shopLevel,
  coins: progress.coins,
  xp: progress.xp,
  served: progress.stats.served,
  earned: progress.stats.earned,
  xpEarned: progress.stats.xpEarned,
  stock: { croissant: progress.stock.croissant, milktea: progress.stock.milktea, ...stock },
  decors: [...progress.ownedDecors],
  street: progress.equipped.street,
  shops: Object.fromEntries(Object.entries(progress.equipped.shops).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  ...extra,
})

const groups: Group[] = []
const openGroup = (slug: string, n: number): Group => {
  const group = { id: `aaaaaaaa-0000-4000-8000-000000000b${n.toString(16).padStart(2, '0')}`, email: `street-unlock-${slug}@example.invalid`, steps: [] }
  groups.push(group)
  return group
}
const remember = (group: Group, op: Step['op'], progress: StreetProgress, expect: Expect) => {
  group.steps.push({ op, progress: op === 'read' ? undefined : JSON.parse(JSON.stringify(snapshot({ progress, sim: newSim(progress) }))), expect })
}

const taro = productSpec('taro')
const pineapple = productSpec('pineapple')
const yolkcake = productSpec('yolkcake')
const parasols = decorSpec('parasols')
const stalls = decorSpec('stalls')
if (taro.unlock !== 2 || pineapple.unlock !== 3 || yolkcake.unlock !== 5) fail('商品解鎖等級與目錄不符')
if (parasols.needShop !== 3 || parasols.needRank !== 5 || parasols.cost !== 260) fail('遮陽傘條件與目錄不符')
if (stalls.needShop !== 4 || stalls.needRank !== 7 || stalls.cost !== 340) fail('夜市小攤車條件與目錄不符')
if (SHOP_LEVELS.map((item) => `${item.level}:${item.cost}:${item.needRank}`).join() !== '1:0:1,2:150:2,3:420:4,4:1000:6,5:2200:9') fail('店面升級表與目錄不符')
pass('目錄：芋泥店面2、土鳳梨酥店面3、蛋黃酥店面5；遮陽傘店面3／店長5／260；攤車店面4／店長7／340')

// 芋泥：店長再高也不能代替店面等級。剛好夠升 Lv.2 的存檔才經 upgrade() 解開。
{
  const group = openGroup('taro', 1)
  const upgrades = { n: 0 }
  let state = arrange(near(shopSpec(2).cost, shopSpec(2).needRank), {})
  rejectUpgrade(arrange(state.progress, { coins: shopSpec(2).cost - 1 }), `金幣不足，還差 1`)
  rejectJob(arrange(state.progress, { xp: xpToReach(9), stats: { ...state.progress.stats, xpEarned: xpToReach(9) } }), 'taro', `店面 Lv.2 才能製作${taro.name}`)
  rejectJob(state, 'taro', `店面 Lv.2 才能製作${taro.name}`)
  remember(group, 'import', state.progress, view('匯入芋泥門檻前', state.progress, { taro: 0, pineapple: 0, yolkcake: 0 }))
  const forged = arrange(state.progress, { stock: { ...state.progress.stock, taro: 5 } })
  remember(group, 'save', forged.progress, view('未達 Lv.2 的芋泥庫存不入帳', state.progress, { taro: 0, pineapple: 0, yolkcake: 0 }))
  remember(group, 'read', state.progress, view('拒絕後重讀芋泥', state.progress, { taro: 0, pineapple: 0, yolkcake: 0 }))
  state = mustUpgrade(state, upgrades)
  rejectJob(state, 'pineapple', `店面 Lv.3 才能製作${pineapple.name}`)
  state = craft(state, 'taro')
  remember(group, 'save', state.progress, view('升到 Lv.2 後製成芋泥', state.progress, { taro: state.progress.stock.taro, pineapple: 0, yolkcake: 0 }))
  remember(group, 'read', state.progress, view('重讀芋泥', state.progress, { taro: state.progress.stock.taro, pineapple: 0, yolkcake: 0 }))
}

// 土鳳梨酥：升到 Lv.2 仍不行，再經 upgrade() 到 Lv.3 才可製作。
{
  const group = openGroup('pineapple', 2)
  const upgrades = { n: 0 }
  const cost = shopSpec(2).cost + shopSpec(3).cost
  let state = arrange(near(cost, shopSpec(3).needRank), {})
  rejectJob(state, 'pineapple', `店面 Lv.3 才能製作${pineapple.name}`)
  remember(group, 'import', state.progress, view('匯入土鳳梨酥門檻前', state.progress, { pineapple: 0, yolkcake: 0 }))
  state = mustUpgrade(state, upgrades)
  rejectJob(state, 'pineapple', `店面 Lv.3 才能製作${pineapple.name}`)
  const locked = state
  remember(group, 'save', state.progress, view('店面 Lv.2 仍不能做土鳳梨酥', state.progress, { pineapple: 0, yolkcake: 0 }))
  const forged = arrange(state.progress, { stock: { ...state.progress.stock, pineapple: 4 } })
  remember(group, 'save', forged.progress, view('未達 Lv.3 的土鳳梨酥庫存不入帳', locked.progress, { pineapple: 0, yolkcake: 0 }))
  remember(group, 'read', locked.progress, view('拒絕後重讀土鳳梨酥', locked.progress, { pineapple: 0, yolkcake: 0 }))
  rejectUpgrade(arrange(state.progress, { xp: xpToReach(shopSpec(3).needRank) - 1, stats: { ...state.progress.stats, xpEarned: xpToReach(shopSpec(3).needRank) - 1 } }), `店長需要 Lv.${shopSpec(3).needRank}`)
  state = mustUpgrade(state, upgrades)
  state = craft(state, 'pineapple')
  remember(group, 'save', state.progress, view('升到 Lv.3 後製成土鳳梨酥', state.progress, { pineapple: state.progress.stock.pineapple, yolkcake: 0 }))
  remember(group, 'read', state.progress, view('重讀土鳳梨酥', state.progress, { pineapple: state.progress.stock.pineapple, yolkcake: 0 }))
}

// 蛋黃酥：店長已是 Lv.9，店面停在 Lv.4 仍不能做；upgrade() 到 Lv.5 才解鎖。
{
  const group = openGroup('yolkcake', 3)
  const upgrades = { n: 0 }
  const cost = shopSpec(2).cost + shopSpec(3).cost + shopSpec(4).cost + shopSpec(5).cost
  let state = arrange(near(cost, shopSpec(5).needRank), {})
  remember(group, 'import', state.progress, view('匯入蛋黃酥門檻前', state.progress, { yolkcake: 0 }))
  state = mustUpgrade(state, upgrades)
  state = mustUpgrade(state, upgrades)
  state = mustUpgrade(state, upgrades)
  rejectJob(state, 'yolkcake', `店面 Lv.5 才能製作${yolkcake.name}`)
  const locked = state
  remember(group, 'save', state.progress, view('店長 Lv.9 但店面 Lv.4 仍不能做蛋黃酥', state.progress, { yolkcake: 0 }))
  const forged = arrange(state.progress, { stock: { ...state.progress.stock, yolkcake: 4 } })
  remember(group, 'save', forged.progress, view('未達 Lv.5 的蛋黃酥庫存不入帳', locked.progress, { yolkcake: 0 }))
  remember(group, 'read', locked.progress, view('拒絕後重讀蛋黃酥', locked.progress, { yolkcake: 0 }))
  rejectUpgrade(arrange(state.progress, { coins: shopSpec(5).cost - 1 }), `金幣不足，還差 1`)
  state = mustUpgrade(state, upgrades)
  state = craft(state, 'yolkcake')
  remember(group, 'save', state.progress, view('升到 Lv.5 後製成蛋黃酥', state.progress, { yolkcake: state.progress.stock.yolkcake }))
  remember(group, 'read', state.progress, view('重讀蛋黃酥', state.progress, { yolkcake: state.progress.stock.yolkcake }))
}

const forgeDecor = (progress: StreetProgress, id: DecorId): StreetProgress => ({
  ...progress,
  coins: progress.coins - decorSpec(id).cost,
  ownedDecors: [...progress.ownedDecors, id],
  equipped: { ...progress.equipped, street: id },
})

// 遮陽傘：店面不足與店長不足是兩種拒絕；兩項都剛好夠才扣 260 並套用。
{
  const shopGroup = openGroup('parasol-shop', 4)
  const shopUps = { n: 0 }
  let shop = arrange(near(shopSpec(2).cost + parasols.cost, parasols.needRank), {})
  remember(shopGroup, 'import', shop.progress, view('匯入遮陽傘店面不足', shop.progress, {}))
  shop = mustUpgrade(shop, shopUps)
  rejectDecor(shop, 'parasols', `店面需要 Lv.${parasols.needShop}`)
  const shopLocked = shop
  remember(shopGroup, 'save', shop.progress, view('店面 Lv.2、店長已夠仍不能買遮陽傘', shop.progress, {}))
  remember(shopGroup, 'save', forgeDecor(shop.progress, 'parasols'), view('偽造遮陽傘不入帳', shopLocked.progress, {}))
  remember(shopGroup, 'read', shopLocked.progress, view('重讀遮陽傘店面不足', shopLocked.progress, {}))
  remember(shopGroup, 'save', shopLocked.progress, view('清掉殘留後再存一次，金幣與持有物不變', shopLocked.progress, {}))
  remember(shopGroup, 'read', shopLocked.progress, view('再次重讀遮陽傘仍無非法套用', shopLocked.progress, {}))

  const rankGroup = openGroup('parasol-rank', 5)
  const rankUps = { n: 0 }
  let rank = arrange(near(shopSpec(2).cost + shopSpec(3).cost + parasols.cost, parasols.needRank - 1), {})
  remember(rankGroup, 'import', rank.progress, view('匯入遮陽傘店長不足', rank.progress, {}))
  rank = mustUpgrade(rank, rankUps)
  rank = mustUpgrade(rank, rankUps)
  rejectDecor(rank, 'parasols', `店長需要 Lv.${parasols.needRank}`)
  rejectDecor(arrange(rank.progress, { xp: xpToReach(parasols.needRank) - 1, stats: { ...rank.progress.stats, xpEarned: xpToReach(parasols.needRank) - 1 } }), 'parasols', `店長需要 Lv.${parasols.needRank}`)
  const rankLocked = rank
  remember(rankGroup, 'save', rank.progress, view('店面 Lv.3、店長 Lv.4 仍不能買遮陽傘', rank.progress, {}))
  remember(rankGroup, 'save', { ...rank.progress, equipped: { ...rank.progress.equipped, street: 'parasols' } }, view('店長不足只偽造套用', rankLocked.progress, {}))
  remember(rankGroup, 'read', rankLocked.progress, view('重讀店長不足的套用已清除', rankLocked.progress, {}))
  remember(rankGroup, 'save', forgeDecor(rank.progress, 'parasols'), { ...view('店長不足的遮陽傘整筆拒絕', rankLocked.progress, {}), ok: false, reason: 'rank' })
  remember(rankGroup, 'read', rankLocked.progress, view('重讀遮陽傘店長不足', rankLocked.progress, {}))

  const okGroup = openGroup('parasol-ok', 6)
  const okUps = { n: 0 }
  let ok = arrange(near(shopSpec(2).cost + shopSpec(3).cost + parasols.cost, parasols.needRank), {})
  remember(okGroup, 'import', ok.progress, view('匯入遮陽傘可購買', ok.progress, {}))
  ok = mustUpgrade(ok, okUps)
  ok = mustUpgrade(ok, okUps)
  remember(okGroup, 'save', ok.progress, view('達標但尚未購買遮陽傘', ok.progress, {}))
  remember(okGroup, 'save', { ...ok.progress, equipped: { ...ok.progress.equipped, street: 'parasols' } }, view('未持有的遮陽傘套用被清掉', ok.progress, {}))
  remember(okGroup, 'read', ok.progress, view('重讀未持有遮陽傘', ok.progress, {}))
  rejectDecor(arrange(ok.progress, { coins: parasols.cost - 1 }), 'parasols', `還差 1 金幣`)
  const bought = buyDecor(ok, 'parasols', CLOCK)
  if (!bought.ok) fail('購買遮陽傘', bought.error)
  if (bought.state.progress.coins !== ok.progress.coins - parasols.cost || bought.state.progress.equipped.street !== 'parasols' || !bought.state.progress.ownedDecors.includes('parasols')) {
    fail('遮陽傘扣款或套用')
  }
  pass(`購買遮陽傘扣 ${parasols.cost}，並套到街道`)
  ok = bought.state
  remember(okGroup, 'save', ok.progress, view('買下遮陽傘', ok.progress, {}))
  const cleared = clearDecor(ok, 'street', CLOCK)
  if (!cleared.ok || cleared.state.progress.equipped.street !== null || !cleared.state.progress.ownedDecors.includes('parasols') || cleared.state.progress.coins !== ok.progress.coins) {
    fail('卸下遮陽傘')
  }
  ok = cleared.state
  remember(okGroup, 'save', ok.progress, view('卸下遮陽傘仍保留收藏', ok.progress, {}))
  const equipped = equipDecor(ok, 'parasols', CLOCK)
  if (!equipped.ok || equipped.state.progress.equipped.street !== 'parasols' || equipped.state.progress.coins !== ok.progress.coins) fail('再套用遮陽傘')
  ok = equipped.state
  pass('已收藏的遮陽傘再套用，不再扣款')
  remember(okGroup, 'save', ok.progress, view('再套用遮陽傘', ok.progress, {}))
  remember(okGroup, 'read', ok.progress, view('重讀遮陽傘', ok.progress, {}))
}

// 夜市小攤車：店面 Lv.4 與店長 Lv.7 各自不足都會拒絕；剛好達成才扣 340。
{
  const shopGroup = openGroup('stall-shop', 7)
  const shopUps = { n: 0 }
  let shop = arrange(near(shopSpec(2).cost + shopSpec(3).cost + stalls.cost, stalls.needRank), {})
  remember(shopGroup, 'import', shop.progress, view('匯入攤車店面不足', shop.progress, {}))
  shop = mustUpgrade(shop, shopUps)
  shop = mustUpgrade(shop, shopUps)
  rejectDecor(shop, 'stalls', `店面需要 Lv.${stalls.needShop}`)
  const shopLocked = shop
  remember(shopGroup, 'save', shop.progress, view('店面 Lv.3、店長已夠仍不能買攤車', shop.progress, {}))
  remember(shopGroup, 'save', forgeDecor(shop.progress, 'stalls'), view('偽造攤車不入帳', shopLocked.progress, {}))
  remember(shopGroup, 'read', shopLocked.progress, view('重讀攤車店面不足', shopLocked.progress, {}))
  remember(shopGroup, 'save', shopLocked.progress, view('清掉攤車殘留後再存一次', shopLocked.progress, {}))
  remember(shopGroup, 'read', shopLocked.progress, view('再次重讀攤車仍無非法套用', shopLocked.progress, {}))

  const rankGroup = openGroup('stall-rank', 8)
  const rankUps = { n: 0 }
  let rank = arrange(near(shopSpec(2).cost + shopSpec(3).cost + shopSpec(4).cost + stalls.cost, stalls.needRank - 1), {})
  remember(rankGroup, 'import', rank.progress, view('匯入攤車店長不足', rank.progress, {}))
  rank = mustUpgrade(rank, rankUps)
  rank = mustUpgrade(rank, rankUps)
  rejectDecor(rank, 'stalls', `店面需要 Lv.${stalls.needShop}`)
  rank = mustUpgrade(rank, rankUps)
  rejectDecor(rank, 'stalls', `店長需要 Lv.${stalls.needRank}`)
  const rankLocked = rank
  remember(rankGroup, 'save', rank.progress, view('店面 Lv.4、店長 Lv.6 仍不能買攤車', rank.progress, {}))
  remember(rankGroup, 'save', forgeDecor(rank.progress, 'stalls'), { ...view('店長不足的攤車整筆拒絕', rankLocked.progress, {}), ok: false, reason: 'rank' })
  remember(rankGroup, 'read', rankLocked.progress, view('重讀攤車店長不足', rankLocked.progress, {}))

  const okGroup = openGroup('stall-ok', 9)
  const okUps = { n: 0 }
  let ok = arrange(near(shopSpec(2).cost + shopSpec(3).cost + shopSpec(4).cost + stalls.cost, stalls.needRank), {})
  remember(okGroup, 'import', ok.progress, view('匯入攤車可購買', ok.progress, {}))
  ok = mustUpgrade(ok, okUps)
  ok = mustUpgrade(ok, okUps)
  ok = mustUpgrade(ok, okUps)
  rejectDecor(arrange(ok.progress, { coins: stalls.cost - 1 }), 'stalls', `還差 1 金幣`)
  const bought = buyDecor(ok, 'stalls', CLOCK)
  if (!bought.ok) fail('購買攤車', bought.error)
  if (bought.state.progress.coins !== ok.progress.coins - stalls.cost || bought.state.progress.equipped.street !== 'stalls') fail('攤車扣款或套用')
  pass(`購買夜市小攤車扣 ${stalls.cost}，並套到街道`)
  ok = bought.state
  remember(okGroup, 'save', ok.progress, view('買下攤車', ok.progress, {}))
  const cleared = clearDecor(ok, 'street', CLOCK)
  if (!cleared.ok || cleared.state.progress.coins !== ok.progress.coins || !cleared.state.progress.ownedDecors.includes('stalls')) fail('卸下攤車')
  ok = cleared.state
  const equipped = equipDecor(ok, 'stalls', CLOCK)
  if (!equipped.ok || equipped.state.progress.equipped.street !== 'stalls' || equipped.state.progress.coins !== ok.progress.coins) fail('再套用攤車')
  ok = equipped.state
  pass('已收藏的夜市小攤車再套用，不再扣款')
  remember(okGroup, 'save', ok.progress, view('再套用攤車', ok.progress, {}))
  remember(okGroup, 'read', ok.progress, view('重讀攤車', ok.progress, {}))
}

// 槽位不符、未開幕的店，以及兩間店各自的合法裝潢。
{
  const group = openGroup('slots', 10)
  const upgrades = { n: 0 }
  const mat = decorSpec('mat')
  const bunting = decorSpec('bunting')
  let state = arrange(near(shopSpec(2).cost + mat.cost + bunting.cost, bunting.needRank), {})
  remember(group, 'import', state.progress, view('匯入槽位測試', state.progress, {}))
  state = mustUpgrade(state, upgrades)
  const boughtMat = buyDecor(state, 'mat', CLOCK)
  if (!boughtMat.ok) fail('購買腳踏墊', boughtMat.error)
  state = boughtMat.state
  const boughtFlag = buyDecor(state, 'bunting', CLOCK)
  if (!boughtFlag.ok) fail('購買彩旗', boughtFlag.error)
  state = boughtFlag.state
  if (state.progress.equipped.street !== 'bunting' || state.progress.equipped.shops.main !== 'mat') fail('合法套用沒有寫入')
  pass('腳踏墊套在主店、彩旗套在街道')
  const legal = state.progress
  remember(group, 'save', legal, view('合法店面與街道套用', legal, {}))
  remember(group, 'save', { ...legal, equipped: { street: 'mat', shops: { main: 'bunting' } } }, view('槽位不符的套用被清掉', { ...legal, equipped: { street: null, shops: {} } }, {}))
  remember(group, 'read', { ...legal, equipped: { street: null, shops: {} } }, view('重讀槽位不符', { ...legal, equipped: { street: null, shops: {} } }, {}))
  remember(group, 'save', legal, view('重新套回合法裝潢且不重複扣款', legal, {}))
  remember(group, 'save', { ...legal, equipped: { street: 'bunting', shops: { main: 'mat', tea: 'mat' } } }, view('未開幕的茶飲館不保留裝潢', legal, {}))
  remember(group, 'read', legal, view('重讀兩種槽位仍正確', legal, {}))

  const shops = openGroup('two-shops', 11)
  const shopUps = { n: 0 }
  const lantern = decorSpec('lantern')
  const tea = 360
  const gift = 980
  let both = arrange(near(shopSpec(2).cost + shopSpec(3).cost + shopSpec(4).cost + tea + gift + mat.cost + lantern.cost, 6), {})
  remember(shops, 'import', both.progress, view('匯入兩店裝潢', both.progress, {}))
  both = mustUpgrade(both, shopUps)
  both = mustUpgrade(both, shopUps)
  both = mustUpgrade(both, shopUps)
  const openedTea = unlockBuilding(both, 'tea', CLOCK)
  if (!openedTea.ok) fail('開茶飲館', openedTea.error)
  both = openedTea.state
  const openedGift = unlockBuilding(both, 'gift', CLOCK)
  if (!openedGift.ok) fail('開禮盒工坊', openedGift.error)
  both = openedGift.state
  const teaMat = buyDecor(both, 'mat', CLOCK, 'tea')
  if (!teaMat.ok) fail('茶飲館腳踏墊', teaMat.error)
  both = teaMat.state
  const giftLantern = buyDecor(both, 'lantern', CLOCK, 'gift')
  if (!giftLantern.ok) fail('禮盒工坊燈籠', giftLantern.error)
  both = giftLantern.state
  if (both.progress.equipped.shops.tea !== 'mat' || both.progress.equipped.shops.gift !== 'lantern' || both.progress.equipped.shops.main) fail('兩店裝潢互相覆蓋')
  pass('茶飲館與禮盒工坊各自套用，主店沒有被改到')
  remember(shops, 'save', both.progress, view('兩店裝潢分別保存', both.progress, {}))
  remember(shops, 'read', both.progress, view('重讀兩店裝潢', both.progress, {}))
  const clearedTea = clearDecor(both, 'shop', CLOCK, 'tea')
  if (!clearedTea.ok || clearedTea.state.progress.equipped.shops.gift !== 'lantern' || clearedTea.state.progress.equipped.shops.tea || clearedTea.state.progress.coins !== both.progress.coins) {
    fail('卸下茶飲館裝潢影響到禮盒工坊')
  }
  pass('卸下茶飲館裝潢後，禮盒工坊維持原樣且不退款')
  remember(shops, 'save', clearedTea.state.progress, view('卸下其中一店', clearedTea.state.progress, {}))
  remember(shops, 'read', clearedTea.state.progress, view('重讀卸下後的兩店', clearedTea.state.progress, {}))
}

const body = (file: string) => {
  const sql = readFileSync(file, 'utf8')
  const start = sql.indexOf('BEGIN;')
  const end = sql.lastIndexOf('COMMIT;')
  if (start < 0 || end < start) throw new Error(`${file} 沒有 BEGIN/COMMIT`)
  return sql.slice(start + 'BEGIN;'.length, end)
}
const psql = (args: string[]) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8' })
const has = (rel: string) => psql(['-tAc', `select to_regclass('${rel}') is not null`]).trim() === 't'
const lit = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`

const beforeUsers = psql(['-tAc', "select count(*) from auth.users where email like 'street-unlock-%@example.invalid'"]).trim()
const beforeSaves = has('public.member_street_saves') ? psql(['-tAc', 'select count(*) from public.member_street_saves']).trim() : 'missing'

const sql = `
DO $unlock$
DECLARE
  groups jsonb := ${lit(groups)};
  g jsonb;
  step jsonb;
  r jsonb;
  rev bigint;
  uid uuid;
  item record;
BEGIN
  FOR g IN SELECT e FROM jsonb_array_elements(groups) AS t(e) LOOP
    uid := (g ->> 'id')::uuid;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', uid::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    rev := NULL;
    FOR step IN SELECT e FROM jsonb_array_elements(g -> 'steps') AS t(e) LOOP
      IF step ->> 'op' = 'import' THEN
        r := public.import_my_street_save(step -> 'progress', gen_random_uuid());
      ELSIF step ->> 'op' = 'save' THEN
        r := public.save_my_street(rev, step -> 'progress', gen_random_uuid());
      ELSE
        r := public.get_my_street_save();
      END IF;
      IF step ->> 'op' = 'read' THEN
        IF r ->> 'exists' IS DISTINCT FROM 'true' OR (r ->> 'contentVersion')::int IS DISTINCT FROM 2 THEN
          RAISE EXCEPTION 'FAIL % 讀檔 %', step #>> '{expect,label}', r;
        END IF;
      ELSE
        IF (r ->> 'ok')::boolean IS DISTINCT FROM (step #>> '{expect,ok}')::boolean
           OR ((step #>> '{expect,ok}')::boolean AND (r ->> 'contentVersion')::int IS DISTINCT FROM 2)
           OR (NOT (step #>> '{expect,ok}')::boolean AND r ->> 'reason' IS DISTINCT FROM step #>> '{expect,reason}') THEN
          RAISE EXCEPTION 'FAIL % 結果 %', step #>> '{expect,label}', r;
        END IF;
        IF (r ->> 'ok')::boolean THEN rev := (r ->> 'revision')::bigint; END IF;
      END IF;
      IF (r #>> '{progress,shopLevel}')::int IS DISTINCT FROM (step #>> '{expect,shopLevel}')::int
         OR (r #>> '{progress,coins}')::bigint IS DISTINCT FROM (step #>> '{expect,coins}')::bigint
         OR (r #>> '{progress,xp}')::bigint IS DISTINCT FROM (step #>> '{expect,xp}')::bigint
         OR (r #>> '{progress,stats,served}')::bigint IS DISTINCT FROM (step #>> '{expect,served}')::bigint
         OR (r #>> '{progress,stats,earned}')::bigint IS DISTINCT FROM (step #>> '{expect,earned}')::bigint
         OR (r #>> '{progress,stats,xpEarned}')::bigint IS DISTINCT FROM (step #>> '{expect,xpEarned}')::bigint
         OR r #> '{progress,ownedDecors}' IS DISTINCT FROM (step #> '{expect,decors}')
         OR r #>> '{progress,equipped,street}' IS DISTINCT FROM step #>> '{expect,street}'
         OR r #> '{progress,equipped,shops}' IS DISTINCT FROM coalesce(step #> '{expect,shops}', '{}'::jsonb) THEN
        RAISE EXCEPTION 'FAIL % 進度 %', step #>> '{expect,label}', r -> 'progress';
      END IF;
      FOR item IN SELECT key, value FROM jsonb_each(step #> '{expect,stock}') LOOP
        IF (r #>> ARRAY['progress', 'stock', item.key])::int IS DISTINCT FROM (item.value #>> '{}')::int THEN
          RAISE EXCEPTION 'FAIL % 庫存 %=%，實際 %', step #>> '{expect,label}', item.key, item.value, r #> '{progress,stock}';
        END IF;
      END LOOP;
      RAISE NOTICE 'PASS %', step #>> '{expect,label}';
    END LOOP;
  END LOOP;
END
$unlock$;
`

const parts = ['BEGIN;']
if (!has('public.member_street_friends')) parts.push(body('supabase/manual/20261029220200_street_friend_help_apply.sql'))
if (!has('public.member_street_steals')) parts.push(body('supabase/manual/20261029230100_street_steal_explore_apply.sql'))
if (!has('public.member_street_saves')) parts.push(body('supabase/manual/20261030010100_street_cloud_save_apply.sql'))
parts.push(body('supabase/manual/20261030030200_street_content_v2_apply.sql'))
parts.push(body('supabase/manual/20261030030210_street_equip_guard_apply.sql'))
parts.push(`
INSERT INTO auth.users (id, email, aud, role, instance_id)
SELECT (g ->> 'id')::uuid, g ->> 'email', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
FROM jsonb_array_elements(${lit(groups.map((g) => ({ id: g.id, email: g.email })))}) AS t(g);
`)
parts.push(sql, 'ROLLBACK;')

const run = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input: parts.join('\n'),
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
const lines = String(run.stderr ?? '').split('\n').filter((line) => /PASS|FAIL|ERROR|DEFECT/.test(line))
console.log(lines.join('\n'))
const afterUsers = psql(['-tAc', "select count(*) from auth.users where email like 'street-unlock-%@example.invalid'"]).trim()
const afterSaves = has('public.member_street_saves') ? psql(['-tAc', 'select count(*) from public.member_street_saves']).trim() : 'missing'
if (afterUsers !== beforeUsers || afterSaves !== beforeSaves) fail('交易沒有還原隔離資料庫', `${beforeUsers}/${afterUsers} ${beforeSaves}/${afterSaves}`)
console.log(`隔離資料庫已還原（測試會員 ${afterUsers}，存檔列 ${afterSaves}）`)
const dbPasses = lines.filter((line) => line.includes('NOTICE:  PASS') || line.startsWith('PASS')).length
if (run.status !== 0) process.exit(1)
console.log(`street unlock local test passed: client ${clientPasses}, database ${dbPasses} (rolled back, not a production member acceptance)`)
