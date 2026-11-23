/**
 * 第八階段第 2 批：賣家進入到期限制時的站內提醒。
 * 只連隔離庫 127.0.0.1:54322。會套用本輪增量。
 * 測試會員在結束時刪除。不呼叫啟用制度的程序，不改全站結帳開關。
 * 最後為 localhost:3001 的測試賣家留下一則通知，並還原該賣家的期限與啟用時間。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const HOST = '127.0.0.1'
const PORT = 54322
const DB_CONTAINER = 'supabase_db_hengjing-stage45-local'
const PLAY = 'merge-play-a@example.test'
const BEFORE = 'a1703000-0000-4000-8000-000000000001'
const AT = 'a1703000-0000-4000-8000-000000000002'
const EXT = 'a1703000-0000-4000-8000-000000000003'
const PENDING = 'a1703000-0000-4000-8000-000000000004'
const PAID = 'a1703000-0000-4000-8000-000000000005'
const UNSET = 'a1703000-0000-4000-8000-000000000006'
const BUYER = 'a1703000-0000-4000-8000-000000000007'
const ADMIN = 'a1703000-0000-4000-8000-000000000008'
const DUP = 'a1703000-0000-4000-8000-000000000009'
const RACE = 'a1703000-0000-4000-8000-00000000000a'
const TEST_IDS = [BEFORE, AT, EXT, PENDING, PAID, UNSET, BUYER, ADMIN, DUP, RACE]
const PHRASE = '目前無法接新訂單，仍可處理既有訂單與回覆聊聊'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const passed: string[] = []
const pass = (name: string) => {
  passed.push(name)
  console.log(`  ✓ ${name}`)
}

function checkSources() {
  const sql = readFileSync('supabase/manual/20261117030000_seller_subscription_expiry_reminders.sql', 'utf8')
  const panel = readFileSync('components/seller-subscription-panel.tsx', 'utf8')
  const market = readFileSync('components/open-marketplace.tsx', 'utf8')
  assert(sql.includes('public.seller_subscription_eval(p_seller, now())'), '提醒沒有沿用既有期限判定')
  assert(sql.includes(PHRASE), '通知沒有寫明無法接新訂單、仍可處理既有訂單與回覆聊聊')
  assert(sql.includes('ON CONFLICT (seller_user_id, period_ends_at) DO NOTHING'), '同一期限沒有防重')
  assert(sql.includes("pg_advisory_xact_lock(hashtext('seller-subscription'), hashtext(p_seller::text))"), '發送前沒有鎖住同一筆賣家期限')
  assert(sql.includes('制度尚未啟用'), '沒有寫明制度未啟用時不通知')
  assert(!sql.includes('admin_enable_seller_subscriptions'), '提醒增量呼叫了啟用制度')
  assert(!sql.includes('commerce_settings') && !sql.includes('checkout_enabled'), '提醒增量碰到全站結帳開關')
  assert(!sql.includes('newebpay') && !sql.includes('藍新'), '提醒增量碰到金流')
  assert(panel.includes('list_my_seller_subscription_reminders'), '通知中心沒有讀取站內提醒')
  assert(panel.includes('aria-label="方案到期提醒"') && panel.includes('{row.body}'), '提醒沒有顯示在既有通知區')
  assert(panel.includes('admin_enable_seller_subscriptions') && panel.includes('啟用賣家訂閱制度'), '啟用制度的按鈕被改掉')
  assert(market.includes('SellerSubscriptionReminderList') && market.includes("label: '通知中心'"), '賣家通知中心沒有接上到期提醒')
  pass('沿用既有期限判定，只新增站內提醒，啟用按鈕與結帳開關未改')
}

function runFile(file: string) {
  execSync(`docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -v ON_ERROR_STOP=1`, {
    input: readFileSync(file),
  })
}

const password = execSync(`docker exec ${DB_CONTAINER} printenv POSTGRES_PASSWORD`, { encoding: 'utf8' }).trim()
const db = new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })

function openClient() {
  return new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })
}

async function asPostgres() {
  await db.query('RESET ROLE')
}

async function asUser(userId: string) {
  await asPostgres()
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await db.query('SET LOCAL ROLE authenticated')
}

async function expectFail(sql: string, pattern: RegExp, name: string, params: unknown[] = []) {
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

async function fingerprint(fn: string) {
  const row = await db.query(
    `select md5(p.prosrc) as fp from pg_proc p where p.oid = to_regprocedure($1)`,
    [fn],
  )
  return String(row.rows[0]?.fp ?? '')
}

async function flags() {
  const row = await db.query(`
    select
      (select enabled_at is null from public.seller_subscription_settings) as disabled,
      (select enabled_by is null from public.seller_subscription_settings) as enabled_by_null,
      (select checkout_enabled from public.commerce_settings where id = true) as checkout
  `)
  return row.rows[0] as { disabled: boolean; enabled_by_null: boolean; checkout: boolean }
}

async function reminderCount(seller: string) {
  const row = await db.query(
    `select count(*)::int as n from public.seller_subscription_reminders where seller_user_id = $1`,
    [seller],
  )
  return Number(row.rows[0].n)
}

function resultOf(value: unknown) {
  const parsed = typeof value === 'string' ? JSON.parse(value) as { enabled?: boolean; sent?: number } : value as { enabled?: boolean; sent?: number }
  return parsed
}

async function deleteSellers(ids: string[]) {
  await asPostgres()
  await db.query(`delete from public.seller_subscription_reminders where seller_user_id = any($1::uuid[])`, [ids])
  await db.query(`delete from public.seller_extension_requests where seller_user_id = any($1::uuid[])`, [ids])
  await db.query(`delete from public.seller_subscriptions where seller_user_id = any($1::uuid[])`, [ids])
  await db.query(`delete from public.seller_applications where user_id = any($1::uuid[])`, [ids])
  await db.query(`delete from public.profiles where id = any($1::uuid[])`, [ids])
  await db.query(`delete from auth.users where id = any($1::uuid[])`, [ids])
}

async function insertUser(id: string, email: string, store: string | null) {
  await db.query(
    `insert into auth.users (id, email, aud, role, instance_id) values
      ($1, $2, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
    [id, email],
  )
  await db.query(`insert into public.profiles (id) values ($1) on conflict (id) do nothing`, [id])
  if (store) {
    await db.query(
      `insert into public.seller_applications (user_id, store_name, status) values ($1, $2, 'approved')`,
      [id, store],
    )
  }
}

async function main() {
  checkSources()
  await db.connect()
  const beforeEval = await fingerprint('public.seller_subscription_eval(uuid, timestamptz)')
  const beforeEnable = await fingerprint('public.admin_enable_seller_subscriptions()')
  const beforeCheckout = await fingerprint('public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb)')
  const beforeFlags = await flags()
  assert(beforeFlags.disabled === true && beforeFlags.enabled_by_null === true, '隔離庫的訂閱制度不是關閉，停止')
  assert(beforeFlags.checkout === false, '隔離庫的全站結帳開關不是關閉，停止')
  assert(beforeEval && beforeEnable && beforeCheckout, '找不到既有的期限判定、啟用或結帳函式')

  runFile('supabase/manual/20261117030000_seller_subscription_expiry_reminders.sql')
  runFile('supabase/manual/20261117030000_seller_subscription_expiry_reminders.sql')
  assert(await fingerprint('public.seller_subscription_eval(uuid, timestamptz)') === beforeEval, '套用提醒後改寫了已驗收的期限判定')
  assert(await fingerprint('public.admin_enable_seller_subscriptions()') === beforeEnable, '套用提醒後改寫了啟用制度')
  assert(await fingerprint('public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb)') === beforeCheckout, '套用提醒後改寫了結帳')
  const afterApply = await flags()
  assert(afterApply.disabled === true && afterApply.checkout === false, '套用提醒時啟用了制度或打開結帳')
  pass('重複套用不改期限判定、啟用時間或結帳開關')

  await deleteSellers(TEST_IDS)

  await db.query('BEGIN')
  try {
    await insertUser(BEFORE, 'seller-remind-off@example.invalid', '未啟用店')
    await db.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values ($1, now() - interval '30 days', now() - interval '1 second')`,
      [BEFORE],
    )
    const disabled = resultOf((await db.query(`select public.dispatch_seller_subscription_reminders() as result`)).rows[0].result)
    assert(disabled.enabled === false && disabled.sent === 0, '制度未啟用時排程仍送出提醒')
    assert(await reminderCount(BEFORE) === 0, '制度未啟用的正式賣家收到提醒')
    const direct = await db.query(`select public.seller_subscription_remind_one($1) as sent`, [BEFORE])
    assert(direct.rows[0].sent === false, '未啟用時單筆補送仍寫入提醒')
    pass('制度尚未啟用的正式賣家不會收到通知')
    await db.query('ROLLBACK')
  } catch (err) {
    await db.query('ROLLBACK')
    throw err
  }

  await db.query('BEGIN')
  try {
    await insertUser(BEFORE, 'seller-remind-before@example.invalid', '到期前店')
    await insertUser(AT, 'seller-remind-at@example.invalid', '到期當下店')
    await insertUser(EXT, 'seller-remind-ext@example.invalid', '延長店')
    await insertUser(PENDING, 'seller-remind-pending@example.invalid', '待審店')
    await insertUser(PAID, 'seller-remind-paid@example.invalid', '有效訂閱店')
    await insertUser(UNSET, 'seller-remind-unset@example.invalid', '尚未起算店')
    await insertUser(BUYER, 'seller-remind-buyer@example.invalid', null)
    await insertUser(ADMIN, 'seller-remind-admin@example.invalid', null)
    await db.query(`set local session_replication_role = replica`)
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [ADMIN])
    await db.query(`set local session_replication_role = origin`)
    await db.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values
         ($1, now() - interval '30 days', now() + interval '1 second'),
         ($2, now() - interval '30 days', now()),
         ($3, now() - interval '30 days', now() - interval '1 second'),
         ($4, now() - interval '30 days', now() - interval '1 second')`,
      [BEFORE, AT, EXT, PENDING],
    )
    await db.query(
      `insert into public.seller_subscriptions (
         seller_user_id, trial_starts_at, trial_ends_at, paid_starts_at, paid_ends_at, payment_status
       ) values (
         $1, now() - interval '40 days', now() - interval '1 day', now() - interval '1 day', now() + interval '30 days', 'paid'
       )`,
      [PAID],
    )
    await db.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values ($1, now() - interval '30 days', now() - interval '1 second')`,
      [BUYER],
    )
    await db.query(`update public.seller_subscription_settings set enabled_at = now(), updated_at = now() where singleton`)

    await asUser(EXT)
    await db.query(`select public.apply_my_seller_extension()`)
    await asUser(PENDING)
    await db.query(`select public.apply_my_seller_extension()`)
    await asPostgres()
    const extRequest = await db.query(`select id from public.seller_extension_requests where seller_user_id = $1`, [EXT])
    await asUser(ADMIN)
    await db.query(`select public.admin_review_seller_extension($1, true, '測試核准')`, [extRequest.rows[0].id])
    await asPostgres()

    const crossed = await db.query(
      `select trial_ends_at <= now() as trial_crossed, extension_ends_at > now() as extension_open,
              (public.seller_subscription_eval($1, now())->>'state') as state
       from public.seller_subscriptions where seller_user_id = $1`,
      [EXT],
    )
    assert(crossed.rows[0].trial_crossed === true && crossed.rows[0].extension_open === true, '核准延長沒有跨過原試營業期限')
    assert(crossed.rows[0].state === 'extension_active', '核准後沒有進入延長中')

    const first = resultOf((await db.query(`select public.dispatch_seller_subscription_reminders() as result`)).rows[0].result)
    assert(first.enabled === true && first.sent === 1, `第一次排程應只送出到期當下的一則：${JSON.stringify(first)}`)
    assert(await reminderCount(BEFORE) === 0, '到期前一秒被通知')
    assert(await reminderCount(AT) === 1, '到期當下沒有通知')
    assert(await reminderCount(EXT) === 0, '核准延長跨過原期限後仍發出舊期限提醒')
    assert(await reminderCount(PENDING) === 0, '延長待審被當成到期限制')
    assert(await reminderCount(PAID) === 0, '已有有效訂閱仍發出舊期限提醒')
    assert(await reminderCount(UNSET) === 0, '尚未起算的正式賣家被通知')
    assert(await reminderCount(BUYER) === 0, '未核准帳號被通知')
    const atNotice = await db.query(
      `select r.title, r.body, public.seller_subscription_taipei(r.period_ends_at) as ends,
              (public.seller_subscription_eval($1, now())->>'endsTaipei') as eval_ends,
              (public.seller_subscription_eval($1, now())->>'state') as state,
              r.period_ends_at = s.trial_ends_at as same_deadline
       from public.seller_subscription_reminders r
       join public.seller_subscriptions s on s.seller_user_id = r.seller_user_id
       where r.seller_user_id = $1`,
      [AT],
    )
    assert(atNotice.rows[0].state === 'restricted' && atNotice.rows[0].same_deadline === true, '通知期限不是判定函式的到期時間')
    assert(atNotice.rows[0].ends === atNotice.rows[0].eval_ends, '通知上的台北時間與判定函式不同')
    assert(atNotice.rows[0].title === '賣家方案已到期', '通知標題不對')
    assert(
      atNotice.rows[0].body === `您的期限已於 ${atNotice.rows[0].ends}（台北時間）到期。${PHRASE}。`,
      `通知內文不對：${atNotice.rows[0].body}`,
    )
    pass('到期前不通知，到期當下寫出期限與限制說明')
    pass('核准延長後跨過原期限，以及有效訂閱，都跳過舊期限')

    const again = resultOf((await db.query(`select public.dispatch_seller_subscription_reminders() as result`)).rows[0].result)
    assert(again.sent === 0 && await reminderCount(AT) === 1, '同一期限重跑又寫了一則')
    pass('排程重跑不會重複通知')

    const pendingRequest = await db.query(`select id from public.seller_extension_requests where seller_user_id = $1`, [PENDING])
    await asUser(ADMIN)
    await db.query(`select public.admin_review_seller_extension($1, false, '測試拒絕')`, [pendingRequest.rows[0].id])
    await asPostgres()
    const afterReject = resultOf((await db.query(`select public.dispatch_seller_subscription_reminders() as result`)).rows[0].result)
    assert(afterReject.sent === 1 && await reminderCount(PENDING) === 1, '拒絕延長後沒有在進入到期限制時通知')
    assert(await reminderCount(AT) === 1, '拒絕延長的排程重複通知了已到期賣家')
    pass('待審尚未進入到期限制；拒絕後才通知一次')

    await db.query(
      `update public.seller_subscriptions
       set extension_starts_at = now() - interval '1 second', extension_ends_at = now(), updated_at = now()
       where seller_user_id = $1`,
      [EXT],
    )
    const extensionEnded = resultOf((await db.query(`select public.dispatch_seller_subscription_reminders() as result`)).rows[0].result)
    assert(extensionEnded.sent === 1 && await reminderCount(EXT) === 1, '延長到期時沒有改通知新期限')
    const extNotice = await db.query(
      `select r.period_ends_at = s.extension_ends_at as extension_deadline,
              r.period_ends_at = s.trial_ends_at as trial_deadline
       from public.seller_subscription_reminders r
       join public.seller_subscriptions s on s.seller_user_id = r.seller_user_id
       where r.seller_user_id = $1`,
      [EXT],
    )
    assert(extNotice.rows[0].extension_deadline === true && extNotice.rows[0].trial_deadline === false, '延長到期仍記在舊的試營業期限')
    const extensionRerun = resultOf((await db.query(`select public.dispatch_seller_subscription_reminders() as result`)).rows[0].result)
    assert(extensionRerun.sent === 0 && await reminderCount(EXT) === 1 && await reminderCount(AT) === 1, '新期限重跑或舊期限被補發')
    pass('延長自己到期才通知新期限，舊期限仍然沒有補發')

    await asUser(AT)
    const mine = resultOf((await db.query(`select public.list_my_seller_subscription_reminders() as rows`)).rows[0].rows)
    const mineRows = Array.isArray(mine) ? mine : []
    assert(mineRows.length === 1 && String((mineRows[0] as { body?: string }).body ?? '').includes(PHRASE), '賣家讀不到自己的到期提醒')
    await asUser(BEFORE)
    const others = resultOf((await db.query(`select public.list_my_seller_subscription_reminders() as rows`)).rows[0].rows)
    assert(Array.isArray(others) && others.length === 0, '賣家讀到別人的到期提醒')
    const markedOther = await db.query(`select public.mark_my_seller_subscription_reminders_read() as n`)
    assert(Number(markedOther.rows[0].n) === 0, '賣家標讀了別人的提醒')
    await asPostgres()
    const stillUnread = await db.query(`select read_at is null as unread from public.seller_subscription_reminders where seller_user_id = $1`, [AT])
    assert(stillUnread.rows[0].unread === true, '別人標讀後，到期提醒變成已讀')
    await asUser(AT)
    const marked = await db.query(`select public.mark_my_seller_subscription_reminders_read() as n`)
    assert(Number(marked.rows[0].n) === 1, '賣家不能把自己的提醒標成已讀')
    await asUser(AT)
    await expectFail(`select public.dispatch_seller_subscription_reminders()`, /permission denied/, '賣家不能自行跑到期提醒排程')
    await expectFail(`select public.seller_subscription_remind_one($1)`, /permission denied/, '賣家不能替任何人補送提醒', [AT])
    await expectFail(
      `insert into public.seller_subscription_reminders (seller_user_id, period_ends_at, title, body)
       values ($1, now(), '賣家方案已到期', '您的期限已於 2030-01-01 00:00:00（台北時間）到期。${PHRASE}。')`,
      /permission denied/,
      '賣家不能直接寫入提醒',
      [AT],
    )
    await asPostgres()
    await db.query(`select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)`)
    await expectFail(`select public.list_my_seller_subscription_reminders()`, /請先登入/, '未登入不能讀到期提醒')
    await asPostgres()
    await expectFail(
      `insert into public.seller_subscription_reminders (seller_user_id, period_ends_at, title, body)
       values ($1, '2031-01-01 00:00:00+08', '賣家方案已到期', '沒有寫限制')`,
      /seller_subscription_reminders_text/,
      '缺少限制說明的提醒不能寫入',
      [AT],
    )
    const skippedBuyer = await db.query(`select public.seller_subscription_remind_one($1) as sent`, [BUYER])
    assert(skippedBuyer.rows[0].sent === false, '未核准帳號仍被補送')
    pass('賣家只能讀取並標讀自己的提醒')

    await db.query('ROLLBACK')
  } catch (err) {
    await db.query('ROLLBACK')
    throw err
  }
  const restored = await flags()
  assert(restored.disabled === true && restored.checkout === false, '測試交易結束後制度或結帳開關變了')
  pass('期限情境都在交易內還原，制度仍未啟用')

  let turnedOn = false
  const c1 = openClient()
  const c2 = openClient()
  await c1.connect()
  await c2.connect()
  try {
    await db.query('BEGIN')
    await insertUser(DUP, 'seller-remind-dup@example.invalid', '併發店')
    await insertUser(ADMIN, 'seller-remind-admin@example.invalid', null)
    await db.query(`set local session_replication_role = replica`)
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [ADMIN])
    await db.query(`set local session_replication_role = origin`)
    await db.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values ($1, now() - interval '30 days', now() - interval '1 second')`,
      [DUP],
    )
    const enabled = await db.query(
      `update public.seller_subscription_settings
       set enabled_at = now(), updated_at = now()
       where singleton and enabled_at is null
       returning enabled_at`,
    )
    assert(enabled.rowCount === 1, '併發測試沒有取得關閉中的啟用時間')
    await db.query('COMMIT')
    turnedOn = true

    const parallel = await Promise.all([
      c1.query(`select public.dispatch_seller_subscription_reminders() as result`),
      c2.query(`select public.dispatch_seller_subscription_reminders() as result`),
    ])
    const sent = parallel.reduce((sum, row) => sum + Number(resultOf(row.rows[0].result).sent ?? 0), 0)
    assert(sent === 1 && await reminderCount(DUP) === 1, `同時執行送出 ${sent} 則，資料庫留下 ${await reminderCount(DUP)} 則`)
    const rerun = resultOf((await db.query(`select public.dispatch_seller_subscription_reminders() as result`)).rows[0].result)
    assert(rerun.sent === 0 && await reminderCount(DUP) === 1, '併發之後重跑又寫了一則')
    pass('排程同時執行與再跑一次都只留下一則')

    await db.query('BEGIN')
    await insertUser(RACE, 'seller-remind-race@example.invalid', '延長競態店')
    const raced = await db.query(
      `update public.seller_subscriptions
       set trial_starts_at = now() - interval '30 days',
           trial_ends_at = now() - interval '1 second',
           updated_at = now()
       where seller_user_id = $1`,
      [RACE],
    )
    assert(raced.rowCount === 1, '制度開啟後新賣家沒有自動寫入試營業，無法改成已到期')
    await db.query('COMMIT')

    await c1.query('BEGIN')
    await c1.query(`select pg_advisory_xact_lock(hashtext('seller-subscription'), hashtext($1::text))`, [RACE])
    const waiting = c2.query('BEGIN').then(() => c2.query(`select public.dispatch_seller_subscription_reminders() as result`))
    await new Promise((resolve) => setTimeout(resolve, 400))
    await c1.query(
      `insert into public.seller_extension_requests (seller_user_id, status) values ($1, 'pending')`,
      [RACE],
    )
    const request = await c1.query(`select id from public.seller_extension_requests where seller_user_id = $1`, [RACE])
    await c1.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ADMIN])
    await c1.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN, role: 'authenticated' })])
    await c1.query('SET LOCAL ROLE authenticated')
    await c1.query(`select public.admin_review_seller_extension($1, true, '競態核准')`, [request.rows[0].id])
    await c1.query('COMMIT')
    const waited = resultOf((await waiting).rows[0].result)
    await c2.query('COMMIT')
    assert(await reminderCount(RACE) === 0, '等待中的排程在延長核准後仍寫了舊期限')
    assert(Number(waited.sent ?? 0) === 0, '等待中的排程回報有送出提醒')
    const raceState = await db.query(`select (public.seller_subscription_eval($1, now())->>'state') as state`, [RACE])
    assert(raceState.rows[0].state === 'extension_active', '競態核准後不是延長中')
    pass('排程取得鎖之後若已核准延長，就跳過舊期限')
  } finally {
    await db.query('ROLLBACK').catch(() => undefined)
    await c1.query('ROLLBACK').catch(() => undefined)
    await c2.query('ROLLBACK').catch(() => undefined)
    await asPostgres()
    if (turnedOn) {
      await db.query(
        `update public.seller_subscription_settings
         set enabled_at = null, updated_at = now()
         where singleton and enabled_by is null`,
      )
    }
    await deleteSellers(TEST_IDS)
    await c1.end()
    await c2.end()
  }
  const afterRace = await flags()
  assert(afterRace.disabled === true && afterRace.enabled_by_null === true && afterRace.checkout === false, '併發測試結束後制度或結帳開關沒有還原')
  assert(await fingerprint('public.seller_subscription_eval(uuid, timestamptz)') === beforeEval, '測試過程改寫了期限判定')
  pass('併發測試已還原，制度仍未啟用，結帳仍關閉')

  await leavePlayNotice()
  await db.end()
  console.log(`seller subscription reminder local test passed: ${passed.length} checks`)
}

async function leavePlayNotice() {
  const found = await db.query(
    `select u.id
     from auth.users u
     join public.seller_applications sa on sa.user_id = u.id and sa.status = 'approved'
     where lower(u.email) = $1`,
    [PLAY],
  )
  assert(found.rowCount === 1, '找不到已核准的測試賣家，沒有留下通知')
  const id = String(found.rows[0].id)
  await db.query('BEGIN')
  try {
    const prior = await flags()
    assert(prior.disabled === true && prior.checkout === false, '留下通知前制度或結帳開關已經變了')
    const sub = await db.query(`select 1 from public.seller_subscriptions where seller_user_id = $1`, [id])
    assert(sub.rowCount === 0, '測試賣家已有訂閱期限，沒有覆寫')
    await db.query(
      `delete from public.seller_subscription_reminders where seller_user_id = $1 and title = '賣家方案已到期'`,
      [id],
    )
    const enabled = await db.query(
      `update public.seller_subscription_settings
       set enabled_at = now(), updated_at = now()
       where singleton and enabled_at is null
       returning enabled_at`,
    )
    assert(enabled.rowCount === 1, '留下通知時無法暫時讀到關閉中的制度')
    await db.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values ($1, now() - interval '30 days', now())`,
      [id],
    )
    const dispatched = resultOf((await db.query(`select public.dispatch_seller_subscription_reminders() as result`)).rows[0].result)
    assert(dispatched.sent === 1, `測試賣家沒有產生到期通知：${JSON.stringify(dispatched)}`)
    await db.query(`delete from public.seller_subscriptions where seller_user_id = $1`, [id])
    await db.query(
      `update public.seller_subscription_settings
       set enabled_at = null, updated_at = now()
       where singleton and enabled_by is null`,
    )
    const check = await db.query(
      `select
         (select enabled_at is null from public.seller_subscription_settings) as disabled,
         (select checkout_enabled from public.commerce_settings where id = true) as checkout,
         (select count(*)::int from public.seller_subscriptions where seller_user_id = $1) as subs,
         (select count(*)::int from public.seller_subscription_reminders where seller_user_id = $1) as notices,
         (select body from public.seller_subscription_reminders where seller_user_id = $1 order by created_at desc limit 1) as body`,
      [id],
    )
    const row = check.rows[0] as { disabled: boolean; checkout: boolean; subs: number; notices: number; body: string }
    assert(row.disabled === true, '通知留下後制度仍是啟用')
    assert(row.checkout === false, '通知留下後結帳開關被打開')
    assert(Number(row.subs) === 0, '測試賣家的期限沒有還原')
    assert(Number(row.notices) === 1, '測試賣家的站內通知不是一則')
    assert(String(row.body).includes(PHRASE), '留下的通知沒有寫明限制')
    const others = await db.query(
      `select count(*)::int as n from public.seller_subscription_reminders where seller_user_id <> $1`,
      [id],
    )
    assert(Number(others.rows[0].n) === 0, '其他賣家也被寫入到期通知')
    await db.query('COMMIT')
    console.log(`play notice: ${row.body}`)
    pass('測試賣家留下一則站內通知，期限與啟用時間已還原')
  } catch (err) {
    await db.query('ROLLBACK')
    throw err
  }
}

main().catch(async (err) => {
  console.error(err)
  try {
    await db.query('ROLLBACK')
  } catch {
    // 連線可能已結束。
  }
  process.exit(1)
})
