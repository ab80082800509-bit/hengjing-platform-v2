import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { OPEN_REWARD_KINDS } from '../lib/rewards/foundation'
import { GAME_REWARD_ERRORS, GAME_REWARD_PAYOUT_ENABLED, gameRewardProgress, rejectGamePayPayout } from '../lib/arcade/game-reward-policy'
import { lunarToSolar, resolveFestivalTheme, solarToLunar, themeActiveOn, type FestivalTheme } from '../lib/arcade/festival-theme'
import { marketplaceHref, readMarketplaceNav } from '../lib/marketplace-url'
import { parseMergeRead } from '../lib/arcade/merge-snapshot'
import {
  MERGE_CHAINS,
  MERGE_ERRORS,
  MERGE_MAX_SHOP_LEVEL,
  MERGE_TUNING_CONFIRMED,
  MERGE_UPGRADE_COST,
  applyMergeAction,
  makeOrder,
  maxShopLevelFor,
  mix32,
  producerCap,
  regenCharges,
  upgradeCost,
  type MergeClock,
  type MergeState,
} from '../lib/arcade/merge-rules'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const clock: MergeClock = { nowMs: Date.parse('2026-10-25T04:00:00Z'), taipeiDay: '2026-10-25' }
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

assert(mix32(0) === 1015568748 && mix32(1) === 1017233273, '合成亂數與資料庫規格不一致')
assert(same(makeOrder(1, 0, 0), { id: 'ord-0-0', itemId: 'tea-1', qty: 2, coins: 12, xp: 4 }), '第一張訂單規格不對')
assert(makeOrder(1, 1, 0).itemId === 'tea-2' && makeOrder(1, 1, 0).coins === 12, '第二張訂單規格不對')
assert(MERGE_TUNING_CONFIRMED === false, '合成數值不能標成已簽核')
assert(GAME_REWARD_PAYOUT_ENABLED === false, '遊戲 Pay 點必須維持關閉')
assert(same(OPEN_REWARD_KINDS, ['checkin', 'scratch']), '第四階段開放入帳來源不能被遊戲改掉')
const progress = gameRewardProgress()
assert(progress.issuedPayPoints === null && progress.dailyCap === 10 && progress.weeklyCap === 80 && progress.scratchExcluded, '獎勵進度不能顯示已發放點數')
let rejected = false
try {
  rejectGamePayPayout(10, 'game:merge_shop:2026-10-25')
} catch (error) {
  rejected = error instanceof Error && error.message === GAME_REWARD_ERRORS.unapproved
}
assert(rejected, '規劃中的遊戲點數不能入帳')

assert(lunarToSolar(2024, 1, 1) === '2024-02-10', '2024 春節換算不對')
assert(lunarToSolar(2026, 1, 1) === '2026-02-17', '2026 春節換算不對')
assert(lunarToSolar(2026, 8, 15) === '2026-09-25', '2026 中秋不能寫死，換算結果應為 9 月 25 日')
assert(lunarToSolar(2026, 9, 9) === '2026-10-18', '2026 重陽不能寫死，換算結果應為 10 月 18 日')
assert(lunarToSolar(2027, 8, 15) === '2027-09-15', '2027 中秋的國曆日必須跟 2026 不同')
assert(lunarToSolar(2027, 9, 9) === '2027-10-08', '2027 重陽的國曆日必須跟 2026 不同')
assert(solarToLunar('2026-10-25')?.month === 9 && solarToLunar('2026-10-25')?.day === 16, '2026-10-25 不是重陽')
assert(resolveFestivalTheme(new Date('2026-10-24T16:30:00Z')).id === 'retrocession', '台北 10 月 25 日應顯示光復節')
assert(resolveFestivalTheme(new Date('2026-10-25T16:30:00Z')).id === 'brand', '台北 10 月 26 日應回到品牌主題')
assert(resolveFestivalTheme(new Date('2026-10-17T16:00:00Z')).id === 'double-ninth', '台北重陽應顯示重陽主題')
assert(resolveFestivalTheme(new Date('2026-09-24T16:00:00Z')).id === 'mid-autumn', '台北中秋應顯示中秋主題')
assert(resolveFestivalTheme(new Date('2027-10-07T16:00:00Z')).id === 'double-ninth', '2027 重陽仍用農曆規則')

