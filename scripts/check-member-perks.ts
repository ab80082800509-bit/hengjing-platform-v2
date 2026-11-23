import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyRewardClaimSpec, emptyLedger, REWARD_ERRORS } from '../lib/rewards/foundation'
import { PERK_CATALOG, PERK_PRICES_CONFIRMED, perkClaimKey } from '../lib/rewards/perk-catalog'
import { parsePerkSnapshot, parsePublicLoadouts, perkFailureMessage } from '../lib/rewards/perk-snapshot'
import {
  PERK_ERRORS,
  emptyPerkInventory,
  purchasePerk,
  setPerkEquipped,
  type PerkInventoryState,
} from '../lib/rewards/perk-rules'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')
const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const DAY = '2026-10-24'

const ORIGINAL = PERK_CATALOG.filter((perk) => perk.since === 1)
assert(ORIGINAL.length === 15 && PERK_CATALOG.slice(0, 15).every((perk) => perk.since === 1), '原有 15 件虛擬特權必須保留在最前面')
assert(PERK_CATALOG.length === 40, '第 9 批目錄共 40 件')
assert(new Set(PERK_CATALOG.map((perk) => perk.id)).size === 40, '虛擬特權編號不能重複')
assert(ORIGINAL.reduce((sum, perk) => sum + perk.cost, 0) === 2180, '既有 15 件點數合計必須維持')
assert(PERK_PRICES_CONFIRMED === false, '目錄價格仍是既有規劃價，不能在程式裡標成已簽核')
assert(PERK_CATALOG.every((perk) => perk.cost > 0), '每件特權都要有正整數點數')

const closed = emptyLedger()
closed.accounts[USER] = 100
let rejectedKind = false
try {
  applyRewardClaimSpec(
    closed,
    { userId: USER, kind: 'perk_unlock', claimKey: perkClaimKey('badge-detail'), delta: -60, internal: true, metadata: {} },
    DAY,
  )
} catch (error) {
  rejectedKind = error instanceof Error && error.message === REWARD_ERRORS.closedKind
}
assert(rejectedKind && closed.accounts[USER] === 100 && closed.entries.length === 0, '既有發獎函式仍不能把 perk_unlock 入帳')

const rich = emptyPerkInventory(emptyLedger())
rich.ledger.accounts[USER] = 100
rich.ledger.accounts[OTHER] = 80
const bought = purchasePerk(rich, { userId: USER, perkId: 'badge-detail', taipeiDay: DAY, internal: true })
assert(bought.replayed === false && bought.balance === 40 && bought.cost === 60, '60 點勳章必須剛好扣目錄價格')
assert(bought.state.holds.length === 1 && bought.state.holds[0]?.claimKey === 'perk_unlock:badge-detail', '購買後只能有一筆收藏')
assert(bought.state.ledger.entries.length === 1 && bought.state.ledger.entries[0]?.delta === -60, '流水必須是 -60')
assert(bought.state.ledger.claims.length === 1 && bought.state.ledger.claims[0]?.kind === 'perk_unlock', '領獎紀錄必須是 perk_unlock')
assert(bought.state.ledger.accounts[OTHER] === 80, '購買不能改到其他會員')
const replay = purchasePerk(bought.state, { userId: USER, perkId: 'badge-detail', taipeiDay: DAY, internal: true })
assert(replay.replayed && replay.state === bought.state && replay.balance === 40, '重複購買不能再扣點或再入庫')

let poor = false
const beforePoor = bought.state
try {
  purchasePerk(beforePoor, { userId: USER, perkId: 'frame-cyber', taipeiDay: DAY, internal: true })
} catch (error) {
  poor = error instanceof Error && error.message === PERK_ERRORS.insufficient
}
assert(poor && beforePoor.ledger.accounts[USER] === 40 && beforePoor.holds.length === 1, '點數不足不能部分成功')

let outside = false
try {
  purchasePerk(rich, { userId: USER, perkId: 'badge-detail', taipeiDay: DAY, internal: false })
} catch (error) {
  outside = error instanceof Error && error.message === PERK_ERRORS.internal
}
assert(outside, '瀏覽器不能直接扣點')

