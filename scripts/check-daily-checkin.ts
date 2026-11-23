import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CHECKIN_REWARDS } from '../lib/rewards/foundation'
import { checkinCycleFromDays, shiftCalendarDay } from '../lib/rewards/checkin-cycle'
import { checkinFailureMessage, parseCheckinSnapshot } from '../lib/rewards/checkin-snapshot'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')
const today = '2026-10-22'
const day = (delta: number) => shiftCalendarDay(today, delta)
const span = (from: number, to: number) => {
  const days: string[] = []
  for (let offset = from; offset <= to; offset += 1) days.push(day(offset))
  return days
}

assert(CHECKIN_REWARDS.reduce((sum, value) => sum + value, 0) === 140, '七日合計應維持 140')
assert(!read('lib/rewards/checkin-cycle.ts').includes('Date.now'), '連續天數規格不能讀裝置現在時間')
assert(!read('lib/rewards/checkin-client.ts').includes('checkinCycleFromDays'), '瀏覽器不能自己決定應發點數')
assert(!read('lib/rewards/checkin-client.ts').includes('post_member_reward'), '瀏覽器不能呼叫內部發獎')
assert(read('lib/rewards/checkin-client.ts').includes("rpc(action === 'claim' ? CHECKIN_RPC.claim : CHECKIN_RPC.read)"), '簽到請求不能附帶參數')
assert(read('lib/rewards/checkin-client.ts').includes('getSession'), '簽到前必須讀取 Auth Session')
assert(read('lib/rewards/checkin-client.ts').includes("setHeader('Authorization'"), '簽到必須帶上 Supabase 核發的 access token')
assert(!read('lib/rewards/checkin-client.ts').includes('auth.uid'), '瀏覽器不能指定 auth.uid()')

const first = checkinCycleFromDays([], today)
assert(first.checkedToday === false && first.checkedDays === 0 && first.claimDelta === 10 && first.claimCycleDay === 1, '首次簽到是第 1 天 10 點')

const dayThree = checkinCycleFromDays([day(-2), day(-1)], today)
assert(dayThree.checkedDays === 2 && dayThree.claimDelta === 15 && dayThree.claimCycleDay === 3 && dayThree.nextDelta === 15, '連續兩天後應領第 3 天 15 點')

const gap = checkinCycleFromDays([day(-2)], today)
assert(gap.checkedDays === 0 && gap.claimDelta === 10 && gap.claimCycleDay === 1, '中斷後從第 1 天重算')

const daySevenDue = checkinCycleFromDays(span(-6, -1), today)
assert(daySevenDue.checkedDays === 6 && daySevenDue.claimDelta === 50 && daySevenDue.claimCycleDay === 7, '滿六天後下一次是第 7 天 50 點')

const afterSeven = checkinCycleFromDays(span(-7, -1), today)
assert(afterSeven.checkedDays === 0 && afterSeven.claimDelta === 10 && afterSeven.claimCycleDay === 1, '完成七日後下一次從第 1 天 10 點重算')

const afterEight = checkinCycleFromDays(span(-8, -1), today)
assert(afterEight.checkedDays === 1 && afterEight.claimDelta === 10 && afterEight.claimCycleDay === 2, '連續八天後下一次是第 2 天 10 點')

const already = checkinCycleFromDays([today, today, day(1)], today)
assert(already.checkedToday && already.checkedDays === 1 && already.todayDelta === 10 && already.nextDelta === null && already.claimDelta === 10, '同一天重複日期不能進到第 2 天')
const again = checkinCycleFromDays([today], today)
assert(again.claimDelta === already.claimDelta && again.checkedDays === already.checkedDays, '同一天再計算也不能增加連續天數')

const fullWeek = checkinCycleFromDays(span(-6, 0), today)
assert(fullWeek.checkedToday && fullWeek.checkedDays === 7 && fullWeek.todayDelta === 50 && fullWeek.nextDelta === null, '含今天的連續七天是第 7 天 50 點')

const fresh = parseCheckinSnapshot({
  balance: 0,
  taipeiDay: today,
  checkedToday: false,
  checkedDays: 0,
  nextDelta: 10,
  todayDelta: null,
  entries: [],
})
assert(fresh?.balance === 0 && fresh.entries.length === 0, '新會員應顯示 0 點，不能補示範點數')

