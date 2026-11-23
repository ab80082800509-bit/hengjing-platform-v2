/**
 * 第六階段第二～四批：對本機隔離 Supabase（127.0.0.1:54322）驗證共用遊戲獎勵、成就與點數商城讀取。
 * 只使用兩個專用測試會員。不連正式專案，不改第四階段點數流水。
 * 「fixture」標記的資料是以資料庫擁有者身分補上的合成紀錄，用來模擬長時間遊玩，會員本身無法寫入。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { parseGameRewardState } from '../lib/arcade/game-reward-snapshot'
import { parseAchievementState } from '../lib/arcade/achievement-snapshot'
import { parsePointsMall } from '../lib/arcade/points-mall-snapshot'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const HOST = '127.0.0.1'
const PORT = 54322
const USER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccc61'
const USER_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccc62'
const USERS = [USER_A, USER_B]
let keySeq = Date.now() % 100000000
const nextKey = () => `dddddddd-dddd-4ddd-8ddd-${String(++keySeq).padStart(12, '0')}`

const password = execSync('docker exec supabase_db_hengjing-stage45-local printenv POSTGRES_PASSWORD', { encoding: 'utf8' }).trim()
const connect = () => new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })
const admin = connect()
const c1 = connect()
const c2 = connect()
const c3 = connect()

const results: string[] = []
const pass = (name: string) => {
  results.push(`通過：${name}`)
  console.log(`  ✓ ${name}`)
}

async function ledgerSnapshot(db: pg.Client) {
  const row = await db.query(`
    select
      (select count(*) from public.member_point_entries)::int as entries,
      (select coalesce(sum(balance), 0) from public.member_point_accounts)::int as balance,
      (select count(*) from public.reward_claims)::int as claims,
      (select count(*) from public.scratch_plays)::int as scratch,
      (select count(*) from public.member_perk_holds)::int as perks,
      (select count(*) from public.member_coupon_holds)::int as coupons,
      md5(pg_get_functiondef('public.post_member_reward(uuid, text, text, integer, jsonb)'::regprocedure)) as post_def
  `)
  return row.rows[0] as Record<string, number | string>
}

async function asUser(db: pg.Client, userId: string) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId])
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await db.query('SET ROLE authenticated')
  const uid = await db.query('select auth.uid() as uid')
  assert(uid.rows[0].uid === userId, '隔離庫沒有把交易綁到指定會員')
}

async function asAnon(db: pg.Client) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'anon' })])
  await db.query('SET ROLE anon')
}

async function expectError(promise: Promise<unknown>, pattern: RegExp, name: string) {
  try {
    await promise
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    assert(pattern.test(message), `${name}：錯誤訊息不符，得到「${message}」`)
    pass(name)
    return
  }
  throw new Error(`${name}：應該失敗卻成功`)
}

async function rewards(db: pg.Client) {
  const state = parseGameRewardState((await db.query('select public.get_my_game_rewards() as data')).rows[0].data)
  assert(state, '獎勵狀態無法解析')
  return state!
}

async function claim(db: pg.Client, taskId: string) {
  const state = parseGameRewardState((await db.query('select public.claim_my_game_reward($1) as data', [taskId])).rows[0].data)
  assert(state && state.claim, '領取結果無法解析')
  return state!
}

const task = (state: NonNullable<ReturnType<typeof parseGameRewardState>>, id: string) => {
  const found = state.tasks.find((item) => item.id === id)
  assert(found, `找不到任務 ${id}`)
  return found!
}

async function act(db: pg.Client, type: string, payload: Record<string, unknown>) {
  await db.query('select public.apply_my_merge_shop_action($1, $2, $3::jsonb)', [nextKey(), type, JSON.stringify(payload)])
}

/** 用會員身分照規格玩一輪：3 張訂單、1 次合成、1 次寶箱。 */
async function playOpening(db: pg.Client) {
  await act(db, 'start', {})
  await act(db, 'serve', { orderId: 'ord-0-0', cells: [0, 1] })
  await act(db, 'spawn', { to: 0 })
  await act(db, 'merge', { from: 0, to: 2 })
  await act(db, 'serve', { orderId: 'ord-0-1', cells: [2] })
  await act(db, 'spawn', { to: 0 })
  await act(db, 'spawn', { to: 1 })
  await act(db, 'serve', { orderId: 'ord-1-2', cells: [0, 1] })
  await act(db, 'claim_quest', {})
}

