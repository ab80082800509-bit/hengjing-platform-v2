/**
 * 賣家授權 Pay 點數兌換券：在本機隔離 Supabase（127.0.0.1:54322）單一交易內套用 SQL 並驗證，最後 ROLLBACK。
 * 不連正式專案，不留下任何資料列。單一連線無法模擬同時送出的兩個請求；並行保護靠函式內的建議鎖與列鎖。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const password = execSync('docker exec supabase_db_hengjing-stage45-local printenv POSTGRES_PASSWORD', { encoding: 'utf8' }).trim()
const db = new pg.Client({ host: '127.0.0.1', port: 54322, user: 'postgres', password, database: 'postgres' })

const SELLER = 'eeeeeeee-0000-4000-8000-000000000101'
const OTHER_SELLER = 'eeeeeeee-0000-4000-8000-000000000102'
const BUYER = 'eeeeeeee-0000-4000-8000-000000000201'
const BUYER_2 = 'eeeeeeee-0000-4000-8000-000000000202'
const BUYER_3 = 'eeeeeeee-0000-4000-8000-000000000203'

let failures = 0
let savepoint = 0
const check = (ok, name) => {
  if (ok) console.log(`  ✓ ${name}`)
  else {
    failures += 1
    console.log(`  ✗ ${name}`)
  }
}

async function asOwner() {
  await db.query('RESET ROLE')
}

async function asUser(id) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id])
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })])
  await db.query('SET LOCAL ROLE authenticated')
}

async function asAnon() {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', '', true)`)
  await db.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`)
  await db.query('SET LOCAL ROLE anon')
}

async function rpc(sql, params = []) {
  const name = `sp${++savepoint}`
  await db.query(`SAVEPOINT ${name}`)
  try {
    const result = await db.query(sql, params)
    await db.query(`RELEASE SAVEPOINT ${name}`)
    return { data: result.rows[0] ? Object.values(result.rows[0])[0] : null, error: null }
  } catch (err) {
    await db.query(`ROLLBACK TO SAVEPOINT ${name}`)
    return { data: null, error: err.message }
  }
}

async function balanceOf(id) {
  await asOwner()
  const row = await db.query('select coalesce((select balance from public.member_point_accounts where user_id = $1), 0) as b', [id])
  return row.rows[0].b
}

async function ledgerMatches(id) {
  await asOwner()
  const row = await db.query(
    `select coalesce((select balance from public.member_point_accounts where user_id = $1), 0) = coalesce((select sum(delta) from public.member_point_entries where user_id = $1), 0) as ok`,
    [id],
  )
  return row.rows[0].ok
}

async function seedUser(id, email) {
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', '{}'::jsonb, '{}'::jsonb, now(), now())`,
    [id, email],
  )
}

async function grantCheckin(id) {
  await db.query(`select set_config('app.reward_post', 'on', true)`)
  await db.query(
    `select public.post_member_reward($1, 'checkin', 'checkin:' || to_char(public.taipei_today(), 'YYYY-MM-DD'), 50, '{}'::jsonb)`,
    [id],
  )
  await db.query(`select set_config('app.reward_post', 'off', true)`)
}

const days = {}

async function loadDays() {
  const row = await db.query(`select to_char(public.taipei_today(), 'YYYY-MM-DD') as d0, to_char(public.taipei_today() + 20, 'YYYY-MM-DD') as d20, to_char(public.taipei_today() + 30, 'YYYY-MM-DD') as d30`)
  Object.assign(days, row.rows[0])
}

async function createCoupon(code, qty, shelf) {
  await asUser(SELLER)
  const result = await rpc(
    `select public.save_my_seller_coupon(null, jsonb_build_object(
      'name', $1::text, 'code', $1::text, 'kind', 'cash', 'amount', 50, 'percent', 0, 'maxDiscount', 0, 'gift', '',
      'minSpend', 500, 'qty', $2::int, 'startAt', $4::text, 'endAt', $5::text, 'listed', false, 'shelf', $3::boolean))`,
    [code, qty, shelf, days.d0, days.d20],
  )
  if (!result.data) throw new Error(`建立測試券失敗：${result.error}`)
  return result.data.id
}

const saveOffer = (couponId, enabled, cost, qty, endsOn = days.d20) =>
  rpc('select public.save_my_coupon_point_offer($1, $2, $3, $4, $5::date)', [couponId, enabled, cost, qty, endsOn])

const exchange = (couponId, cost) => rpc('select public.exchange_my_point_offer($1, $2)', [couponId, cost])
const listMall = () => rpc('select public.list_point_offer_coupons()')

async function main() {
  await db.connect()
  const apply = readFileSync(resolve('supabase/manual/20261029210000_seller_coupon_point_offers_apply.sql'), 'utf8')
  const body = apply.replace(/^BEGIN;\s*$/m, '').replace(/^NOTIFY pgrst.*$/m, '').replace(/^COMMIT;\s*$/m, '')

  const mallDefBefore = (await db.query(`select md5(pg_get_functiondef('public.get_my_points_mall()'::regprocedure)) as d`)).rows[0].d
  const exchangeDefBefore = (await db.query(`select md5(pg_get_functiondef('public.exchange_my_coupon(uuid)'::regprocedure)) as d`)).rows[0].d

  await db.query('BEGIN')
  try {
    await db.query(body)
    console.log('套用 SQL（交易內）：完成')

    await seedUser(SELLER, 'offer-seller@example.invalid')
    await seedUser(OTHER_SELLER, 'offer-other@example.invalid')
    await seedUser(BUYER, 'offer-buyer@example.invalid')
    await seedUser(BUYER_2, 'offer-buyer2@example.invalid')
    await seedUser(BUYER_3, 'offer-buyer3@example.invalid')
    await db.query(
      `insert into public.seller_applications (user_id, store_name, status) values ($1, '測試點數店', 'approved'), ($2, '別家店', 'approved')`,
      [SELLER, OTHER_SELLER],
    )
    for (const id of [SELLER, BUYER, BUYER_2, BUYER_3]) await grantCheckin(id)
    await loadDays()

    const couponA = await createCoupon('OFFERA1', 3, false)
    const couponB = await createCoupon('SHELFB1', 5, true)
    const couponC = await createCoupon('OFFERC1', 5, false)
    const couponD = await createCoupon('OFFERD1', 5, false)

    console.log('授權前')
    await asUser(BUYER)
    let mall = await listMall()
    check(mall.data && mall.data.coupons.length === 0, '沒有授權時購物優惠區是空的，一般券不會自動出現')
    check((await exchange(couponA, 30)).error?.includes('此優惠券未開放 Pay 點數兌換'), '未授權的券不能用點數兌換')
    check((await exchange(couponB, 100)).error?.includes('此優惠券未開放 Pay 點數兌換'), '賣場領取券不能被當成點數券')

    console.log('賣家授權')
    await asUser(OTHER_SELLER)
    check((await saveOffer(couponA, true, 30, 2)).error?.includes('不能管理其他商家的優惠券'), '其他商家不能授權別人的券')
    await asUser(BUYER)
    check((await saveOffer(couponA, true, 30, 2)).error?.includes('尚未通過賣家審核'), '一般會員不能授權')
    await asUser(SELLER)
    check((await saveOffer(couponA, true, 0, 2)).error?.includes('兌換所需點數需介於'), '點數必須由賣家設定在合理範圍')
    check((await saveOffer(couponA, true, 30, 4)).error?.includes('可兌換數量不可超過發行總數量'), '可兌換數量不能超過發行量')
    check((await saveOffer(couponA, true, 30, 2, days.d30)).error?.includes('不可晚於優惠券結束日'), '截止日不能晚於券期限')
    const savedA = await saveOffer(couponA, true, 30, 2)
    check(savedA.data?.enabled === true && savedA.data.pointsCost === 30 && savedA.data.pointsQty === 2, '賣家可自訂點數與數量並開放')
    check((await saveOffer(couponC, true, 40, 5)).data?.pointsCost === 40, '第二張券可設不同點數')
    check((await saveOffer(couponD, true, 10, 5)).data?.enabled === true, '第三張券授權')
    const mine = await rpc('select public.list_my_coupon_point_offers()')
    check(Array.isArray(mine.data) && mine.data.length === 3, '賣家只讀到自己的授權')
    check((await rpc('select count(*) from public.seller_coupon_point_offers')).error?.includes('permission denied'), '會員不能直接讀寫授權表')
    mall = await listMall()
    check(mall.data && mall.data.coupons.length === 0, '購物優惠區不列自己賣場的券')

    console.log('買家兌換')
    await asUser(BUYER)
    mall = await listMall()
    const ids = mall.data.coupons.map((c) => c.id)
    check(ids.includes(couponA) && ids.includes(couponC) && !ids.includes(couponB), '買家只看到已授權的券')
    const rowA = mall.data.coupons.find((c) => c.id === couponA)
    check(rowA?.sellerName === '測試點數店' && rowA.offer.pointsCost === 30 && rowA.offer.pointsQty - rowA.offer.pointsIssued === 2 && rowA.endAt, '清單有賣家名稱、點數、剩餘與期限')
    check((await exchange(couponA, 25)).error?.includes('兌換所需點數已變更'), '前端顯示的點數與目前授權不同時不扣點')
    check((await balanceOf(BUYER)) === 50, '價格不符時點數沒有變更')
    await asUser(BUYER)
    const first = await exchange(couponA, 30)
    check(first.data?.replayed === false && first.data.balance === 20 && first.data.cost === 30 && first.data.hold.source === 'points', '扣 30 點並發券')
    const wallet = await rpc('select public.list_my_coupon_wallet()')
    check(wallet.data?.some((h) => h.couponId === couponA && h.source === 'points'), '券存入既有券包')
    const again = await exchange(couponA, 30)
    check(again.data?.replayed === true && again.data.balance === 20, '重複送出不會再扣點')
    const shelfReplay = await rpc('select public.claim_storefront_coupon($1)', [couponA])
    check(shelfReplay.data?.replayed === true || shelfReplay.error, '同一張券不會再從賣場領第二張')
    check((await exchange(couponC, 40)).error?.includes('點數不足'), '點數不足時拒絕')
    check((await balanceOf(BUYER)) === 20, '點數不足時沒有扣點')
    await asOwner()
    const entries = await db.query(`select count(*)::int as n, sum(delta)::int as s from public.member_point_entries where user_id = $1 and kind = 'coupon_exchange'`, [BUYER])
    check(entries.rows[0].n === 1 && entries.rows[0].s === -30, '帳本只有一筆 -30')
    const holds = await db.query('select count(*)::int as n from public.member_coupon_holds where user_id = $1 and coupon_id = $2', [BUYER, couponA])
    check(holds.rows[0].n === 1, '只發一張券')
    const stock = await db.query('select c.issued_count, o.points_issued from public.seller_coupons c join public.seller_coupon_point_offers o on o.coupon_id = c.id where c.id = $1', [couponA])
    check(stock.rows[0].issued_count === 1 && stock.rows[0].points_issued === 1, '總庫存與點數兌換庫存各加 1')
    check(await ledgerMatches(BUYER), '餘額等於流水合計')

    console.log('數量控管')
    await asUser(BUYER_2)
    check((await exchange(couponA, 30)).data?.balance === 20, '第二位買家兌換成功')
    await asUser(BUYER_3)
    mall = await listMall()
    check(!mall.data.coupons.some((c) => c.id === couponA), '點數兌換數量用完後下架')
    check((await exchange(couponA, 30)).error?.includes('此優惠券的點數兌換已兌完'), '超額兌換被拒絕')
    check((await balanceOf(BUYER_3)) === 50, '超額時沒有扣點')

    console.log('期限、關閉與自家券')
    await asOwner()
    await db.query(`select set_config('app.point_offer_issue', 'off', true), set_config('app.point_offer_seller', 'on', true)`)
    await db.query(`update public.seller_coupon_point_offers set ends_on = public.taipei_today() - 1 where coupon_id = $1`, [couponD])
    await db.query(`select set_config('app.point_offer_seller', 'off', true)`)
    await asUser(BUYER_3)
    check((await exchange(couponD, 10)).error?.includes('已過期'), '授權過期後不能兌換')
    await asUser(SELLER)
    check((await saveOffer(couponC, false, 40, 5)).data?.enabled === false, '賣家可關閉授權')
    await asUser(BUYER_3)
    check((await exchange(couponC, 40)).error?.includes('此優惠券未開放 Pay 點數兌換'), '關閉後不能兌換')
    mall = await listMall()
    check(mall.data.coupons.length === 0, '關閉與過期的券都不在清單')
    await asUser(SELLER)
    check((await saveOffer(couponC, true, 40, 5)).data?.enabled === true, '賣家可重新開放')
    check((await exchange(couponC, 40)).error?.includes('不能兌換自己賣場的優惠券'), '賣家不能用點數兌換自己的券')
    await asUser(SELLER)
    await rpc('select public.set_my_seller_coupon_flag($1, $2, false)', [couponC, 'active'])
    await asUser(BUYER_3)
    check((await exchange(couponC, 40)).error?.includes('此優惠券未開放 Pay 點數兌換'), '券下架後即使授權仍開著也不能兌換')

    console.log('一般券與權限')
    await asUser(BUYER_3)
    const shelf = await rpc('select public.claim_storefront_coupon($1)', [couponB])
    check(shelf.data?.hold.source === 'shelf' && shelf.data.balance === 50, '一般券照原本方式免費領取，不扣點')
    await asUser(BUYER_3)
    check((await rpc('update public.seller_coupon_point_offers set points_issued = 0')).error?.includes('permission denied'), '會員不能直接改兌換數量')
    await asAnon()
    check((await listMall()).error?.includes('permission denied'), '訪客不能讀取購物優惠區')
    check((await exchange(couponA, 30)).error?.includes('permission denied'), '訪客不能兌換')
    await asOwner()
    await db.query(`select set_config('app.point_offer_seller', 'off', true), set_config('app.point_offer_issue', 'off', true)`)
    check((await rpc(`update public.seller_coupon_point_offers set points_cost = 1 where coupon_id = $1`, [couponA])).error?.includes('只有商家本人可以設定點數兌換'), '就算資料庫擁有者也不能繞過入口改價格')
    check((await rpc(`delete from public.seller_coupon_point_offers where coupon_id = $1`, [couponA])).error?.includes('不可直接刪除'), '授權不可直接刪除')
    for (const id of [BUYER, BUYER_2, BUYER_3, SELLER]) check(await ledgerMatches(id), `會員 ${id.slice(-3)} 餘額等於流水`)

    const mallDefAfter = (await db.query(`select md5(pg_get_functiondef('public.get_my_points_mall()'::regprocedure)) as d`)).rows[0].d
    const exchangeDefAfter = (await db.query(`select md5(pg_get_functiondef('public.exchange_my_coupon(uuid)'::regprocedure)) as d`)).rows[0].d
    check(mallDefBefore === mallDefAfter && exchangeDefBefore === exchangeDefAfter, '既有 get_my_points_mall 與 exchange_my_coupon 沒有被改寫')
  } finally {
    await db.query('ROLLBACK')
    await db.end()
  }
  const left = new pg.Client({ host: '127.0.0.1', port: 54322, user: 'postgres', password, database: 'postgres' })
  await left.connect()
  const gone = await left.query(`select to_regclass('public.seller_coupon_point_offers') is null as ok`)
  await left.end()
  check(gone.rows[0].ok, 'ROLLBACK 後隔離庫沒有留下新表')
  console.log(failures === 0 ? '全部通過' : `${failures} 項失敗`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
