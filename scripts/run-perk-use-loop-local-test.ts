/**
 * 第七階段第 9 批第 6、7 項：動態貼圖與虛擬商品使用閉環。
 * 只連隔離庫 127.0.0.1:54322。商城 v2 與商店街若這份快照還沒有，只在交易內載入既有檔，最後 ROLLBACK。
 * 不改兌換開關，不開 Pay 遊戲點數發放。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { PERK_CATALOG } from '../lib/rewards/perk-catalog'
import { STICKERS, parseStickerMessage, stickerToken, stickerUsable } from '../lib/rewards/stickers'
import {
  newSim,
  newStreet,
  serve,
  setOpen,
  snapshot as streetSnapshot,
  startJob,
  STREET_PRODUCTS,
  tick,
  upgrade,
} from '../lib/arcade/street-rules'

const HOST = '127.0.0.1'
const PORT = 54322
const CONTAINER = 'supabase_db_hengjing-stage45-local'
const A = 'e1000000-0000-4000-8000-0000000000e1'
const B = 'e2000000-0000-4000-8000-0000000000e2'
const C = 'e3000000-0000-4000-8000-0000000000e3'
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

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function checkStickers() {
  const css = readFileSync('components/home/perk-visuals.css', 'utf8')
  const view = readFileSync('components/home/perk-visuals.tsx', 'utf8')
  assert(css.includes('@keyframes pv-frame'), '貼圖沒有兩格切換的動畫')
  assert(view.includes('-idle.png') && view.includes('-a.png') && view.includes('pv-m-'), '貼圖元件沒有用核准立繪的兩個動作格')
  const castStickers = STICKERS.filter((sticker) => sticker.kind === 'cast')
  const payStickers = STICKERS.filter((sticker) => sticker.kind === 'pay-bag')
  const missing: string[] = []
  for (const sticker of castStickers) {
    assert(css.includes(`@keyframes pv-m-${sticker.motion}`), `貼圖 ${sticker.id} 的動作 ${sticker.motion} 沒有動畫`)
    for (const frame of ['idle', 'a']) {
      const file = `public/arcade/street/art/cast/c${sticker.cast}-${frame}.png`
      if (!existsSync(file)) missing.push(file)
    }
    const parsed = parseStickerMessage(stickerToken(sticker.id))
    assert(parsed?.kind === 'cast' && parsed.id === sticker.id && parsed.cast === sticker.cast, `貼圖代號 ${sticker.id} 讀不回來`)
  }
  assert(missing.length === 0, `缺少核准的 Q 版立繪：${missing.join('、')}`)
  assert(castStickers.length === 12, '已核准居民貼圖不是 12 張')
  assert(css.includes('@keyframes pv-pay-frame') && view.includes('pv-pay-frame'), 'Pay 袋仔沒有左右兩格切換')
  for (const sticker of payStickers) {
    const file = `public/stickers/pay-bag/${sticker.id}.png`
    assert(existsSync(file), `缺少 Pay 袋仔素材 ${sticker.id}`)
    assert(sticker.sheet === `/stickers/pay-bag/${sticker.id}.png`, `Pay 袋仔 ${sticker.id} 沒有指向自己的雙格圖`)
    const parsed = parseStickerMessage(stickerToken(sticker.id))
    assert(parsed?.kind === 'pay-bag' && parsed.id === sticker.id && parsed.caption === sticker.caption, `Pay 袋仔 ${sticker.id} 讀不回來`)
  }
  assert(payStickers.length === 18, 'Pay 袋仔不是 18 張')
  assert(new Set(STICKERS.map((sticker) => sticker.id)).size === STICKERS.length, '貼圖識別碼重複')
  assert(STICKERS.length === 30, '免費動態貼圖不是 30 張')
  assert(STICKERS.every((sticker) => stickerUsable(sticker, [])), '未持有貼圖包時已收錄貼圖不能播放')
  assert(parseStickerMessage('[[sticker:not-a-real-sticker]]') == null, '非法貼圖代號被當成可播放')
  assert(parseStickerMessage('[[sticker:base-ok]]')?.caption === '收到', '舊貼圖訊息讀不回')
  pass('12 張居民貼圖與 18 張 Pay 袋仔都可播放，不需持有即可使用')
}

function playToLevel2() {
  let auto = { progress: newStreet(CLOCK), sim: newSim(newStreet(CLOCK)) }
  const first = streetSnapshot(auto)
  auto = setOpen(auto, true, CLOCK)
  const rand = seeded(11)
  const steps: { elapsed: number; payload: unknown }[] = []
  let last = 0
  for (let i = 0; i < 400_000 && auto.progress.shopLevel < 2; i += 1) {
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
    const up = upgrade(auto, CLOCK)
    if (up.ok) auto = up.state
    if (auto.sim.t - last >= 10_000) {
      steps.push({ elapsed: (auto.sim.t - last) / 1000, payload: streetSnapshot(auto) })
      last = auto.sim.t
    }
  }
  assert(auto.progress.shopLevel >= 2, '商店街沒有升到裝潢所需的 Lv.2')
  steps.push({ elapsed: Math.max(1, (auto.sim.t - last) / 1000), payload: streetSnapshot(auto) })
  return { first, steps }
}

async function apply(file: string) {
  await db.query(body(file))
  await db.query('RESET ROLE')
  loaded.push(file)
}

async function asUser(userId: string) {
  await db.query('RESET ROLE')
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await db.query('SET LOCAL ROLE authenticated')
  const uid = await db.query('select auth.uid() as uid')
  assert(uid.rows[0].uid === userId, '隔離庫沒有綁到指定會員')
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

async function purchase(id: string) {
  const row = await db.query('select public.purchase_my_perk($1) as r', [id])
  return row.rows[0].r as { balance: number; replayed: boolean; owned: string[] }
}

async function equip(id: string, on: boolean) {
  const row = await db.query('select public.set_my_perk_equipped($1, $2) as r', [id, on])
  return row.rows[0].r as { balance: number; replayed: boolean; equipped: Record<string, string | null> }
}

async function main() {
  assert(HOST === '127.0.0.1' && PORT === 54322, '拒絕連到隔離庫以外的資料庫')
  const dockerPort = execSync(`docker port ${CONTAINER} 5432`, { encoding: 'utf8' })
  assert(dockerPort.includes('54322'), '54322 不是 hengjing-stage45-local')
  checkStickers()
  await db.connect()
  const before = await db.query(`
    select
      (select count(*) from public.member_perk_catalog)::int as catalog,
      (select coalesce(sum(cost),0) from public.member_perk_catalog)::int as cost,
      (select purchase_enabled from public.member_perk_settings) as purchase,
      (select coalesce(bool_or(payout_enabled), false) from public.game_reward_policies) as payout,
      (select count(*) from public.member_point_accounts)::int as accounts,
      (select coalesce(sum(balance),0) from public.member_point_accounts)::int as balance,
      (select count(*) from public.member_point_entries)::int as entries,
      (select count(*) from public.member_perk_holds)::int as holds,
      (select to_regclass('public.member_perk_sale_windows') is not null) as mall_v2,
      (select to_regclass('public.member_street_saves') is not null) as street
  `)
  const snap = before.rows[0]
  console.log('套用前', snap)
  assert(snap.payout === false, '隔離庫的 Pay 遊戲點數發放不是關閉')
  await db.query('BEGIN')
  await db.query(`set statement_timeout = '180s'`)
  try {
    if (!snap.mall_v2) await apply('supabase/manual/20261030020100_points_mall_v2_apply.sql')
    if (!(await db.query(`select to_regclass('public.member_street_friends') is not null as ok`)).rows[0].ok) {
      await apply('supabase/manual/20261029220200_street_friend_help_apply.sql')
    }
    if (!(await db.query(`select to_regclass('public.member_street_steals') is not null as ok`)).rows[0].ok) {
      await apply('supabase/manual/20261029230100_street_steal_explore_apply.sql')
    }
    if (!(await db.query(`select to_regclass('public.member_street_saves') is not null as ok`)).rows[0].ok) {
      await apply('supabase/manual/20261030010100_street_cloud_save_apply.sql')
    }
    const catalog = await db.query('select count(*)::int as n from public.member_perk_catalog')
    assert(catalog.rows[0].n === 40, `目錄不是 40 件（${catalog.rows[0].n}）`)
    const original = PERK_CATALOG.filter((perk) => perk.since === 1)
    const costs = await db.query('select id, cost from public.member_perk_catalog where id = any($1::text[])', [original.map((perk) => perk.id)])
    for (const perk of original) {
      const row = costs.rows.find((item) => item.id === perk.id)
      assert(row && Number(row.cost) === perk.cost, `原有商品 ${perk.id} 的價格被改掉`)
    }
    pass('40 件目錄保留原 15 件編號與價格')

    await db.query('RESET ROLE')
    await db.query(
      `insert into auth.users (id, email, aud, role, instance_id) values
        ($1, 'perk-e1@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($2, 'perk-e2@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        ($3, 'perk-e3@example.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')`,
      [A, B, C],
    )
    await db.query(`insert into public.seller_applications (user_id, store_name, status) values ($1, '貼圖測試店', 'approved')`, [B])
    await db.query('set local session_replication_role = replica')
    await db.query(
      `with seed as (
         insert into public.member_point_entries (user_id, delta, balance_after, kind, claim_key, taipei_day, metadata)
         values ($1, 2000, 2000, 'scratch', 'scratch:perk-use-seed', public.taipei_today(), '{}'::jsonb)
         returning id, user_id, delta, balance_after, kind, claim_key, taipei_day
       )
       insert into public.reward_claims (user_id, kind, claim_key, taipei_day, delta, balance_after, point_entry_id, metadata)
       select user_id, kind, claim_key, taipei_day, delta, balance_after, id, '{}'::jsonb from seed`,
      [A],
    )
    await db.query('insert into public.member_point_accounts (user_id, balance) values ($1, 2000)', [A])
    await db.query('set local session_replication_role = origin')
    const othersBefore = await db.query('select coalesce(sum(balance),0)::int as balance from public.member_point_accounts where user_id <> all($1::uuid[])', [[A, B, C]])

    await asUser(A)
    const pairs: Array<[string, string, string]> = [
      ['bubble-milktea', 'bubble-memo', 'bubble'],
      ['pet-cat', 'pet-shiba', 'pet'],
      ['skin-cyber', 'skin-ink', 'skin'],
      ['board-wood', 'board-arcade', 'board'],
      ['scene-sakura', 'scene-harbor', 'scene'],
      ['effect-snow', 'effect-hearts', 'effect'],
    ]
    for (const [first, second, slot] of pairs) {
      const bought = await purchase(first)
      assert(bought.replayed === false && bought.owned.includes(first), `${first} 沒有入庫`)
      const again = await purchase(first)
      assert(again.replayed === true && again.balance === bought.balance, `${first} 重送又扣了點`)
      const on = await equip(first, true)
      assert(on.equipped[slot] === first && on.balance === bought.balance, `${first} 裝備時扣了點或沒生效`)
      const secondBuy = await purchase(second)
      const swapped = await equip(second, true)
      assert(swapped.equipped[slot] === second && swapped.balance === secondBuy.balance, `${slot} 切換沒有換成新的一件或另外扣點`)
      const off = await equip(second, false)
      assert(off.equipped[slot] == null && off.balance === secondBuy.balance, `${slot} 卸下時扣了點`)
      const back = await equip(second, true)
      assert(back.equipped[slot] === second && back.balance === secondBuy.balance && back.replayed === false, `${slot} 重新套用沒有保留`)
    }
    await db.query('RESET ROLE')
    const partyRow = await db.query(`select active, cost from public.member_perk_catalog where id = 'sticker-party'`)
    const activeCount = await db.query('select count(*)::int as n from public.member_perk_catalog where active')
    assert(partyRow.rows[0].active === false && Number(partyRow.rows[0].cost) === 150, '貼圖包沒有停售，或歷史定價被改掉')
    assert(activeCount.rows[0].n === 39, `有效商城件數不是 39（${activeCount.rows[0].n}）`)
    const balanceBefore = await db.query('select balance::int as balance from public.member_point_accounts where user_id = $1', [A])
    const entriesBefore = await db.query(`select count(*)::int as n from public.member_point_entries where user_id = $1 and claim_key = 'perk_unlock:sticker-party'`, [A])
    await asUser(A)
    await expectFail(`select public.purchase_my_perk('sticker-party')`, /無法購買/, '已停售的貼圖包仍可扣點')
    await db.query('RESET ROLE')
    const balanceAfter = await db.query('select balance::int as balance from public.member_point_accounts where user_id = $1', [A])
    const entriesAfter = await db.query(`select count(*)::int as n from public.member_point_entries where user_id = $1 and claim_key = 'perk_unlock:sticker-party'`, [A])
    assert(balanceAfter.rows[0].balance === balanceBefore.rows[0].balance && entriesAfter.rows[0].n === entriesBefore.rows[0].n, '停售貼圖包仍然扣點或寫入流水')
    pass('氣泡、寵物、外觀、棋盤、場景、特效可兌換、切換、卸下與再套用，且不重複扣點；貼圖包已停售')

    await db.query('RESET ROLE')
    const mergeBefore = await db.query(`select coalesce(md5(string_agg(user_id::text || ':' || shop_level::text || ':' || lifetime_orders::text, ',' order by user_id)), '') as sig from public.member_merge_shops`)
    const street = playToLevel2()
    await asUser(A)
    const imported = await db.query('select public.import_my_street_save($1::jsonb, gen_random_uuid()) as r', [JSON.stringify(street.first)])
    assert(imported.rows[0].r.ok === true, `新店轉移失敗：${JSON.stringify(imported.rows[0].r)}`)
    let revision = 1
    for (const step of street.steps) {
      await db.query('RESET ROLE')
      await db.query(`update public.member_street_saves set updated_at = updated_at - make_interval(secs => $1) where user_id = $2`, [step.elapsed, A])
      await asUser(A)
      const saved = await db.query('select public.save_my_street($1, $2::jsonb, gen_random_uuid()) as r', [revision, JSON.stringify(step.payload)])
      assert(saved.rows[0].r.ok === true, `升到裝潢等級的存檔被拒：${saved.rows[0].r.reason ?? JSON.stringify(saved.rows[0].r)}`)
      revision = Number(saved.rows[0].r.revision)
    }
    await db.query('RESET ROLE')
    const level = await db.query('select shop_level::int as level from public.member_street_saves where user_id = $1', [A])
    assert(level.rows[0].level >= 2, '讀回的店面等級不到 2')
    await asUser(A)
    const decor = await purchase('decor-balloon')
    const decorOn = await equip('decor-balloon', true)
    assert(decor.owned.includes('decor-balloon') && decorOn.equipped.decor === 'decor-balloon' && decorOn.balance === decor.balance, '裝潢沒有裝備到街景欄')
    const decorOff = await equip('decor-balloon', false)
    const decorBack = await equip('decor-balloon', true)
    assert(decorOff.equipped.decor == null && decorBack.equipped.decor === 'decor-balloon' && decorBack.balance === decor.balance, '裝潢卸下或再套用改了點數')
    pass('商店街升到 Lv.2 後可裝備裝潢，切換不另扣點')

    await db.query('RESET ROLE')
    await asUser(A)
    const mine = await db.query('select public.list_my_perks() as r')
    assert(mine.rows[0].r.equipped.bubble === 'bubble-memo', '重新讀取後聊天氣泡沒有保留')
    assert(mine.rows[0].r.equipped.pet === 'pet-shiba', '重新讀取後寵物沒有保留')
    assert(mine.rows[0].r.equipped.skin === 'skin-ink', '重新讀取後個人頁外觀沒有保留')
    assert(mine.rows[0].r.equipped.board === 'board-arcade', '重新讀取後方塊棋盤沒有保留')
    assert(mine.rows[0].r.equipped.scene === 'scene-harbor', '重新讀取後場景沒有保留')
    assert(mine.rows[0].r.equipped.effect === 'effect-hearts', '重新讀取後個人頁特效沒有保留')
    assert(mine.rows[0].r.equipped.decor === 'decor-balloon', '重新讀取後裝潢沒有保留')
    assert(!mine.rows[0].r.owned.includes('sticker-party'), '停售後仍把貼圖包記成新持有')
    pass('重新登入讀回持有與裝備')

    await asUser(B)
    await expectFail(`select public.set_my_perk_equipped('bubble-memo', true)`, /尚未擁有/, '未持有者不能裝備')
    await expectFail(
      `insert into public.member_perk_holds (user_id, perk_id, category, cost, claim_key, point_entry_id) values ('${A}', 'pet-cat', 'pet', 1, 'perk_unlock:pet-cat', gen_random_uuid())`,
      /permission denied|會員不能自行建立/,
      '不能竄改別人的持有',
    )
    const publicRows = await db.query('select public.public_equipped_perks($1::uuid[]) as rows', [[A, B]])
    const shown = (publicRows.rows[0].rows as Array<Record<string, unknown>>).find((row) => row.userId === A)
    assert(shown?.bubble === 'bubble-memo' && shown.pet === 'pet-shiba' && shown.decor === 'decor-balloon', '公開展示沒有帶出已裝備的外觀')
    assert(!Array.isArray(shown?.stickers) || !(shown.stickers as string[]).includes('sticker-party'), '沒有購買仍公開了貼圖包持有')
    assert(!('owned' in (shown ?? {})), '公開展示帶出了未選擇的收藏清單')
    const hidden = await db.query('select public.list_my_perks() as r')
    assert(!hidden.rows[0].r.owned.includes('bubble-memo'), '另一位會員讀到別人的收藏')
    pass('只公開已裝備的外觀與已持有貼圖包，不能改別人的收藏')

    await asUser(A)
    const chat = await db.query('select public.open_seller_chat($1) as id', [B])
    const chatId = chat.rows[0].id as string
    const baseBody = stickerToken('base-thanks')
    const partyBody = stickerToken('party-birthday')
    await db.query('select public.send_seller_chat_message($1, $2)', [chatId, baseBody])
    await db.query('select public.send_seller_chat_message($1, $2)', [chatId, partyBody])
    await asUser(B)
    const seen = await db.query('select public.list_seller_chat_messages($1) as rows', [chatId])
    const bodies = (seen.rows[0].rows as Array<{ body: string; sender_id: string }>).map((row) => row.body).sort()
    assert(bodies.includes(baseBody) && bodies.includes(partyBody), '對方讀到的貼圖代號不同')
    await db.query('RESET ROLE')
    await asUser(A)
    const reread = await db.query('select public.list_seller_chat_messages($1) as rows', [chatId])
    const againBodies = (reread.rows[0].rows as Array<{ body: string }>).map((row) => row.body).sort()
    assert(JSON.stringify(againBodies) === JSON.stringify(bodies), '重新讀取後貼圖訊息變了')
    assert(parseStickerMessage(baseBody)?.caption === '謝謝！', '基本貼圖讀不回說明')
    assert(stickerUsable(parseStickerMessage(partyBody)!, []), '沒有貼圖包時原加購貼圖不能播放')
    await asUser(B)
    await db.query('select public.send_seller_chat_message($1, $2)', [chatId, stickerToken('party-go')])
    await asUser(A)
    const both = await db.query('select public.list_seller_chat_messages($1) as rows', [chatId])
    const bothBodies = (both.rows[0].rows as Array<{ body: string }>).map((row) => row.body)
    assert(bothBodies.includes(stickerToken('party-go')), '未持有貼圖包的會員送不出原加購貼圖')
    const fakeBody = '[[sticker:not-a-real-sticker]]'
    await db.query('select public.send_seller_chat_message($1, $2)', [chatId, fakeBody])
    const withFake = await db.query('select public.list_seller_chat_messages($1) as rows', [chatId])
    const fakeBodies = (withFake.rows[0].rows as Array<{ body: string }>).map((row) => row.body)
    assert(fakeBodies.includes(fakeBody) && parseStickerMessage(fakeBody) == null, '非法貼圖代號沒有保留成一般文字')
    await db.query('RESET ROLE')
    await db.query(`select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)`)
    await expectFail(`select public.send_seller_chat_message('${chatId}', '${baseBody}')`, /請先登入/, '未登入仍可送貼圖')
    await asUser(C)
    await expectFail(`select public.list_seller_chat_messages('${chatId}')`, /不能查看這則對話/, '外人不能讀這則聊天')
    pass('聊天貼圖免持有即可雙向送出與重讀；未登入、非會話成員與非法代號仍被擋下')

    await db.query('RESET ROLE')
    const othersAfter = await db.query('select coalesce(sum(balance),0)::int as balance from public.member_point_accounts where user_id <> all($1::uuid[])', [[A, B, C]])
    const mergeAfter = await db.query(`select coalesce(md5(string_agg(user_id::text || ':' || shop_level::text || ':' || lifetime_orders::text, ',' order by user_id)), '') as sig from public.member_merge_shops`)
    const flags = await db.query(`select (select purchase_enabled from public.member_perk_settings) as purchase, (select coalesce(bool_or(payout_enabled), false) from public.game_reward_policies) as payout`)
    assert(othersAfter.rows[0].balance === othersBefore.rows[0].balance, '其他會員的點數被改動')
    assert(mergeAfter.rows[0].sig === mergeBefore.rows[0].sig, '外觀裝備改動了合成小舖等級或分數')
    assert(flags.rows[0].purchase === snap.purchase && flags.rows[0].payout === false, '兌換開關或 Pay 發放被改掉')
    pass('外觀沒有改遊戲分數，兌換開關與 Pay 發放維持原狀')

    await db.query('ROLLBACK')
    await db.query('RESET ROLE')
    const after = await db.query(`
      select
        (select count(*) from public.member_perk_catalog)::int as catalog,
        (select coalesce(sum(cost),0) from public.member_perk_catalog)::int as cost,
        (select purchase_enabled from public.member_perk_settings) as purchase,
        (select coalesce(bool_or(payout_enabled), false) from public.game_reward_policies) as payout,
        (select count(*) from public.member_point_accounts)::int as accounts,
        (select coalesce(sum(balance),0) from public.member_point_accounts)::int as balance,
        (select count(*) from public.member_point_entries)::int as entries,
        (select count(*) from public.member_perk_holds)::int as holds,
        (select to_regclass('public.member_perk_sale_windows') is not null) as mall_v2,
        (select to_regclass('public.member_street_saves') is not null) as street
    `)
    assert(JSON.stringify(after.rows[0]) === JSON.stringify(snap), `交易沒有還原：${JSON.stringify(snap)} -> ${JSON.stringify(after.rows[0])}`)
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
