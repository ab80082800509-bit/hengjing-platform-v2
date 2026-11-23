import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyRewardClaimSpec, emptyLedger, REWARD_ERRORS } from '../lib/rewards/foundation'
import {
  COUPON_ERRORS,
  COUPON_EXCHANGE_COST,
  GAME_POOL_LIMIT,
  applyCouponPointDebit,
  couponExpiresOn,
  exchangeCoupon,
  issueCoupon,
  type CouponTemplate,
} from '../lib/rewards/coupon-rules'
import { couponFailureMessage, parseSellerCoupon, parseWalletCoupon } from '../lib/rewards/coupon-snapshot'
import { parseScratchSnapshot } from '../lib/rewards/scratch-snapshot'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')
const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const DAY = '2026-10-24'
const COUPON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

assert(couponExpiresOn('2026-10-01', '2026-12-31') === '2026-10-31', '領取日加 30 天較早時要用 30 天')
assert(couponExpiresOn('2026-10-20', '2026-11-01') === '2026-11-01', '券截止日較早時要用券截止日')
assert(couponExpiresOn(DAY, DAY) === DAY, '同一天領取且當天截止時到期日就是當天')
const again = couponExpiresOn(DAY, '2026-12-01')
assert(couponExpiresOn(DAY, '2026-12-01') === again, '重複計算仍是同一個到期日')

const ledger = emptyLedger()
ledger.accounts[USER] = 100
let closed = false
try {
  applyRewardClaimSpec(ledger, { userId: USER, kind: 'coupon_exchange', claimKey: `coupon_exchange:${COUPON}`, delta: -100, internal: true, metadata: {} }, DAY)
} catch (error) {
  closed = error instanceof Error && error.message === REWARD_ERRORS.closedKind
}
assert(closed, '既有發獎函式仍不接受優惠券兌換')
assert(ledger.entries.length === 0 && ledger.accounts[USER] === 100, '被拒絕的兌換不能改餘額')

const debited = applyCouponPointDebit(ledger, { userId: USER, couponId: COUPON, taipeiDay: DAY, internal: true })
assert(debited.balance === 0 && debited.state.entries[0]?.delta === -COUPON_EXCHANGE_COST, '兌換固定扣 100 點')
const replay = applyCouponPointDebit(debited.state, { userId: USER, couponId: COUPON, taipeiDay: DAY, internal: true })
assert(replay.replayed && replay.balance === 0 && replay.state.entries.length === 1, '同一張券不能重複扣點')
let poor = false
try {
  applyCouponPointDebit(emptyLedger(), { userId: USER, couponId: COUPON, taipeiDay: DAY, internal: true })
} catch (error) {
  poor = error instanceof Error && error.message === COUPON_ERRORS.insufficient
}
assert(poor, '點數不足必須拒絕')

const template = (patch: Partial<CouponTemplate> = {}): CouponTemplate => ({
  id: COUPON,
  sellerId: OTHER,
  qty: 1,
  issued: 0,
  active: true,
  deleted: false,
  gamePool: true,
  shelf: true,
  startOn: DAY,
  endOn: '2026-11-01',
  ...patch,
})

const shelf = issueCoupon(template({ gamePool: false }), [], { userId: USER, source: 'shelf', today: DAY })
assert(shelf.coupon.issued === 1 && shelf.hold.expiresOn === '2026-11-01', '賣場領取扣庫存並用較早的截止日')
const shelfReplay = issueCoupon(shelf.coupon, shelf.holds, { userId: USER, source: 'shelf', today: DAY })
assert(shelfReplay.replayed && shelfReplay.coupon.issued === 1, '重複領取不能再扣庫存')
let soldOut = false
try {
  issueCoupon(shelf.coupon, shelf.holds, { userId: OTHER, source: 'shelf', today: DAY })
} catch (error) {
  soldOut = error instanceof Error && error.message === COUPON_ERRORS.soldOut
}
assert(soldOut, '最後一張被領走後不能超發')

const funded = emptyLedger()
funded.accounts[USER] = 100
const exchanged = exchangeCoupon(funded, template({ qty: 2, shelf: false, endOn: '2026-12-31' }), [], { userId: USER, today: DAY, internal: true })
assert(exchanged.balance === 0 && exchanged.coupon.issued === 1 && exchanged.holds[0]?.expiresOn === '2026-11-23', '扣點與發券一起完成，到期日是領取加 30 天')
const exchangedAgain = exchangeCoupon(exchanged.state, exchanged.coupon, exchanged.holds, { userId: USER, today: DAY, internal: true })
assert(exchangedAgain.replayed && exchangedAgain.balance === 0 && exchangedAgain.coupon.issued === 1, '重複兌換不能再扣點或庫存')
assert(exchanged.state.entries.length === 1 && exchanged.state.claims.length === 1, '扣點必須有流水與領獎紀錄')