let unknown = false
try {
  purchasePerk(rich, { userId: USER, perkId: 'frame-missing', taipeiDay: DAY, internal: true })
} catch (error) {
  unknown = error instanceof Error && error.message === PERK_ERRORS.unavailable
}
assert(unknown && rich.holds.length === 0, '目錄外的道具不能購買')

const funded = emptyPerkInventory(emptyLedger())
funded.ledger.accounts[USER] = 400
funded.ledger.accounts[OTHER] = 400
const firstFrame = purchasePerk(funded, { userId: USER, perkId: 'frame-founder', taipeiDay: DAY, internal: true })
const secondFrame = purchasePerk(firstFrame.state, { userId: USER, perkId: 'frame-koi', taipeiDay: DAY, internal: true })
const badge = purchasePerk(secondFrame.state, { userId: USER, perkId: 'badge-honest', taipeiDay: DAY, internal: true })
assert(badge.balance === 140 && badge.state.holds.length === 3, '不同特權可以各自購買一次')
const equipFirst = setPerkEquipped(badge.state, { userId: USER, perkId: 'frame-founder', equipped: true })
const equipSecond = setPerkEquipped(equipFirst.state, { userId: USER, perkId: 'frame-koi', equipped: true })
assert(equipSecond.state.loadouts[0]?.frame === 'frame-koi' && equipSecond.state.loadouts[0]?.badge === undefined, '同一頭像框欄位只能留最後一件')
const equipBadge = setPerkEquipped(equipSecond.state, { userId: USER, perkId: 'badge-honest', equipped: true })
assert(equipBadge.state.loadouts[0]?.frame === 'frame-koi' && equipBadge.state.loadouts[0]?.badge === 'badge-honest', '不同欄位可以同時裝備')
const unequip = setPerkEquipped(equipBadge.state, { userId: USER, perkId: 'frame-koi', equipped: false })
assert(unequip.state.loadouts[0]?.frame === undefined && unequip.state.holds.length === 3, '卸下不能刪除擁有權')
const equipAgain = setPerkEquipped(unequip.state, { userId: USER, perkId: 'frame-founder', equipped: true })
assert(equipAgain.replayed === false && equipAgain.state.loadouts[0]?.frame === 'frame-founder', '可以改裝另一件已擁有的頭像框')
const sameEquip = setPerkEquipped(equipAgain.state, { userId: USER, perkId: 'frame-founder', equipped: true })
assert(sameEquip.replayed && sameEquip.state === equipAgain.state, '重複裝備不能製造第二筆')

let unowned = false
const beforeUnowned = equipAgain.state
try {
  setPerkEquipped(beforeUnowned, { userId: USER, perkId: 'title-hunter', equipped: true })
} catch (error) {
  unowned = error instanceof Error && error.message === PERK_ERRORS.unowned
}
assert(unowned && beforeUnowned.loadouts[0]?.frame === 'frame-founder', '未擁有的特權不能裝備')

const otherEquip = setPerkEquipped(
  purchasePerk(equipAgain.state, { userId: OTHER, perkId: 'title-cart', taipeiDay: DAY, internal: true }).state,
  { userId: OTHER, perkId: 'title-cart', equipped: true },
)
const mine = otherEquip.state.loadouts.find((item) => item.userId === USER)
const theirs = otherEquip.state.loadouts.find((item) => item.userId === OTHER)
assert(mine?.frame === 'frame-founder' && mine.title === undefined && theirs?.title === 'title-cart', '不能改到其他會員的裝備')

const broken: PerkInventoryState = {
  ledger: bought.state.ledger,
  holds: [],
  loadouts: [],
}
let incomplete = false
try {
  purchasePerk(broken, { userId: USER, perkId: 'badge-detail', taipeiDay: DAY, internal: true })
} catch (error) {
  incomplete = error instanceof Error && error.message === PERK_ERRORS.incomplete
}
assert(incomplete && broken.holds.length === 0, '只有流水沒有收藏時不能再扣一次')

