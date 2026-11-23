import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PERK_CATALOG } from '../lib/rewards/perk-catalog'
import { taipeiDayStart, VISITOR_PATTERN } from '../lib/referral'
import {
  CHECKIN_POINT_VALUES,
  CHECKIN_REWARDS,
  KNOWN_PERKS,
  OPEN_REWARD_KINDS,
  REWARD_DATABASE,
  REWARD_ERRORS,
  REWARD_KINDS,
  REWARD_RPC,
  applyRewardClaimSpec,
  assertPointBalanceCovers,
  assertRewardWriteStaysOffBrowser,
  checkinClaimKey,
  emptyLedger,
  linkVisitorSpec,
  type LedgerState,
} from '../lib/rewards/foundation'
import { TAIPEI_DAY_VECTORS, taipeiCalendarDate } from '../lib/rewards/taipei-day'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const DAY_1 = '2026-10-22'
const DAY_2 = '2026-10-23'
const VISITOR_A = 'a'.repeat(32)
const VISITOR_B = 'b'.repeat(32)

for (const vector of TAIPEI_DAY_VECTORS) {
  const instant = new Date(vector.iso)
  assert(taipeiCalendarDate(instant) === vector.day, `台北日 ${vector.iso} 應為 ${vector.day}`)
  assert(
    taipeiCalendarDate(taipeiDayStart(instant)) === vector.day,
    `既有邀請換日與 Asia/Taipei 在 ${vector.iso} 不一致`,
  )
}
assert(VISITOR_PATTERN.source === '^' + '[a-f0-9]{32}' + '$', '訪客編號規則必須與邀請資料庫相同')
assert(REWARD_DATABASE === 'supabase', '發獎資料庫必須是 Supabase')
const openRewardKinds = OPEN_REWARD_KINDS as readonly string[]
assert(openRewardKinds.includes('checkin') && openRewardKinds.includes('scratch'), '簽到與刮卡可以入帳')
assert(!openRewardKinds.includes('coupon_exchange') && !openRewardKinds.includes('perk_unlock'), '兌換與虛擬道具仍未開放')
assert(CHECKIN_REWARDS.reduce((sum, value) => sum + value, 0) === 140, '七日點數合計應維持既有規則')
assert(Math.max(...CHECKIN_REWARDS) === 50, 'Day 7 是 50 點')

assertRewardWriteStaysOffBrowser()
const previousWindow = (globalThis as { window?: unknown }).window
Object.defineProperty(globalThis, 'window', { value: {}, configurable: true })
let browserBlocked = false
try {
  assertRewardWriteStaysOffBrowser()
} catch (error) {
  browserBlocked = error instanceof Error && error.message === REWARD_ERRORS.browser
}
if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
else Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true })
assert(browserBlocked, '瀏覽器不能入帳')

const post = (state: LedgerState, delta: number, day: string, userId = USER_A, kind = 'checkin', claimKey?: string) =>
  applyRewardClaimSpec(
    state,
    { userId, kind, claimKey: claimKey ?? checkinClaimKey(day), delta, internal: true, metadata: {} },
    day,
  )

let ledger = emptyLedger()
const first = post(ledger, 10, DAY_1)
assert(first.result.replayed === false && first.result.currentBalance === 10, '第一次簽到入帳 10 點')
const replay = post(first.state, 10, DAY_1)
assert(replay.result.replayed && replay.result.currentBalance === 10, '同一領獎鍵回放不能再入帳')
assert(replay.state === first.state, '回放不能產生新狀態')
assert(first.state.entries.length === 1 && first.state.claims.length === 1, '簽到只留下一筆流水與一筆領獎')

for (const delta of [0, 11, 51, -10]) {
  let rejected = false
  try {
    post(first.state, delta, DAY_1)
  } catch (error) {
    rejected = error instanceof Error && error.message === REWARD_ERRORS.checkinAmount
  }
  assert(rejected, `簽到金額 ${delta} 不在已確認的 10、15、20、50`)
}

let rewritten = false
try {
  post(first.state, 50, DAY_1)
} catch (error) {
  rewritten = error instanceof Error && error.message === REWARD_ERRORS.rewrite
}
assert(rewritten, '同一天改領 50 點必須被拒絕，且不能覆蓋原本的 10 點')

let closed = false
const beforeScratch = first.state
try {
  post(beforeScratch, 10, DAY_1, USER_A, 'scratch', 'scratch:free:1')
} catch (error) {
  closed = error instanceof Error && error.message === '刮卡領獎鍵必須使用資料庫台北日與次數槽'
}
assert(closed && beforeScratch.entries.length === 1, '不正確的刮卡領獎鍵不能入帳')

