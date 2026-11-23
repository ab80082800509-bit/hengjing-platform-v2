import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { noteInviteBonus, applyRewardClaimSpec, emptyLedger } from '../lib/rewards/foundation'
import { parseInviteSettlement, parseInviteStatus, inviteFailureMessage } from '../lib/rewards/invite-snapshot'
import { scratchFailureMessage, parseScratchSnapshot } from '../lib/rewards/scratch-snapshot'
import {
  SCRATCH_ERRORS,
  rollScratchAwardFromBasis,
  scratchClaimKey,
} from '../lib/rewards/scratch-rules'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')
const USER_A = '11111111-1111-4111-8111-111111111111'
const DAY = '2026-10-23'

const coupon = rollScratchAwardFromBasis(0, 9700)
const couponEdge = rollScratchAwardFromBasis(2499, 0)
const points = [
  [2500, 0, 10],
  [2500, 3999, 10],
  [8999, 4000, 15],
  [2500, 6999, 15],
  [2500, 7000, 20],
  [2500, 8799, 20],
  [2500, 8800, 30],
  [2500, 9699, 30],
  [2500, 9700, 50],
] as const
const founder = rollScratchAwardFromBasis(9000, 0)
const founderEdge = rollScratchAwardFromBasis(9499, 1)
const none = rollScratchAwardFromBasis(9500, 0)
const noneEdge = rollScratchAwardFromBasis(9999, 9999)

assert(coupon.outcomeKind === 'coupon_fallback' && coupon.points === 20, '一般券邊界應改發 20 點')
assert(couponEdge.outcomeKind === 'coupon_fallback' && couponEdge.points === 20, '2499 仍是一般券替代')
for (const [kindBp, pointBp, expected] of points) {
  const award = rollScratchAwardFromBasis(kindBp, pointBp)
  assert(award.outcomeKind === 'points' && award.points === expected, `${kindBp}/${pointBp} 應為 ${expected} 點`)
}
assert(founder.outcomeKind === 'founder_fallback' && founder.points === 30, '創始券應改發 30 點')
assert(founderEdge.outcomeKind === 'founder_fallback' && founderEdge.points === 30, '9499 仍是創始券替代')
assert(none.outcomeKind === 'none' && none.points === 3, '保底應為 3 點')
assert(noneEdge.outcomeKind === 'none' && noneEdge.points === 3, '9999 仍是保底')

let outOfRange = false
try {
  rollScratchAwardFromBasis(10000, 0)
} catch (error) {
  outOfRange = error instanceof Error && error.message === SCRATCH_ERRORS.random
}
assert(outOfRange, '超過萬分比必須拒絕')

const ledger = emptyLedger()
const posted = applyRewardClaimSpec(
  ledger,
  { userId: USER_A, kind: 'scratch', claimKey: scratchClaimKey(DAY, 1), delta: 3, internal: true, metadata: {} },
  DAY,
)
assert(posted.result.currentBalance === 3 && posted.result.replayed === false, '保底 3 點可入帳')
const withBonus = noteInviteBonus(posted.state, USER_A, DAY)
const second = applyRewardClaimSpec(
  withBonus,
  { userId: USER_A, kind: 'scratch', claimKey: scratchClaimKey(DAY, 2), delta: 30, internal: true, metadata: {} },
  DAY,
)
assert(second.result.currentBalance === 33 && second.state.entries.length === 2, '邀請加碼後可以刮第二次')
assert(withBonus.accounts[USER_A] === 3, '記下加碼本身不發點')