const credited = parseCheckinSnapshot({
  balance: 10,
  taipeiDay: today,
  checkedToday: true,
  checkedDays: 1,
  nextDelta: null,
  todayDelta: 10,
  awardedDelta: 10,
  replayed: false,
  entries: [{ id: 'entry-1', delta: 10, label: '每日簽到（第 1 天）', at: today }],
})
if (!credited) throw new Error('成功回應必須沿用資料庫回傳的點數')
assert(credited.balance === 10 && credited.awardedDelta === 10, '成功回應必須沿用資料庫回傳的點數')
assert(parseCheckinSnapshot({ ...credited, balance: credited.balance + 10, entries: [] }) === null, '已簽到但沒有今天的流水時不能採用')
assert(parseCheckinSnapshot({ balance: 11, taipeiDay: today, checkedToday: false, checkedDays: 0, nextDelta: 11, todayDelta: null, entries: [] }) === null, '未確認的點數不能顯示')
assert(checkinFailureMessage('Failed to fetch', 'claim') === '網路異常，簽到沒有成功，點數沒有變動', '網路失敗不能當成簽到成功')
assert(checkinFailureMessage('Could not find the function public.claim_my_daily_checkin', 'claim').includes('尚未完成資料庫更新'), '函式尚未建立時不能假裝已入帳')

const migrationPath = 'supabase/migrations/20261022193000_daily_checkin.sql'
const previewPath = 'supabase/manual/20261022193000_daily_checkin_preview.sql'
const migration = read(migrationPath)
const preview = read(previewPath)
const bodyOf = (sql: string) => {
  const start = sql.indexOf('-- daily-checkin-body-start\n')
  const end = sql.indexOf('-- daily-checkin-body-end\n')
  assert(start >= 0 && end > start, '第二批 SQL 必須標出共用本文')
  return sql.slice(start, end + '-- daily-checkin-body-end\n'.length)
}
assert(bodyOf(migration) === bodyOf(preview), '預演本文必須與正式 migration 相同')
assert(migration.trimEnd().endsWith('COMMIT;'), '正式 migration 以 COMMIT 結束')
assert(preview.trimEnd().endsWith('ROLLBACK;'), '預演必須以 ROLLBACK 結束')
assert(!preview.includes('\nCOMMIT;'), '預演不能提交')
assert(!migration.includes('ROLLBACK;'), '正式 migration 不能回復交易')
assert(!migration.includes('DROP TABLE') && !preview.includes('DROP TABLE'), '不能刪除既有資料表')
assert(!migration.includes('TRUNCATE') && !preview.includes('TRUNCATE'), '不能清空資料表')
assert(!migration.includes('checkout_enabled'), '不能改結帳開關')
assert(!migration.includes('GRANT EXECUTE ON FUNCTION public.post_member_reward'), '不能把內部發獎授給 API')
assert(!migration.includes(':= public.claim_my_daily_checkin()'), '正式 migration 不能幫會員簽到')
assert(preview.includes('public.claim_my_daily_checkin()'), '預演必須實際呼叫簽到入口')
assert(preview.includes('同一天再次簽到仍再入帳'), '預演必須拒絕同一天重複入帳')
assert(preview.includes('第二位會員讀到了別人的點數或簽到紀錄'), '預演必須檢查跨帳戶讀取')
assert(preview.includes('一般會員不應能直接發獎'), '預演必須拒絕一般會員直接發獎')
assert(preview.includes('匿名角色不應能簽到'), '預演必須拒絕匿名簽到')
assert(preview.includes('帳戶餘額與點數流水不一致') || preview.includes('餘額與流水不一致'), '預演必須核對餘額與流水')

for (const message of [
  '首次簽到應從第 1 天 10 點開始',
  '連續兩天後下一次應是第 3 天 15 點',
  '中斷後應從第 1 天重新計算',
  '滿六天後下一次應是第 7 天 50 點',
  '完成七日後下一次應從第 1 天 10 點重新計算',
  '連續八天後下一次應是第 2 天 10 點',
  '今天已簽到應停在第 1 天 10 點',
  '連續七天且含今天應是第 7 天 50 點',
  '台北日在 23:59 不應換日',
  '台北日應在 UTC 16:00 換到下一天',
  '簽到入口不能接受參數',
  '簽到缺少交易鎖',
  'ARRAY[10, 10, 15, 15, 20, 20, 50]',
  'pg_advisory_xact_lock',
  'FOR UPDATE',
  'auth.uid()',
]) {
  assert(migration.includes(message), `正式 SQL 缺少檢查：${message}`)
}