const scratch = post(first.state, 10, DAY_1, USER_A, 'scratch', 'scratch:2026-10-22:slot:1')
assert(scratch.result.replayed === false && scratch.result.currentBalance === 20, '刮卡點數寫入同一本帳')
const scratchReplay = post(scratch.state, 10, DAY_1, USER_A, 'scratch', 'scratch:2026-10-22:slot:1')
assert(scratchReplay.result.replayed && scratchReplay.result.currentBalance === 20, '同一張刮卡不能再入帳')
let scratchRewrite = false
try {
  post(scratch.state, 50, DAY_1, USER_A, 'scratch', 'scratch:2026-10-22:slot:1')
} catch (error) {
  scratchRewrite = error instanceof Error && error.message === REWARD_ERRORS.rewrite
}
assert(scratchRewrite && scratch.state.accounts[USER_A] === 20, '同一張刮卡不能改點數')
let bonusMissing = false
try {
  post(scratch.state, 3, DAY_1, USER_A, 'scratch', 'scratch:2026-10-22:slot:2')
} catch (error) {
  bonusMissing = error instanceof Error && error.message === '邀請加碼次數尚未成立'
}
assert(bonusMissing && scratch.state.accounts[USER_A] === 20, '沒有邀請加碼不能使用第二次')
for (const delta of [2, 5, 11]) {
  let rejected = false
  try {
    post(scratch.state, delta, DAY_1, USER_A, 'scratch', 'scratch:2026-10-22:slot:2')
  } catch (error) {
    rejected = error instanceof Error && (error.message === '刮卡點數不在已確認的獎項' || error.message === '邀請加碼次數尚未成立')
  }
  assert(rejected, `刮卡金額 ${delta} 不能入帳`)
}

let couponClosed = false
try {
  post(first.state, 10, DAY_1, USER_A, 'coupon_exchange', 'coupon_exchange:1')
} catch (error) {
  couponClosed = error instanceof Error && error.message === REWARD_ERRORS.closedKind
}
assert(couponClosed, '優惠券兌換仍未開放入帳')

let unknown = false
try {
  post(first.state, 10, DAY_1, USER_A, 'invite', 'invite:1')
} catch (error) {
  unknown = error instanceof Error && error.message === REWARD_ERRORS.unknownKind
}
assert(unknown, '邀請不是點數來源')

let external = false
try {
  applyRewardClaimSpec(
    first.state,
    { userId: USER_A, kind: 'checkin', claimKey: checkinClaimKey(DAY_1), delta: 10, internal: false },
    DAY_1,
  )
} catch (error) {
  external = error instanceof Error && error.message === REWARD_ERRORS.internalOnly
}
assert(external, '沒有內部旗標不能發獎')

const secondDay = post(first.state, 50, DAY_2)
assert(secondDay.result.currentBalance === 60 && secondDay.state.entries.length === 2, '規格模型尚未核對連續天數，隔日仍可直接入帳 50')
assert(
  secondDay.state.entries.some((entry) => entry.taipeiDay === DAY_2 && entry.delta === 50),
  '隔日那一筆就是傳入的 50，不是另外再加 Day 7',
)

const other = post(first.state, 10, DAY_1, USER_B)
assert(other.result.currentBalance === 10 && first.state.accounts[USER_A] === 10, '另一位會員的簽到不改到原本餘額')

let short = false
try {
  assertPointBalanceCovers(5, -6)
} catch (error) {
  short = error instanceof Error && error.message === REWARD_ERRORS.insufficient
}
assert(short, '餘額不足必須拒絕')
assert(assertPointBalanceCovers(5, -5) === 0, '扣到 0 仍是合法餘額')
let fraction = false
try {
  assertPointBalanceCovers(5, 1.5)
} catch (error) {
  fraction = error instanceof Error && error.message === REWARD_ERRORS.integer
}
assert(fraction, '點數必須是整數')

const seeded: LedgerState = {
  ...emptyLedger(),
  accounts: { [USER_A]: 10 },
  entries: [{ userId: USER_A, kind: 'checkin', claimKey: 'checkin:2026-10-22', delta: 10, balanceAfter: 10, taipeiDay: DAY_1 }],
  claims: [{ userId: USER_A, kind: 'checkin', claimKey: 'checkin:1999-01-01', delta: 10, balanceAfter: 10, taipeiDay: DAY_1 }],
}
let sameDay = false
try {
  post(seeded, 10, DAY_1)
} catch (error) {
  sameDay = error instanceof Error && error.message === REWARD_ERRORS.sameDay
}
assert(sameDay, '同一台北日的另一個簽到鍵也必須拒絕')

let badVisitor = false
try {
  linkVisitorSpec(emptyLedger(), USER_A, 'ABC')
} catch (error) {
  badVisitor = error instanceof Error && error.message === REWARD_ERRORS.visitorFormat
}
assert(badVisitor, '訪客編號必須是 32 碼小寫十六進位')

