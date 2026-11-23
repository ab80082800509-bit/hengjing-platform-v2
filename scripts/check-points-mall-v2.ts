import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PERK_CATALOG, PERK_CATEGORIES, PERK_SLOTS } from '../lib/rewards/perk-catalog'
import { activeLiveEvents, festivalPeriod, festivalWindows, LIVE_EVENTS, livePeriod } from '../lib/arcade/live-ops'

const apply = readFileSync('supabase/manual/20261030020100_points_mall_v2_apply.sql', 'utf8')
const open = readFileSync('supabase/manual/20261030020200_points_mall_open_purchase.sql', 'utf8')
const close = readFileSync('supabase/manual/20261030020300_points_mall_close_purchase.sql', 'utf8')
const precheck = readFileSync('supabase/manual/20261030020000_points_mall_v2_readonly_check.sql', 'utf8')

// ---- 目錄與 SQL 一致：新 25 件的分類、價格、解鎖、販售方式與數量 ----
const rows = new Map<string, string[]>()
for (const m of apply.matchAll(/\('([a-z0-9-]+)', '([a-z]+)', (\d+), (NULL|'[a-z._]+'), (NULL|\d+), '([a-z]+)', (NULL|\d+), (\d+)\)/g)) {
  rows.set(m[1], m.slice(2))
}
const added = PERK_CATALOG.filter((perk) => perk.since === 2)
assert.equal(added.length, 25)
assert.equal(rows.size, 25, 'SQL 必須剛好新增 25 件')
for (const perk of added) {
  const row = rows.get(perk.id)
  assert.ok(row, `${perk.id} 不在 SQL`)
  const [category, cost, metric, target, saleKind, stock] = row
  const unlock = 'unlock' in perk ? perk.unlock : undefined
  const sale = 'sale' in perk ? perk.sale : undefined
  assert.equal(category, perk.category, perk.id)
  assert.equal(Number(cost), perk.cost, `${perk.id} 價格`)
  assert.equal(metric, unlock ? `'${unlock.metric}'` : 'NULL', `${perk.id} 解鎖條件`)
  assert.equal(target, unlock ? String(unlock.target) : 'NULL', `${perk.id} 解鎖門檻`)
  assert.equal(saleKind, sale?.kind ?? 'always', `${perk.id} 販售方式`)
  assert.equal(stock, 'stock' in perk ? String(perk.stock) : 'NULL', `${perk.id} 數量`)
}
for (const category of PERK_CATEGORIES) assert.ok(apply.includes(`'${category}'`), `SQL 缺少分類 ${category}`)
for (const slot of PERK_SLOTS.slice(4)) assert.ok(apply.includes(`ADD COLUMN ${slot}_id text`), `裝備欄位 ${slot}_id`)
assert.ok(!apply.includes("ADD COLUMN sticker_id"), '貼圖包不佔裝備欄位')

// ---- 節慶販售期間與 27 個節慶主題的日期計算一致 ----
for (const perk of added) {
  if (!('sale' in perk) || perk.sale.kind !== 'festival') continue
  const windows = festivalWindows(perk.sale.festivalId, 2026, 2035)
  assert.equal(windows.length, 10, `${perk.id} 十年期間`)
  for (const w of windows) {
    assert.ok(apply.includes(`('${perk.id}', '${w.startsOn}', '${w.endsOn}')`), `${perk.id} ${w.startsOn} 期間不一致`)
  }
}

// ---- 安全邊界：v2 不開兌換、不改點數；開關檔只動 purchase_enabled ----
assert.ok(!/purchase_enabled\s*=\s*true/.test(apply), 'v2 本體不可打開兌換')
assert.ok(!/UPDATE public\.member_point_accounts|INSERT INTO public\.member_point_entries|DELETE FROM/i.test(apply), 'v2 不可改點數或刪資料')
assert.ok(!/\bEXCEPTION\s+WHEN\b/.test(apply), '兌換交易不可吞掉錯誤')
for (const file of [open, close]) {
  const updates = [...file.matchAll(/^UPDATE .+$/gm)].map((m) => m[0])
  assert.deepEqual(updates.map((u) => u.replace(/= (true|false)/, '= ?')), ['UPDATE public.member_perk_settings SET purchase_enabled = ? WHERE id = true;'])
  const code = file.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n')
  assert.ok(!/checkout_enabled/.test(code), '不可碰商品結帳開關')
}
assert.ok(precheck.trimEnd().endsWith('ROLLBACK;') && precheck.includes('BEGIN READ ONLY;'), '預檢必須唯讀')
for (const msg of ['點數不足', '尚未達成解鎖條件', '這件收藏不在販售期間', '這件收藏已經兌換完畢']) assert.ok(apply.includes(msg), msg)

// ---- 台北時間週期：每日、每週、每月、季節與節慶自動輪替 ----
const at = (iso: string) => Date.parse(iso)
assert.equal(livePeriod('daily', at('2026-10-29T23:59:00+08:00')).key, 'd:2026-10-29')
assert.equal(livePeriod('daily', at('2026-10-30T00:00:00+08:00')).key, 'd:2026-10-30')
assert.equal(livePeriod('weekly', at('2026-11-01T23:59:00+08:00')).key, 'w:2026-10-26')
assert.equal(livePeriod('weekly', at('2026-11-02T00:00:00+08:00')).key, 'w:2026-11-02')
assert.equal(livePeriod('monthly', at('2026-10-31T16:30:00Z')).key, 'm:2026-11', 'UTC 16:30 已是台北 11/1')
assert.equal(livePeriod('season', at('2026-10-29T12:00:00+08:00')).key, 's:2026-autumn')
assert.equal(livePeriod('season', at('2027-02-10T12:00:00+08:00')).key, 's:2026-winter', '一、二月屬於前一年的冬季')
assert.equal(festivalPeriod('christmas', at('2026-12-25T12:00:00+08:00'))?.key, 'f:christmas:2026-12-20')
assert.equal(festivalPeriod('christmas', at('2027-12-25T12:00:00+08:00'))?.key, 'f:christmas:2027-12-20', '每年自動再開')
assert.equal(festivalPeriod('christmas', at('2026-11-25T12:00:00+08:00')), null)
const keys = new Set<string>()
for (const ms of [at('2026-10-29T12:00:00+08:00'), at('2026-11-05T12:00:00+08:00'), at('2026-12-24T12:00:00+08:00')]) {
  for (const event of activeLiveEvents(ms)) {
    assert.equal(event.payPoints, 0, '活動獎勵與 Pay 點數分開')
    assert.ok(event.claimKey.startsWith(`${event.id}@`))
    keys.add(event.claimKey)
  }
}
assert.ok(keys.size >= 8, '不同週期產生不同領取鍵')
assert.equal(new Set(LIVE_EVENTS.map((e) => e.id)).size, LIVE_EVENTS.length)
assert.ok(!/20[2-9]\d-\d\d-\d\d/.test(readFileSync('lib/arcade/live-ops.ts', 'utf8')), '活動設定不可寫死單次日期')

console.log('points mall v2 + live ops checks ok')