const look = { decor: 'none' as const, palette: { accent: '#f97316', soft: '#fff1e2', glow: '#fdba74' } }
const overlap: FestivalTheme[] = [
  { id: 'brand', name: '品牌', priority: 0, schedule: { kind: 'always' }, eyebrow: '', banner: '', motif: '', ...look },
  { id: 'low', name: '低', priority: 5, schedule: { kind: 'solar', startMonth: 10, startDay: 25, endMonth: 10, endDay: 25 }, eyebrow: '', banner: '', motif: '', ...look },
  { id: 'high', name: '高', priority: 50, schedule: { kind: 'solar', startMonth: 10, startDay: 25, endMonth: 10, endDay: 25 }, eyebrow: '', banner: '', motif: '', ...look },
]
assert(resolveFestivalTheme(new Date('2026-10-25T02:00:00Z'), overlap).id === 'high', '同一天應採用優先順序較高的主題')
assert(themeActiveOn(overlap[1], '2026-10-25') && !themeActiveOn(overlap[1], '2026-10-26'), '國曆節慶要有起訖')

const started = applyMergeAction(null, { type: 'start' }, clock)
assert(started.coins === 0 && started.xp === 0 && started.shopLevel === 1 && started.revision === 1, '開張時沒有遊戲幣也還沒升級')
assert(started.cells.filter((cell) => cell === 'tea-1').length === 3, '開張應有三份茶葉')
assert(started.orders[0]?.itemId === 'tea-1' && started.orders[1]?.itemId === 'tea-2', '開張訂單應可立刻做')
assert(started.catalog.includes('tea-1') && started.producerCharges === 5, '開張圖鑑與原料不對')
const restarted = applyMergeAction(started, { type: 'start' }, clock)
assert(restarted === started, '再次開始營業不能重置進度')

let state = applyMergeAction(started, { type: 'serve', orderId: 'ord-0-0', cells: [0, 1] }, clock, 1)
assert(state.coins === 12 && state.xp === 4 && state.ordersCompletedToday === 1, '第一張訂單應給 12 遊戲金幣與 4 經驗')
assert(state.cells[0] === null && state.cells[1] === null && state.cells[2] === 'tea-1', '交付應消耗指定商品')
const other = applyMergeAction(null, { type: 'start' }, clock)
assert(other.coins === 0 && state.coins === 12, '另一位玩家的新局不能看到別人的金幣')

state = applyMergeAction(state, { type: 'spawn', to: 0 }, clock, state.revision)
assert(state.cells[0] === 'tea-1' && state.producerCharges === 4, '補貨應放進指定空位並消耗原料')
state = applyMergeAction(state, { type: 'merge', from: 0, to: 2 }, clock, state.revision)
assert(state.cells[2] === 'tea-2' && state.cells[0] === null && state.catalog.includes('tea-2'), '兩份茶葉應合成溫杯')
state = applyMergeAction(state, { type: 'serve', orderId: 'ord-0-1', cells: [2] }, clock, state.revision)
assert(state.coins === 24 && state.xp === 12 && state.ordersCompletedToday === 2, '第二張訂單應再給 12 遊戲金幣與 8 經驗')
state = applyMergeAction(state, { type: 'spawn', to: 0 }, clock, state.revision)
state = applyMergeAction(state, { type: 'spawn', to: 1 }, clock, state.revision)
state = applyMergeAction(state, { type: 'serve', orderId: 'ord-1-2', cells: [0, 1] }, clock, state.revision)
assert(state.ordersCompletedToday === 3 && state.coins === 36, '第三張訂單後可以領每日任務')
const beforeQuest = state.coins
state = applyMergeAction(state, { type: 'claim_quest', }, clock, state.revision)
assert(state.coins === beforeQuest + 24 && state.xp === 28 && state.questClaimed, '每日任務只加遊戲金幣與經驗')
let claimedAgain = false
const claimedState = state
try {
  applyMergeAction(claimedState, { type: 'claim_quest' }, clock, claimedState.revision)
} catch (error) {
  claimedAgain = error instanceof Error && error.message === MERGE_ERRORS.questDone
}
assert(claimedAgain && claimedState.coins === state.coins, '每日任務不能領第二次')
state = applyMergeAction(state, { type: 'upgrade' }, clock, state.revision)
assert(state.shopLevel === 2 && state.coins === 30 && state.catalog.includes('snack-1'), '30 遊戲金幣升級後解鎖點心')