const migrationPath = 'supabase/migrations/20261023040000_scratch_card_and_invites.sql'
const previewPath = 'supabase/manual/20261023040000_scratch_card_and_invites_preview.sql'
const migration = read(migrationPath)
const preview = read(previewPath)
const bodyOf = (sql: string) => {
  const start = sql.indexOf('-- scratch-batch-body-start\n')
  const end = sql.indexOf('-- scratch-batch-body-end\n')
  assert(start >= 0 && end > start, 'SQL 必須標出第三批本文')
  return sql.slice(start, end + '-- scratch-batch-body-end\n'.length)
}
assert(bodyOf(migration) === bodyOf(preview), '預演本文必須與正式 migration 相同')
assert(!migration.includes('pg_catalog.greatest('), '第三批不能呼叫不存在的 pg_catalog.greatest')
assert(migration.includes('CASE WHEN total > used THEN total - used ELSE 0 END'), '剩餘次數必須用 CASE')
assert(migration.trimEnd().endsWith('COMMIT;'), '正式 migration 以 COMMIT 結束')
assert(preview.trimEnd().endsWith('ROLLBACK;'), '預演必須以 ROLLBACK 結束')
assert(!preview.includes('\nCOMMIT;'), '預演不能提交')
assert(!migration.includes('ROLLBACK;'), '正式 migration 不能回復交易')
assert(!migration.includes('SET LOCAL ROLE'), '正式 migration 不能切換角色試呼叫')
assert(preview.includes('SET LOCAL ROLE authenticated;'), '預演必須以一般會員身份呼叫')
assert(preview.includes('public.draw_my_scratch_card()'), '預演必須實際刮卡')
assert(preview.includes('public.settle_my_signup_invite()'), '預演必須實際結算邀請')
assert(preview.includes('SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE'), '預演必須跑過延後領獎檢查')
assert(preview.includes('自己邀請自己必須拒絕'), '預演必須拒絕自我邀請')
assert(preview.includes('其他會員的點數被改寫'), '預演必須確認沒有改到其他會員')

for (const message of Object.values(SCRATCH_ERRORS)) {
  assert(migration.includes(message), `正式 SQL 缺少：${message}`)
}
for (const marker of [
  'p_delta NOT IN (10, 15, 20, 50)',
  'p_delta NOT IN (3, 10, 15, 20, 30, 50)',
  'email_confirmed_at',
  'self_invite',
  'registration_incomplete',
  'auth.uid()',
  'public.post_member_reward(',
  'pg_advisory_xact_lock',
  'FOR UPDATE',
  'ENABLE ROW LEVEL SECURITY',
  'GRANT EXECUTE ON FUNCTION public.draw_my_scratch_card() TO authenticated',
  'GRANT EXECUTE ON FUNCTION public.claim_my_daily_checkin()',
]) {
  if (marker === 'GRANT EXECUTE ON FUNCTION public.claim_my_daily_checkin()') {
    assert(migration.includes('登入會員應仍能簽到並讀取簽到狀態'), '不能拿掉既有簽到權限')
  } else {
    assert(migration.includes(marker), `正式 SQL 缺少 ${marker}`)
  }
}
assert(!migration.includes('GRANT EXECUTE ON FUNCTION public.post_member_reward'), '不能把內部發獎授給 API')
assert(!migration.includes('GRANT EXECUTE ON FUNCTION public.scratch_award_from_units'), '開獎函式不能授給 API')
assert(!migration.includes('checkout_enabled'), '不能變更結帳開關')
assert(!migration.includes('referral_visits') && !migration.includes('referral_codes'), '不能讀寫另一個資料庫的進站表')
assert(migration.includes("position('INSERT INTO public.coupons' IN draw_def)"), '必須檢查刮卡函式沒有建立優惠券')
assert(migration.includes("position('wallet' IN draw_def)"), '必須檢查刮卡函式沒有寫入券包')
assert(!migration.includes('FOUNDER_DAILY_QUOTA'), '不能恢復創始券每日 5 張')
for (const word of ['DROP TABLE', 'TRUNCATE', 'DELETE FROM public.member_point', 'DISABLE ROW LEVEL SECURITY']) {
  assert(!migration.includes(word) && !preview.includes(word), `第三批 SQL 不應包含 ${word}`)
}
assert(!migration.includes('ALTER FUNCTION public.claim_my_daily_checkin'), '不能改寫已套用的簽到入口')
assert(!migration.includes('ALTER FUNCTION public.member_point_entry_requires_claim'), '不能再改延後觸發器')

