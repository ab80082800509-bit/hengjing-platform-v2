/**
 * 第八階段第 3 批：賣家月費付款單與藍新通知核對。
 * 只連隔離庫 127.0.0.1:54322。不改方案金額，不送出藍新，不啟用訂閱制度，不開結帳。
 */
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import {
  decryptTradeInfo,
  encryptTradeInfo,
  mpgTradeQuery,
  NEWEBPAY_SAMPLE_IV,
  NEWEBPAY_SAMPLE_KEY,
  NEWEBPAY_SAMPLE_QUERY,
  readNewebpayNotice,
  tradeSha,
  type NewebpayFields,
} from '../lib/newebpay-mpg.ts'
import { isolatedSellerPaymentDatabaseUrl, newebpayTestCredentials } from '../lib/seller-subscription-newebpay.ts'

const HOST = '127.0.0.1'
const PORT = 54322
const DB_CONTAINER = 'supabase_db_hengjing-stage45-local'
const SELLER = 'a1705000-0000-4000-8000-0000000000a1'
const OTHER = 'a1705000-0000-4000-8000-0000000000b2'
const MERCHANT = '3430112'
const KEY = NEWEBPAY_SAMPLE_KEY
const IV = NEWEBPAY_SAMPLE_IV
const SAMPLE_INFO =
  'ff91c8aa01379e4de621a44e5f11f72e4d25bdb1a18242db6cef9ef07d80b0165e476fd1d9acaa53170272c82d122961e1a0700a7427cfa1cf90db7f6d6593bbc93102a4d4b9b66d9974c13c31a7ab4bba1d4e0790f0cbbbd7ad64c6d3c8012a601ceaa808bff70f94a8efa5a4f984b9d41304ffd879612177c622f75f4214fa'
const SAMPLE_SHA = 'EA0A6CC37F40C1EA5692E7CBB8AE097653DF3E91365E6A9CD7E91312413C7BB8'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const passed: string[] = []
const pass = (name: string) => {
  passed.push(name)
  console.log(`  ✓ ${name}`)
}

function runFile(file: string) {
  execSync(`docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -v ON_ERROR_STOP=1`, {
    input: readFileSync(file),
  })
}

const password = execSync(`docker exec ${DB_CONTAINER} printenv POSTGRES_PASSWORD`, { encoding: 'utf8' }).trim()
const db = new pg.Client({ host: HOST, port: PORT, user: 'postgres', password, database: 'postgres' })

async function asUser(userId: string) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await db.query('SET LOCAL ROLE authenticated')
}

