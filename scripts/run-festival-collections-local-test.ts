/**
 * 第七階段第 9 批第 8 項：節慶活動窗口與三件限定收藏。
 * 只連隔離庫 127.0.0.1:54322。快照若還沒有商城 v2 或活動表，只在交易內載入既有檔，最後 ROLLBACK。
 * 時間用交易內的台北日曆覆蓋，不改系統時鐘、不開 Pay 發放、不改兌換開關。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { festivalPeriod, festivalWindows, LIVE_EVENTS } from '../lib/arcade/live-ops'
import { PERK_CATALOG } from '../lib/rewards/perk-catalog'

const HOST = '127.0.0.1'
const PORT = 54322
const CONTAINER = 'supabase_db_hengjing-stage45-local'
const A = 'f1000000-0000-4000-8000-0000000000f1'
const B = 'f2000000-0000-4000-8000-0000000000f2'

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
const passed: string[] = []
const pass = (name: string) => {
  passed.push(name)
  console.log(`  ✓ ${name}`)
}

async function apply(file: string) {
  await db.query(body(file))
  await db.query('RESET ROLE')
  console.log(`  交易內載入 ${file}`)
}

async function asUser(userId: string) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await db.query('SET LOCAL ROLE authenticated')
}

async function clock(at: string | null) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('app.festival_clock', $1, true)`, [at ?? ''])
}

async function expectFail(sql: string, params: unknown[], pattern: RegExp, name: string) {
  await db.query('SAVEPOINT expect_fail')
  try {
    await db.query(sql, params)
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

async function state(id: string) {
  const row = await db.query(
    `select item->>'state' as state from jsonb_array_elements(public.get_my_points_mall()->'perks') item where item->>'id' = $1`,
    [id],
  )
  return row.rows[0]?.state as string | undefined
}

async function balance() {
  const row = await db.query(`select (public.get_my_points_mall()->>'balance')::int as balance`)
  return Number(row.rows[0].balance)
}

async function snapshot() {
  const row = await db.query(`
    select
      (select count(*) from public.member_perk_catalog)::int as catalog,
      (select coalesce(sum(cost),0) from public.member_perk_catalog)::int as cost,
      (select purchase_enabled from public.member_perk_settings) as purchase,
      (select coalesce(bool_or(payout_enabled), false) from public.game_reward_policies) as payout,
      (select count(*) from public.member_point_accounts)::int as accounts,
      (select coalesce(sum(balance),0) from public.member_point_accounts)::int as balance,
      (select count(*) from public.member_point_entries)::int as entries,
      (select count(*) from public.member_perk_holds)::int as holds,
      (select to_regclass('public.member_perk_sale_windows') is not null) as sale_table,
      (select to_regclass('public.game_live_festival_windows') is not null) as event_table,
      (select case when to_regclass('public.member_perk_sale_windows') is null then -1 else (select count(*) from public.member_perk_sale_windows) end)::int as sale_windows,
      (select case when to_regclass('public.game_live_festival_windows') is null then -1 else (select count(*) from public.game_live_festival_windows) end)::int as festival_windows
  `)
  return row.rows[0]
}

async function main() {
  assert(HOST === '127.0.0.1' && PORT === 54322, '拒絕連到隔離庫以外的資料庫')
  const dockerPort = execSync(`docker port ${CONTAINER} 5432`, { encoding: 'utf8' })
  assert(dockerPort.includes('54322'), '54322 不是 hengjing-stage45-local')
  await db.connect()
  const before = await snapshot()
  console.log('套用前', before)
  assert(before.payout === false, '隔離庫的 Pay 遊戲點數發放不是關閉')
  await db.query('BEGIN')
  await db.query(`set statement_timeout = '180s'`)
  try {
    if (before.sale_table !== true) {
      const catalog = await db.query('select count(*)::int as n, coalesce(sum(cost),0)::int as cost from public.member_perk_catalog')
      assert(catalog.rows[0].n === 15 && catalog.rows[0].cost === 2180, '隔離庫目錄不是可載入商城 v2 的原 15 件')
      await apply('supabase/manual/20261030020100_points_mall_v2_apply.sql')
    }
    const events = await db.query(`select to_regclass('public.game_live_festival_windows') is not null as ok`)
    if (!events.rows[0].ok) await apply('supabase/manual/20261030030700_live_events_apply.sql')

    const listed = await db.query('select id, cost from public.member_perk_catalog order by id')
    const expected = [...PERK_CATALOG].sort((a, b) => a.id.localeCompare(b.id))
    assert(listed.rows.length === 40 && listed.rows.length === expected.length, `目錄不是 40 件（${listed.rows.length}）`)
    for (const perk of expected) {
      const row = listed.rows.find((item) => item.id === perk.id)
      assert(row && Number(row.cost) === perk.cost, `${perk.id} 的編號或價格變了`)
    }
    const windows = await db.query(`select count(*)::int as n from public.member_perk_sale_windows`)
    assert(windows.rows[0].n === 30 || windows.rows[0].n === 75, `限定販售期間不是原版 30 段或補完 75 段（${windows.rows[0].n}）`)
    const preserved = await db.query(`select perk_id, starts_on::text, ends_on::text from public.member_perk_sale_windows order by perk_id, starts_on`)
    await apply('supabase/manual/20261030031200_festival_date_gaps.sql')
    const extended = await db.query(`select count(*)::int as n from public.member_perk_sale_windows`)
    assert(extended.rows[0].n === 75, `補完後限定販售期間不是 75 段（${extended.rows[0].n}）`)
    const stillThere = await db.query(
      `select count(*)::int as n
       from unnest($1::text[], $2::text[], $3::text[]) as old(perk_id, starts_on, ends_on)
       join public.member_perk_sale_windows as w
         on w.perk_id = old.perk_id and w.starts_on::text = old.starts_on and w.ends_on::text = old.ends_on`,
      [preserved.rows.map((row) => row.perk_id), preserved.rows.map((row) => row.starts_on), preserved.rows.map((row) => row.ends_on)],
    )
    assert(stillThere.rows[0].n === preserved.rows.length, '補窗口時改動了既有販售期間')
    const purchase = await db.query('select purchase_enabled from public.member_perk_settings')
    assert(purchase.rows[0].purchase_enabled === true, '這次測試不改兌換開關，但隔離庫目前不是開放兌換')
    pass('40 件編號、價格保持原樣，既有販售期間仍在，並補到 2050')

    await db.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'festival-f1@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($2, 'festival-f2@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [A, B],
    )
    await db.query('set local session_replication_role = replica')
    for (const [userId, key] of [[A, 'scratch:festival-item8-a'], [B, 'scratch:festival-item8-b']] as const) {
      await db.query(
        `with seed as (
           insert into public.member_point_entries (user_id, delta, balance_after, kind, claim_key, taipei_day, metadata)
           values ($1, 500, 500, 'scratch', $2, public.taipei_today(), '{}'::jsonb)
           returning id, user_id, delta, balance_after, kind, claim_key, taipei_day
         )
         insert into public.reward_claims (user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata)
         select user_id, kind, claim_key, taipei_day, delta, balance_after, id, '{}'::jsonb from seed`,
        [userId, key],
      )
      await db.query('insert into public.member_point_accounts (user_id, balance) values ($1, 500)', [userId])
    }
    await db.query('set local session_replication_role = origin')
    await db.query(`
      CREATE OR REPLACE FUNCTION public.taipei_today(p_at timestamptz DEFAULT now())
      RETURNS date
      LANGUAGE sql
      STABLE
      SET search_path = pg_catalog
      AS $$
        SELECT (timezone('Asia/Taipei',
          CASE
            WHEN current_setting('app.festival_clock', true) IS NULL OR current_setting('app.festival_clock', true) = '' THEN p_at
            ELSE current_setting('app.festival_clock', true)::timestamptz
          END
        ))::date;
      $$;
    `)

    await clock('2026-12-01 12:00:00+08')
    await asUser(B)
    assert(await state('collect-snowman') === 'not_started', '未開賣沒有顯示尚未開始')
    assert(await state('collect-moon') === 'ended' || await state('collect-moon') === 'not_started', '中秋收藏在 12 月狀態異常')
    const moon = await state('collect-moon')
    assert(moon === 'not_started', `12 月的中秋收藏應是下一期尚未開始（${moon}）`)
    await expectFail(`select public.purchase_my_perk($1)`, ['collect-snowman'], /不在販售期間/, '未開賣不扣點、不發物品')
    assert(await balance() === 500, '未開賣失敗後餘額變了')

    await clock('2036-01-10 12:00:00+08')
    await asUser(B)
    assert(await state('collect-snowman') === 'not_started', '2035 年聖誕結束後、2036 年開賣前沒有顯示尚未開始')
    assert(await state('collect-newyear') === 'not_started', '2036 新年收藏開賣前沒有顯示尚未開始')
    await expectFail(`select public.purchase_my_perk($1)`, ['collect-snowman'], /不在販售期間/, '兩期之間不扣點、不發物品')
    assert(await balance() === 500, '未開賣失敗後餘額變了')
    await clock('2036-01-26 15:59:59+00')
    assert(await state('collect-newyear') === 'not_started', '2036 新年收藏台北午夜前被算成已開賣')
    await clock('2036-01-26 16:00:00+00')
    assert(await state('collect-newyear') === 'available', '2036 新年收藏台北午夜沒有開賣')
    await clock('2036-02-11 16:00:00+00')
    assert(await state('collect-newyear') === 'not_started', '2036 新年收藏結束後沒有回到尚未開始')
    await clock('2036-10-02 15:59:59+00')
    assert(await state('collect-moon') === 'not_started', '2036 中秋收藏台北午夜前被算成已開賣')
    await clock('2036-10-02 16:00:00+00')
    assert(await state('collect-moon') === 'available', '2036 中秋收藏台北午夜沒有開賣')
    await clock('2036-10-04 16:00:00+00')
    assert(await state('collect-moon') === 'not_started', '2036 中秋收藏結束後沒有回到尚未開始')

    await clock('2036-12-19 15:59:59+00')
    await asUser(B)
    assert(await state('collect-snowman') === 'not_started', '2036 聖誕台北午夜前被算成已開賣')
    await clock('2036-12-19 16:00:00+00')
    assert(await state('collect-snowman') === 'available', '2036 聖誕台北午夜沒有開賣')
    await clock('2036-12-25 16:00:00+00')
    assert(await state('collect-snowman') === 'not_started' && await balance() === 500, '2036 聖誕結束後、下一年開賣前被算成已結束或已扣點')

    await clock('2050-02-06 16:00:00+00')
    assert(await state('collect-newyear') === 'ended', '2050 新年收藏結束後沒有顯示已結束')
    await clock('2050-09-30 16:00:00+00')
    assert(await state('collect-moon') === 'ended', '2050 中秋收藏結束後沒有顯示已結束')
    await clock('2050-12-25 16:00:00+00')
    assert(await state('collect-snowman') === 'ended', '2050 年最後一期結束後沒有顯示已結束')
    await expectFail(`select public.purchase_my_perk($1)`, ['collect-snowman'], /不在販售期間/, '已結束不扣點、不發物品')
    assert(await balance() === 500, '已結束失敗後餘額變了')

    await clock('2026-12-24 12:00:00+08')
    await asUser(A)
    assert(await state('collect-snowman') === 'available', '販售期間內沒有開放兌換')
    const bought = await db.query(`select public.purchase_my_perk('collect-snowman') as r`)
    const first = bought.rows[0].r
    assert(first.replayed === false && first.owned.includes('collect-snowman') && first.balance === 332, '合法兌換沒有入庫或扣錯點數')
    const again = await db.query(`select public.purchase_my_perk('collect-snowman') as r`)
    assert(again.rows[0].r.replayed === true && again.rows[0].r.balance === 332, '同一請求重送又扣點或再發一次')
    pass('販售中可兌換，重送不重複扣點')

    await clock('2026-12-26 12:00:00+08')
    await asUser(A)
    assert(await state('collect-snowman') === 'owned', '活動結束後已兌換收藏沒有保留')
    const equipped = await db.query(`select public.set_my_perk_equipped('collect-snowman', true) as r`)
    assert(equipped.rows[0].r.equipped.collection === 'collect-snowman' && equipped.rows[0].r.balance === 332, '活動結束後不能裝備或裝備時扣了點')
    const off = await db.query(`select public.set_my_perk_equipped('collect-snowman', false) as r`)
    const back = await db.query(`select public.set_my_perk_equipped('collect-snowman', true) as r`)
    assert(off.rows[0].r.equipped.collection == null && back.rows[0].r.equipped.collection === 'collect-snowman' && back.rows[0].r.balance === 332, '卸下再裝備改變了持有或點數')

    await clock('2027-06-01 12:00:00+08')
    await asUser(A)
    assert(await state('collect-snowman') === 'owned' && await balance() === 332, '換年後持有或點數不見了')
    const nextYearEquip = await db.query(`select public.set_my_perk_equipped('collect-snowman', true) as r`)
    assert(nextYearEquip.rows[0].r.replayed === true && nextYearEquip.rows[0].r.equipped.collection === 'collect-snowman', '換年後使用權沒有保留')
    await clock('2036-12-20 12:00:00+08')
    assert(await state('collect-snowman') === 'owned' && await balance() === 332, '新年度窗口改動了既有持有或點數')
    pass('活動結束與換年後仍保留持有和裝備')

    await clock('2026-12-24 12:00:00+08')
    await db.query('RESET ROLE')
    await db.query(`select set_config('app.perk_catalog', 'on', true)`)
    await db.query(`update public.member_perk_catalog set stock_limit = 1 where id = 'collect-snowman'`)
    await db.query(`select set_config('app.perk_catalog', 'off', true)`)
    await asUser(B)
    assert(await state('collect-snowman') === 'sold_out', '售完沒有顯示已售完')
    await expectFail(`select public.purchase_my_perk($1)`, ['collect-snowman'], /已經兌換完畢/, '售完不能兌換')
    assert(await balance() === 500, '售完失敗後 B 的餘額變了')
    await db.query('RESET ROLE')
    await db.query(`select set_config('app.perk_catalog', 'on', true)`)
    await db.query(`update public.member_perk_catalog set stock_limit = 500 where id = 'collect-snowman'`)
    await db.query(`select set_config('app.perk_catalog', 'off', true)`)
    pass('未開賣、已結束、售完各自拒絕，且不扣點')

    await db.query('RESET ROLE')
    await db.query(`select set_config('request.jwt.claim.sub', '', true)`)
    await db.query(`select set_config('request.jwt.claims', '{}', true)`)
    await db.query('SET LOCAL ROLE authenticated')
    await expectFail(`select public.purchase_my_perk($1)`, ['collect-snowman'], /請先登入/, '未登入不能兌換')
    await asUser(B)
    await expectFail(`select public.set_my_perk_equipped('collect-snowman', true)`, [], /尚未擁有/, '未持有不能裝備別人的收藏')
    await expectFail(
      `insert into public.member_perk_holds (user_id, perk_id, category, cost, claim_key, point_entry_id) values ($1, 'collect-snowman', 'collection', 168, 'perk_unlock:collect-snowman', gen_random_uuid())`,
      [B],
      /permission denied|權限/,
      '會員不能直接寫入收藏',
    )
    pass('權限不足不扣點、不發物品')

    await clock('2036-12-19 16:00:00+00')
    await asUser(B)
    assert(await state('collect-snowman') === 'available', '新年度販售期間沒有開放兌換')
    const boughtLater = await db.query(`select public.purchase_my_perk('collect-snowman') as r`)
    assert(boughtLater.rows[0].r.replayed === false && boughtLater.rows[0].r.balance === 332 && boughtLater.rows[0].r.owned.includes('collect-snowman'), '新年度販售沒有沿用原價入庫')
    await clock('2036-12-25 16:00:00+00')
    assert(await state('collect-snowman') === 'owned' && await balance() === 332, '新年度窗口結束後持有沒有保留')
    await asUser(A)
    assert(await state('collect-snowman') === 'owned' && await balance() === 332, '新年度兌換改動了另一位會員的持有或點數')
    pass('2036 年窗口可兌換，結束後保留，既有持有不變')

    await clock(null)
    await db.query('RESET ROLE')
    const festivals = LIVE_EVENTS.filter((event) => event.cadence === 'festival')
    assert(festivals.length === 27, '活動登記不是 27 個')
    for (const event of festivals) {
      const sample = festivalWindows(event.festivalId!, 2026, 2026)[0]
      assert(sample, `${event.festivalId} 沒有活動窗口`)
      const open = await db.query(`select period_key, starts_at, ends_at from public.live_event_period($1, $2::timestamptz)`, [event.id, `${sample.startsOn}T00:00:00+08:00`])
      const period = festivalPeriod(event.festivalId!, Date.parse(`${sample.startsOn}T00:00:00+08:00`))
      assert(open.rows[0]?.period_key === period?.key, `${event.id} 開始日資料庫期別 ${open.rows[0]?.period_key} 與規則 ${period?.key} 不同`)
      assert(new Date(open.rows[0].starts_at).getTime() === period!.startMs, `${event.id} 開始時刻不是台北午夜`)
      assert(new Date(open.rows[0].ends_at).getTime() === period!.endMs, `${event.id} 結束時刻不是台北午夜`)
      const shut = await db.query(`select period_key from public.live_event_period($1, $2::timestamptz)`, [event.id, `${sample.endsOn}T00:00:00+08:00`])
      assert(shut.rows.length === 0, `${event.id} 在結束日仍開著`)
    }
    const eveOff = await db.query(`select period_key from public.live_event_period('fest_new_year_eve', '2026-12-31 18:00:00+08'::timestamptz)`)
    const eveOn = await db.query(`select period_key from public.live_event_period('fest_new_year_eve', '2026-12-31 16:00:00+00'::timestamptz)`)
    const eveUtc = await db.query(`select period_key from public.live_event_period('fest_new_year_eve', '2026-12-31 15:59:59+00'::timestamptz)`)
    assert(eveOff.rows.length === 0 && eveUtc.rows.length === 0, '跨年傍晚或 UTC 同一瞬間被算進活動')
    assert(eveOn.rows[0]?.period_key === 'f:new-year-eve:2027-01-01', '台北跨入 1 月 1 日沒有開啟跨年活動')
    const xmasOn = await db.query(`select period_key from public.live_event_period('fest_christmas_block', '2026-12-19 16:00:00+00'::timestamptz)`)
    const xmasOff = await db.query(`select period_key from public.live_event_period('fest_christmas_block', '2026-12-25 16:00:00+00'::timestamptz)`)
    assert(xmasOn.rows[0]?.period_key === 'f:christmas:2026-12-20' && xmasOff.rows.length === 0, '聖誕起訖沒有落在台北午夜')
    const both = await db.query(
      `select event_id, period_key from (values ('fest_lantern_festival'), ('fest_new_year_merge')) as e(event_id)
       join lateral public.live_event_period(e.event_id, '2027-02-20 12:00:00+08'::timestamptz) p on true`,
    )
    assert(both.rows.length === 2, '重疊日資料庫少算了一個節慶活動')
    for (const [at, key] of [
      ['2038-04-04 15:59:59+00', null],
      ['2038-04-04 16:00:00+00', 'f:qingming:2038-04-05'],
      ['2038-04-05 16:00:00+00', null],
      ['2042-04-03 15:59:59+00', null],
      ['2042-04-03 16:00:00+00', 'f:qingming:2042-04-04'],
      ['2042-04-04 16:00:00+00', null],
    ] as const) {
      const row = await db.query(`select period_key from public.live_event_period('fest_qingming', $1::timestamptz)`, [at])
      const client = festivalPeriod('qingming', Date.parse(at.replace(' ', 'T').replace('+00', 'Z')))
      assert((row.rows[0]?.period_key ?? null) === key, `清明 ${at} 資料庫期別不是 ${key ?? '關閉'}`)
      assert((client?.key ?? null) === key, `清明 ${at} 客戶端期別不是 ${key ?? '關閉'}`)
    }
    const oldQingming = await db.query(
      `select ends_on::text as ends_on from public.game_live_festival_windows where festival_id = 'qingming' and starts_on = '2026-04-05'`,
    )
    assert(oldQingming.rows[0]?.ends_on === '2026-04-06', '既有 2026 清明窗口被改動')
    pass('27 個活動的起訖與資料庫窗口一致，重疊活動都保留')

    const during = await snapshot()
    assert(during.payout === false && during.purchase === true, '測試中途改了發放或兌換開關')
    assert(during.catalog === 40 && during.cost === PERK_CATALOG.reduce((sum, perk) => sum + perk.cost, 0), '測試中途改了目錄或價格')
    await db.query('ROLLBACK')
  } catch (err) {
    await db.query('ROLLBACK')
    throw err
  }
  const after = await snapshot()
  assert(JSON.stringify(after) === JSON.stringify(before), `ROLLBACK 後快照變了：${JSON.stringify(after)}`)
  const day = await db.query(`select public.taipei_today('2026-10-21T16:00:00Z'::timestamptz)::text as day`)
  const def = await db.query(`select pg_get_functiondef('public.taipei_today(timestamptz)'::regprocedure) as def`)
  assert(day.rows[0].day === '2026-10-22', `交易結束後台北日期函式沒有恢復（${day.rows[0].day}）`)
  assert(String(def.rows[0].def).includes(`timezone('Asia/Taipei', p_at)`) && !String(def.rows[0].def).includes('festival_clock'), '交易結束後日期函式仍留著測試用時鐘')
  console.log(`通過 ${passed.length} 項，隔離庫已回復`)
  await db.end()
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  try { await db.end() } catch { /* 連線已關 */ }
  process.exit(1)
})