const linked = linkVisitorSpec(emptyLedger(), USER_A, VISITOR_A)
const linkedAgain = linkVisitorSpec(linked.state, USER_A, VISITOR_A)
assert(linked.result.replayed === false && linkedAgain.result.replayed && linkedAgain.state === linked.state, '同一組綁定是回放')
const secondDevice = linkVisitorSpec(linked.state, USER_A, VISITOR_B)
assert(secondDevice.state.links.length === 2, '第一批允許同一會員綁定多個裝置，綁定不發獎')
assert(secondDevice.state.accounts[USER_A] === undefined, '綁定訪客不能產生點數')
let taken = false
const linksBefore = secondDevice.state.links.length
try {
  linkVisitorSpec(secondDevice.state, USER_B, VISITOR_A)
} catch (error) {
  taken = error instanceof Error && error.message === REWARD_ERRORS.visitorTaken
}
assert(taken && secondDevice.state.links.length === linksBefore, '同一個訪客編號不能改綁到另一位會員')

const migrationPath = 'supabase/migrations/20261022153000_member_reward_ledger.sql'
const previewPath = 'supabase/manual/20261022153000_member_reward_ledger_preview.sql'
const migration = read(migrationPath)
const preview = read(previewPath)
const bodyOf = (sql: string) => {
  const start = sql.indexOf('-- reward-ledger-body-start\n')
  const end = sql.indexOf('-- reward-ledger-body-end\n')
  assert(start >= 0 && end > start, 'SQL 必須標出共用帳本本文')
  return sql.slice(start, end + '-- reward-ledger-body-end\n'.length)
}
assert(bodyOf(migration) === bodyOf(preview), '預演本文必須與正式 migration 相同')
assert(migration.trimEnd().endsWith('COMMIT;'), '正式 migration 以 COMMIT 結束')
assert(preview.trimEnd().endsWith('ROLLBACK;'), '預演必須以 ROLLBACK 結束')
assert(!preview.includes('\nCOMMIT;'), '預演不能提交')
assert(!migration.includes('ROLLBACK;'), '正式 migration 不能回復交易')

const sqlMessages = Object.entries(REWARD_ERRORS).filter(([key]) => key !== 'browser' && key !== 'integer')
for (const [key, message] of sqlMessages) {
  assert(migration.includes(message), `正式 SQL 缺少錯誤訊息 ${key}`)
}
for (const value of CHECKIN_POINT_VALUES) assert(migration.includes(String(value)), `正式 SQL 缺少簽到金額 ${value}`)
for (const vector of TAIPEI_DAY_VECTORS) {
  const stamp = vector.iso.replace('T', ' ').replace('.000Z', '+00')
  assert(migration.includes(stamp), `正式 SQL 缺少台北日向量 ${stamp}`)
  assert(migration.includes(`DATE '${vector.day}'`), `正式 SQL 缺少台北日結果 ${vector.day}`)
}
for (const kind of REWARD_KINDS) assert(migration.includes(`'${kind}'`), `正式 SQL 缺少獎勵來源 ${kind}`)
for (const name of Object.values(REWARD_RPC)) assert(migration.includes(name), `正式 SQL 缺少 ${name}`)