async function expectFail(sql: string, pattern: RegExp, name: string, params: unknown[] = []) {
  await db.query('SAVEPOINT expect_fail')
  try {
    await db.query(sql, params)
    throw new Error(`${name}：沒有失敗`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.query('ROLLBACK TO SAVEPOINT expect_fail')
    assert(pattern.test(message), `${name}：得到「${message}」`)
    pass(name)
  }
}

function signed(orderNo: string, amt: number | string, extra: Record<string, unknown> = {}, outer = 'SUCCESS', inner = outer) {
  const plain = JSON.stringify({
    Status: inner,
    Message: inner === 'SUCCESS' ? '授權成功' : '交易失敗',
    Result: {
      MerchantID: MERCHANT,
      Amt: amt,
      TradeNo: extra.TradeNo ?? '17012411541818970',
      MerchantOrderNo: orderNo,
      PaymentType: 'CREDIT',
      PayTime: extra.PayTime === undefined ? '2026-11-23 16:20:00' : extra.PayTime,
      RespondType: 'JSON',
      ...extra,
    },
  })
  const tradeInfo = encryptTradeInfo(plain, KEY, IV)
  const fields: NewebpayFields = {
    Status: outer,
    MerchantID: MERCHANT,
    TradeInfo: tradeInfo,
    TradeSha: tradeSha(tradeInfo, KEY, IV),
    Version: '1.6',
  }
  return fields
}

async function ledger(fields: NewebpayFields) {
  const notice = readNewebpayNotice(fields, KEY, IV, MERCHANT)
  assert(notice.ok, `通知沒有通過驗證：${notice.ok ? '' : notice.code}`)
  if (!notice.ok) throw new Error('unreachable')
  const recorded = await db.query(`select public.record_seller_subscription_payment_notice($1::jsonb) as result`, [
    JSON.stringify(notice.payload),
  ])
  return recorded.rows[0].result as { ok: boolean; outcome: string; credited: boolean; status: string; periodWritten: boolean }
}

async function period(userId: string) {
  const row = await db.query(
    `select payment_status, paid_starts_at::text, paid_ends_at::text, trial_starts_at::text, trial_ends_at::text,
            extension_starts_at::text, extension_ends_at::text
     from public.seller_subscriptions where seller_user_id = $1`,
    [userId],
  )
  return JSON.stringify(row.rows)
}

async function main() {
  const info = encryptTradeInfo(NEWEBPAY_SAMPLE_QUERY, NEWEBPAY_SAMPLE_KEY, NEWEBPAY_SAMPLE_IV)
  assert(info === SAMPLE_INFO, '交易資料 AES 和藍新範例不同')
  assert(tradeSha(info, NEWEBPAY_SAMPLE_KEY, NEWEBPAY_SAMPLE_IV) === SAMPLE_SHA, 'TradeSha 和藍新範例不同')
  assert(decryptTradeInfo(info, NEWEBPAY_SAMPLE_KEY, NEWEBPAY_SAMPLE_IV) === NEWEBPAY_SAMPLE_QUERY, '解密沒有還原範例')
  const broken: NewebpayFields = { ...signed('fix40ok', 40), TradeSha: `${SAMPLE_SHA.slice(0, 63)}0` }
  assert(readNewebpayNotice(broken, KEY, IV, MERCHANT).ok === false, '錯誤的 TradeSha 被當成通過')
  const fractional = signed('fix40ok', 523.95)
  const fractionalNotice = readNewebpayNotice(fractional, KEY, IV, MERCHANT)
  assert(fractionalNotice.ok && fractionalNotice.payload.amt === '523.95', '小數金額被改成整數')
  assert(isolatedSellerPaymentDatabaseUrl('postgresql://postgres:secret@127.0.0.1:54322/postgres'), '隔離庫位址被拒絕')
  assert(isolatedSellerPaymentDatabaseUrl('postgresql://postgres:secret@db.example.supabase.co:5432/postgres') === null, '正式庫位址被接受')
  const envText = `${readFileSync('.env.play.local', 'utf8')}\n${readFileSync('.env.local', 'utf8')}`
  assert(!envText.includes('NEWEBPAY_'), '隔離或正式環境檔裡已有藍新憑證，這支測試不該拿來送出交易')
  assert(newebpayTestCredentials(process.env) === false, '目前行程已有藍新測試憑證')
  const sql = readFileSync('supabase/manual/20261117060000_seller_subscription_charge_420.sql', 'utf8')
  assert(!sql.includes('UPDATE public.seller_subscriptions') && !sql.includes('checkout_enabled'), '金額定案改了訂閱期限或結帳開關')
  assert(!sql.includes('ccore.newebpay.com') && !sql.includes('core.newebpay.com'), '金額定案自己送出藍新')
  const mpg = mpgTradeQuery({
    merchantId: MERCHANT,
    timeStamp: '1700000000',
    merchantOrderNo: 'sub420',
    amt: 420,
    itemDesc: '標準賣家方案月費',
  })
  assert(mpg.includes('Amt=420') && !mpg.includes('523'), '藍新交易資料沒有使用 Amt=420')
  let rejectedAmt = false
  try {
    mpgTradeQuery({ merchantId: MERCHANT, timeStamp: '1700000000', merchantOrderNo: 'sub420', amt: 523, itemDesc: '標準賣家方案月費' })
  } catch {
    rejectedAmt = true
  }
  assert(rejectedAmt, '不是 420 的金額仍能組成藍新交易')
  pass('藍新範例加解密、小數金額與 Amt=420')

  await db.connect()
  const beforeEval = await db.query(`select md5(pg_get_functiondef('public.seller_subscription_eval(uuid, timestamptz)'::regprocedure)) as md5`)
  const beforeQuote = await db.query(`select public.seller_plan_quote() as quote`)
  const beforePolicy = await db.query(
    `select (select enabled_at is null from public.seller_subscription_settings) as disabled,
            (select checkout_enabled from public.commerce_settings where id = true) as checkout`,
  )
  assert(beforePolicy.rows[0].disabled === true && beforePolicy.rows[0].checkout === false, '測試開始時制度或結帳不是關閉')
  if (Number(beforeQuote.rows[0].quote.gross) === 523.95) {
    runFile('supabase/manual/20261117050000_seller_subscription_payment.sql')
  }
  runFile('supabase/manual/20261117060000_seller_subscription_charge_420.sql')
  runFile('supabase/manual/20261117060000_seller_subscription_charge_420.sql')
  const afterEval = await db.query(`select md5(pg_get_functiondef('public.seller_subscription_eval(uuid, timestamptz)'::regprocedure)) as md5`)
  const afterQuote = await db.query(`select public.seller_plan_quote() as quote`)
  assert(beforeEval.rows[0].md5 === afterEval.rows[0].md5, '套用金額定案後改了期限判定')
  assert(Number(afterQuote.rows[0].quote.net) === 400 && Number(afterQuote.rows[0].quote.tax) === 20 && Number(afterQuote.rows[0].quote.gross) === 420, '伺服器報價不是 400、20、420')
  assert(Number(afterQuote.rows[0].quote.chargeAmt) === 420, '伺服器沒有把實收寫成 420')
  pass('金額定案可重跑，報價為 420，期限判定不變')

  await db.query('BEGIN')
  try {
    await db.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'seller-pay-a@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($2, 'seller-pay-b@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [SELLER, OTHER],
    )
    await db.query(`insert into public.profiles (id) values ($1), ($2) on conflict (id) do nothing`, [SELLER, OTHER])
    await db.query(
      `insert into public.seller_applications (user_id, store_name, status) values ($1, '月費付款店', 'approved')`,
      [SELLER],
    )
    await db.query(
      `insert into public.seller_subscriptions (seller_user_id, trial_starts_at, trial_ends_at)
       values ($1, '2030-01-01 00:00:00+08', '2030-01-31 00:00:00+08')`,
      [SELLER],
    )
    const originalPeriod = await period(SELLER)
    await db.query(
      `insert into public.seller_subscription_payments (
         seller_user_id, merchant_order_no, quote_net, quote_tax, quote_gross, status
       ) values ($1, 'fix523draft', 499.00, 24.95, 523.95, 'amount_pending')`,
      [SELLER],
    )

    await asUser(SELLER)
    const created = await db.query(`select public.create_my_seller_subscription_payment() as result`)
    const first = created.rows[0].result
    assert(first.ok === true && first.gatewayReady === false && first.collectionOpen === false && first.credited === false, '新付款單被送出或被入帳')
    assert(first.code === 'mpg_amt_420' && first.mpgAmt === 420, '新付款單沒有標成 Amt=420')
    assert(first.payment.quoteNet === '400.00' && first.payment.quoteTax === '20.00' && first.payment.quoteGross === '420.00', '新付款單沒有寫入 400、20、420')
    assert(first.payment.gatewayAmt === 420 && first.payment.mpgAmt === 420 && first.payment.merchantOrderNo !== 'fix523draft', '新付款單沿用了舊草稿或實收不是 420')
    assert(first.payment.periodWritten === false, '新付款單寫入了付費期限')
    const again = await db.query(`select public.create_my_seller_subscription_payment() as result`)
    assert(again.rows[0].result.reused === true && again.rows[0].result.payment.id === first.payment.id, '再按一次又產生一張 420 付款單')
    const listed = await db.query(`select public.list_my_seller_subscription_payments() as rows`)
    assert(listed.rows[0].rows.length === 2, '舊草稿與新付款單沒有同時留下')
    const queried = await db.query(`select public.get_my_seller_subscription_payment($1) as result`, [first.payment.merchantOrderNo])
    assert(queried.rows[0].result.payment.quoteGross === '420.00' && queried.rows[0].result.payment.gatewayAmt === 420, '查詢頁沒有顯示 420')
    await db.query('RESET ROLE')
    const legacy = await db.query(`select quote_gross::text as gross, gateway_amt from public.seller_subscription_payments where merchant_order_no = 'fix523draft'`)
    assert(legacy.rows[0].gross === '523.95' && legacy.rows[0].gateway_amt === null, '舊草稿的報價被改掉')
    assert(await period(SELLER) === originalPeriod, '建立付款單改了試營業或付費期限')
    pass('新付款單是 420，舊的 523.95 草稿保留原報價')

    await asUser(OTHER)
    const hidden = await db.query(`select public.get_my_seller_subscription_payment($1) as result`, [first.payment.merchantOrderNo])
    assert(hidden.rows[0].result.ok === false, '另一位使用者查到這張付款單')
    await expectFail(`select public.create_my_seller_subscription_payment()`, /通過賣家認證/, '未通過的使用者建立了付款單')
    await expectFail(`select public.record_seller_subscription_payment_notice('{"verified":true}'::jsonb)`, /permission denied/, '賣家可以自行入帳')
    await db.query('RESET ROLE')
    await db.query(`select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)`)
    await expectFail(`select public.create_my_seller_subscription_payment()`, /請先登入/, '未登入建立了付款單')
    await db.query('RESET ROLE')

    const mismatched = await ledger(signed(first.payment.merchantOrderNo, 421, { TradeNo: '17012411541818983' }))
    assert(mismatched.outcome === 'amount_mismatch' && mismatched.credited === false && mismatched.status === 'amount_pending', '金額不符仍入帳')
    const oldAmount = await ledger(signed(first.payment.merchantOrderNo, 523.95, { TradeNo: '17012411541818984' }))
    assert(oldAmount.outcome === 'amount_mismatch' && oldAmount.credited === false, '舊金額 523.95 被寫進 420 付款單')
    const legacyNotice = await ledger(signed('fix523draft', 420, { TradeNo: '17012411541818980' }))
    assert(legacyNotice.outcome === 'amount_undecided' && legacyNotice.credited === false, '舊草稿被 420 的通知入帳')
    const legacyStill = await db.query(`select quote_gross::text as gross, gateway_amt, status from public.seller_subscription_payments where merchant_order_no = 'fix523draft'`)
    assert(legacyStill.rows[0].gross === '523.95' && legacyStill.rows[0].gateway_amt === null && legacyStill.rows[0].status === 'amount_pending', '舊草稿被通知改寫')
    pass('金額不符與舊草稿都不入帳')

    const successFields = signed(first.payment.merchantOrderNo, 420, { TradeNo: '17012411541818970' })
    const success = await ledger(successFields)
    assert(success.outcome === 'credited' && success.status === 'paid' && success.periodWritten === false, 'Amt=420 的成功通知沒有入帳')
    const paidOnce = await db.query(`select status, trade_no, paid_at::text as paid_at, gateway_amt from public.seller_subscription_payments where id = $1`, [first.payment.id])
    const duplicate = await ledger(successFields)
    assert(duplicate.outcome === 'duplicate' && duplicate.credited === false, '同一張通知重複入帳')
    const paidStill = await db.query(`select status, trade_no, paid_at::text as paid_at, gateway_amt from public.seller_subscription_payments where id = $1`, [first.payment.id])
    assert(paidStill.rows[0].status === 'paid' && paidStill.rows[0].gateway_amt === 420 && paidStill.rows[0].trade_no === paidOnce.rows[0].trade_no && paidStill.rows[0].paid_at === paidOnce.rows[0].paid_at, '重複通知改了入帳時間、交易序號或金額')
    const secondSuccess = await ledger(signed(first.payment.merchantOrderNo, 420, { TradeNo: '17012411541818999', PayTime: '2026-11-23 16:25:00' }))
    assert(secondSuccess.outcome === 'duplicate' && secondSuccess.credited === false, '第二筆成功通知又入帳一次')
    const noticeCount = await db.query(
      `select count(*)::int as n from public.seller_subscription_payment_notices n
       where n.payment_id = $1 and n.outcome = 'credited'`,
      [first.payment.id],
    )
    assert(Number(noticeCount.rows[0].n) === 1, '成功入帳紀錄不是一筆')
    assert(await period(SELLER) === originalPeriod, '入帳後改了試營業、延長或付費期限')
    pass('420 元成功通知只入帳一次，重複通知不延長期限')

    await db.query(
      `insert into public.seller_subscription_payments (
         seller_user_id, merchant_order_no, quote_net, quote_tax, quote_gross, gateway_amt, merchant_id, status
       ) values
         ($1, 'fix420fail', 400.00, 20.00, 420.00, 420, $2, 'pending'),
         ($1, 'fix420take', 400.00, 20.00, 420.00, 420, $2, 'pending'),
         ($1, 'fix420shop', 400.00, 20.00, 420.00, 420, $2, 'pending')`,
      [SELLER, MERCHANT],
    )
    const failed = await ledger(signed('fix420fail', 420, { TradeNo: '17012411541818982', PayTime: '' }, 'MPG03009', 'MPG03009'))
    assert(failed.outcome === 'failed' && failed.credited === false && failed.status === 'failed', '失敗通知被入帳')
    const numbered = await ledger(signed('fix420take', 420, { TradeNo: '17012411541818985', PayTime: '' }))
    assert(numbered.outcome === 'not_payment' && numbered.status === 'pending', '取號成功被當成付款成功')
    const wrongShop = signed('fix420shop', 420, { TradeNo: '17012411541818986' })
    const wrongPlain = JSON.parse(decryptTradeInfo(wrongShop.TradeInfo, KEY, IV) ?? '{}') as { Result: { MerchantID: string } }
    wrongPlain.Result.MerchantID = '9999999'
    const wrongInfo = encryptTradeInfo(JSON.stringify(wrongPlain), KEY, IV)
    const wrongFields: NewebpayFields = { ...wrongShop, MerchantID: '9999999', TradeInfo: wrongInfo, TradeSha: tradeSha(wrongInfo, KEY, IV) }
    assert(readNewebpayNotice(wrongFields, KEY, IV, MERCHANT).ok === false, '商店代號不符仍通過驗證')
    const directMismatch = await db.query(`select public.record_seller_subscription_payment_notice($1::jsonb) as result`, [
      JSON.stringify({
        verified: true,
        outerStatus: 'SUCCESS',
        outerMerchantId: '9999999',
        resultStatus: 'SUCCESS',
        resultMerchantId: '9999999',
        merchantOrderNo: 'fix420shop',
        amt: '420',
        tradeNo: '17012411541818986',
        payTime: '2026-11-23 16:20:00',
        tradeSha: createHash('sha256').update('merchant-mismatch').digest('hex').toUpperCase(),
      }),
    ])
    assert(directMismatch.rows[0].result.outcome === 'merchant_mismatch' && directMismatch.rows[0].result.status === 'pending', '商店代號不符仍入帳')
    await expectFail(
      `select public.record_seller_subscription_payment_notice('{"verified":false,"tradeSha":"${SAMPLE_SHA}","merchantOrderNo":"fix420shop"}'::jsonb)`,
      /尚未通過驗證/,
      '未通過驗證的通知被收下',
    )
    const unknown = await ledger(signed('missingorder', 40, { TradeNo: '17012411541818987' }))
    assert(unknown.outcome === 'unknown_order' && unknown.credited === false, '不存在的訂單被入帳')
    await asUser(SELLER)
    await expectFail(
      `update public.seller_subscription_payments set status = 'paid', gateway_amt = 421 where merchant_order_no = 'fix420shop'`,
      /permission denied/,
      '賣家能改付款單金額或狀態',
    )
    await db.query('RESET ROLE')
    assert(await period(SELLER) === originalPeriod, '失敗、金額不符或商店不符之後改了期限')
    const policy = await db.query(
      `select (select enabled_at is null from public.seller_subscription_settings) as disabled,
              (select checkout_enabled from public.commerce_settings where id = true) as checkout`,
    )
    assert(policy.rows[0].disabled === true && policy.rows[0].checkout === false, '測試過程打開了制度或結帳')
    pass('失敗、金額不符、取號與商店不符都不會入帳')

    await db.query('ROLLBACK')
  } catch (err) {
    await db.query('ROLLBACK')
    throw err
  }

  const restored = await db.query(
    `select (select count(*)::int from public.seller_subscription_payments where seller_user_id = '${SELLER}') as payments,
            (select count(*)::int from public.seller_subscription_payments where quote_gross = 523.95 and gateway_amt is not null) as rewritten,
            (select enabled_at is null from public.seller_subscription_settings) as disabled,
            (select checkout_enabled from public.commerce_settings where id = true) as checkout`,
  )
  assert(Number(restored.rows[0].payments) === 0 && Number(restored.rows[0].rewritten) === 0, '測試付款單沒有回滾，或舊草稿被改成 420')
  assert(restored.rows[0].disabled === true && restored.rows[0].checkout === false, '回滾後制度或結帳不是關閉')
  pass('測試資料已回滾，制度與結帳維持關閉')
  console.log(`seller subscription payment local test passed: ${passed.length} checks`)
}

main()
  .catch(async (err) => {
    console.error(err)
    try {
      await db.query('ROLLBACK')
    } catch {
      // 連線可能已結束。
    }
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })
