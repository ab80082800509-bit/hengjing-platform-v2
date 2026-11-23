/**
 * 第八階段第 1 批：賣家月費狀態、一次延長、到期後禁止新交易。
 * 只連隔離庫 127.0.0.1:54322。會套用本輪增量。測試會員與訂單在結束時刪除。
 * 不連正式庫，不改 checkout_enabled。
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const HOST = '127.0.0.1'
const PORT = 54322
const DB_CONTAINER = 'supabase_db_hengjing-stage45-local'
const A = 'a1700000-0000-4000-8000-0000000000a1'
const B = 'b1700000-0000-4000-8000-0000000000b2'
const ADMIN = 'c1700000-0000-4000-8000-0000000000ad'
const BUYER = 'd1700000-0000-4000-8000-0000000000be'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const passed: string[] = []
const pass = (name: string) => {
  passed.push(name)
  console.log(`  ✓ ${name}`)
}

function checkSources() {
  const ui = readFileSync('components/seller-subscription-panel.tsx', 'utf8')
  const legal = readFileSync('lib/legal.ts', 'utf8')
  const gate = readFileSync('components/seller-gate-modal.tsx', 'utf8')
  const sql = readFileSync('supabase/manual/20261117010000_seller_subscription_apply.sql', 'utf8')
  const rules = readFileSync('supabase/manual/20261117020000_seller_subscription_start_rules.sql', 'utf8')
  assert(ui.includes('含稅實付') && ui.includes('Amt=420'), '方案頁沒有寫明實付 420')
  assert(ui.includes('twd(view.quote.gross)') && ui.includes('twd(view.quote.tax)'), '畫面沒有分開顯示稅額與含稅金額')
  assert(ui.includes('create_my_seller_subscription_payment'), '立即訂閱沒有建立伺服器付款單')
  assert(ui.includes('不會寫成有效訂閱'), '付款單被寫成有效訂閱')
  assert(ui.includes('if (!view?.canApplyExtension)'), '第二次申請只靠按鈕停用')
  assert(ui.includes('admin_enable_seller_subscriptions'), '站長畫面沒有啟用制度的操作')
  assert(ui.includes('訂閱資格有效') && ui.includes('平台結帳尚未開放') && !ui.includes('目前可以開始新交易'), '結帳關閉時仍把訂閱資格寫成可以開始新交易')
  assert(!ui.includes('paymentStatus = \'paid\'') && !ui.includes('payment_status = \'paid\''), '畫面會把訂閱標成已付款')
  const market = readFileSync('components/open-marketplace.tsx', 'utf8')
  assert(market.includes('subscriptionLabel') && market.includes('eligibilityText(subscription)'), '賣家總覽沒有接上伺服器訂閱狀態')
  assert(!market.includes('舊版示意'), '站長頁仍留著舊的月費示意表')
  assert(legal.includes('400') && legal.includes('20') && legal.includes('420') && legal.includes('正式收款維持關閉'), '條款沒有寫明實付 420')
  assert(legal.includes('從審核通過時起算') && legal.includes('拒絕後不能再申請') && legal.includes('從核准時間起算'), '條款沒有寫入已確認的起算規則')
  assert(!legal.includes('尚未另定') && !legal.includes('599 元') && !gate.includes('NT$ 599'), '舊的未定規則或 599 月費還留在條款或賣家入口')
  assert(sql.includes('不為任何正式賣家寫入日期') && sql.includes('沒有降回第一支') && !sql.includes('checkout_enabled'), '第一份增量寫了正式賣家日期、動到全站結帳開關，或沒有防降版')
  assert(rules.includes('本檔不設定啟用時間') && rules.includes('checkoutOpen') && !rules.includes('UPDATE public.commerce_settings'), '第二份增量自行設定啟用時間或改寫結帳開關')
  const check = readFileSync('supabase/manual/20261117019000_seller_subscription_readonly_check.sql', 'utf8')
  assert(check.includes('BEGIN READ ONLY;') && check.trimEnd().endsWith('ROLLBACK;'), '預檢不是唯讀')
  const checkBody = check.slice(check.indexOf('BEGIN READ ONLY;'), check.lastIndexOf('ROLLBACK;'))
  const statements = checkBody.split(';').map((part) => part.replace(/--[^\n]*/g, '').trim().toUpperCase())
  for (const word of ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'GRANT', 'REVOKE']) {
    assert(!statements.some((part) => part.startsWith(word)), `預檢含有 ${word}`)
  }
  for (const [name, marker] of [
    ['seller_subscription_eval', 'CREATE OR REPLACE FUNCTION public.seller_subscription_eval(p_seller uuid, p_at timestamptz)'],
    ['apply_my_seller_extension', 'CREATE OR REPLACE FUNCTION public.apply_my_seller_extension()'],
    ['admin_review_seller_extension', 'CREATE OR REPLACE FUNCTION public.admin_review_seller_extension(p_id uuid, p_approve boolean, p_note text)'],
    ['get_my_seller_subscription', 'CREATE OR REPLACE FUNCTION public.get_my_seller_subscription()'],
  ] as const) {
    const first = md5(functionBody(sql, marker))
    const second = md5(functionBody(rules, marker))
    assert(first !== second, `${name} 的兩支本文不該相同`)
    assert(sql.includes(first) && sql.includes(second) && check.includes(first) && check.includes(second), `${name} 的指紋沒有同時寫進第一支防降版與預檢`)
  }
  assert(sql.includes('賣家月費到期，不能建立新交易'), '新交易限制不在伺服器')
  pass('方案金額、概數、結帳文案與防降版指紋一致')
}

const md5 = (text: string) => createHash('md5').update(text.replace(/\r\n/g, '\n')).digest('hex')

function functionBody(sql: string, marker: string) {
  const at = sql.indexOf(marker)
  const as = sql.indexOf('AS $$', at)
  const end = sql.indexOf('\n$$', as + 5)
  if (at < 0 || as < 0 || end < 0) throw new Error(`套用檔函式本文無法截取 ${marker}`)
  return sql.slice(as + 'AS $$'.length, end + 1)
}

function sqlBody(file: string) {
  const sql = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const start = sql.indexOf('\nBEGIN;')
  const end = sql.lastIndexOf('\nCOMMIT;')
  if (start < 0 || end < start) throw new Error(`${file} 沒有 BEGIN/COMMIT`)
  return sql.slice(start + '\nBEGIN;'.length, end)
}

function precheckSql() {
  const sql = readFileSync('supabase/manual/20261117019000_seller_subscription_readonly_check.sql', 'utf8').replace(/\r\n/g, '\n')
  const start = sql.indexOf('WITH fn(')
  const end = sql.lastIndexOf('ROLLBACK;')
  if (start < 0 || end < start) throw new Error('預檢沒有結果查詢')
  return sql.slice(start, end)
}

function runFile(file: string) {
  return execSync(`docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -v ON_ERROR_STOP=1`, {
    input: readFileSync(file),
  }).toString()
}

function runPrecheck() {
  const output = execSync(`docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA -F "|"`, {
    input: readFileSync('supabase/manual/20261117019000_seller_subscription_readonly_check.sql'),
  }).toString()
  const line = output.split(/\r?\n/).find((row) => row.startsWith('尚未安裝|') || row.startsWith('僅第一支已安裝|') || row.startsWith('兩支已完整安裝|') || row.startsWith('不相容|'))
  if (!line) throw new Error(`預檢沒有單列結果：${output}`)
  const [judgment, reason, snapshot] = line.split('|')
  return { judgment, reason, snapshot }
}

const password = execSync(`docker exec ${DB_CONTAINER} printenv POSTGRES_PASSWORD`, { encoding: 'utf8' }).trim()
const db = new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })

function openClient() {
  return new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })
}

async function asUser(userId: string) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await db.query('SET LOCAL ROLE authenticated')
}

async function asClient(client: pg.Client, userId: string) {
  await client.query('RESET ROLE')
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await client.query('SET LOCAL ROLE authenticated')
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

async function stateAt(seller: string, at: string) {
  const row = await db.query(`select public.seller_subscription_eval($1, $2::timestamptz) as state`, [seller, at])
  return row.rows[0].state as {
    state: string
    label: string
    canStartNewTrade: boolean | null
    startsTaipei: string | null
    endsTaipei: string | null
    serverTaipei: string
    quote: { net: number; tax: number; gross: number; approxDisplay: number; approxIsCharge: boolean }
  }
}

async function snapshot() {
  const row = await db.query(`
    select
      (select checkout_enabled from public.commerce_settings where id = true) as checkout,
      (select count(*)::int from public.orders) as orders,
      (select count(*)::int from public.seller_subscriptions) as subs,
      (select count(*)::int from public.seller_extension_requests) as requests,
      (select count(*)::int from public.seller_chat_messages) as chats,
      (select count(*)::int from public.seller_applications) as applications,
      (select enabled_at is null from public.seller_subscription_settings) as subscription_disabled
  `)
  return row.rows[0] as Record<string, unknown>
}

async function main() {
  checkSources()
  const beforeUpgrade = runPrecheck()
  assert(beforeUpgrade.judgment === '不相容' && beforeUpgrade.reason.includes('get_my_seller_subscription=第一支'), `升級前預檢應指出讀取函式仍是第一支：${beforeUpgrade.judgment} ${beforeUpgrade.reason}`)
  assert(beforeUpgrade.snapshot.includes('啟用時間=尚未設定') && beforeUpgrade.snapshot.includes('結帳開關=關閉'), '升級前快照的啟用時間或結帳開關不對')
  pass('升級前預檢為不相容，並指出讀取函式仍是第一支')
  runFile('supabase/manual/20261117020000_seller_subscription_start_rules.sql')
  const installed = runPrecheck()
  assert(installed.judgment === '兩支已完整安裝', `第二支套用後預檢不是完整安裝：${installed.judgment} ${installed.reason}`)
  assert(installed.snapshot.includes('啟用時間=尚未設定') && installed.snapshot.includes('結帳開關=關閉') && installed.snapshot.includes('訂閱列=0') && installed.snapshot.includes('申請列=0'), '完整安裝快照不該寫入啟用時間、打開結帳或留下申請')
  pass('第二支套用後預檢為兩支已完整安裝')
  let blocked = false
  try {
    runFile('supabase/manual/20261117010000_seller_subscription_apply.sql')
  } catch (err) {
    const message = err instanceof Error ? `${err.message}` : String(err)
    blocked = message.includes('偵測到第二支賣家訂閱增量，已停止，沒有降回第一支')
  }
  assert(blocked, '第二支之後重跑第一支沒有在修改前停止')
  const stillInstalled = runPrecheck()
  assert(stillInstalled.judgment === '兩支已完整安裝' && stillInstalled.snapshot === installed.snapshot, '第一支被擋下後，版本或快照變了')
  pass('第二支之後重跑第一支被阻止，期限與申請紀錄沒有被改寫')

  await db.connect()
  const before = await snapshot()
  assert(before.checkout === false, '隔離庫的全站結帳開關不是關閉')

  await db.query('BEGIN')
  try {
    await db.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'seller-sub-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($2, 'seller-sub-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($3, 'seller-sub-admin@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($4, 'seller-sub-buyer@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [A, B, ADMIN, BUYER],
    )
    await db.query(`insert into public.profiles (id) values ($1), ($2), ($3), ($4) on conflict (id) do nothing`, [A, B, ADMIN, BUYER])
    await db.query(`set local session_replication_role = replica`)
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [ADMIN])
    await db.query(`set local session_replication_role = origin`)
    await db.query(
      `insert into public.seller_applications (user_id, store_name, status) values
        ($1, '月費甲店', 'approved'),
        ($2, '月費乙店', 'approved')`,
      [A, B],
    )
    await db.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values ($1, '2030-01-01 00:00:00+08', '2030-01-31 00:00:00+08')`,
      [A],
    )

    const quote = await stateAt(A, '2030-01-01 00:00:00+08')
    assert(Number(quote.quote.net) === 400 && Number(quote.quote.tax) === 20 && Number(quote.quote.gross) === 420, '月費金額不對')
    assert(Number(quote.quote.chargeAmt) === 420 && quote.quote.approxIsCharge === true, '實付 420 沒有當成藍新金額')
    assert(quote.state === 'trial' && quote.label === '試營業' && quote.canStartNewTrade === true, '試營業開始當下不是試營業')
    assert(quote.startsTaipei === '2030-01-01 00:00:00' && quote.serverTaipei === '2030-01-01 00:00:00', '畫面時間不是台北時間')
    const beforeEnd = await stateAt(A, '2030-01-30 23:59:59+08')
    assert(beforeEnd.state === 'trial' && beforeEnd.canStartNewTrade === true, '試營業結束前一秒被當成到期')
    const atEnd = await stateAt(A, '2030-01-31 00:00:00+08')
    assert(atEnd.state === 'restricted' && atEnd.label === '到期限制' && atEnd.canStartNewTrade === false, '試營業結束當下仍可新交易')
    pass('試營業邊界使用伺服器時間，結束點不再算試營業')

    await db.query(
      `update public.seller_subscriptions
       set extension_starts_at = '2030-02-01 00:00:00+08', extension_ends_at = '2030-02-16 00:00:00+08'
       where seller_user_id = $1`,
      [A],
    )
    const extStart = await stateAt(A, '2030-02-01 00:00:00+08')
    const extEnd = await stateAt(A, '2030-02-16 00:00:00+08')
    assert(extStart.state === 'extension_active' && extStart.canStartNewTrade === true, '延長開始當下不是延長中')
    assert(extEnd.state === 'restricted' && extEnd.canStartNewTrade === false, '延長滿 15 天後仍可新交易')
    await db.query(
      `update public.seller_subscriptions
       set extension_starts_at = null, extension_ends_at = null,
           payment_status = 'paid', paid_starts_at = '2030-03-01 00:00:00+08', paid_ends_at = '2030-04-01 00:00:00+08'
       where seller_user_id = $1`,
      [A],
    )
    const paid = await stateAt(A, '2030-03-01 00:00:00+08')
    const paidEnd = await stateAt(A, '2030-04-01 00:00:00+08')
    assert(paid.state === 'subscribed' && paid.label === '有效訂閱', '付費窗口開始不是有效訂閱')
    assert(paidEnd.state === 'restricted', '付費窗口結束後仍是有效訂閱')
    await db.query(
      `update public.seller_subscriptions
       set payment_status = 'unpaid', paid_starts_at = null, paid_ends_at = null
       where seller_user_id = $1`,
      [A],
    )
    pass('延長與有效訂閱的結束點會回到到期限制')

    const unset = await stateAt(B, '2030-06-01 00:00:00+08')
    assert(unset.state === 'unset' && unset.canStartNewTrade === null, '沒有日期的賣家被寫成試營業或到期')
    pass('沒有決策的賣家維持尚未起算，不寫入日期')

    await db.query(
      `update public.seller_subscriptions
       set trial_starts_at = now() - interval '40 days',
           trial_ends_at = now() - interval '1 day',
           extension_starts_at = null,
           extension_ends_at = null,
           paid_starts_at = null,
           paid_ends_at = null,
           payment_status = 'unpaid'
       where seller_user_id = $1`,
      [A],
    )
    await asUser(A)
    const mine = await db.query(`select public.get_my_seller_subscription() as state`)
    assert(mine.rows[0].state.state === 'restricted', '賣家看不到自己的到期狀態')
    await db.query('RESET ROLE')
    await db.query(`select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)`)
    await expectFail(`select public.get_my_seller_subscription()`, /請先登入/, '未登入不能讀訂閱')
    await db.query('RESET ROLE')
    await asUser(B)
    const other = await db.query(`select public.get_my_seller_subscription() as state`)
    assert(other.rows[0].state.state === 'unset', '另一位賣家讀到別人的訂閱')
    await expectFail(`select public.admin_list_seller_extensions()`, /沒有權限/, '賣家不能審核延長')
    await expectFail(
      `update public.seller_subscriptions set payment_status = 'paid', trial_ends_at = '2040-01-01 00:00:00+08' where seller_user_id = $1`,
      /permission denied|不能自行修改/,
      '賣家不能改期限或付款狀態',
      [A],
    )
    await expectFail(`select public.seller_subscription_eval($1, now())`, /permission denied/, '賣家不能自訂判定時間', [A])
    pass('會員只能讀自己的訂閱，偽造期限或付款沒有作用')

    await db.query('RESET ROLE')
    await asUser(B)
    await expectFail(`select public.apply_my_seller_extension()`, /尚未啟用|尚未起算/, '沒有期限時申請不會寫入')
    await db.query('RESET ROLE')
    const unused = await db.query(`select count(*)::int as n from public.seller_extension_requests where seller_user_id = $1`, [B])
    assert(unused.rows[0].n === 0, '無效申請仍寫入並消耗資格')
    pass('沒有成功寫入的申請不消耗延長資格')

    await asUser(A)
    const applied = await db.query(`select public.apply_my_seller_extension() as state`)
    assert(applied.rows[0].state.state === 'extension_pending', '送出申請後沒有變成待審')
    assert(applied.rows[0].state.canStartNewTrade === false, '待審自動恢復新交易')
    await db.query('RESET ROLE')
    const dates = await db.query(`select trial_ends_at < now() as ended, extension_ends_at from public.seller_subscriptions where seller_user_id = $1`, [A])
    assert(dates.rows[0].ended === true, '申請改了試營業結束日')
    assert(dates.rows[0].extension_ends_at === null, '待審寫入了延長結束日')
    await asUser(A)
    await expectFail(`select public.apply_my_seller_extension()`, /已經有待審申請/, '重複申請會被拒絕')
    pass('待審不會延長期限，也不能同時有兩筆申請')

    await db.query('RESET ROLE')
    await asUser(ADMIN)
    const pending = await db.query(`select public.admin_list_seller_extensions() as rows`)
    const requestId = (pending.rows[0].rows as Array<{ id: string; status: string }>)[0].id
    const approved = await db.query(`select public.admin_review_seller_extension($1, true, '核准一次延長') as state`, [requestId])
    assert(approved.rows[0].state.state === 'extension_active' && approved.rows[0].state.label === '延長中', '核准當下沒有進入延長中')
    assert(approved.rows[0].state.canStartNewTrade === true, '核准後仍不能新交易')
    await db.query('RESET ROLE')
    const afterApprove = await db.query(
      `select s.extension_starts_at, s.extension_ends_at, s.payment_status, s.trial_ends_at < now() as trial_ended,
              r.reviewed_at, s.extension_starts_at = r.reviewed_at as same_instant,
              s.extension_ends_at = s.extension_starts_at + interval '15 days' as fifteen
       from public.seller_subscriptions s
       join public.seller_extension_requests r on r.seller_user_id = s.seller_user_id
       where s.seller_user_id = $1 and r.status = 'approved'`,
      [A],
    )
    assert(afterApprove.rows[0].same_instant === true && afterApprove.rows[0].fifteen === true, '核准沒有在同一時間寫入 15 天')
    assert(afterApprove.rows[0].trial_ended === true && afterApprove.rows[0].payment_status === 'unpaid', '核准改了試營業或變成付款')
    const extensionBoundary = await db.query(
      `select
         (public.seller_subscription_eval($1, extension_ends_at - interval '1 second')->>'state') as before_end,
         (public.seller_subscription_eval($1, extension_ends_at)->>'state') as at_end,
         (public.seller_subscription_eval($1, extension_ends_at)->>'canStartNewTrade') as at_end_trade,
         extension_starts_at < extension_ends_at as has_length
       from public.seller_subscriptions
       where seller_user_id = $1`,
      [A],
    )
    assert(extensionBoundary.rows[0].before_end === 'extension_active', '延長結束前一秒被當成到期')
    assert(extensionBoundary.rows[0].at_end === 'restricted' && extensionBoundary.rows[0].at_end_trade === 'false', '延長結束當下仍可新交易')
    assert(extensionBoundary.rows[0].has_length === true, '延長開始與結束被寫成同一點')
    const extensionEndsText = await db.query(`select extension_ends_at::text as ends from public.seller_subscriptions where seller_user_id = $1`, [A])
    await asUser(ADMIN)
    await expectFail(
      `select public.admin_review_seller_extension($1, true, '再批一次')`,
      /已經審過|已經核准過/,
      '同一筆不能批准第二次',
      [requestId],
    )
    await db.query('RESET ROLE')
    const stillOnce = await db.query(
      `select extension_ends_at::text = $2 as unchanged,
              (select count(*)::int from public.seller_extension_requests where seller_user_id = $1 and status = 'approved') as approved
       from public.seller_subscriptions where seller_user_id = $1`,
      [A, extensionEndsText.rows[0].ends],
    )
    assert(stillOnce.rows[0].unchanged === true && stillOnce.rows[0].approved === 1, '重複批准改了期限或核准了兩次')
    await asUser(A)
    await expectFail(`select public.apply_my_seller_extension()`, /只能提出一次/, '核准後不能再申請')
    const refused = await db.query(`select public.reject_seller_subscription_payment() as result`)
    assert(refused.rows[0].result.ok === false && refused.rows[0].result.paymentStatus === 'unpaid', '立即訂閱被當成付款成功')
    pass('核准立即進入延長中，不收款，重複批准不會重設 15 天')

    await db.query('RESET ROLE')
    await db.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values ($1, now() - interval '40 days', now() - interval '1 day')`,
      [B],
    )
    await asUser(B)
    const second = await db.query(`select public.apply_my_seller_extension() as state`)
    const secondId = (second.rows[0].state.requests as Array<{ id: string; status: string }>).find((row) => row.status === 'pending')?.id
    assert(secondId, '第二位賣家沒有待審申請')
    await db.query('RESET ROLE')
    await asUser(ADMIN)
    const rejected = await db.query(`select public.admin_review_seller_extension($1, false, '這次先拒絕') as state`, [secondId])
    assert(rejected.rows[0].state.state === 'restricted' && rejected.rows[0].state.extensionQualificationUsed === true, '拒絕後仍可再申請')
    assert(rejected.rows[0].state.canApplyExtension === false, '拒絕後畫面仍允許申請')
    await db.query('RESET ROLE')
    const rejectedDates = await db.query(
      `select extension_starts_at, extension_ends_at,
              (select count(*)::int from public.seller_extension_requests where seller_user_id = $1) as requests
       from public.seller_subscriptions where seller_user_id = $1`,
      [B],
    )
    assert(rejectedDates.rows[0].extension_starts_at === null && rejectedDates.rows[0].requests === 1, '拒絕寫入延長或留下兩筆申請')
    await asUser(B)
    await expectFail(`select public.apply_my_seller_extension()`, /只能提出一次/, '拒絕後的第二次申請沒有被拒絕')
    pass('拒絕後不能再提出延長申請')

    await db.query('RESET ROLE')
    await db.query(
      `update public.seller_subscriptions
       set trial_starts_at = now() - interval '1 day', trial_ends_at = now() + interval '1 day'
       where seller_user_id = $1`,
      [A],
    )
    await db.query(`select set_config('hengjing.commerce_write', 'on', true), set_config('hengjing.commerce_checkout', 'on', true)`)
    const batch = await db.query(
      `insert into public.checkout_batches (buyer_id, idempotency_key, request_hash)
       values ($1, gen_random_uuid(), md5('seller-subscription-old-order')) returning id`,
      [BUYER],
    )
    const order = await db.query(
      `insert into public.orders (
         display_no, batch_id, buyer_id, seller_id, payment_method, fulfillment_method,
         stock_hold_expires_at, items_subtotal, order_total, recipient_name, recipient_phone, recipient_address
       ) values (
         'HJ20300115-100001', $1, $2, $3, 'ecpay', 'home_delivery',
         '2030-01-20 00:00:00+08', 100, 100, '舊訂單收件人', '0912000000', '台北市中正區測試路1號'
       ) returning id`,
      [batch.rows[0].id, BUYER, A],
    )
    await db.query(
      `update public.seller_subscriptions
       set trial_ends_at = now() - interval '1 minute',
           extension_starts_at = now() - interval '2 minutes',
           extension_ends_at = now() - interval '1 minute'
       where seller_user_id = $1`,
      [A],
    )
    await expectFail(
      `insert into public.orders (
         display_no, batch_id, buyer_id, seller_id, payment_method, fulfillment_method,
         stock_hold_expires_at, items_subtotal, order_total, recipient_name, recipient_phone, recipient_address
       ) values (
         'HJ20300201-100002', $1, $2, $3, 'ecpay', 'home_delivery',
         '2030-02-20 00:00:00+08', 100, 100, '新訂單收件人', '0912000000', '台北市中正區測試路1號'
       )`,
      /賣家月費到期，不能建立新交易/,
      '到期後不能直接建立新訂單',
      [batch.rows[0].id, BUYER, A],
    )
    await db.query(`update public.orders set recipient_name = '履約仍可更新' where id = $1`, [order.rows[0].id])
    await expectFail(
      `update public.orders set fulfillment_status = 'shipped' where id = $1`,
      /金流尚未串接/,
      '到期後變更出貨狀態仍只被金流未串接擋住',
      [order.rows[0].id],
    )
    await asUser(A)
    const cancelled = await db.query(`select public.seller_cancel_unpaid_order($1) as result`, [order.rows[0].id])
    assert(cancelled.rows[0].result.ok === true, '到期後不能處理舊訂單')
    await db.query('RESET ROLE')
    const kept = await db.query(`select count(*)::int as n from public.orders where id = $1`, [order.rows[0].id])
    assert(kept.rows[0].n === 1, '舊訂單被刪掉')
    const product = await db.query(`select count(*)::int as n from public.products`)
    assert(product.rows[0].n >= 0, '商品資料被清掉')
    pass('到期只擋新訂單，舊訂單仍可取消')

    await db.query('RESET ROLE')
    await asUser(A)
    const productRow = await db.query(
      `insert into public.products (name, price, active, draft, flagged, review_hold)
       values ('月費測試商品', 120, true, false, false, false) returning id`,
    )
    await db.query('RESET ROLE')
    await asUser(BUYER)
    await expectFail(
      `select public.place_checkout(gen_random_uuid(), jsonb_build_array(jsonb_build_object('productId', $1::text, 'qty', 1)), '{}'::jsonb, '{}'::jsonb, '測試收件', '0912000000', '台北市中正區測試路1號', null)`,
      /賣家月費到期，不能建立新交易/,
      '結帳程序會拒絕到期賣家',
      [productRow.rows[0].id],
    )
    await db.query('RESET ROLE')
    const checkoutFlag = await db.query(`select checkout_enabled from public.commerce_settings where id = true`)
    assert(checkoutFlag.rows[0].checkout_enabled === false, '測試改了全站結帳開關')
    pass('結帳程序在全站開關仍關閉時也拒絕到期賣家的新交易')

    await db.query('RESET ROLE')
    const chat = await db.query(
      `insert into public.seller_chats (buyer_id, seller_user_id) values ($1, $2) returning id`,
      [BUYER, A],
    )
    await asUser(A)
    const message = await db.query(`select public.send_seller_chat_message($1, '舊客戶仍可聯絡') as message`, [chat.rows[0].id])
    assert(message.rows[0].message.body === '舊客戶仍可聯絡', '到期後不能聊天')
    pass('到期不阻止賣家回覆聊天')

    await db.query('ROLLBACK')
  } catch (err) {
    await db.query('ROLLBACK')
    throw err
  }

  const existingSeller = 'f1700000-0000-4000-8000-0000000000e2'
  const newSeller = 'f1700000-0000-4000-8000-0000000000e3'
  const conflictSeller = 'f1700000-0000-4000-8000-0000000000e4'
  const paidSeller = 'f1700000-0000-4000-8000-0000000000e5'
  const laterSeller = 'f1700000-0000-4000-8000-0000000000e6'
  await db.query('BEGIN')
  try {
    await db.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'seller-sub-existing@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($2, 'seller-sub-new@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($3, 'seller-sub-conflict@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($4, 'seller-sub-paid@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($5, 'seller-sub-later@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [existingSeller, newSeller, conflictSeller, paidSeller, laterSeller],
    )
    await db.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'seller-sub-admin@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [ADMIN],
    )
    await db.query(
      `insert into public.profiles (id) values ($1), ($2), ($3), ($4), ($5), ($6) on conflict (id) do nothing`,
      [existingSeller, newSeller, conflictSeller, paidSeller, laterSeller, ADMIN],
    )
    await db.query(`set local session_replication_role = replica`)
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [ADMIN])
    await db.query(`set local session_replication_role = origin`)
    await db.query(
      `insert into public.seller_applications (user_id, store_name, status, created_at) values
        ($1, '啟用前店', 'approved', now() - interval '40 days'),
        ($2, '衝突店', 'approved', now() - interval '10 days'),
        ($3, '已付費店', 'approved', now() - interval '3 days')`,
      [existingSeller, conflictSeller, paidSeller],
    )
    await db.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values ($1, '2031-01-01 00:00:00+08', '2031-01-31 00:00:00+08')`,
      [conflictSeller],
    )
    await db.query(
      `insert into public.seller_subscriptions (
         seller_user_id, payment_status, paid_starts_at, paid_ends_at
       ) values ($1, 'paid', now() - interval '1 day', now() + interval '20 days')`,
      [paidSeller],
    )
    await asUser(ADMIN)
    await expectFail(`select public.admin_enable_seller_subscriptions()`, /沒有覆蓋|沒有另外寫入/, '已有期限的賣家會擋住啟用，不會被覆蓋')
    await db.query('RESET ROLE')
    const untouched = await db.query(
      `select
         (select enabled_at is null from public.seller_subscription_settings) as disabled,
         (select trial_starts_at = '2031-01-01 00:00:00+08' from public.seller_subscriptions where seller_user_id = $1) as conflict_kept,
         (select payment_status = 'paid' and trial_starts_at is null from public.seller_subscriptions where seller_user_id = $2) as paid_kept`,
      [conflictSeller, paidSeller],
    )
    assert(untouched.rows[0].disabled === true && untouched.rows[0].conflict_kept === true && untouched.rows[0].paid_kept === true, '衝突時仍寫入啟用時間或覆蓋期限')
    await db.query(`delete from public.seller_applications where user_id in ($1, $2)`, [conflictSeller, paidSeller])
    await db.query(
      `delete from public.seller_subscriptions
       where seller_user_id in (select user_id from public.seller_applications where status = 'approved')
         and seller_user_id <> $1`,
      [existingSeller],
    )
    await asUser(ADMIN)
    const firstEnable = await db.query(`select public.admin_enable_seller_subscriptions() as result`)
    assert(firstEnable.rows[0].result.alreadyEnabled === false && Number(firstEnable.rows[0].result.sellersStarted) >= 1, '第一次啟用沒有寫入')
    await db.query('RESET ROLE')
    const started = await db.query(
      `select s.trial_starts_at = p.enabled_at as from_enable,
              s.trial_ends_at = s.trial_starts_at + interval '30 days' as full_month,
              s.trial_starts_at > a.created_at as not_backdated,
              p.enabled_at as enabled_at,
              s.trial_starts_at as trial_starts_at
       from public.seller_subscriptions s
       join public.seller_applications a on a.user_id = s.seller_user_id
       cross join public.seller_subscription_settings p
       where s.seller_user_id = $1`,
      [existingSeller],
    )
    assert(started.rows[0].from_enable === true && started.rows[0].full_month === true && started.rows[0].not_backdated === true, '既有賣家沒有從啟用時間起算完整 30 天')
    await asUser(ADMIN)
    const secondEnable = await db.query(`select public.admin_enable_seller_subscriptions() as result`)
    assert(secondEnable.rows[0].result.alreadyEnabled === true && Number(secondEnable.rows[0].result.sellersStarted) === 0, '重複啟用又起算一次')
    await db.query('RESET ROLE')
    const repeated = await db.query(
      `select s.trial_starts_at = p.enabled_at as from_enable,
              s.trial_ends_at = s.trial_starts_at + interval '30 days' as full_month,
              s.trial_starts_at > a.created_at as not_backdated
       from public.seller_subscriptions s
       join public.seller_applications a on a.user_id = s.seller_user_id
       cross join public.seller_subscription_settings p
       where s.seller_user_id = $1`,
      [existingSeller],
    )
    assert(repeated.rows[0].from_enable === true && repeated.rows[0].full_month === true && repeated.rows[0].not_backdated === true, '重複啟用重設了期限')
    await db.query(
      `insert into public.seller_applications (user_id, store_name, status) values ($1, '啟用後店', 'pending')`,
      [newSeller],
    )
    await asUser(ADMIN)
    await db.query(`update public.seller_applications set status = 'approved' where user_id = $1 and status = 'pending'`, [newSeller])
    await db.query('RESET ROLE')
    const fresh = await db.query(
      `select s.trial_starts_at = a_time.approved_at as from_approval,
              s.trial_ends_at = s.trial_starts_at + interval '30 days' as full_month,
              s.trial_starts_at = p.enabled_at as same_clock
       from public.seller_subscriptions s
       cross join public.seller_subscription_settings p
       cross join lateral (select now() as approved_at) a_time
       where s.seller_user_id = $1`,
      [newSeller],
    )
    assert(fresh.rows[0].from_approval === true && fresh.rows[0].full_month === true && fresh.rows[0].same_clock === true, '新賣家沒有從審核通過時間起算')
    await asUser(ADMIN)
    const secondReview = await db.query(`update public.seller_applications set status = 'approved' where user_id = $1`, [newSeller])
    assert(secondReview.rowCount === 0, '已經通過的審核被再改一次')
    pass('已經通過的審核不能再改一次')
    await db.query('RESET ROLE')
    const renamed = await db.query(
      `select s.trial_starts_at = p.enabled_at as same,
              s.trial_ends_at = s.trial_starts_at + interval '30 days' as full_month
       from public.seller_subscriptions s
       cross join public.seller_subscription_settings p
       where s.seller_user_id = $1`,
      [newSeller],
    )
    assert(renamed.rows[0].same === true && renamed.rows[0].full_month === true, '重複通過審核重設了試營業')
    await db.query(`insert into public.profiles (id) values ($1) on conflict (id) do nothing`, [laterSeller])
    await db.query(
      `select public.seller_subscription_ensure_trial($1, (select enabled_at + interval '10 days' from public.seller_subscription_settings))`,
      [laterSeller],
    )
    const later = await db.query(
      `select s.trial_starts_at = p.enabled_at + interval '10 days' as from_later_approval,
              s.trial_ends_at = s.trial_starts_at + interval '30 days' as full_month
       from public.seller_subscriptions s
       cross join public.seller_subscription_settings p
       where s.seller_user_id = $1`,
      [laterSeller],
    )
    assert(later.rows[0].from_later_approval === true && later.rows[0].full_month === true, '較晚通過的賣家被拉回啟用時間')
    await expectFail(
      `select public.seller_subscription_ensure_trial($1, now() + interval '3 days')`,
      /沒有覆蓋/,
      '不同的試營業起算會被拒絕',
      [laterSeller],
    )
    const laterKept = await db.query(
      `select s.trial_starts_at = p.enabled_at + interval '10 days' as same
       from public.seller_subscriptions s
       cross join public.seller_subscription_settings p
       where s.seller_user_id = $1`,
      [laterSeller],
    )
    assert(laterKept.rows[0].same === true, '衝突檢查仍改了較晚賣家的期限')
    await db.query(
      `insert into public.seller_extension_requests (seller_user_id, status) values ($1, 'pending')`,
      [paidSeller],
    )
    const paidRequest = await db.query(`select id from public.seller_extension_requests where seller_user_id = $1`, [paidSeller])
    await asUser(ADMIN)
    await expectFail(
      `select public.admin_review_seller_extension($1, true, '不應核准')`,
      /有效訂閱/,
      '有效訂閱不會被核准延長覆蓋',
      [paidRequest.rows[0].id],
    )
    await db.query('RESET ROLE')
    const paidKept = await db.query(
      `select payment_status = 'paid' as paid,
              extension_starts_at is null as no_extension,
              (select status from public.seller_extension_requests where seller_user_id = $1) as request_status
       from public.seller_subscriptions where seller_user_id = $1`,
      [paidSeller],
    )
    assert(paidKept.rows[0].paid === true && paidKept.rows[0].no_extension === true && paidKept.rows[0].request_status === 'pending', '有效訂閱的核准失敗後仍寫入延長')
    await asUser(existingSeller)
    await expectFail(`select public.admin_enable_seller_subscriptions()`, /沒有權限/, '賣家不能自行啟用制度')
    await db.query('ROLLBACK')
    pass('新舊賣家起算、重複啟用與有效訂閱衝突都沒有寫出這次交易')
  } catch (err) {
    await db.query('ROLLBACK')
    throw err
  }

  const raceSeller = 'e1700000-0000-4000-8000-0000000000e1'
  const c1 = openClient()
  const c2 = openClient()
  await c1.connect()
  await c2.connect()
  try {
    await c1.query('BEGIN')
    await c1.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'seller-sub-race@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [raceSeller],
    )
    await c1.query(`insert into public.profiles (id) values ($1) on conflict (id) do nothing`, [raceSeller])
    await c1.query(`insert into public.seller_applications (user_id, store_name, status) values ($1, '月費併發店', 'approved')`, [raceSeller])
    await c1.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values ($1, now() - interval '40 days', now() - interval '1 day')`,
      [raceSeller],
    )
    await c1.query('COMMIT')
    await c1.query('BEGIN')
    await c2.query('BEGIN')
    await asClient(c1, raceSeller)
    await asClient(c2, raceSeller)
    await c1.query(`select public.apply_my_seller_extension()`)
    const second = c2.query(`select public.apply_my_seller_extension()`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    await c1.query('COMMIT')
    let rejected = false
    try {
      await second
    } catch (err) {
      rejected = /已經有待審申請/.test(err instanceof Error ? err.message : String(err))
    }
    assert(rejected, '兩個分頁同時申請時，第二次沒有被拒絕')
    await c2.query('ROLLBACK')
    const left = await db.query(`select count(*)::int as n from public.seller_extension_requests where seller_user_id = $1 and status = 'pending'`, [raceSeller])
    assert(left.rows[0].n === 1, '同時申請留下的待審不是一筆')
    pass('兩個分頁同時申請只留下一筆待審')
  } finally {
    await c1.query('ROLLBACK').catch(() => undefined)
    await c2.query('ROLLBACK').catch(() => undefined)
    await db.query('RESET ROLE')
    await db.query(`delete from public.seller_extension_requests where seller_user_id = $1`, [raceSeller])
    await db.query(`delete from public.seller_subscriptions where seller_user_id = $1`, [raceSeller])
    await db.query(`delete from public.seller_applications where user_id = $1`, [raceSeller])
    await db.query(`delete from public.profiles where id = $1`, [raceSeller])
    await db.query(`delete from auth.users where id = $1`, [raceSeller])
    await c1.end()
    await c2.end()
  }

  await verifyInstallEdges()

  const after = await snapshot()
  assert(JSON.stringify(after) === JSON.stringify(before), `測試資料沒有還原：${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  pass('隔離庫測試資料已還原，全站結帳開關仍關閉')

  await db.end()
  console.log(`seller subscription local test passed: ${passed.length} checks`)
}

async function verifyInstallEdges() {
  const seller = 'f1700000-0000-4000-8000-0000000000f6'
  const file1 = readFileSync('supabase/manual/20261117010000_seller_subscription_apply.sql', 'utf8').replace(/\r\n/g, '\n')
  const statement = (marker: string) => {
    const at = file1.indexOf(marker)
    const end = file1.indexOf('\n$$;', at)
    if (at < 0 || end < 0) throw new Error(`第一支找不到 ${marker}`)
    return file1.slice(at, end + '\n$$;'.length)
  }

  await db.query('BEGIN')
  await db.query(
    `insert into auth.users (id, email, aud, role, instance_id) values
      ($1, 'seller-sub-edge@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
    [seller],
  )
  await db.query(
    `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
     values ($1, '2032-01-01 00:00:00+08', '2032-01-31 00:00:00+08')`,
    [seller],
  )
  await db.query(
    `insert into public.seller_extension_requests (seller_user_id, status, reviewed_at, reviewed_by, note)
     values ($1, 'rejected', '2032-02-01 00:00:00+08', $1, '預檢')`,
    [seller],
  )
  const beforeRow = await db.query(
    `select trial_starts_at::text as trial_starts, trial_ends_at::text as trial_ends,
            (select status from public.seller_extension_requests where seller_user_id = $1) as status,
            (select enabled_at is null from public.seller_subscription_settings) as enable_unset
       from public.seller_subscriptions where seller_user_id = $1`,
    [seller],
  )
  await db.query(sqlBody('supabase/manual/20261117020000_seller_subscription_start_rules.sql'))
  const afterRow = await db.query(
    `select trial_starts_at::text as trial_starts, trial_ends_at::text as trial_ends,
            (select status from public.seller_extension_requests where seller_user_id = $1) as status,
            (select enabled_at is null from public.seller_subscription_settings) as enable_unset
       from public.seller_subscriptions where seller_user_id = $1`,
    [seller],
  )
  assert(JSON.stringify(beforeRow.rows[0]) === JSON.stringify(afterRow.rows[0]), '重複套用第二支改了期限、申請或啟用時間')
  await db.query('ROLLBACK')
  pass('重複套用第二支不改期限、申請紀錄或啟用時間')

  await db.query('BEGIN')
  await db.query(`
    DO $rewrite$
    DECLARE def text;
    BEGIN
      def := pg_get_functiondef('public.seller_subscription_eval(uuid, timestamptz)'::regprocedure);
      def := replace(def, '尚未起算', '尚未起算x');
      EXECUTE def;
    END
    $rewrite$
  `)
  const unknown = await db.query(precheckSql())
  assert(unknown.rows[0].judgment === '不相容' && String(unknown.rows[0].reason).includes('未知版本'), `未知版本沒有被預檢擋下：${unknown.rows[0].judgment} ${unknown.rows[0].reason}`)
  await db.query('ROLLBACK')
  pass('未知函式版本的預檢為不相容')

  await db.query('BEGIN')
  await db.query(`drop trigger if exists seller_applications_subscription_trial on public.seller_applications`)
  await db.query(`drop function if exists public.admin_enable_seller_subscriptions()`)
  await db.query(`drop function if exists public.seller_subscription_on_seller_approved()`)
  await db.query(`drop function if exists public.seller_subscription_ensure_trial(uuid, timestamptz)`)
  await db.query(`drop function if exists public.seller_subscription_policy()`)
  await db.query(`drop table if exists public.seller_subscription_settings`)
  await db.query(`drop index if exists public.seller_extension_one_request`)
  for (const marker of [
    'CREATE OR REPLACE FUNCTION public.seller_subscription_eval(p_seller uuid, p_at timestamptz)',
    'CREATE OR REPLACE FUNCTION public.apply_my_seller_extension()',
    'CREATE OR REPLACE FUNCTION public.admin_review_seller_extension(p_id uuid, p_approve boolean, p_note text)',
    'CREATE OR REPLACE FUNCTION public.get_my_seller_subscription()',
  ]) {
    await db.query(statement(marker))
  }
  const onlyFirst = await db.query(precheckSql())
  assert(onlyFirst.rows[0].judgment === '僅第一支已安裝', `只留第一支時預檢不是該狀態：${onlyFirst.rows[0].judgment} ${onlyFirst.rows[0].reason} ${onlyFirst.rows[0].snapshot}`)
  await db.query(
    `insert into auth.users (id, email, aud, role, instance_id) values
      ($1, 'seller-sub-edge@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
    [seller],
  )
  await db.query(
    `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
     values ($1, '2033-03-01 00:00:00+08', '2033-03-31 00:00:00+08')`,
    [seller],
  )
  const kept = await db.query(`select trial_starts_at::text as trial_starts, trial_ends_at::text as trial_ends from public.seller_subscriptions where seller_user_id = $1`, [seller])
  await db.query(sqlBody('supabase/manual/20261117010000_seller_subscription_apply.sql'))
  const keptAfter = await db.query(`select trial_starts_at::text as trial_starts, trial_ends_at::text as trial_ends from public.seller_subscriptions where seller_user_id = $1`, [seller])
  assert(JSON.stringify(kept.rows[0]) === JSON.stringify(keptAfter.rows[0]), '在只有第一支時重複套用第一支改了期限')
  const stillFirst = await db.query(precheckSql())
  assert(stillFirst.rows[0].judgment === '僅第一支已安裝', '重複套用第一支之後不再是僅第一支')
  await db.query('ROLLBACK')
  pass('僅第一支的預檢正確，重複套用第一支不改期限')

  await db.query('BEGIN')
  await db.query(`
    DO $unpatch$
    DECLARE def text;
    BEGIN
      def := pg_get_functiondef('public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb)'::regprocedure);
      def := replace(def, 'PERFORM public.seller_subscription_refuse_new_trades(p_lines);' || E'\\n  ', '');
      EXECUTE def;
    END
    $unpatch$
  `)
  await db.query(`drop trigger if exists orders_seller_subscription_guard on public.orders`)
  await db.query(`drop trigger if exists seller_applications_subscription_trial on public.seller_applications`)
  for (const fn of [
    'public.admin_enable_seller_subscriptions()',
    'public.seller_subscription_on_seller_approved()',
    'public.seller_subscription_ensure_trial(uuid, timestamptz)',
    'public.seller_subscription_policy()',
    'public.get_my_seller_subscription()',
    'public.apply_my_seller_extension()',
    'public.admin_review_seller_extension(uuid, boolean, text)',
    'public.admin_list_seller_extensions()',
    'public.reject_seller_subscription_payment()',
    'public.orders_block_expired_seller_subscription()',
    'public.seller_subscription_refuse_new_trades(jsonb)',
    'public.seller_subscription_new_trade_allowed(uuid, timestamptz)',
    'public.seller_subscription_eval(uuid, timestamptz)',
    'public.seller_subscription_remaining(timestamptz, timestamptz)',
    'public.seller_subscription_taipei(timestamptz)',
    'public.seller_plan_quote()',
  ]) {
    await db.query(`drop function if exists ${fn}`)
  }
  await db.query(`drop table if exists public.seller_extension_requests`)
  await db.query(`drop table if exists public.seller_subscriptions`)
  await db.query(`drop table if exists public.seller_subscription_settings`)
  const blank = await db.query(precheckSql())
  assert(blank.rows[0].judgment === '尚未安裝', `拆掉訂閱物件後預檢不是尚未安裝：${blank.rows[0].judgment} ${blank.rows[0].reason} ${blank.rows[0].snapshot}`)
  await db.query('ROLLBACK')
  const restored = await db.query(`select to_regprocedure('public.place_checkout(uuid, jsonb, jsonb, jsonb, text, text, text, jsonb)') is not null as checkout_fn`)
  assert(restored.rows[0].checkout_fn === true, '還原後結帳函式不見了')
  pass('尚未安裝的預檢正確，還原後結帳函式仍在')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