let conflicted = false
const beforeConflict = state
try {
  applyMergeAction(beforeConflict, { type: 'move', from: 0, to: 1 }, clock, beforeConflict.revision - 1)
} catch (error) {
  conflicted = error instanceof Error && error.message === MERGE_ERRORS.conflict
}
assert(conflicted && beforeConflict.revision === state.revision, '舊修訂不能覆蓋進度')

const rich: MergeState = {
  ...state,
  cells: Array.from({ length: 30 }, () => null),
  coins: 5,
}
rich.cells[0] = 'tea-5'
rich.cells[1] = 'tea-5'
let maxed = false
try {
  applyMergeAction(rich, { type: 'merge', from: 0, to: 1 }, clock, rich.revision)
} catch (error) {
  maxed = error instanceof Error && error.message === MERGE_ERRORS.maxItem
}
assert(maxed && rich.cells[0] === 'tea-5' && rich.coins === 5, '最高階不能再合成，也不能順便改金幣')

const dry = regenCharges({ producerCharges: 1, producerAnchorMs: clock.nowMs, shopLevel: 1 }, clock.nowMs + 60_000)
assert(dry.charges === 3, '60 秒應補回 2 份原料')
const capped = regenCharges({ producerCharges: 5, producerAnchorMs: clock.nowMs - 86_400_000, shopLevel: 1 }, clock.nowMs)
assert(capped.charges === 5 && capped.anchorMs === clock.nowMs, '原料已滿時不能囤積離線時間')

const moved = applyMergeAction(started, { type: 'move', from: 2, to: 4 }, clock, 1)
assert(moved.cells[4] === 'tea-1' && moved.cells[2] === null && moved.coins === 0, '移動只換位置')