const market = read('components/open-marketplace.tsx')
assert(!market.includes('const [points, setPoints] = useState(120)'), '畫面不能從 120 點開始')
assert(!market.includes('streak: 2'), '畫面不能從連續 2 天開始')
assert(market.includes('claimMyDailyCheckin'), '簽到按鈕必須走資料庫入口')
assert(market.includes("checkinPhase === 'ready' ? points"), '載入完成前不能把餘額顯示成已確認數字')

const ledgerPath = 'supabase/migrations/20261022153000_member_reward_ledger.sql'
const ledger = read(ledgerPath)
const ledgerFnStart = ledger.indexOf('CREATE OR REPLACE FUNCTION public.member_point_entry_requires_claim()')
const ledgerFnEnd = ledger.indexOf('CREATE CONSTRAINT TRIGGER member_point_entries_require_claim')
assert(ledgerFnStart >= 0 && ledgerFnEnd > ledgerFnStart, '第一批必須保留延後領獎檢查函式')
const ledgerFn = ledger.slice(ledgerFnStart, ledgerFnEnd)
assert(!ledgerFn.includes('SECURITY DEFINER'), '第一批原始函式維持呼叫者權限，補充修正不能改回原始 migration')
assert(ledgerFn.includes('FROM public.reward_claims'), '第一批領獎檢查必須仍讀取 reward_claims')
assert(ledgerFn.includes('點數流水缺少領獎紀錄'), '第一批領獎檢查的拒絕條件必須保留')
assert(ledger.includes('DEFERRABLE INITIALLY DEFERRED'), '第一批延後約束觸發器必須保留')
assert(!ledger.includes('ALTER FUNCTION public.member_point_entry_requires_claim'), '不能改已套用的第一批 migration')
assert(!migration.includes('ALTER FUNCTION public.member_point_entry_requires_claim'), '不能改已套用的第二批 migration')
assert(!preview.includes('ALTER FUNCTION public.member_point_entry_requires_claim'), '不能改已套用的第二批預演')