const market = read('components/open-marketplace.tsx')
assert(market.includes('drawMyScratchCard'), '刮卡必須走資料庫入口')
assert(market.includes('revealMyScratchCard'), '揭曉必須走資料庫入口')
assert(market.includes('settleMySignupInvite'), '註冊後必須結算邀請')
assert(market.includes('invite_code: inviteCode'), '註冊要把邀請碼交給資料庫')
assert(!market.includes('rollPrizeKind') && !market.includes('rollPointAmount'), '瀏覽器不能自己開獎')
assert(!market.includes('grantScratchPoints'), '瀏覽器不能自己發刮卡點數')
assert(!market.includes('post_member_reward'), '市集不能呼叫內部發獎')
assert(!market.includes('/api/referral/claim'), '刮卡不能再用進站領次')
assert(!market.includes('FOUNDER_DAILY_QUOTA'), '畫面不能恢復每日 5 張')
assert(!read('components/home/scratch-card-panel.tsx').includes('lib/rewards'), '刮卡畫面不能自己入帳')
assert(!read('components/home/scratch-card-panel.tsx').includes('尚未寫入正式'), '不能再把刮卡說成示範')
assert(!read('components/home/invite-panel.tsx').includes('/api/referral/claim'), '邀請畫面不能用進站領次')
assert(read('components/referral-tracker.tsx').includes('rememberSignupInvite'), '連結要留給註冊使用')
assert(read('lib/rewards/scratch-client.ts').includes("rpc(rpc)") || read('lib/rewards/scratch-client.ts').includes('supabase.rpc(rpc)'), '刮卡請求不能附帶點數參數')
assert(!read('lib/rewards/scratch-client.ts').includes('post_member_reward'), '瀏覽器不能呼叫內部發獎')
assert(!read('lib/rewards/scratch-client.ts').includes('delta:'), '瀏覽器不能傳送點數')

assert(inviteFailureMessage('permission denied for table scratch_plays') !== '請先登入', '權限錯誤不能顯示成請先登入')
assert(scratchFailureMessage('permission denied for table reward_claims', 'draw') !== '請先登入', '刮卡權限錯誤不能顯示成請先登入')
assert(scratchFailureMessage('請先登入', 'draw') === '請先登入', '真的未登入仍要提示登入')
assert(scratchFailureMessage('今日刮卡次數已用完', 'draw').includes('00:00'), '次數用完要說明重製時間')

const cardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const parsed = parseScratchSnapshot({
  balance: 20,
  taipeiDay: DAY,
  baseChances: 1,
  bonusChances: 0,
  chancesTotal: 1,
  used: 1,
  chancesLeft: 0,
  inviteBonusToday: false,
  replayed: false,
  awardedDelta: 20,
  card: { id: cardId, slot: 1, outcomeKind: 'coupon_fallback', points: 20, revealed: false },
})
assert(parsed?.awardedDelta === 20 && parsed.card?.outcomeKind === 'coupon_fallback', '刮卡結果必須能讀回')
assert(parseScratchSnapshot({ ...parsed, awardedDelta: 15, card: parsed?.card }) === null, '入帳點數與開獎不一致時不能當成功')
assert(parseInviteStatus({ code: 'ABCD2345', inviteBonusToday: true })?.inviteBonusToday === true, '邀請狀態可讀')
assert(parseInviteStatus({ code: 'CLICKONLY', inviteBonusToday: true }) === null, '含易混淆字元的舊碼不能當會員邀請碼')
const settlement = parseInviteSettlement({ settled: true, replayed: false, reason: null, bonusGranted: true })
assert(settlement?.bonusGranted === true, '邀請成立要帶回是否加上今天的次數')
assert(parseInviteSettlement({ settled: false, replayed: false, reason: 'self_invite', bonusGranted: true }) === null, '拒絕自我邀請時不能同時加次數')

console.log('scratch card checks ok')