const nav = readMarketplaceNav(new URLSearchParams('page=arcade&game=merge'))
assert(nav.page === 'arcade' && nav.game === 'merge', '遊樂園網址應能打開合成小舖')
assert(marketplaceHref('/', nav) === '/?page=arcade&game=merge', '合成小舖網址應可重新整理還原')
assert(readMarketplaceNav(new URLSearchParams('page=rewards')).game === null, '簽到頁不能帶進遊戲')
assert(parseMergeRead({ exists: false, replayed: false, payPointsDelta: 0, payoutEnabled: false, tuningStatus: 'pending_approval', taipeiDay: '2026-10-25', gameVersion: 'stage6-batch1' })?.exists === false, '尚未開張的回應要能讀')
assert(parseMergeRead({ exists: true, replayed: false, payPointsDelta: 5, payoutEnabled: false, tuningStatus: 'pending_approval', gameVersion: 'stage6-batch1', taipeiDay: '2026-10-25' }) === null, '帶有 Pay 點的遊戲回應不能採用')

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const preview = read('supabase/manual/20261025201700_merge_shop_preview.sql')
const client = read('lib/arcade/merge-client.ts')
const shop = read('components/arcade/merge-shop.tsx')
const arcade = read('components/arcade/arcade-page.tsx')
assert(!/perform\s+(public\.)?post_member_reward|select\s+(public\.)?post_member_reward/i.test(preview), '預覽 SQL 不能呼叫點數入帳')
assert(preview.includes("position('post_member_reward' IN def) > 0"), '預覽 SQL 應自己拒絕點數入帳呼叫')
assert(preview.includes('CONSTRAINT game_reward_payout_closed CHECK (payout_enabled = false)'), '發放開關必須被資料庫約束關掉')
assert(!/localStorage\s*[.\[]/.test(client) && !/localStorage\s*[.\[]/.test(shop), '正式進度不能寫進 localStorage')
assert(!arcade.includes('drawMyScratchCard') && !shop.includes('drawMyScratchCard'), '遊樂園不能自己刮卡')
assert(!read('components/arcade/merge-shop.tsx').includes('member_point'), '合成畫面不能改點數帳本')

// ---------- 內容 v2：Lv.6 水果線 ----------
{
  const v2 = read('supabase/manual/20261030030100_merge_shop_v2_apply.sql').replace(/\r\n/g, '\n')
  const sqlCosts = [...v2.matchAll(/WHEN (\d) THEN (\d+)\n/g)].map(([, lv, cost]) => [Number(lv), Number(cost)])
  assert(same(sqlCosts, MERGE_UPGRADE_COST.slice(1).map((cost, i) => [i + 1, cost])), 'v2 SQL 升級成本要和前端一致')
  assert(MERGE_MAX_SHOP_LEVEL === 6 && v2.includes('CHECK (shop_level BETWEEN 1 AND 6)'), 'v2 等級上限要一致')
  assert(MERGE_CHAINS.map((c) => c.id).join('|') === 'tea|snack|gift|fruit' && v2.includes("'^(tea|snack|gift|fruit)-[1-5]$'"), 'v2 商品線要一致')
  assert(!/post_member_reward\s*\(/.test(v2.replace(/position\('post_member_reward'[^)]*\)/g, '')) && !/member_point/.test(v2), 'v2 不能碰點數帳本')
  const outsideFunctions = v2.replace(/AS \$\$[\s\S]*?\n\$\$;/g, '')
  assert(!/\b(UPDATE|INSERT INTO|DELETE FROM|TRUNCATE)\s+(public\.)?member_/i.test(outsideFunctions), 'v2 套用時不能改任何會員存檔')
  // Lv.1～5 的訂單與補貨要和 v1 完全相同，舊存檔才不用轉換。
  for (let level = 1; level <= 5; level += 1) {
    for (let serial = 0; serial < 12; serial += 1) {
      const order = makeOrder(level, serial, 3)
      assert(MERGE_CHAINS.findIndex((c) => order.itemId.startsWith(`${c.id}-`)) < 3, `Lv.${level} 訂單不能出現水果`)
    }
  }
  assert(makeOrder(6, 3, 0).itemId === 'fruit-4' && makeOrder(5, 2, 7).itemId === 'gift-3', '訂單規格要與 v2 SQL 自我檢查一致')
  const lv5: MergeState = { ...state, shopLevel: 5, coins: 650 }
  const lv6 = applyMergeAction(lv5, { type: 'upgrade' }, clock, lv5.revision)
  assert(lv6.shopLevel === 6 && lv6.coins === 50 && lv6.catalog.includes('fruit-1') && lv6.producerCharges <= producerCap(6), 'Lv.6 要解鎖水果線')
  assert(upgradeCost(6) === null, 'Lv.6 是最高級')
  const fruits: MergeState = { ...lv6, cells: lv6.cells.map((_, i) => (i < 2 ? 'fruit-4' : null)) }
  assert(applyMergeAction(fruits, { type: 'merge', from: 0, to: 1 }, clock, fruits.revision).cells[1] === 'fruit-5', '芒果冰合成水果禮籃')
  // 舊資料庫（沒有 contentVersion）只接受到 Lv.5。
  const base = { exists: true, replayed: false, payPointsDelta: 0, payoutEnabled: false, tuningStatus: 'pending_approval', gameVersion: 'stage6-batch1', taipeiDay: '2026-10-25', revision: 3, coins: 0, xp: 0, cells: Array(30).fill(null), catalog: [], orders: [], orderSerial: 0, lifetimeOrders: 0, ordersCompletedToday: 0, questTarget: 3, questClaimed: false, questRewardCoins: 24, questRewardXp: 12, producerCharges: 0, producerAnchor: 'x', serverNow: 'x', regenSeconds: 30, upgradeCost: null, updatedAt: 'x' }
  const v1Read = parseMergeRead({ ...base, shopLevel: 5, producerCap: 9 })
  assert(v1Read?.exists === true && v1Read.contentVersion === 1, '舊資料庫回應要能讀')
  assert(parseMergeRead({ ...base, shopLevel: 6, producerCap: 10 }) === null, '舊資料庫不能出現 Lv.6')
  const v2Read = parseMergeRead({ ...base, shopLevel: 6, producerCap: 10, contentVersion: 2 })
  assert(v2Read?.exists === true && v2Read.contentVersion === 2 && v2Read.shopLevel === 6, 'v2 資料庫回應要能讀 Lv.6')
  assert(maxShopLevelFor(1) === 5 && maxShopLevelFor(2) === 6, '內容版本上限錯誤')
}

console.log('merge shop rules, festival theme, and reward gate ok')