const securityMigrationPath = 'supabase/migrations/20261023023700_daily_checkin_claim_trigger_security.sql'
const securityPreviewPath = 'supabase/manual/20261023023700_daily_checkin_claim_trigger_security_preview.sql'
const securityMigration = read(securityMigrationPath)
const securityPreview = read(securityPreviewPath)
const securityBodyOf = (sql: string) => {
  const start = sql.indexOf('-- checkin-claim-trigger-security-body-start\n')
  const end = sql.indexOf('-- checkin-claim-trigger-security-body-end\n')
  assert(start >= 0 && end > start, '補充 SQL 必須標出共用修正')
  return sql.slice(start, end + '-- checkin-claim-trigger-security-body-end\n'.length)
}
const securityBody = securityBodyOf(securityMigration)
assert(securityBody === securityBodyOf(securityPreview), '補充預演的修正內容必須與正式 migration 相同')
assert(securityMigration.trimEnd().endsWith('COMMIT;'), '補充 migration 以 COMMIT 結束')
assert(securityPreview.trimEnd().endsWith('ROLLBACK;'), '補充預演必須以 ROLLBACK 結束')
assert(!securityPreview.includes('\nCOMMIT;'), '補充預演不能提交')
assert(!securityMigration.includes('ROLLBACK;'), '補充 migration 不能回復交易')
assert(securityBody.includes('ALTER FUNCTION public.member_point_entry_requires_claim()'), '補充修正必須調整既有觸發器函式')
assert(securityBody.includes('SECURITY DEFINER'), '補充修正必須改以函式擁有者執行')
assert(securityBody.includes('SET search_path = public, pg_catalog'), '補充修正必須固定 search_path')
assert(securityBody.includes('search_path=public, pg_catalog'), '補充修正必須檢查完整的 search_path')
assert(securityBody.includes('FROM public.reward_claims'), '補充修正必須保留領獎紀錄檢查')
assert(securityBody.includes('點數流水缺少領獎紀錄'), '補充修正必須保留缺少領獎紀錄的拒絕')
assert(securityBody.includes('延後約束觸發器必須維持啟用且交易結束才檢查'), '補充修正必須確認觸發器仍是延後約束')
assert(securityBody.includes('REVOKE ALL ON FUNCTION public.member_point_entry_requires_claim() FROM PUBLIC, anon, authenticated'), '不能開放延後檢查給一般會員')
assert(securityBody.includes('FROM service_role'), '不能開放延後檢查給 service_role')
assert(!securityBody.includes('CREATE OR REPLACE FUNCTION'), '補充修正不能改寫函式本文')
assert(!securityBody.includes('DROP TRIGGER') && !securityPreview.includes('DROP TRIGGER'), '不能移除觸發器')
assert(!securityBody.includes('DISABLE TRIGGER') && !securityPreview.includes('DISABLE TRIGGER'), '不能停用觸發器')
assert(!securityBody.includes('GRANT '), '補充修正不能新增授權')
assert(!securityMigration.includes('GRANT EXECUTE ON FUNCTION public.post_member_reward'), '不能把內部發獎授給 API')
assert(!securityMigration.includes('GRANT EXECUTE ON FUNCTION public.member_point_entry_requires_claim'), '不能把延後檢查授給 API')
assert(!securityMigration.includes(':= public.claim_my_daily_checkin()'), '正式補充 migration 不能幫會員簽到')
assert(!securityMigration.includes('SET LOCAL ROLE'), '正式補充 migration 不能切換角色試呼叫')
assert(!securityMigration.includes('SET CONSTRAINTS'), '正式補充 migration 不能改約束檢查時機')
assert(!securityMigration.includes('ARRAY[10, 10, 15, 15, 20, 20, 50]'), '補充修正不能改七日簽到金額')
for (const word of ['DROP TABLE', 'TRUNCATE', 'DELETE FROM', 'CREATE POLICY', 'DISABLE ROW LEVEL SECURITY']) {
  assert(!securityMigration.includes(word) && !securityPreview.includes(word), `補充 SQL 不應包含 ${word}`)
}

const securityTail = securityPreview.slice(securityPreview.indexOf('-- checkin-claim-trigger-security-body-end\n'))
const securityRole = securityTail.indexOf('SET LOCAL ROLE authenticated;')
const securityFirstClaim = securityTail.indexOf('public.claim_my_daily_checkin()')
const securityConstraints = securityTail.indexOf('SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE')
const securitySecondClaim = securityTail.indexOf('public.claim_my_daily_checkin()', securityFirstClaim + 1)
const securityReset = securityTail.indexOf('RESET ROLE;')
assert(
  securityRole >= 0 &&
    securityFirstClaim > securityRole &&
    securityConstraints > securityFirstClaim &&
    securitySecondClaim > securityConstraints &&
    securityReset > securitySecondClaim,
  '預演必須先切換到一般會員，實際簽到，再強制執行已排隊的延後檢查，然後才能重複簽到',
)
assert(securityTail.split('public.claim_my_daily_checkin()').length - 1 === 2, '預演的一般會員簽到必須正好兩次')
assert(securityTail.includes('首次簽到沒有正常入帳'), '預演必須驗證首次領取入帳')
assert(securityTail.includes('同一天再次簽到不能再增加點數'), '預演必須驗證同一天不能再次增加點數')
assert(securityTail.includes('點數餘額、流水與領獎紀錄不一致'), '預演必須核對餘額、流水與領獎紀錄')
assert(securityTail.includes('一般會員不應能直接讀取 reward_claims'), '預演必須拒絕一般會員直接讀取領獎紀錄')
assert(securityTail.includes('一般會員不應能直接發獎'), '預演必須拒絕一般會員直接發獎')
assert(securityTail.includes('既有點數帳戶被改寫'), '預演必須確認沒有改寫其他會員的帳戶')
assert(securityTail.includes('預演不得把延後約束觸發器改成立即檢查'), '預演必須確認觸發器定義仍是延後檢查')
assert(securityTail.includes('不會刪除或改寫現有帳本'), '預演找不到乾淨會員時必須停止，不能清帳')

console.log('daily check-in checks ok')
