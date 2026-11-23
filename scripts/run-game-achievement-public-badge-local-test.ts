/**
 * 第七階段第 9 批第 9 項：三款遊戲真實進度、成就解鎖、防重、展示權限與公開評價勳章。
 * 只連本機隔離庫 127.0.0.1:54322。整段一個交易，最後 ROLLBACK。
 * 活動與排行套用檔不在此重跑；方塊／商店街資料表若這份隔離快照還沒有，只在交易內載入既有檔，結束後還原。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { rankedSpec, replayRun, startRun, stepRun, type ChallengeRun } from '../lib/arcade/block-modes'
import { newSim, newStreet, serve, setOpen, snapshot as streetSnapshot, startJob, STREET_PRODUCTS, tick } from '../lib/arcade/street-rules'

const HOST = '127.0.0.1'
const PORT = 54322
const CONTAINER = 'supabase_db_hengjing-stage45-local'
const A = 'c1000000-0000-4000-8000-0000000000c1'
const B = 'c2000000-0000-4000-8000-0000000000c2'
const CLOCK = Date.parse('2026-11-08T12:00:00+08:00')

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const body = (file: string) => {
  const sql = readFileSync(file, 'utf8')
  const start = sql.indexOf('BEGIN;')
  const end = sql.lastIndexOf('COMMIT;')
  if (start < 0 || end < start) throw new Error(`${file} 沒有 BEGIN/COMMIT`)
  return sql.slice(start + 'BEGIN;'.length, end)
}

const password = execSync(`docker exec ${CONTAINER} printenv POSTGRES_PASSWORD`, { encoding: 'utf8' }).trim()
const db = new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })

const loaded: string[] = []
const passed: string[] = []
const pass = (name: string) => {
  passed.push(name)
  console.log(`  ✓ ${name}`)
}

type Achievement = { id: string; unlocked: boolean; progress: number; available: boolean; target: number }
type AchievementState = { achievements: Achievement[]; showcase: string | null; newlyUnlocked: string[]; catalogVersion: number }

const item = (state: AchievementState, id: string) => {
  const found = state.achievements.find((row) => row.id === id)
  assert(found, `成就狀態沒有 ${id}`)
  return found!
}

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function playRanked(runId: string, seed: number): ChallengeRun {
  const spec = rankedSpec(runId, seed)
  let run = startRun(spec)
  let guard = 0
  while (run.status === 'playing' && guard < 400) {
    guard += 1
    let moved = false
    for (let slot = 0; slot < 3 && !moved; slot += 1) {
      if (!run.game.tray[slot]) continue
      for (let p = 0; p < 64 && !moved; p += 1) {
        const step = stepRun(run, slot, Math.floor(p / 8), p % 8)
        if ('error' in step) continue
        run = step.run
        moved = true
      }
    }
    if (!moved) break
  }
  assert(run.status === 'ended' && run.game.over, `排行賽沒有下到結束（${run.status}/${run.game.moves} 步）`)
  const again = replayRun(spec, run.moves)
  assert(again && again.game.score === run.game.score && again.game.over, '本機重算與對局不一致')
  return run
}

function playFirstGuest() {
  let auto = { progress: newStreet(CLOCK), sim: newSim(newStreet(CLOCK)) }
  const fresh = streetSnapshot(auto)
  auto = setOpen(auto, true, CLOCK)
  const rand = seeded(11)
  for (let i = 0; i < 200_000 && auto.progress.stats.served < 1; i += 1) {
    auto = tick(auto, 100, rand, CLOCK).state
    for (const customer of auto.sim.customers) {
      if (customer.kind === 'guest' && customer.phase === 'wait') {
        const result = serve(auto, customer.id, CLOCK)
        if (result.ok) auto = result.state
      }
    }
    for (const product of STREET_PRODUCTS) {
      const result = startJob(auto, product.id)
      if (result.ok) auto = result.state
    }
  }
  assert(auto.progress.stats.served >= 1, '商店街沒有接待到第一位客人')
  return { fresh, saved: streetSnapshot(auto), elapsedSec: Math.max(1, auto.sim.t / 1000), served: auto.progress.stats.served }
}

async function hasRel(rel: string) {
  const row = await db.query('select to_regclass($1) is not null as ok', [rel])
  return row.rows[0].ok === true
}

async function apply(file: string) {
  await db.query(body(file))
  await db.query('RESET ROLE')
  loaded.push(file)
}

async function dbSnapshot() {
  const row = await db.query(`
    select
      (select count(*) from public.member_point_accounts)::int as accounts,
      (select coalesce(sum(balance), 0) from public.member_point_accounts)::int as balance,
      (select count(*) from public.member_point_entries)::int as entries,
      (select count(*) from public.member_merge_shops)::int as shops,
      (select count(*) from public.member_merge_shop_events)::int as merge_events,
      (select count(*) from public.game_achievement_catalog)::int as catalog,
      (select count(*) from public.member_game_achievements)::int as owned,
      (select count(*) from public.member_perk_holds)::int as perks,
      (select count(*) from public.member_perk_loadout)::int as loadouts,
      (select position('reward_cleanup' in prosrc) > 0 from pg_proc where oid = 'public.guard_game_achievement_write()'::regprocedure) as backdoor,
      (select position('game_badge' in pg_get_functiondef('public.list_public_reviews(uuid[])'::regprocedure)) > 0) as review_badge,
      (select to_regclass('public.block_ranked_runs') is not null) as block,
      (select to_regclass('public.member_street_saves') is not null) as street,
      (select to_regclass('public.game_live_events') is not null) as live
  `)
  return row.rows[0] as Record<string, number | boolean>
}

async function asUser(userId: string) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await db.query('SET LOCAL ROLE authenticated')
  const uid = await db.query('select auth.uid() as uid')
  assert(uid.rows[0].uid === userId, '隔離庫沒有把交易綁到指定會員')
}

async function asAnon() {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', '', true)`)
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })])
  await db.query('SET LOCAL ROLE anon')
  const uid = await db.query('select auth.uid() as uid')
  assert(uid.rows[0].uid == null, '匿名身分不該有會員編號')
}

async function expectFail(sql: string, pattern: RegExp, name: string) {
  await db.query('SAVEPOINT expect_fail')
  try {
    await db.query(sql)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.query('ROLLBACK TO SAVEPOINT expect_fail')
    assert(pattern.test(message), `${name}：得到「${message}」`)
    pass(name)
    return
  }
  await db.query('ROLLBACK TO SAVEPOINT expect_fail')
  throw new Error(`${name}：應該失敗卻成功`)
}

async function sync(): Promise<AchievementState> {
  const row = await db.query('select public.sync_my_game_achievements() as state')
  return row.rows[0].state as AchievementState
}

async function main() {
  assert(HOST === '127.0.0.1' && PORT === 54322, '拒絕連到隔離庫以外的資料庫')
  const dockerPort = execSync(`docker port ${CONTAINER} 5432`, { encoding: 'utf8' })
  assert(dockerPort.includes('54322'), '54322 不是 hengjing-stage45-local')
  await db.connect()
  const before = await dbSnapshot()
  console.log('套用前', before)
  await db.query('BEGIN')
  await db.query(`set statement_timeout = '180s'`)
  try {
    const backdoor = await db.query(`select position('reward_cleanup' in prosrc) > 0 as yes from pg_proc where oid = 'public.guard_game_achievement_write()'::regprocedure`)
    if (backdoor.rows[0].yes) await apply('supabase/manual/20261030030260_game_achievement_guard_fix.sql')
    else pass('守門函式已無刪除後門')
    if (!(await hasRel('public.member_street_friends'))) await apply('supabase/manual/20261029220200_street_friend_help_apply.sql')
    if (!(await hasRel('public.member_street_steals'))) await apply('supabase/manual/20261029230100_street_steal_explore_apply.sql')
    if (!(await hasRel('public.member_street_saves'))) await apply('supabase/manual/20261030010100_street_cloud_save_apply.sql')
    if (!(await hasRel('public.block_ranked_runs'))) await apply('supabase/manual/20261027010000_block_weekly_board_preview.sql')
    const v2Ready = await db.query(`select to_regprocedure('public.game_achievement_available(text)') is not null as ok`)
    const streetCatalog = await db.query(`select count(*)::int as n from public.game_achievement_catalog where game_id in ('dream_street', 'block_challenge')`)
    if (!v2Ready.rows[0].ok || streetCatalog.rows[0].n === 0) await apply('supabase/manual/20261030030300_game_achievements_v2_apply.sql')
    const reviewHasBadge = await db.query(`select position('game_badge' in pg_get_functiondef('public.list_public_reviews(uuid[])'::regprocedure)) > 0 as yes`)
    if (!reviewHasBadge.rows[0].yes) await apply('supabase/manual/20261030030900_game_achievement_public_badge.sql')
    else pass('公開評價已有遊戲勳章')

    await db.query('RESET ROLE')
    await db.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'achv-c1@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($2, 'achv-c2@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [A, B],
    )
    await db.query(
      `insert into public.profiles (id, public_nickname) values ($1, '成就甲'), ($2, '成就乙')
       on conflict (id) do update set public_nickname = excluded.public_nickname`,
      [A, B],
    )

    const perksBeforeUsers = await db.query('select count(*)::int as n from public.member_perk_holds')
    const pointsBeforeUsers = await db.query('select count(*)::int as n, coalesce(sum(balance),0)::int as balance from public.member_point_accounts')

    await asUser(A)
    await db.query(`select public.apply_my_merge_shop_action(gen_random_uuid()::text, 'start', '{}'::jsonb)`)
    await db.query(`select public.apply_my_merge_shop_action(gen_random_uuid()::text, 'serve', '{"orderId":"ord-0-0","cells":[0,1]}'::jsonb)`)
    let state = await sync()
    assert(state.catalogVersion === 2, '成就目錄版本不是 2')
    assert(item(state, 'merge_first_order').unlocked && item(state, 'merge_first_order').available, '完成第一張訂單沒有解鎖')
    assert(!item(state, 'street_first_guest').unlocked && item(state, 'street_first_guest').progress === 0, '還沒開店卻算出商店街進度')
    assert(!item(state, 'block_ranked_first').unlocked && item(state, 'block_ranked_first').progress === 0, '還沒打排行賽卻算出方塊進度')
    assert(!item(state, 'merge_level_six').unlocked, '一張訂單不該升到六級')
    pass('合成小舖真實完成一單後解鎖，商店街與方塊仍未達成')
    const again = await sync()
    assert(again.newlyUnlocked.length === 0, '重複同步又解鎖了成就')
    pass('重複同步不新增成就')

    const street = playFirstGuest()
    await asUser(A)
    const imported = await db.query('select public.import_my_street_save($1::jsonb, gen_random_uuid()) as r', [JSON.stringify(street.fresh)])
    assert(imported.rows[0].r.ok === true, `新店轉移失敗：${JSON.stringify(imported.rows[0].r)}`)
    await db.query('RESET ROLE')
    await db.query(`update public.member_street_saves set updated_at = updated_at - make_interval(secs => $1) where user_id = $2`, [street.elapsedSec, A])
    await asUser(A)
    const saved = await db.query('select public.save_my_street(1, $1::jsonb, gen_random_uuid()) as r', [JSON.stringify(street.saved)])
    assert(saved.rows[0].r.ok === true, `真實存檔被拒：${saved.rows[0].r.reason ?? JSON.stringify(saved.rows[0].r)}`)
    const requestKey = 'c3000000-0000-4000-8000-0000000000c3'
    await db.query('RESET ROLE')
    const revision = await db.query('select revision, (progress #>> \'{stats,served}\')::int as served from public.member_street_saves where user_id = $1', [A])
    assert(revision.rows[0].served >= 1, '資料庫存檔沒有接待人數')
    await db.query(`update public.member_street_saves set updated_at = updated_at - interval '30 seconds' where user_id = $1`, [A])
    await asUser(A)
    const replaySave = await db.query('select public.save_my_street($1, $2::jsonb, $3::uuid) as r', [revision.rows[0].revision, JSON.stringify(street.saved), requestKey])
    assert(replaySave.rows[0].r.ok === true, `同內容再存一次失敗：${replaySave.rows[0].r.reason}`)
    const forged = { ...street.saved, stats: { ...street.saved.stats, served: 99999, itemsSold: 99999, earned: 999999 } }
    await db.query('RESET ROLE')
    await db.query(`update public.member_street_saves set updated_at = updated_at - interval '1 second' where user_id = $1`, [A])
    await asUser(A)
    const forgedSave = await db.query('select public.save_my_street($1, $2::jsonb, gen_random_uuid()) as r', [replaySave.rows[0].r.revision, JSON.stringify(forged)])
    assert(forgedSave.rows[0].r.ok !== true, '偽造大量接待人數被接受')
    await db.query('RESET ROLE')
    const readBack = await db.query('select revision, (progress #>> \'{stats,served}\')::int as served from public.member_street_saves where user_id = $1', [A])
    assert(readBack.rows[0].served === revision.rows[0].served, '偽造存檔改變了已讀回的接待人數')
    await asUser(A)
    const sameKey = await db.query('select public.save_my_street($1, $2::jsonb, $3::uuid) as r', [readBack.rows[0].revision, JSON.stringify(forged), requestKey])
    assert(sameKey.rows[0].r.ok === true && sameKey.rows[0].r.replay === true, '同一請求鍵沒有當成重送')
    state = await sync()
    assert(item(state, 'street_first_guest').unlocked, '接待第一位客人沒有解鎖')
    assert(!item(state, 'street_famous').unlocked && item(state, 'street_famous').progress === readBack.rows[0].served, '成就進度沒有跟著資料庫存檔')
    assert(item(state, 'street_famous').progress < 500, '偽造人數滲進成就')
    pass('商店街真實存檔解鎖第一位客人，偽造與重複請求不改進度')

    await asUser(A)
    const opened = await db.query('select public.start_block_ranked_run() as r')
    const runId = opened.rows[0].r.runId as string
    const seed = opened.rows[0].r.seed as number
    const played = playRanked(runId, seed)
    await db.query('RESET ROLE')
    await db.query(
      `update public.block_ranked_runs set started_at = now() - ($1::int * interval '250 milliseconds' + interval '2 seconds') where id = $2`,
      [played.moves.length, runId],
    )
    await asUser(A)
    const submitted = await db.query('select public.submit_block_ranked_run($1::uuid, $2::jsonb) as r', [runId, JSON.stringify(played.moves)])
    assert(submitted.rows[0].r.status === 'verified', `合法對局沒有驗證通過：${JSON.stringify(submitted.rows[0].r)}`)
    await db.query('RESET ROLE')
    const stored = await db.query('select status, score, moves, move_log from public.block_ranked_runs where id = $1', [runId])
    assert(stored.rows[0].status === 'verified' && stored.rows[0].score === played.game.score && stored.rows[0].moves === played.moves.length, '讀回的成績與對局不同')
    await asUser(A)
    const duplicate = await db.query('select public.submit_block_ranked_run($1::uuid, $2::jsonb) as r', [runId, JSON.stringify(played.moves)])
    assert(duplicate.rows[0].r.status === 'duplicate', '重複提交沒有被擋下')
    state = await sync()
    assert(item(state, 'block_ranked_first').unlocked, '驗證過的排行賽沒有解鎖')
    assert(item(state, 'block_ranked_ten').unlocked === false && item(state, 'block_ranked_ten').progress === 1, '一場排行賽被算成十場')
    const high = item(state, 'block_score_8k')
    assert(high.unlocked === (played.game.score >= 8000) && high.progress === Math.min(played.game.score, 8000), '高分成就與實際分數不符')
    assert(!item(state, 'block_score_3k').unlocked || played.game.score >= 3000, '未達三千分卻解鎖')
    pass(`方塊排行賽驗證通過（${played.game.score} 分／${played.moves.length} 步），重複提交不重複計算`)

    await asUser(B)
    const other = await sync()
    assert(!item(other, 'merge_first_order').unlocked && item(other, 'merge_first_order').progress === 0, '另一位會員看到合成進度')
    assert(!item(other, 'street_first_guest').unlocked && item(other, 'street_first_guest').progress === 0, '另一位會員看到商店街進度')
    assert(!item(other, 'block_ranked_first').unlocked && item(other, 'block_ranked_first').progress === 0, '另一位會員看到方塊進度')
    pass('兩位會員的成就進度彼此隔離')

    await asUser(B)
    const openedB = await db.query('select public.start_block_ranked_run() as r')
    const playedB = playRanked(openedB.rows[0].r.runId, openedB.rows[0].r.seed)
    await db.query('RESET ROLE')
    await db.query(
      `update public.block_ranked_runs set started_at = now() - ($1::int * interval '250 milliseconds' + interval '2 seconds') where id = $2`,
      [playedB.moves.length, openedB.rows[0].r.runId],
    )
    await asUser(B)
    const submittedB = await db.query('select public.submit_block_ranked_run($1::uuid, $2::jsonb) as r', [openedB.rows[0].r.runId, JSON.stringify(playedB.moves)])
    assert(submittedB.rows[0].r.status === 'verified', '第二位會員的合法對局沒有驗證通過')
    const otherUnlocked = await sync()
    assert(item(otherUnlocked, 'block_ranked_first').unlocked, '第二位會員自己的排行賽沒有解鎖')
    await db.query('RESET ROLE')
    const counts = await db.query(
      `select user_id, count(*) filter (where status = 'verified')::int as n from public.block_ranked_runs where user_id = any($1::uuid[]) group by user_id`,
      [[A, B]],
    )
    const countOf = (id: string) => counts.rows.find((row) => row.user_id === id)?.n ?? 0
    assert(countOf(A) === 1 && countOf(B) === 1, '排行賽場次沒有按會員分開')
    pass('兩位會員各自一場驗證對局，互不累加')

    await asUser(B)
    await expectFail(`select public.set_my_game_badge('merge_first_order')`, /尚未解鎖這個成就/, '不能展示自己沒有的成就')
    await expectFail(
      `insert into public.member_game_achievements (user_id, achievement_id, metric_value) values ('${A}', 'street_famous', 999)`,
      /permission denied|遊戲成就只能由同步交易更新/,
      '會員不能直接寫入成就',
    )
    await db.query('RESET ROLE')
    await db.query(`select set_config('game.reward_cleanup', 'on', true)`)
    await expectFail(`delete from public.member_game_achievements where user_id = '${A}'`, /已解鎖的成就不可修改或刪除|遊戲成就只能由同步交易更新/, '刪除後門不能清掉已解鎖成就')
    await db.query(`select set_config('game.reward_cleanup', 'off', true)`)
    const stillOwned = await db.query('select count(*)::int as n from public.member_game_achievements where user_id = $1 and achievement_id = $2', [A, 'merge_first_order'])
    assert(stillOwned.rows[0].n === 1, '成就持有被刪掉或重複')
    pass('成就持有只能由同步寫入，不能改、不能刪、不能重複')

    await asUser(A)
    const shown = await db.query(`select public.set_my_game_badge('merge_first_order') as state`)
    assert(shown.rows[0].state.showcase === 'merge_first_order', '已解鎖的成就不能設為展示勳章')
    await asUser(B)
    const shownB = await db.query(`select public.set_my_game_badge('block_ranked_first') as state`)
    assert(shownB.rows[0].state.showcase === 'block_ranked_first', '第二位會員不能展示自己的成就')
    await db.query('RESET ROLE')
    const showcaseRows = await db.query('select user_id, achievement_id from public.member_game_showcase where user_id = any($1::uuid[])', [[A, B]])
    assert(showcaseRows.rows.find((row) => row.user_id === A)?.achievement_id === 'merge_first_order', '甲的展示勳章被改掉')
    assert(showcaseRows.rows.find((row) => row.user_id === B)?.achievement_id === 'block_ranked_first', '乙的展示勳章不對')
    pass('展示勳章只屬於自己已解鎖的成就')

    await db.query('RESET ROLE')
    await db.query(`insert into public.seller_applications (user_id, store_name, status) values ($1, '成就測試店', 'approved')`, [A])
    await asUser(A)
    const product = await db.query(`insert into public.products (name, price, active, draft, flagged, review_hold) values ('成就展示測試商品', 100, true, false, false, false) returning id`)
    const productId = product.rows[0].id as string
    await db.query('RESET ROLE')
    await db.query(
      `insert into public.product_reviews (user_id, product_id, order_item_id, rating, body) values
        ($1, $3, gen_random_uuid(), 5, '甲的評價'),
        ($2, $3, gen_random_uuid(), 4, '乙的評價')`,
      [A, B, productId],
    )
    await asAnon()
        const badges = await db.query('select public.public_game_badges($1::uuid[]) as rows', [[A, B]])
        const badgeOf = (id: string) => (badges.rows[0].rows as Array<{ userId: string; badge: string | null }>).find((row) => row.userId === id)
        assert(badgeOf(A)?.badge === 'merge_first_order', '匿名看不到甲的展示勳章')
        assert(badgeOf(B)?.badge === 'block_ranked_first', '匿名看不到乙的展示勳章')
        const reviews = await db.query('select public.list_public_reviews($1::uuid[]) as rows', [[productId]])
        const list = reviews.rows[0].rows as Array<Record<string, unknown>>
        assert(list.length === 2, '公開評價數量不對')
        assert(list.every((row) => !('user_id' in row) && !('userId' in row)), '公開評價回傳了會員編號')
        const reviewA = list.find((row) => row.body === '甲的評價')
        const reviewB = list.find((row) => row.body === '乙的評價')
        assert(reviewA?.game_badge === 'merge_first_order' && reviewA.nickname === '成就甲', '甲的評價沒有自己的勳章或暱稱')
        assert(reviewB?.game_badge === 'block_ranked_first', '乙的評價沒有自己的勳章')
        assert(reviewA?.equipped && typeof reviewA.equipped === 'object', '評價仍要保留頭銜裝備欄位')
    pass('匿名公開頁只看到本人選擇的勳章，看不到會員編號')

    await db.query('RESET ROLE')
    const perksAfter = await db.query('select count(*)::int as n from public.member_perk_holds')
    const pointsAfter = await db.query('select count(*)::int as n, coalesce(sum(balance),0)::int as balance from public.member_point_accounts')
    const loadoutsAfter = await db.query('select count(*)::int as n from public.member_perk_loadout')
    assert(perksAfter.rows[0].n === perksBeforeUsers.rows[0].n, '成就流程新增了收藏或頭銜持有')
    assert(pointsAfter.rows[0].n === pointsBeforeUsers.rows[0].n && pointsAfter.rows[0].balance === pointsBeforeUsers.rows[0].balance, '成就流程改動了點數')
    assert(loadoutsAfter.rows[0].n === before.loadouts, '成就流程改動了頭銜裝備')
    const defs = await db.query(`
      select pg_get_functiondef('public.sync_my_game_achievements()'::regprocedure) as sync,
             pg_get_functiondef('public.list_public_reviews(uuid[])'::regprocedure) as reviews
    `)
    assert(!/post_member_reward|member_point/.test(defs.rows[0].sync + defs.rows[0].reviews), '成就或公開評價碰到點數發放')
    pass('沒有新增點數、Pay 發放、收藏或頭銜持有')

    await db.query('ROLLBACK')
    await db.query('RESET ROLE')
    const after = await dbSnapshot()
    assert(JSON.stringify(after) === JSON.stringify(before), `交易沒有還原：${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
    pass('隔離庫已還原')
    console.log(`通過 ${passed.length} 項。交易內載入：${loaded.join('、') || '無'}`)
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