let noPool = false
try {
  exchangeCoupon(funded, template({ gamePool: false, shelf: true }), [], { userId: USER, today: DAY, internal: true })
} catch (error) {
  noPool = error instanceof Error && error.message === COUPON_ERRORS.unavailable
}
assert(noPool && funded.accounts[USER] === 100, '沒有授權的券不能扣點')
assert(GAME_POOL_LIMIT === 3, '每家店最多 3 張遊戲曝光')

const parsed = parseSellerCoupon({
  id: COUPON,
  sellerId: OTHER,
  code: 'AB12',
  name: '預覽券',
  kind: 'cash',
  amount: 10,
  percent: 0,
  maxDiscount: null,
  gift: '',
  minSpend: 100,
  qty: 5,
  redeemed: 1,
  usedOrders: 0,
  listed: true,
  shelf: false,
  cost: 100,
  active: true,
  deleted: false,
  startAt: DAY,
  endAt: '2026-11-01',
})
assert(parsed?.redeemed === 1 && parsed.usedOrders === 0 && parsed.cost === 100, '優惠券清單必須能讀回，且不能帶已使用訂單')
assert(parseSellerCoupon({ ...parsed, usedOrders: 2, cost: 100 }) === null, '未核銷的券不能讀成已使用')
const hold = parseWalletCoupon({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  couponId: COUPON,
  code: 'AB12',
  sellerId: OTHER,
  sellerName: '測試賣場',
  source: 'points',
  kind: 'cash',
  amount: 10,
  percent: 0,
  maxDiscount: null,
  gift: '',
  minSpend: 100,
  claimedAt: DAY,
  expiresAt: '2026-11-23',
  status: 'unused',
})
assert(hold?.source === 'points' && hold.status === 'unused', '券包必須保留來源與未使用狀態')
assert(couponFailureMessage('permission denied for table seller_coupons') !== '請先登入', '權限錯誤不能顯示成請先登入')
const scratchCoupon = parseScratchSnapshot({
  balance: 0,
  taipeiDay: DAY,
  baseChances: 1,
  bonusChances: 0,
  chancesTotal: 1,
  used: 1,
  chancesLeft: 0,
  inviteBonusToday: false,
  replayed: false,
  awardedDelta: null,
  card: {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    slot: 1,
    outcomeKind: 'coupon',
    points: 0,
    revealed: false,
    coupon: {
      holdId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      couponId: COUPON,
      code: 'AB12',
      sellerId: OTHER,
      sellerName: '測試賣場',
      name: '預覽券',
      kind: 'cash',
      amount: 10,
      percent: 0,
      maxDiscount: null,
      gift: '',
      minSpend: 100,
      expiresOn: '2026-11-23',
    },
  },
})
assert(scratchCoupon?.card?.outcomeKind === 'coupon' && scratchCoupon.card.points === 0 && scratchCoupon.awardedDelta === null && scratchCoupon.card.coupon?.couponId === COUPON, '刮到可發券時只能發券，點數維持 0')
assert(parseScratchSnapshot({ ...scratchCoupon, awardedDelta: 20 }) === null, '發券與替代點數不能同時成立')
assert(couponFailureMessage('點數不足') === '點數不足', '點數不足要原樣顯示')

