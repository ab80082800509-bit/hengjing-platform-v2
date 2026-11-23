import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')
const migrationPath = 'supabase/migrations/20261024210000_founder_test_point_grant.sql'
const previewPath = 'supabase/manual/20261024210000_founder_test_point_grant_preview.sql'
const grantApplyPath = 'supabase/manual/20261024210000_founder_test_point_grant_apply.sql'
const reclaimApplyPath = 'supabase/manual/20261024210000_founder_test_point_reclaim_apply.sql'
const migration = read(migrationPath)
const preview = read(previewPath)
const grantApply = read(grantApplyPath)
const reclaimApply = read(reclaimApplyPath)
const startMarker = '-- founder-test-grant-body-start\n'
const endMarker = '-- founder-test-grant-body-end\n'
const bodyOf = (sql: string) => {
  const start = sql.indexOf(startMarker)
  const end = sql.indexOf(endMarker)
  assert(start >= 0 && end > start, 'SQL 必須標出測試額度本文')
  assert(sql.indexOf(startMarker, start + 1) === -1, '測試額度本文標記只能出現一次')
  return sql.slice(start, end + endMarker.length)
}

assert(bodyOf(migration) === bodyOf(preview), '預演本文必須與正式 migration 相同')
assert(migration.trimEnd().endsWith('COMMIT;'), '正式 migration 以 COMMIT 結束')
assert(preview.trimEnd().endsWith('ROLLBACK;'), '預演必須以 ROLLBACK 結束')
assert(grantApply.trimEnd().endsWith('ROLLBACK;'), '正式補點語句預設必須回復')
assert(reclaimApply.trimEnd().endsWith('ROLLBACK;'), '正式回收語句預設必須回復')
assert(!preview.includes('\nCOMMIT;'), '預演不能提交')
assert(!grantApply.includes('\nCOMMIT;'), '正式補點語句不能自帶提交')
assert(!reclaimApply.includes('\nCOMMIT;'), '正式回收語句不能自帶提交')
assert(!migration.includes('ROLLBACK;'), '正式 migration 不能回復交易')
assert(!migration.includes('SELECT public.post_founder_coupon_test_grant('), '正式 migration 不能給會員入帳')
assert(!migration.includes('SELECT public.post_founder_coupon_test_reclaim('), '正式 migration 不能回收會員點數')
assert(!migration.includes('CREATE OR REPLACE FUNCTION public.post_member_reward'), '不能改寫既有發獎函式')
const grantFn = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.post_founder_coupon_test_grant'),
  migration.indexOf('CREATE OR REPLACE FUNCTION public.post_founder_coupon_test_reclaim'),
)
const reclaimFn = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.post_founder_coupon_test_reclaim'),
  migration.indexOf('COMMENT ON FUNCTION public.post_founder_coupon_test_reclaim'),
)
assert(grantFn.length > 0 && reclaimFn.length > 0, '兩支測試函式都必須存在')
assert(!grantFn.includes('UPDATE public.member_coupon_holds') && !reclaimFn.includes('UPDATE public.member_coupon_holds'), '不能改已領取的優惠券')
assert(!grantFn.includes('DELETE FROM public.member_coupon_holds') && !reclaimFn.includes('DELETE FROM public.member_coupon_holds'), '不能刪已領取的優惠券')
assert(!grantFn.includes('WHERE claim_key = claim_key') && !reclaimFn.includes('WHERE claim_key = claim_key'), '領獎鍵不能與同名變數比較')
assert(migration.includes('claim.claim_key = v_grant_key'), '補點必須用表別名與領獎鍵變數')
assert(migration.includes('claim.claim_key = v_reclaim_key'), '回收必須用表別名與領獎鍵變數')
assert(migration.includes('v_target - v_account.balance'), '必須依差額補足至目標餘額')
assert(migration.includes('補點後必須剛好是 5000 點'), '補點結果必須是 5000')
assert(!grantFn.includes('+ 5000') && !grantFn.includes('balance + 5000'), '不能固定再加 5000')
assert(migration.includes('不會作廢券、訂單或虛擬道具'), '必須標明權益回收限制')
assert(preview.includes('delta\')::integer IS DISTINCT FROM 4990'), '預演必須證明 10 點只補 4990')
assert(preview.includes('delta\')::integer IS DISTINCT FROM -4890'), '預演必須證明只收回尚未花掉的測試點')
assert(preview.includes('預演不應偽造刮卡流水'), '預演必須拒絕刮卡流水')
assert(preview.includes("SQLERRM IS DISTINCT FROM '尚未開放這個獎勵來源'"), '預演必須精確比對舊發獎函式真正拋出的例外')
assert(!preview.includes("position('尚未開放這個獎勵來源' IN SQLERRM)"), '預演不能用片段比對吞掉其他發獎錯誤')
assert(reclaimFn.includes('entry.balance_after::bigint - entry.delta::bigint'), '回收必須沿餘額鏈歸屬')
assert(!reclaimFn.includes('entry.created_at >= v_grant_created_at'), '回收不能用建立時間加總扣點')
assert(reclaimFn.includes('這位會員已有虛擬道具流水'), '已有虛擬道具流水時仍必須停止')
assert(!reclaimFn.includes('user_inventory'), '這次不能提前建立或改寫永久 Inventory')
assert(preview.includes('同一交易時間的扣點必須沿餘額鏈歸屬'), '預演必須證明同一時刻的補點前扣點不會算進測試額度')
assert(preview.includes('虛擬道具流水不應被當成可回收'), '預演必須證明虛擬道具流水會停止回收')
assert(!grantApply.includes('ALTER TABLE'), '正式補點語句不能改結構')
assert(!reclaimApply.includes('ALTER TABLE'), '正式回收語句不能改結構')
assert(grantApply.includes('member@example.com'), '正式補點必須保留待填信箱')
assert(reclaimApply.includes('holdsReleased 必須是 false'), '正式回收必須說明券不會作廢')

console.log('founder test grant checks passed')