const sharedBody = bodyOf(migration)
const forbidden = [
  'checkout_enabled',
  'referral_visits',
  'referral_codes',
  'DROP TABLE',
  'TRUNCATE',
  'service_role_key',
  'FROM public.profiles',
  'UPDATE public.orders',
  'UPDATE public.products',
]
for (const word of forbidden) {
  assert(!sharedBody.includes(word), `帳本本文不應包含 ${word}`)
}
assert(!migration.includes('\nDROP TABLE') && !preview.includes('\nDROP TABLE'), '不能刪除既有資料表')
assert(!migration.includes('TRUNCATE') && !preview.includes('TRUNCATE'), '不能清空資料表')
assert(migration.includes('FROM service_role'), '必須撤銷 service_role 的直接寫入')
assert(migration.includes('FOR UPDATE'), '發獎必須鎖定帳戶')
assert(migration.includes('ON DELETE RESTRICT'), '刪除會員不能悄悄刪掉帳本')
assert(migration.includes('auth.users'), '會員必須對應 Supabase auth.users')
assert(!migration.includes('GRANT EXECUTE ON FUNCTION public.post_member_reward'), '不能把發獎函式授給 API')
assert(!sharedBody.includes('GRANT EXECUTE ON FUNCTION public.link_my_visitor'), '不能把訪客綁定授給任何 API 角色')
assert(
  sharedBody.includes('GRANT EXECUTE ON FUNCTION public.get_my_reward_account() TO authenticated'),
  '登入會員仍可讀取自己的帳戶',
)
assert(sharedBody.includes('PUBLIC 不應能綁定訪客'), '共用檢查必須拒絕 PUBLIC 執行訪客綁定')
assert(sharedBody.includes('登入會員暫時不能呼叫訪客綁定'), '共用檢查必須拒絕一般會員執行訪客綁定')
assert(sharedBody.includes('% 不應能執行訪客綁定'), '共用檢查必須涵蓋 anon 與 service_role')
assert(!sharedBody.includes('登入會員應能綁定自己的訪客編號'), '不能再要求一般會員可以綁定')
assert(!migration.includes('SET LOCAL ROLE'), '正式 migration 不能切換角色試呼叫')
const previewTail = preview.slice(preview.indexOf('-- reward-ledger-body-end\n'))
const roleSwitch = previewTail.indexOf('SET LOCAL ROLE authenticated;')
const memberCall = previewTail.indexOf("PERFORM public.link_my_visitor('")
assert(roleSwitch > 0 && memberCall > roleSwitch, '預演必須先切換到一般會員，再呼叫訪客綁定')
assert(
  previewTail.indexOf("PERFORM public.link_my_visitor('", memberCall + 1) === -1,
  '預演只能有一次訪客綁定呼叫，而且必須預期被拒絕',
)
assert(previewTail.includes('RESET ROLE;'), '預演在權限驗證後必須回到管理者角色，才能檢查沒有寫入')
assert(previewTail.includes('一般會員呼叫訪客綁定時沒有被拒絕'), '預演必須在一般會員仍能呼叫時失敗')
assert(previewTail.includes('被拒絕的訪客綁定不應寫入資料'), '預演必須確認被拒絕的呼叫沒有寫入')
assert(previewTail.includes('一般會員應仍能讀取自己的點數餘額'), '預演必須保留一般會員讀取自己的帳戶')
assert(!preview.includes('第一次訪客綁定沒有成功'), '預演不能把綁定成功當成通過')
assert(!preview.includes('跨帳號綁定沒有被拒絕'), '擁有者跨帳號呼叫不能代替權限驗證')

const foundation = read('lib/rewards/foundation.ts')
const taipei = read('lib/rewards/taipei-day.ts')
assert(
  !foundation.includes("from '@/lib/db'") &&
    !foundation.includes("from '@/lib/supabase'") &&
    !foundation.includes('drizzle-orm') &&
    !foundation.includes('@supabase/supabase-js'),
  '規格程式不能連線',
)
assert(!taipei.includes('Date.now') && !foundation.includes('Date.now'), '規格不能讀取裝置現在時間')
assert(!read('components/home/checkin-card.tsx').includes("lib/rewards"), '簽到卡片只顯示後端傳回的狀態')
assert(!read('components/home/scratch-card-panel.tsx').includes("lib/rewards"), '刮卡畫面不能接發獎帳本')

const market = read('components/open-marketplace.tsx')
assert(market.includes("from '@/lib/rewards/foundation'"), '市集應沿用既有七日獎勵')
assert(market.includes('claimMyDailyCheckin'), '市集應呼叫簽到入口')
assert(market.includes('fetchMyCheckinState'), '市集應讀取正式簽到狀態')
assert(!market.includes('post_member_reward'), '市集不能呼叫內部發獎')
assert(!market.includes('applyRewardClaimSpec'), '市集不能在瀏覽器入帳')
assert(!market.includes('const [points, setPoints] = useState(120)'), '不能再使用示範 120 點')
assert(!market.includes('streak: 2'), '不能再使用示範連續 2 天')
assert(!market.includes('新手註冊禮'), '不能再顯示示範註冊點數')
assert(!market.includes('setPoints((p) => p +'), '瀏覽器不能自行增加正式點數')
assert(!market.includes('setPoints((p) => p -'), '瀏覽器不能自行減少正式點數')
assert(!market.includes('setPoints((v) => v -'), '瀏覽器不能自行減少正式點數')
assert(!read('components/home/scratch-config.ts').includes('FOUNDER_DAILY_QUOTA'), '創始券每日 5 張上限不得恢復')

const perkUi = read('components/home/perks-catalog.tsx')
assert(perkUi.includes('PERK_CATALOG.map'), '畫面價格必須來自同一份道具目錄')
assert(!/cost:\s*\d+/.test(perkUi), '畫面元件不能再寫死點數價格')
const ORIGINAL_PERKS = PERK_CATALOG.filter((perk) => perk.since === 1)
assert(KNOWN_PERKS.length === PERK_CATALOG.length && ORIGINAL_PERKS.length === 15, '原有 15 件虛擬道具必須保留')
ORIGINAL_PERKS.forEach((perk, index) => {
  const known = KNOWN_PERKS[index]
  assert(known?.id === perk.id && known.category === perk.category && known.cost === perk.cost, `道具契約與目錄不一致：${perk.id}`)
})

console.log('reward ledger checks ok')