const migrationPath = 'supabase/migrations/20261024160000_seller_coupons_and_wallet.sql'
const previewPath = 'supabase/manual/20261024160000_seller_coupons_and_wallet_preview.sql'
const migration = read(migrationPath)
const preview = read(previewPath)
const marker = '-- coupon-batch-body-start\n'
const endMarker = '-- coupon-batch-body-end\n'
const bodyOf = (sql: string) => {
  const start = sql.indexOf(marker)
  const end = sql.indexOf(endMarker)
  assert(start >= 0 && end > start, 'SQL 必須標出第四批本文')
  return sql.slice(start, end + endMarker.length)
}
assert(bodyOf(migration) === bodyOf(preview), '預演本文必須與正式 migration 相同')
assert(migration.trimEnd().endsWith('COMMIT;'), '正式 migration 以 COMMIT 結束')
assert(preview.trimEnd().endsWith('ROLLBACK;'), '預演必須以 ROLLBACK 結束')
assert(!preview.includes('\nCOMMIT;'), '預演不能提交')
assert(!migration.includes('ROLLBACK;'), '正式 migration 不能回復交易')
assert(
  !migration.split('\n').some((line) => line.includes('checkout_enabled') && !line.trimStart().startsWith('--')),
  '不能變更結帳開關',
)
assert(!migration.includes('CREATE OR REPLACE FUNCTION public.post_member_reward'), '不能改寫既有發獎函式')
assert(!migration.includes('CREATE OR REPLACE FUNCTION public.scratch_award_from_units'), '不能改刮卡機率')
assert(!migration.includes('CREATE OR REPLACE FUNCTION public.claim_my_daily_checkin'), '不能改簽到')
assert(!migration.includes('pg_catalog.greatest(') && !migration.includes('pg_catalog.least('), '不能再呼叫不存在的 pg_catalog.greatest 或 least')
assert(migration.includes('CASE WHEN total > used THEN total - used ELSE 0 END'), '刮卡剩餘次數要用 CASE')
assert(migration.includes('FOR UPDATE'), '領券與扣點必須鎖定資料列')
assert(migration.includes('member_coupon_holds_user_coupon UNIQUE (user_id, coupon_id)'), '同一會員同一張券只能有一筆')
assert(migration.includes('-100'), '兌換必須固定扣 100 點')
assert(!migration.includes('GRANT EXECUTE ON FUNCTION public.post_coupon_exchange_debit'), '扣點函式不能授給 API')
assert(!migration.includes('GRANT EXECUTE ON FUNCTION public.issue_member_coupon'), '發券函式不能授給 API')
assert(migration.includes('GRANT EXECUTE ON FUNCTION public.exchange_my_coupon(uuid) TO authenticated'), '會員只能走兌換入口')
assert(migration.includes('GRANT EXECUTE ON FUNCTION public.claim_storefront_coupon(uuid) TO authenticated'), '會員只能走賣場領取入口')
assert(migration.includes('-- scratch-coupon-or-points'), '刮卡必須把發券與入點分開')
assert(!migration.includes('FOUNDER_DAILY_QUOTA') && !migration.includes('founder_prize'), '不能建立創始券每日限制或庫存')
assert(migration.includes('不能恢復創始券每日 5 張'), '必須拒絕恢復創始券每日限制')
assert(migration.includes('每家店最多同時上架 3 張到簽到專區'), '遊戲曝光上限必須是 3')
assert(migration.includes('ENABLE ROW LEVEL SECURITY'), '優惠券表必須啟用 RLS')
assert(!migration.includes('CREATE POLICY'), '不能靠開放資料表政策解決權限')
assert(migration.includes('app.reward_post'), '扣點必須沿用帳本的內部旗標')

const claimStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.claim_storefront_coupon')
const exchangeStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.exchange_my_coupon')
assert(claimStart > 0 && exchangeStart > claimStart, '賣場領取與點數兌換要分成兩個入口')
const claimBody = migration.slice(claimStart, exchangeStart)
assert(!claimBody.includes('post_coupon_exchange_debit') && !claimBody.includes('post_member_reward'), '賣場免費領取不能扣點')

const drawStart = migration.indexOf('-- scratch-coupon-or-points\n')
const drawEnd = migration.indexOf('-- scratch-coupon-or-points-end\n')
const drawBranch = migration.slice(drawStart, drawEnd)
const drawElse = drawBranch.indexOf('\n  ELSE\n')
assert(drawElse > 0, '刮卡發券分支必須存在')
assert(!drawBranch.slice(0, drawElse).includes('post_member_reward'), '發出優惠券時不能入點')
assert(drawBranch.slice(drawElse).includes('post_member_reward'), '沒有發券時仍要走原本的點數入帳')
assert(preview.includes('點數不足'), '預演必須測試點數不足')
assert(preview.includes('此優惠券已被領完'), '預演必須測試庫存不足')
assert(preview.includes('insufficient_privilege'), '預演必須測試權限拒絕')
assert(preview.includes('public.exchange_my_coupon('), '預演必須實際兌換')
assert(preview.includes('public.claim_storefront_coupon('), '預演必須實際領券')
assert(preview.includes('SET CONSTRAINTS public.member_point_entries_require_claim IMMEDIATE'), '預演必須跑過延後領獎檢查')
assert(preview.includes('其他會員的點數被改寫'), '預演必須確認沒有改到其他會員')

const market = read('components/open-marketplace.tsx')
assert(market.includes('exchangeMyCoupon'), '兌換必須走資料庫入口')
assert(market.includes('claimStorefrontCoupon'), '賣場領取必須走資料庫入口')
assert(market.includes('saveMySellerCoupon'), '商家必須走資料庫入口管理優惠券')
assert(!market.includes('SEED_COUPONS') && !market.includes('SEED_WALLET'), '不能再把示範券當成正式券包')
assert(!market.includes('優惠券點數兌換尚未開放'), '不能再把已開放的兌換說成未開放')
assert(read('components/home/scratch-card-panel.tsx').includes('不會兩樣一起領') || read('components/home/scratch-card-panel.tsx').includes('不會同時領'), '畫面要說明發券與替代點數只取一種')
assert(!read('supabase/migrations/20261023040000_scratch_card_and_invites.sql').includes('pg_catalog.greatest('), '第三批原檔不能留下 greatest 呼叫')

console.log('seller coupon checks ok')