async function fixtureEvents(userId: string, type: string, count: number) {
  await admin.query('RESET ROLE')
  await admin.query(`select set_config('merge.internal', 'on', false)`)
  for (let i = 0; i < count; i += 1) {
    await admin.query(
      `insert into public.member_merge_shop_events (user_id, action_key, action_type, revision_after, result)
       values ($1, $2, $3, 0, '{"fixture":true}'::jsonb)`,
      [userId, nextKey(), type],
    )
  }
  await admin.query(`select set_config('merge.internal', 'off', false)`)
}

async function setPolicy(fields: { daily_cap?: number; weekly_quest?: number; weekly_cap?: number }) {
  await admin.query('RESET ROLE')
  const current = (await admin.query('select daily_cap, weekly_quest, weekly_cap from public.game_reward_policies where id = $1', ['stage6'])).rows[0]
  await admin.query(
    'update public.game_reward_policies set daily_cap = $1, weekly_quest = $2, weekly_cap = $3, updated_at = now() where id = $4',
    [fields.daily_cap ?? current.daily_cap, fields.weekly_quest ?? current.weekly_quest, fields.weekly_cap ?? current.weekly_cap, 'stage6'],
  )
}

async function ensureUser(id: string, email: string) {
  await admin.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', '{}'::jsonb, '{}'::jsonb, now(), now())
     on conflict (id) do nothing`,
    [id, email],
  )
}

async function cleanup() {
  await admin.query('RESET ROLE')
  await admin.query(`select set_config('game.reward_cleanup', 'on', false)`)
  await admin.query(`select set_config('game.achievement', 'on', false)`)
  await admin.query('delete from public.member_game_reward_claims where user_id = any($1::uuid[])', [USERS])
  await admin.query('delete from public.member_game_showcase where user_id = any($1::uuid[])', [USERS])
  await admin.query('delete from public.member_game_achievements where user_id = any($1::uuid[])', [USERS])
  await admin.query(`select set_config('game.reward_cleanup', 'off', false)`)
  await admin.query(`select set_config('game.achievement', 'off', false)`)
  await admin.query(`select set_config('merge.internal', 'on', false)`)
  await admin.query('delete from public.member_merge_shop_events where user_id = any($1::uuid[])', [USERS])
  await admin.query('delete from public.member_merge_shops where user_id = any($1::uuid[])', [USERS])
  await admin.query(`select set_config('merge.internal', 'off', false)`)
}

async function main() {
  assert(HOST === '127.0.0.1' && PORT === 54322, '拒絕連到隔離庫以外的資料庫')
  const dockerPort = execSync('docker port supabase_db_hengjing-stage45-local 5432', { encoding: 'utf8' })
  assert(dockerPort.includes('54322'), '54322 不是 hengjing-stage45-local')
  for (const db of [admin, c1, c2, c3]) await db.connect()

  const sql = readFileSync(resolve(process.cwd(), 'supabase/manual/20261026160000_stage6_rewards_achievements_preview.sql'), 'utf8')
  await admin.query(sql)
  pass('預覽 SQL 可重複套用（冪等）')

  await setPolicy({ daily_cap: 10, weekly_quest: 10, weekly_cap: 80 })
  await ensureUser(USER_A, 'stage6-reward-a@example.test')
  await ensureUser(USER_B, 'stage6-reward-b@example.test')
  await cleanup()
  const before = await ledgerSnapshot(admin)

  console.log('第二批：共用遊戲獎勵')
  await asAnon(c1)
  const rules = parseGameRewardState((await c1.query('select public.get_game_reward_rules() as data')).rows[0].data)
  assert(rules && !rules.signedIn && rules.payoutEnabled === false && rules.dailyCap === 10 && rules.weeklyCap === 80, '訪客規則讀取不正確')
  assert(rules!.tasks.find((t) => t.id === 'block_daily_clear')?.status === 'locked', '方塊大挑戰應為尚未開放')
  pass('訪客可讀規則，未開放遊戲顯示 locked，payoutEnabled=false')
  await expectError(c1.query('select public.get_my_game_rewards()'), /permission denied/, '訪客不能讀取會員獎勵')
  await expectError(c1.query(`select public.claim_my_game_reward('merge_daily_orders')`), /permission denied/, '訪客不能領取')

  await asUser(c1, USER_A)
  let a = await rewards(c1)
  assert(a.signedIn && a.dailyUsed === 0 && a.weeklyUsed === 0 && a.issuedPayPoints === 0, '新會員額度應為 0')
  assert(task(a, 'merge_daily_orders').status === 'in_progress', '尚未遊玩時應為進行中')
  await expectError(c1.query(`select public.claim_my_game_reward('merge_daily_orders')`), /任務還沒完成/, '未完成任務不能領取')
  await expectError(c1.query(`select public.claim_my_game_reward('block_daily_clear')`), /尚未開放/, '未開放遊戲不能領取')
  await expectError(c1.query(`select public.claim_my_game_reward('no_such_task')`), /找不到/, '不存在的任務不能領取')
  await expectError(c1.query(`select public.claim_my_game_reward('x; drop')`), /找不到/, '格式錯誤的任務編號被拒絕')

  await playOpening(c1)
  a = await rewards(c1)
  assert(task(a, 'merge_daily_orders').status === 'claimable' && task(a, 'merge_daily_orders').progress === 3, '3 張訂單後應可領取')
  assert(task(a, 'merge_daily_chest').status === 'claimable', '開過寶箱後應可領取')
  assert(task(a, 'merge_daily_merges').status === 'in_progress' && task(a, 'merge_daily_merges').progress === 1, '合成進度應為 1')
  pass('任務進度只由合成交易紀錄計算')

  a = await claim(c1, 'merge_daily_orders')
  assert(a.claim!.awardedPoints === 4 && !a.claim!.replayed && a.dailyUsed === 4, '訂單任務應記 4 點')
  a = await claim(c1, 'merge_daily_orders')
  assert(a.claim!.replayed && a.claim!.awardedPoints === 4 && a.dailyUsed === 4, '重送應回放，不重複累計')
  pass('重複領取回放同一筆紀錄（冪等）')
  a = await claim(c1, 'merge_daily_chest')
  assert(a.claim!.awardedPoints === 3 && a.dailyUsed === 7, '寶箱任務應記 3 點')
  await fixtureEvents(USER_A, 'merge', 9)
  a = await claim(c1, 'merge_daily_merges')
  assert(a.claim!.awardedPoints === 3 && a.dailyUsed === 10, '合成任務應記 3 點，今日達 10')
  assert(task(a, 'merge_weekly_orders').status === 'in_progress', '每週任務仍在進行')
  pass('每日三項合計剛好 10 點')

  await fixtureEvents(USER_A, 'serve', 17)
  a = await rewards(c1)
  assert(task(a, 'merge_weekly_orders').status === 'claimable' && task(a, 'merge_weekly_orders').progress === 20, '每週 20 張訂單應可領取')
  a = await claim(c1, 'merge_weekly_orders')
  assert(a.claim!.awardedPoints === 10 && a.weeklyQuestUsed === 10 && a.weeklyUsed === 20 && a.dailyUsed === 10, '每週任務 10 點不佔每日上限')
  pass('每週額外任務 10 點，週累計 20')

  console.log('上限、設定與並發')
  await asUser(c2, USER_B)
  await asUser(c3, USER_B)
  await asUser(c1, USER_B)
  await playOpening(c1)
  let b = await rewards(c1)
  assert(b.dailyUsed === 0 && b.weeklyUsed === 0, 'B 不應看到 A 的額度')
  pass('A、B 會員額度互相隔離')

  await setPolicy({ daily_cap: 5 })
  const raced = await Promise.allSettled([
    c1.query(`select public.claim_my_game_reward('merge_daily_orders') as data`),
    c2.query(`select public.claim_my_game_reward('merge_daily_orders') as data`),
    c3.query(`select public.claim_my_game_reward('merge_daily_chest') as data`),
  ])
  assert(raced.every((item) => item.status === 'fulfilled'), `並發領取不應出錯：${JSON.stringify(raced.map((r) => r.status === 'rejected' ? String(r.reason) : 'ok'))}`)
  const counts = await admin.query(
    'select count(*)::int as n, coalesce(sum(awarded_points), 0)::int as total from public.member_game_reward_claims where user_id = $1',
    [USER_B],
  )
  assert(counts.rows[0].n === 2 && counts.rows[0].total === 5, `並發後應剛好 2 筆合計 5 點，得到 ${JSON.stringify(counts.rows[0])}`)
  pass('同一任務並發只成立一筆，不同遊戲任務並發也不超過共用每日上限')

  b = await rewards(c1)
  assert(task(b, 'merge_daily_merges').status === 'capped', '達上限後應顯示 capped')
  await fixtureEvents(USER_B, 'merge', 9)
  await expectError(c1.query(`select public.claim_my_game_reward('merge_daily_merges')`), /已達上限/, '達每日上限後不能再領')
  await setPolicy({ daily_cap: 10 })
  b = await claim(c1, 'merge_daily_merges')
  assert(b.claim!.awardedPoints === 3 && b.dailyUsed === 8, '調回上限後可依新規則領取')
  pass('每日上限可由資料庫設定調整，不寫死')

  await fixtureEvents(USER_B, 'serve', 17)
  await setPolicy({ weekly_cap: 12 })
  b = await claim(c1, 'merge_weekly_orders')
  assert(b.claim!.awardedPoints === 4 && b.weeklyUsed === 12, `每週總上限應裁切為 4，得到 ${b.claim!.awardedPoints}`)
  await setPolicy({ weekly_cap: 80 })
  pass('每週總上限裁切正確')

  console.log('權限與防作弊')
  await expectError(
    c1.query(`insert into public.member_game_reward_claims (user_id, task_id, game_id, period, period_key, taipei_day, week_start, claim_key, task_points, awarded_points, metric_value)
      values ($1, 'merge_daily_orders', 'merge_shop', 'daily', current_date, current_date, current_date, 'game_reward:merge_daily_orders:2099-01-01', 4, 4, 3)`, [USER_B]),
    /permission denied/,
    '會員不能直接寫入領取紀錄',
  )
  await expectError(c1.query(`update public.game_reward_policies set daily_cap = 999`), /permission denied/, '會員不能修改獎勵規則')
  await expectError(c1.query(`update public.game_reward_tasks set points = 100`), /permission denied/, '會員不能修改任務點數')
  await expectError(c1.query(`select public.game_reward_state_json($1)`, [USER_A]), /permission denied/, '會員不能讀取他人獎勵狀態')
  await expectError(
    c1.query(`insert into public.member_merge_shop_events (user_id, action_key, action_type, revision_after, result) values ($1, $2, 'serve', 0, '{}')`, [USER_B, nextKey()]),
    /permission denied/,
    '會員不能偽造遊戲紀錄來刷任務',
  )
  await admin.query('RESET ROLE')
  await expectError(admin.query(`update public.game_reward_policies set payout_enabled = true where id = 'stage6'`), /game_reward_payout_closed/, 'payout_enabled 無法被打開')
  await expectError(admin.query(`update public.member_game_reward_claims set awarded_points = 99`), /不可修改/, '領取紀錄建立後不可竄改')
  const leaked = await admin.query(`select count(*)::int as n from public.member_game_reward_claims where payout_state <> 'withheld' or point_entry_id is not null`)
  assert(leaked.rows[0].n === 0, '所有遊戲獎勵都應為 withheld')
  pass('所有遊戲獎勵紀錄皆為 withheld，未連到點數流水')

  console.log('第三批：成就與展示')
  await asUser(c1, USER_A)
  await asUser(c2, USER_A)
  const syncRace = await Promise.all([
    c1.query('select public.sync_my_game_achievements() as data'),
    c2.query('select public.sync_my_game_achievements() as data'),
  ])
  const firstNew = syncRace.flatMap((row) => parseAchievementState(row.rows[0].data)?.newlyUnlocked ?? [])
  assert(firstNew.filter((id) => id === 'merge_first_order').length === 1, `並發同步只應解鎖一次，得到 ${JSON.stringify(firstNew)}`)
  let ach = parseAchievementState((await c1.query('select public.sync_my_game_achievements() as data')).rows[0].data)!
  assert(ach.newlyUnlocked.length === 0, '再次同步不應重複解鎖')
  assert(ach.achievements.find((item) => item.id === 'merge_first_order')?.unlocked, '首單成就應已解鎖')
  assert(!ach.achievements.find((item) => item.id === 'merge_famous')?.unlocked, '120 單成就不應解鎖')
  pass('成就依伺服器進度解鎖，並發同步不重複')
  await expectError(c1.query(`select public.set_my_game_badge('merge_famous')`), /尚未解鎖/, '不能展示未解鎖成就')
  ach = parseAchievementState((await c1.query(`select public.set_my_game_badge('merge_first_order') as data`)).rows[0].data)!
  assert(ach.showcase === 'merge_first_order', '展示勳章應更新')
  await asAnon(c3)
  const pub = (await c3.query('select public.public_game_badges($1::uuid[]) as data', [[USER_A, USER_B]])).rows[0].data as Array<{ userId: string; badge: string | null }>
  assert(pub.find((row) => row.userId === USER_A)?.badge === 'merge_first_order' && !pub.find((row) => row.userId === USER_B)?.badge, '公開勳章應同步')
  pass('展示勳章公開同步，B 未展示時不顯示')
  await expectError(
    c1.query(`insert into public.member_game_achievements (user_id, achievement_id, metric_value) values ($1, 'merge_codex_full', 15)`, [USER_A]),
    /permission denied/,
    '會員不能直接寫入成就',
  )
  ach = parseAchievementState((await c1.query(`select public.set_my_game_badge(null) as data`)).rows[0].data)!
  assert(ach.showcase === null, '卸下展示應清空')
  ach = parseAchievementState((await c1.query(`select public.set_my_game_badge('merge_first_order') as data`)).rows[0].data)!
  pass('成就裝備與卸下正常')

  console.log('第三批：點數商城')
  const mall = parsePointsMall((await c1.query('select public.get_my_points_mall() as data')).rows[0].data)
  assert(mall && mall.perkPurchaseEnabled === false && mall.benefitsOpen === false && mall.couponExchangeCost === 100, '點數商城總覽不正確')
  pass(`點數商城總覽可讀（虛擬特權兌換開關=${mall!.perkPurchaseEnabled}，可兌換券 ${mall!.coupons.length} 張）`)
  await expectError(c1.query(`select public.purchase_my_perk('badge-detail')`), /尚未開放/, '虛擬特權購買開關關閉時仍拒絕兌換')
  await expectError(c3.query('select public.get_my_points_mall()'), /permission denied/, '訪客不能讀取會員點數商城')

  const after = await ledgerSnapshot(admin)
  assert(JSON.stringify(before) === JSON.stringify(after), `第四階段帳本、刮刮卡、收藏或券包有變動：${JSON.stringify({ before, after })}`)
  pass('點數流水、餘額、領獎紀錄、刮刮卡、虛擬特權、券包與 post_member_reward 定義皆未變動')

  await setPolicy({ daily_cap: 10, weekly_quest: 10, weekly_cap: 80 })
  const policy = (await admin.query('select payout_enabled, daily_cap, weekly_quest, weekly_cap, approval from public.game_reward_policies')).rows[0]
  assert(policy.payout_enabled === false && policy.daily_cap === 10 && policy.weekly_cap === 80 && policy.approval === 'pending_approval', '規則應還原為規劃值')
  pass('規則還原為規劃值 10 / 10 / 80，payout_enabled=false')
  console.log(`\n共 ${results.length} 項通過`)
}

main()
  .catch((err) => {
    console.error('失敗：', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await setPolicy({ daily_cap: 10, weekly_quest: 10, weekly_cap: 80 })
    } catch {
      // 連線已中斷時不覆蓋原本的錯誤
    }
    for (const db of [admin, c1, c2, c3]) await db.end().catch(() => undefined)
  })