const snapshot = parsePerkSnapshot({
  replayed: false,
  balance: 40,
  owned: ['badge-detail'],
  equipped: { badge: 'badge-detail' },
})
assert(snapshot?.balance === 40 && snapshot.owned[0] === 'badge-detail' && snapshot.equipped.badge === 'badge-detail', '收藏回應必須能還原')
assert(parsePerkSnapshot({ replayed: false, balance: 40, owned: ['badge-detail'], equipped: { frame: 'frame-koi' } }) === null, '未擁有的裝備不能當成有效收藏')
assert(parsePerkSnapshot({ replayed: false, balance: 40, owned: ['not-a-perk'], equipped: {} }) === null, '目錄外的收藏不能當成有效回應')
assert(parsePublicLoadouts([{ userId: USER, badge: 'badge-detail' }])?.[USER]?.badge === 'badge-detail', '公開裝備只接受目錄內的欄位')
assert(perkFailureMessage('點數不足', 'purchase') === '點數不足', '點數不足要原樣顯示')
assert(perkFailureMessage('虛擬特權購買尚未開放', 'purchase') === '虛擬特權購買尚未開放', '關閉購買時要原樣顯示尚未開放')

const migrationPath = 'supabase/migrations/20261024230000_member_perk_inventory.sql'
const previewPath = 'supabase/manual/20261024230000_member_perk_inventory_preview.sql'
const migration = read(migrationPath)
const preview = read(previewPath)
const marker = '-- perk-inventory-body-start\n'
const endMarker = '-- perk-inventory-body-end\n'
const bodyOf = (sql: string) => {
  const start = sql.indexOf(marker)
  const end = sql.indexOf(endMarker)
  assert(start >= 0 && end > start, 'SQL 必須標出第五批本文')
  return sql.slice(start, end + endMarker.length)
}
assert(bodyOf(migration) === bodyOf(preview), '預演本文必須與正式 migration 相同')
assert(migration.trimEnd().endsWith('COMMIT;'), '正式 migration 以 COMMIT 結束')
assert(preview.trimEnd().endsWith('ROLLBACK;'), '預演必須以 ROLLBACK 結束')
assert(!preview.includes('\nCOMMIT;'), '預演不能提交')
assert(!migration.includes('ROLLBACK;'), '正式 migration 不能回復交易')
assert(!migration.includes('CREATE OR REPLACE FUNCTION public.post_member_reward'), '不能改寫既有發獎函式')
assert(!migration.includes('CREATE OR REPLACE FUNCTION public.exchange_my_coupon'), '不能改寫優惠券兌換')
assert(!migration.includes('CREATE OR REPLACE FUNCTION public.draw_my_scratch_card'), '不能改寫刮卡')
assert(!migration.includes('CREATE OR REPLACE FUNCTION public.scratch_award_from_units'), '不能改刮卡機率')
assert(!migration.includes('CREATE OR REPLACE FUNCTION public.post_coupon_exchange_debit'), '不能改寫優惠券扣點')
assert(
  !migration.split('\n').some((line) => line.includes('checkout_enabled') && !line.trimStart().startsWith('--')),
  '不能變更結帳開關',
)
assert(!migration.includes('post_founder_coupon_test_grant'), '不能執行創始人補點')
assert(migration.includes('member_perk_holds_user_perk UNIQUE (user_id, perk_id)'), '同一件永久特權只能擁有一次')
assert(migration.includes('frame_id') && migration.includes('badge_id') && migration.includes('title_id') && migration.includes('skin_id'), '四個裝備欄位都要存在')
assert(migration.includes('GRANT EXECUTE ON FUNCTION public.purchase_my_perk(text) TO authenticated'), '會員只能走購買入口')
assert(!migration.includes('GRANT EXECUTE ON FUNCTION public.post_perk_unlock_debit'), '扣點函式不能授給 API')
assert(migration.includes('ENABLE ROW LEVEL SECURITY'), '收藏表必須啟用 RLS')
assert(!migration.includes('CREATE POLICY'), '不能靠開放資料表政策解決權限')
assert(migration.includes('app.perk_purchase') && migration.includes('app.reward_post'), '扣點必須同時有特權購買旗標與帳本旗標')
assert(migration.includes('CREATE TABLE IF NOT EXISTS public.member_perk_settings'), '必須有資料庫購買開關')
assert(migration.includes('purchase_enabled boolean NOT NULL DEFAULT false'), '購買開關必須預設關閉')
assert(migration.includes('不能修改虛擬特權購買開關'), '會員身份不能自行開啟購買')
assert(migration.includes('虛擬特權購買尚未開放'), '關閉時購買入口必須拒絕')
assert(!migration.includes('purchase_enabled = true'), '正式 migration 不能把購買開關打開')
assert(!migration.includes('GRANT UPDATE ON TABLE public.member_perk_settings'), '不能把購買開關的修改權授給會員')
assert(!migration.includes('GRANT INSERT ON TABLE public.member_perk_settings'), '不能把購買開關的新增權授給會員')
for (const perk of ORIGINAL) {
  assert(migration.includes(`('${perk.id}', '${perk.category}', ${perk.cost})`), `資料庫目錄缺少 ${perk.id}`)
}
const debitStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.post_perk_unlock_debit')
const debitEnd = migration.indexOf('COMMENT ON FUNCTION public.post_perk_unlock_debit')
const debit = migration.slice(debitStart, debitEnd)
assert(debitStart > 0 && debitEnd > debitStart, '必須有獨立扣點函式')
assert(!debit.includes('p_delta'), '扣點函式不能接受呼叫端傳入點數')
assert(debit.includes('FROM public.member_perk_catalog'), '扣點必須讀目錄價格')
const purchaseStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.purchase_my_perk')
const purchaseEnd = migration.indexOf('COMMENT ON FUNCTION public.purchase_my_perk')
const purchase = migration.slice(purchaseStart, purchaseEnd)
assert(!purchase.includes('post_member_reward'), '購買不能呼叫簽到或刮卡發獎')
assert(!/^\s*EXCEPTION\b/m.test(purchase), '購買函式不能吞掉錯誤')
assert(preview.includes('點數不足'), '預演必須測試點數不足')
assert(preview.includes('尚未擁有這個虛擬特權'), '預演必須測試未擁有不能裝備')
assert(preview.includes('insufficient_privilege'), '預演必須測試權限拒絕')
assert(preview.includes('public.purchase_my_perk('), '預演必須實際購買')
assert(preview.includes('其他會員的點數被改寫'), '預演必須確認沒有改到其他會員')
assert(preview.includes('這個獎勵來源尚未開放入帳'), '預演必須證明 perk_unlock 不能走既有發獎函式')
assert(preview.includes('虛擬特權購買尚未開放'), '預演必須測試關閉時拒絕購買')
assert(preview.includes('不能修改虛擬特權購買開關'), '預演必須測試會員身份不能開啟購買')
assert(preview.includes('purchase_enabled = true'), '預演必須用授權方式開啟購買')
assert(preview.includes('purchase_enabled = false'), '預演結束前必須恢復關閉')
assert(preview.includes('關閉購買後不能裝備已擁有的特權'), '預演必須證明關閉購買不影響裝備')

const market = read('components/open-marketplace.tsx')
assert(market.includes('purchaseMyPerk'), '購買必須走資料庫入口')
assert(market.includes('setMyPerkEquipped'), '裝備必須走資料庫入口')
assert(market.includes('fetchMyPerks'), '重新登入必須讀取收藏庫')
assert(!market.includes('虛擬道具尚未開放'), '不能再把已開發的購買說成未開放')
assert(!market.includes('post_perk_unlock_debit'), '畫面不能呼叫內部扣點')
assert(!market.includes('setEquippedPerks((e)'), '瀏覽器不能自己改裝備')
assert(!read('app/api/user/perks/route.js').includes('user_inventory'), '不能再用服務金鑰讀任意會員背包')
assert(!read('app/api/user/perks/route.js').includes('SERVICE_ROLE'), '舊的特權 API 不能再使用服務金鑰')

console.log('member perk checks ok')
